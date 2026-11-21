'use strict';
/**
 * newsCollector.js — Orquestador de la recopilación de noticias.
 *
 * Flujo:
 *   1. Descarga las fuentes RSS/Atom habilitadas (y búsqueda web si está configurada).
 *   2. Filtra por relevancia real con Ayamonte y su entorno.
 *   3. Detecta duplicados (URL, huella, titular similar).
 *   4. Clasifica, resume y genera titular alternativo con IA (o reglas locales).
 *   5. Guarda en SQLite con estado pending/approved según configuración.
 *   6. Registra historial y errores.
 *
 * Ejecución:
 *   - Automática: scheduler.js (cada N minutos).
 *   - Manual: POST /api/admin/collect
 *   - CLI:     node server/newsCollector.js --once
 */
const db = require('./database');
const { loadFeeds } = require('./rssManager');
const searchProvider = require('./searchProvider');
const aiProcessor = require('./aiProcessor');
const { isSafeUrl, upgradeHttps, truncate, fingerprint } = require('./utils');

let running = false; // evita búsquedas simultáneas

function isRunning() {
  return running;
}

/**
 * Ejecuta una ronda completa de recopilación.
 * @param {object} opts
 * @param {'manual'|'auto'|'topic'} opts.trigger
 * @param {string} [opts.query] consulta temática adicional
 * @returns {Promise<object>} resumen de la ejecución
 */
