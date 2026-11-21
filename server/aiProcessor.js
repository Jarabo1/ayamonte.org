'use strict';
/**
 * aiProcessor.js — Módulo de inteligencia artificial configurable.
 *
 * Proveedores soportados (variables de entorno, nunca en el frontend):
 *   - none      : procesador local por reglas (sin API): relevancia, clasificación,
 *                 resumen extractivo y detección de duplicados. No inventa contenido.
 *   - openai    : API compatible con OpenAI (OPENAI-compatible /chat/completions)
 *   - openrouter: https://openrouter.ai/api/v1
 *   - anthropic : API de Anthropic (messages)
 *   - generic   : endpoint propio compatible con OpenAI (AI_API_URL)
 *
 * REGLAS DE CONTENIDO:
 *   - No se inventan noticias, declaraciones, fechas ni acontecimientos.
 *   - Los resúmenes se generan solo a partir del texto proporcionado.
 *   - Si la IA no responde con JSON válido, se aplica el procesador local.
 */
const { stripHtml, truncate, normalizeText, textSimilarity } = require('./utils');

const TIMEOUT_MS = 45000;

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

function getProvider() {
  return (process.env.AI_PROVIDER || 'none').toLowerCase();
}

function isConfigured() {
  const p = getProvider();
  if (p === 'none') return false;
  if (p === 'generic') return !!process.env.AI_API_URL;
  if (p === 'openai' || p === 'openrouter') return !!(process.env.AI_API_KEY || process.env.AI_API_URL);
  if (p === 'anthropic') return !!process.env.AI_API_KEY;
  return false;
}

