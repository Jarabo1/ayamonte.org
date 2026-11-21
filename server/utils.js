'use strict';
/**
 * Utilidades comunes del servidor: fechas, textos, URLs, validación.
 */
const crypto = require('crypto');

/** Escapa HTML para evitar XSS cuando se renderiza contenido externo. */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normaliza un texto: minúsculas, sin acentos, sin puntuación. */
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte un título en slug URL-amigable. */
function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'noticia';
}

/** Extrae texto plano de HTML (resúmenes RSS, contenido CDATA...). */
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recorta texto a un máximo de caracteres, respetando palabras. */
function truncate(text, max = 220) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

/** Devuelve true si la URL es http(s) válida (bloquea javascript:, data:...). */
function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Convierte http a https cuando sea posible (evita contenido mixto). */
function upgradeHttps(url) {
  if (typeof url === 'string' && url.startsWith('http://')) {
    return 'https://' + url.slice(7);
  }
  return url;
}

/** Fecha ISO en formato local legible: 17/11/2026, 12:30 */
function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Fecha reliva: "hace 5 min", "ayer", "17 nov" */
function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'ahora mismo';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
  return formatDateTime(iso).split(',')[0];
}

/** Hash determinista para detectar duplicados (fingerprint de la noticia). */
function fingerprint({ title, url, sourceName }) {
  const base = normalizeText(title) + '|' + canonicalUrl(url) + '|' + normalizeText(sourceName);
  return crypto.createHash('sha1').update(base).digest('hex');
}

/** Normaliza una URL para comparar (quita utm_*, fragmentos y slash final). */
function canonicalUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

/** Similitud entre dos textos (índice de Jaccard sobre tokens). */
function textSimilarity(a, b) {
  const ta = new Set(normalizeText(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(normalizeText(b).split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Token aleatorio para sesiones. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Hash de contraseña con sal. */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 64).toString('hex');
  return `${s}:${h}`;
}

/** Compara contraseña guardada con la introducida (timing-safe). */
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const calc = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return calc.length === expected.length && crypto.timingSafeEqual(calc, expected);
  } catch {
    return false;
  }
}

/** Limita las peticiones por IP (simple mapa en memoria). */
function rateLimiter(limit = 20, windowMs = 60000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return arr.length <= limit;
  };
}

module.exports = {
  escapeHtml,
  normalizeText,
  slugify,
  stripHtml,
  truncate,
  isSafeUrl,
  upgradeHttps,
  formatDateTime,
  relativeTime,
  fingerprint,
  canonicalUrl,
  textSimilarity,
  randomToken,
  hashPassword,
  verifyPassword,
  rateLimiter
};
