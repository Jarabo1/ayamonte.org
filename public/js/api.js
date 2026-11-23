'use strict';
/**
 * api.js — Cliente HTTP compartido + utilidades de renderizado.
 * JavaScript puro, sin dependencias.
 */

const API = {
  async get(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
  },
  async send(path, method = 'GET', body = null) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
};

/* ------------------------------ utilidades ------------------------------ */

const SECTION_NAMES = {
  ayamonte: 'Noticias de Ayamonte',
  comarca: 'Noticias comarcales'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sectionName(slug) {
  return SECTION_NAMES[slug] || (slug ? slug.replace(/-/g, ' ') : '');
}

/** Formato de fecha legible: 17/11/2026, 12:30 */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Fecha relativa: hace 5 min, ayer... */
function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'ahora mismo';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return 'ayer';
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
  return fmtDate(iso).split(',')[0];
}

/** Imagen de la noticia o placeholder genérico de la sección. */
function newsImage(n, { lazy = true } = {}) {
  const src = n.imageUrl && /^https?:\/\//i.test(n.imageUrl)
    ? n.imageUrl
    : n.imageUrl || `/assets/images/placeholder-${n.section || 'default'}.svg`;
  const fallback = `/assets/images/placeholder-${n.section || 'default'}.svg`;
  return `<img src="${esc(src)}" alt="${esc(n.title)}" ${lazy ? 'loading="lazy"' : ''}
    onerror="this.onerror=null;this.src='${fallback}'">`;
}

/** URL canónica de la noticia (URLs amigables). */
function newsHref(n) {
  return `/noticia/${encodeURIComponent(n.slug)}`;
}

/** Metadatos comunes de una tarjeta. */
function metaHtml(n) {
  return `<div class="meta">
    <span>${esc(fmtRelative(n.publishedAt || n.fetchedAt))}</span>
    <span class="source dot">${esc(n.source || 'Redacción')}</span>
    ${n.isDemo ? '<span class="demo-tag">Demo</span>' : ''}
  </div>`;
}

/* ------------------------------ tarjetas ------------------------------ */

function cardHtml(n) {
  return `<article class="card reveal">
    <a href="${newsHref(n)}" aria-label="${esc(n.title)}">
      <div class="media">${newsImage(n)}</div>
      <span class="kicker">${esc(sectionName(n.section))}</span>
      <h3>${esc(n.title)}</h3>
      <p class="summary">${esc(n.summary)}</p>
    </a>
    ${metaHtml(n)}
  </article>`;
}

function rowHtml(n) {
  return `<article class="card-row reveal">
    <a href="${newsHref(n)}" class="media" aria-hidden="true" tabindex="-1">${newsImage(n)}</a>
    <div>
      <span class="kicker">${esc(sectionName(n.section))}</span>
      <h3><a href="${newsHref(n)}">${esc(n.title)}</a></h3>
      ${metaHtml(n)}
    </div>
  </article>`;
}

function heroLeadHtml(n) {
  if (!n) return '';
  return `<article class="hero-lead reveal">
    <a href="${newsHref(n)}">
      <div class="media">${newsImage(n, { lazy: false })}</div>
      <span class="kicker">${esc(sectionName(n.section))}</span>
      <h1>${esc(n.title)}</h1>
      <p class="summary">${esc(n.summary)}</p>
    </a>
    ${metaHtml(n)}
  </article>`;
}

function heroSecondaryHtml(n) {
  if (!n) return '';
  return `<article class="hero-secondary reveal">
    <a href="${newsHref(n)}" class="media" aria-hidden="true" tabindex="-1">${newsImage(n)}</a>
    <div>
      <span class="kicker">${esc(sectionName(n.section))}</span>
      <h2><a href="${newsHref(n)}">${esc(n.title)}</a></h2>
      ${metaHtml(n)}
    </div>
  </article>`;
}

/* ------------------------------ interfaz ------------------------------ */

/** Aviso flotante (toast). */
function toast(message, type = 'ok') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', type === 'error');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3600);
}

/** Animación de entrada discreta de los elementos .reveal. */
function observeReveals(root = document) {
  const els = root.querySelectorAll('.reveal:not(.is-visible)');
  if (!('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: '0px 0px -40px 0px', threshold: 0.08 }
  );
  els.forEach((e) => io.observe(e));
}

/** Compartir en WhatsApp / X / copiar enlace. */
function buildShareBar(n) {
  const url = encodeURIComponent(location.origin + newsHref(n));
  const text = encodeURIComponent(n.title);
  return `<span class="share-group" style="display:inline-flex;gap:.4rem;align-items:center;flex-wrap:wrap;">
    <a class="share-btn wa" target="_blank" rel="noopener"
       href="https://wa.me/?text=${text}%20${url}">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.96-.94 1.16c-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.04-.17-.3-.02-.46.13-.6.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 004.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.13c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 01-1.26-4.36c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 012.41 5.82c0 4.54-3.7 8.21-8.23 8.21z"/></svg>
      WhatsApp
    </a>
    <a class="share-btn tw" target="_blank" rel="noopener"
       href="https://twitter.com/intent/tweet?text=${text}&url=${url}">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z"/></svg>
      X / Twitter
    </a>
    <button class="share-btn" type="button" data-copy="${esc(location.origin + newsHref(n))}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      Copiar enlace
    </button>
  </span>`;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  navigator.clipboard?.writeText(btn.dataset.copy).then(
    () => toast('Enlace copiado'),
    () => toast('No se pudo copiar', 'error')
  );
});

/** Estado vacío. */
function emptyHtml(title, message) {
  return `<div class="empty reveal"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}

/** Bloque de carga. */
function loadingHtml(text = 'Cargando noticias…') {
  return `<div class="loading">${esc(text)}</div>`;
}
