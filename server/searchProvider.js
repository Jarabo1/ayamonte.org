'use strict';
/**
 * searchProvider.js — Proveedor de búsqueda web configurable.
 *
 * Proveedores soportados (vía variables de entorno, nunca en el frontend):
 *   - none      : desactivado (solo RSS)
 *   - serper    : https://serper.dev   (SEARCH_API_KEY)
 *   - brave     : https://api.search.brave.com (SEARCH_API_KEY)
 *   - serpapi   : https://serpapi.com (SEARCH_API_KEY)
 *   - generic   : endpoint propio (SEARCH_API_URL) con esquema { results: [{title,url,snippet}] }
 *
 * Si el proveedor no está configurado o falla, el sistema sigue funcionando
 * únicamente con las fuentes RSS (resiliencia).
 */
const { isSafeUrl, upgradeHttps } = require('./utils');

const TIMEOUT_MS = 15000;

function getProvider() {
  return (process.env.SEARCH_PROVIDER || 'none').toLowerCase();
}

function isConfigured() {
  const p = getProvider();
  if (p === 'none') return false;
  if (p === 'generic') return !!process.env.SEARCH_API_URL;
  return !!process.env.SEARCH_API_KEY;
}

async function request(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ejecuta una búsqueda web.
 * @param {string} query
 * @param {number} num  número máximo de resultados
 * @returns {Promise<{ok:boolean, results:Array<{title,url,snippet}>, error?:string, provider:string}>}
 */
async function searchWeb(query, num = 10) {
  const provider = getProvider();
  if (provider === 'none') return { ok: true, results: [], provider, skipped: true };
  if (!isConfigured()) {
    return { ok: false, results: [], provider, error: 'Proveedor de búsqueda sin configurar (falta API key / URL)' };
  }

  try {
    let results = [];
    const key = process.env.SEARCH_API_KEY || '';

    if (provider === 'serper') {
      const data = await request('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num })
      });
      results = (data.organic || []).map((r) => ({
        title: r.title || '',
        url: r.link || '',
        snippet: r.snippet || ''
      }));
    } else if (provider === 'brave') {
      const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}`;
      const data = await request(u, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key }
      });
      results = (data.web?.results || []).map((r) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || ''
      }));
    } else if (provider === 'serpapi') {
      const u = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${num}&api_key=${encodeURIComponent(key)}`;
      const data = await request(u);
      results = (data.organic_results || []).map((r) => ({
        title: r.title || '',
        url: r.link || '',
        snippet: r.snippet || ''
      }));
    } else if (provider === 'generic') {
      const base = process.env.SEARCH_API_URL;
      const sep = base.includes('?') ? '&' : '?';
      const u = `${base}${sep}q=${encodeURIComponent(query)}&num=${num}`;
      const headers = key ? { Authorization: `Bearer ${key}`, 'X-API-KEY': key } : {};
      const data = await request(u, { headers });
      const raw = Array.isArray(data) ? data : data.results || data.items || data.organic || [];
      results = raw.map((r) => ({
        title: r.title || r.name || '',
        url: r.url || r.link || '',
        snippet: r.snippet || r.description || r.content || ''
      }));
    } else {
      return { ok: false, results: [], provider, error: `Proveedor desconocido: ${provider}` };
    }

    results = results.filter((r) => r.title && isSafeUrl(r.url)).slice(0, num);
    return { ok: true, results, provider };
  } catch (err) {
    return { ok: false, results: [], provider, error: err.message };
  }
}

/** Estado del proveedor para el panel de administración (sin exponer claves). */
function status() {
  const provider = getProvider();
  return {
    provider,
    configured: isConfigured(),
    // Se informa solo si hay clave, nunca la clave en sí
    hasKey: !!process.env.SEARCH_API_KEY,
    hasUrl: !!process.env.SEARCH_API_URL
  };
}

module.exports = { searchWeb, isConfigured, status, getProvider };