function baseUrl() {
  const p = getProvider();
  if (process.env.AI_API_URL) return process.env.AI_API_URL.replace(/\/+$/, '');
  if (p === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (p === 'anthropic') return 'https://api.anthropic.com';
  return 'https://api.openai.com/v1';
}

function modelName() {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  const p = getProvider();
  if (p === 'openrouter') return 'openai/gpt-4o-mini';
  if (p === 'anthropic') return 'claude-3-5-haiku-latest';
  if (p === 'openai' || p === 'generic') return 'gpt-4o-mini';
  return '';
}

/* ------------------------------------------------------------------ */
/* Procesador local por reglas (funciona sin API key)                  */
/* ------------------------------------------------------------------ */

const PLACES = [
  'ayamonte', 'isla cristina', 'lepe', 'villablanca', 'cartaya',
  'villanueva de los castillejos', 'el rompido', 'punta umbría',
  'sanlúcar de guadiana', 'el granado', 'san silvestre de guadiana',
  'aljaraque', 'isla cristina-lepe'
];

const AYAMONTE_KEYWORDS = [
  'ayamonte', 'ayamontino', 'ayamontina', 'ayuntamiento de ayamonte',
  'canela', 'isla canela', 'punta del moral', 'pozo del camino',
  'guadiana', 'cd ayamonte', 'puerto de ayamonte'
];

/** ¿El texto tiene relación real con Ayamonte o su entorno? */
function isRelevant(text, extraPlaces = []) {
  const t = normalizeText(text);
  const places = PLACES.concat(extraPlaces || []).concat(AYAMONTE_KEYWORDS).map(normalizeText);
  return places.some((p) => p && t.includes(p));
}

/** Clasifica el texto: 'ayamonte' (principal) o 'comarca'. */
function classify(text) {
  const t = normalizeText(text);
  const isAyamonte = AYAMONTE_KEYWORDS.some((w) => t.includes(normalizeText(w)));
  if (isAyamonte) {
    return ['ayamonte'];
  }
  return ['comarca'];
}

/** Extrae entidades/etiquetas temáticas básicas. */
function extractTags(text, max = 6) {
  const t = normalizeText(text);
  const candidates = [
    'ayamonte', 'isla cristina', 'lepe', 'cartaya', 'villablanca', 'semana santa',
    'carnaval', 'deportes', 'ayuntamiento', 'empleo', 'turismo', 'guadiana',
    'cultura', 'sucesos', 'política', 'medio ambiente', 'comarca'
  ];
  return candidates.filter((c) => t.includes(c)).slice(0, max);
}

/**
 * Resumen extractivo: elige las 2-3 frases más relevantes del texto original.
 * No genera información nueva (no inventa).
 */
function localSummary(text, maxLen = 260) {
  const clean = stripHtml(text);
  if (!clean) return '';
  const sentences = clean
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30);

  if (!sentences.length) return truncate(clean, maxLen);

  const t = normalizeText(clean);
  const keywords = PLACES.map(normalizeText).filter((p) => t.includes(p));

  const scored = sentences.map((s, i) => {
    const ns = normalizeText(s);
    let score = 0;
    if (keywords.some((k) => ns.includes(k))) score += 3;
    if (i === 0) score += 2;
    if (/ayamonte/i.test(s)) score += 2;
    score += Math.min(ns.split(' ').length / 30, 1);
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);

  let out = '';
  for (const { s } of scored) {
    if ((out + ' ' + s).trim().length > maxLen) break;
    out = (out + ' ' + s).trim();
  }
  return out || truncate(clean, maxLen);
}

/** Titular alternativo: solo acorta/limpia el original, nunca cambia el sentido. */
function localAltTitle(title, max = 110) {
  if (!title || title.length <= max) return null;
  let t = title.replace(/\s*[|\-–—]\s*[^|\-–—]{3,}$/, '').trim(); // quita " | Medio"
  t = truncate(t, max);
  return t && t !== title ? t : null;
}

/** Resultado local por reglas (fallback sin IA externa). */
function processLocal(item, { existingTitles = [] } = {}) {
  const text = `${item.title} ${item.description} ${item.content}`;
  const relevant = isRelevant(text);
  const sections = classify(text);
  const summary = localSummary(item.content || item.description || item.title);
  const altTitle = localAltTitle(item.title);

  // Duplicado por similitud de titular con noticias ya almacenadas
  let duplicateOf = null;
  for (const t of existingTitles) {
    if (textSimilarity(item.title, t) > 0.7) {
      duplicateOf = t;
      break;
    }
  }

  return {
    provider: 'local',
    relevant,
    sections,
    primarySection: sections[0],
    tags: extractTags(text),
    summary,
    altTitle,
    duplicateOf,
    reason: relevant ? 'Relacionado con Ayamonte o su entorno' : 'Sin relación detectada con Ayamonte'
  };
}

/* ------------------------------------------------------------------ */
/* Proveedores remotos (OpenAI-compatible / Anthropic)                 */
/* ------------------------------------------------------------------ */

async function chat(messages, { system, json = true } = {}) {
  const p = getProvider();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    if (p === 'anthropic') {
      const res = await fetch(`${baseUrl()}/v1/messages`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.AI_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelName(),
          max_tokens: 1200,
          system,
          messages
        })
      });
      if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
      const data = await res.json();
      return data.content?.map((c) => c.text || '').join('') || '';
    }

    // OpenAI-compatible (openai / openrouter / generic)
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.AI_API_KEY) headers.Authorization = `Bearer ${process.env.AI_API_KEY}`;
    if (p === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost';
      headers['X-Title'] = 'Ayamonte.org';
    }
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({
        model: modelName(),
        temperature: 0.2,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages]
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `Eres el módulo de IA del periódico digital "Ayamonte.org" (Ayamonte, Huelva).
Tu objetivo es analizar noticias y priorizar las noticias locales de Ayamonte frente a las de la comarca.

REGLAS ESTRICTAS:
- NO inventes noticias, declaraciones, fechas ni acontecimientos.
- NO presentes información antigua como actual.
- Trabaja SOLO con el texto que se te proporciona.
- Los resúmenes deben ser objetivos, periodísticos y en español natural (2-3 frases, máximo 400 caracteres).
- Respeta siempre el sentido original del titular.
- Si el texto no se relaciona con Ayamonte ni con su comarca (Isla Cristina, Lepe, Villablanca, Cartaya, etc.), marca relevant=false.

Secciones válidas (SOLO dos):
- "ayamonte": Noticias que ocurren en Ayamonte, de su Ayuntamiento, vecinos, cultura, fiestas, playas (Isla Canela, Punta del Moral) o término municipal. ES LA SECCIÓN PRINCIPAL.
- "comarca": Noticias comarcales cuando no traten directamente de Ayamonte.

Responde SOLO con JSON con esta forma exacta:
{"relevant": boolean, "reason": string, "sections": [string], "primarySection": string, "tags": [string], "summary": string, "altTitle": string|null, "isDuplicate": boolean, "publishedAt": "ISO o null"}`;

/**
 * Procesa una noticia con el proveedor IA configurado.
 * Si falla, cae automáticamente al procesador local (resiliencia).
 */
async function processWithAI(item, { existingTitles = [], nearbyPlaces = [] } = {}) {
  const local = () => processLocal(item, { existingTitles });

  if (!isConfigured()) return local();

  try {
    const payload = JSON.stringify({
      title: item.title,
      source: item.sourceName || 'desconocido',
      publishedAt: item.pubDate || null,
      url: item.link,
      text: truncate(`${item.description} ${item.content}`, 6000),
      nearbyPlaces
    });

    const raw = await chat(
      [{ role: 'user', content: `Analiza esta noticia:\n${payload}` }],
      { system: SYSTEM_PROMPT }
    );

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Respuesta IA sin JSON');
    const data = JSON.parse(match[0]);

    const validSections = new Set(['ayamonte', 'comarca']);

    let sections = (Array.isArray(data.sections) ? data.sections : [])
      .map((s) => String(s).toLowerCase().trim())
      .filter((s) => validSections.has(s));
    if (!sections.length) sections = classify(`${item.title} ${item.description}`);

    const primary = validSections.has(String(data.primarySection))
      ? String(data.primarySection)
      : sections[0];

    const summary = typeof data.summary === 'string' && data.summary.trim()
      ? truncate(data.summary.trim(), 400)
      : local().summary;

    const altTitle =
      typeof data.altTitle === 'string' && data.altTitle.trim() && data.altTitle.trim() !== item.title
        ? truncate(data.altTitle.trim(), 120)
        : localAltTitle(item.title);

    const relevant =
      typeof data.relevant === 'boolean'
        ? data.relevant
        : isRelevant(`${item.title} ${item.description} ${item.content}`);

    // Duplicado: la IA lo indica o se detecta por similitud local
    let duplicateOf = null;
    if (data.isDuplicate === true) duplicateOf = 'indicado por IA';
    else {
      const loc = local();
      duplicateOf = loc.duplicateOf;
    }

    return {
      provider: getProvider(),
      model: modelName(),
      relevant,
      reason: typeof data.reason === 'string' ? truncate(data.reason, 200) : '',
      sections,
      primarySection: primary,
      tags: (Array.isArray(data.tags) ? data.tags : []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 8),
      summary,
      altTitle,
      duplicateOf,
      publishedAt: typeof data.publishedAt === 'string' && !isNaN(Date.parse(data.publishedAt)) ? data.publishedAt : null
    };
  } catch (err) {
    const fallback = local();
    fallback.reason = `IA no disponible (${err.message}); procesado localmente`;
    return fallback;
  }
}

/** Estado del proveedor para el panel (sin exponer claves). */
function status() {
  const provider = getProvider();
  return {
    provider,
    configured: isConfigured(),
    model: modelName(),
    baseUrl: baseUrl(),
    hasKey: !!process.env.AI_API_KEY
  };
}

module.exports = {
  processWithAI,
  processLocal,
  isRelevant,
  classify,
  localSummary,
  extractTags,
  status,
  getProvider
};
