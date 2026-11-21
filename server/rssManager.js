'use strict';
/**
 * rssManager.js — Descarga y parseo de fuentes RSS/Atom sin dependencias externas.
 * - Reintentos con espera escalonada.
 * - Timeout por fuente.
 * - Nunca lanza excepciones no controladas: devuelve resultados con error.
 */
const { stripHtml, isSafeUrl, upgradeHttps } = require('./utils');

const USER_AGENT = 'AyamonteAlDia/1.0 (+https://localhost; agregador de noticias local)';
const TIMEOUT_MS = 15000;

/** Espera en milisegundos. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga una URL con timeout usando fetch nativo.
 */
async function fetchText(url, { timeout = TIMEOUT_MS, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', ...headers }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Parser XML mínimo (suficiente para RSS 2.0 / RSS 1.0 / Atom)        */
/* ------------------------------------------------------------------ */

/** Decodifica entidades comunes en feeds. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    })
    .replace(/&amp;/g, '&');
}

/** Devuelve el contenido de la primera etiqueta encontrada (con o sin espacio de nombres). */
function pickTag(block, names) {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const m = block.match(re);
    if (m) return decodeEntities(m[1]).trim();
  }
  return '';
}

/** Extrae un atributo de la etiqueta de apertura. */
function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * Parsea un documento RSS/Atom y devuelve items normalizados:
 * { title, link, description, content, pubDate, image, guid }
 */
function parseFeed(xml) {
  const items = [];
  if (!xml || typeof xml !== 'string') return items;

  // ¿Atom? -> <entry> ; RSS -> <item>
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const tag = isAtom ? 'entry' : 'item';
  const blocks = xml.split(new RegExp(`<${tag}[\\s>]`, 'i')).slice(1);

  for (const raw of blocks) {
    const end = raw.search(new RegExp(`</${tag}>`, 'i'));
    const block = end > -1 ? raw.slice(0, end) : raw;

    const title = stripHtml(pickTag(block, ['title']));
    let link = pickTag(block, ['link']);
    if (isAtom) {
      // En Atom el <link> puede estar como etiqueta vacía con atributo href
      if (!link || /^https?:\/\/\s*$/i.test(link)) {
        link = pickAttr(block, 'link', 'href');
      }
    }
    if (!link) link = pickAttr(block, 'link', 'href') || pickAttr(block, 'guid', 'isPermaLink');

    // Feeds con estructura anidada (p. ej. Junta de Andalucía): el título real
    // y la URL viven dentro de <content> (<data><title>, <alias>).
    let finalTitle = title;
    let finalLink = link;
    const allTitles = [...block.matchAll(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/gi)]
      .map((m) => stripHtml(decodeEntities(m[1])))
      .filter((t) => t && t !== title && !/^[A-Za-z]{2,10}-?\d{3,}$/.test(t));
    if (allTitles.length) {
      allTitles.sort((a, b) => b.length - a.length);
      if (!title || /^[A-Za-z]{2,10}-?\d{3,}$/.test(title)) finalTitle = allTitles[0];
    }
    if (!finalLink) {
      const alias = stripHtml(pickTag(block, ['alias']));
      if (alias && isSafeUrl(alias)) finalLink = alias;
    }

    const description =
      pickTag(block, ['description', 'summary']) ||
      stripHtml(pickTag(block, ['field_subtitle_noticias'])) ||
      '';
    const content =
      pickTag(block, ['content:encoded', 'content']) ||
      stripHtml(pickTag(block, ['field_noticia_texto_completo']));
    const pubDate =
      pickTag(block, ['pubDate', 'field_fecha_publicacion', 'published', 'updated', 'dc:date', 'date']) ||
      '';

    // Imagen: media:content / enclosure / <uri> anidado / <img> del contenido
    let image =
      pickAttr(block, 'media:content', 'url') ||
      pickAttr(block, 'enclosure', 'url') ||
      '';
    if (!image) {
      const nestedUri = stripHtml(pickTag(block, ['field_media_image', 'thumbnail']))
        .match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)/i);
      if (nestedUri) image = nestedUri[0];
    }
    if (!image) {
      const mImg = (content || description).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (mImg) image = mImg[1];
    } else if (!/^https?:\/\//i.test(image)) {
      image = '';
    }

    const guid = pickTag(block, ['guid', 'id']) || finalLink;

    if (finalTitle && finalLink) {
      items.push({
        title: stripHtml(finalTitle),
        link: finalLink.trim(),
        description: stripHtml(description).slice(0, 3000),
        content: stripHtml(content).slice(0, 8000),
        pubDate: normalizeDate(pubDate),
        image: image && isSafeUrl(image) ? upgradeHttps(image) : '',
        guid
      });
    }
  }
  return items;
}

/** Convierte fechas de feed a ISO 8601 (o null si no se puede). */
function normalizeDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let d = new Date(s);
  if (isNaN(d.getTime())) {
    // Formatos habituales en feeds españoles: 17/11/2026 12:30
    const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00`);
    }
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Descarga y parsea una fuente con reintentos.
 * @returns {{ok:boolean, items:Array, error?:string}}
 */
async function loadFeed(source, { retries = 2 } = {}) {
  if (!isSafeUrl(source.url)) return { ok: false, items: [], error: 'URL no válida' };
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const xml = await fetchText(source.url);
      const items = parseFeed(xml);
      if (!items.length) return { ok: false, items: [], error: 'Feed sin elementos legibles' };
      return { ok: true, items };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  return { ok: false, items: [], error: lastErr ? lastErr.message : 'Error desconocido' };
}

/**
 * Carga varias fuentes en paralelo (con límite de concurrencia).
 * Una fuente que falle no detiene al resto.
 */
async function loadFeeds(sources, { concurrency = 4 } = {}) {
  const results = [];
  const queue = [...sources];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const src = queue.shift();
      const r = await loadFeed(src);
      results.push({ source: src, ...r });
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = { parseFeed, loadFeed, loadFeeds, fetchText, normalizeDate, decodeEntities };