async function collect({ trigger = 'manual', query = null } = {}) {
  if (running) {
    return { skipped: true, message: 'Ya hay una recopilación en curso' };
  }
  running = true;
  const historyId = db.startHistory({
    triggerType: trigger,
    query,
    provider: `${searchProvider.getProvider()} / ${aiProcessor.getProvider()}`
  });

  const stats = {
    sourcesTotal: 0,
    itemsFound: 0,
    newAdded: 0,
    duplicates: 0,
    rejected: 0,
    sourceErrors: []
  };

  try {
    const cfg = db.loadConfigFile();
    const nearbyPlaces = cfg.nearbyPlaces || [];

    /* 1. Fuentes RSS/Atom ------------------------------------------------ */
    const sources = db.getSources().filter((s) => s.enabled);
    stats.sourcesTotal = sources.length;

    const feedResults = await loadFeeds(sources);

    const candidates = [];
    for (const r of feedResults) {
      if (!r.ok) {
        db.markSourceResult(r.source.id, 'error', r.error);
        db.logError('rssManager', `Fuente "${r.source.name}" no responde`, r.error, 'warn');
        stats.sourceErrors.push({ source: r.source.name, error: r.error });
        continue;
      }
      db.markSourceResult(r.source.id, 'ok', null);
      for (const item of r.items) {
        candidates.push({
          ...item,
          sourceName: r.source.name,
          sourceId: r.source.id
        });
      }
    }

    /* 2. Búsqueda web (opcional) ---------------------------------------- */
    if (searchProvider.isConfigured()) {
      const queries = [];
      if (query) queries.push(query);
      const cfgQueries = db.getConfig('search_queries', '') || '';
      queries.push(...cfgQueries.split(',').map((q) => q.trim()).filter(Boolean));
      if (!queries.length) queries.push('Ayamonte');

      const seen = new Set(candidates.map((c) => c.link));
      for (const q of [...new Set(queries)].slice(0, 5)) {
        const res = await searchProvider.searchWeb(q, 8);
        if (!res.ok && res.error) {
          db.logError('searchProvider', `Búsqueda "${q}" fallida`, res.error, 'warn');
          stats.sourceErrors.push({ source: `Búsqueda: ${q}`, error: res.error });
          continue;
        }
        for (const r of res.results) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          candidates.push({
            title: r.title,
            link: r.url,
            description: r.snippet || '',
            content: r.snippet || '',
            pubDate: null,
            image: '',
            guid: r.url,
            sourceName: `Búsqueda web (${res.provider})`,
            sourceId: null
          });
        }
      }
    }

    stats.itemsFound = candidates.length;

    /* 3. Procesado: primero los candidatos con relación real con Ayamonte
     *    (prefiltrado local barato) y después el límite por ejecución.       */
    const MAX_PER_RUN = 60;
    const prefiltered = candidates.filter((c) => {
      const text = `${c.title} ${c.description} ${c.content}`;
      return aiProcessor.isRelevant(text, nearbyPlaces);
    });
    stats.relevantCandidates = prefiltered.length;
    const toProcess = prefiltered.slice(0, MAX_PER_RUN);

    const recentTitles = db
      .getDb()
      .prepare("SELECT title FROM news WHERE created_at >= datetime('now', '-30 days') LIMIT 500")
      .all()
      .map((r) => r.title);

    const publicationMode = db.getConfig('publication_mode', 'manual');
    const autoPublish = publicationMode === 'auto';

    for (const item of toProcess) {
      try {
        if (!isSafeUrl(item.link)) {
          stats.rejected++;
          continue;
        }
        item.link = upgradeHttps(item.link);

        // Filtrado de relevancia + IA (o reglas locales)
        const ai = await aiProcessor.processWithAI(item, {
          existingTitles: recentTitles,
          nearbyPlaces
        });

        if (!ai.relevant) {
          stats.rejected++;
          continue;
        }
        if (ai.duplicateOf) {
          stats.duplicates++;
          continue;
        }

        const title = (ai.altTitle || item.title || '').trim();
        if (!title) {
          stats.rejected++;
          continue;
        }

        // La imagen solo se asocia si viene en metadatos del feed (no se descarga).
        const image = item.image && isSafeUrl(item.image) ? upgradeHttps(item.image) : null;

        const result = db.insertNews({
          title,
          alt_title: ai.altTitle && ai.altTitle !== title ? ai.altTitle : null,
          summary: ai.summary || truncate(stripLite(item.content || item.description), 260),
          body_excerpt: truncate(stripLite(item.content || item.description), 1200),
          url: item.link,
          image_url: image,
          image_source: image ? item.sourceName : null,
          source_name: item.sourceName || 'Desconocido',
          source_id: item.sourceId || null,
          published_at: ai.publishedAt || item.pubDate || null,
          primary_section: ai.primarySection,
          sections: ai.sections,
          tags: ai.tags,
          status: autoPublish ? 'approved' : 'pending',
          featured: 0,
          is_demo: 0,
          ai_processed: 1,
          ai_provider: ai.provider,
          fingerprint: fingerprint({ title: item.title, url: item.link, sourceName: item.sourceName })
        });

        if (result.inserted) {
          stats.newAdded++;
          recentTitles.push(item.title);
        } else {
          stats.duplicates++;
        }
      } catch (err) {
        stats.rejected++;
        db.logError('newsCollector', 'Error procesando un ítem', `${item.title || ''} — ${err.message}`, 'warn');
      }
    }

    db.finishHistory(historyId, {
      ...stats,
      status: 'ok',
      message: `Fuentes: ${stats.sourcesTotal} · Encontrados: ${stats.itemsFound} · Nuevas: ${stats.newAdded} · Duplicadas: ${stats.duplicates} · Descartadas: ${stats.rejected}`
    });
    db.setConfig('last_collect_at', new Date().toISOString());

    return { ...stats, historyId, status: 'ok' };
  } catch (err) {
    db.logError('newsCollector', 'Fallo general en la recopilación', err.message);
    db.finishHistory(historyId, { ...stats, status: 'error', message: err.message });
    return { ...stats, status: 'error', error: err.message, historyId };
  } finally {
    running = false;
  }
}

function stripLite(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* CLI: node server/newsCollector.js --once                            */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  (async () => {
    db.init();
    console.log('[collector] Iniciando recopilación manual (CLI)...');
    const res = await collect({ trigger: 'manual' });
    console.log('[collector] Resultado:', JSON.stringify(res, null, 2));
    process.exit(res.status === 'error' ? 1 : 0);
  })();
}

module.exports = { collect, isRunning };
