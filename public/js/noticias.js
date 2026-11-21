'use strict';
/**
 * noticias.js — Archivo/listado de noticias con buscador, filtros y paginación.
 */

const state = {
  q: '',
  section: '',
  from: '',
  to: '',
  sort: 'published',
  page: 1
};

function readParams() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.section = p.get('section') || '';
  state.from = p.get('from') || '';
  state.to = p.get('to') || '';
  state.sort = p.get('sort') || 'published';
  state.page = Number(p.get('page') || 1);

  const f_q = document.getElementById('f-q');
  if (f_q) f_q.value = state.q;
  const f_section = document.getElementById('f-section');
  if (f_section) f_section.value = state.section;
  const f_from = document.getElementById('f-from');
  if (f_from) f_from.value = state.from;
  const f_to = document.getElementById('f-to');
  if (f_to) f_to.value = state.to;
  const f_sort = document.getElementById('f-sort');
  if (f_sort) f_sort.value = state.sort;

  const title = document.getElementById('page-title');
  const desc = document.getElementById('page-desc');
  if (state.q) {
    title.textContent = `Resultados para “${state.q}”`;
    desc.textContent = 'Resultados de búsqueda en el archivo del periódico.';
  } else if (state.section) {
    title.textContent = sectionName(state.section);
    desc.textContent = `Noticias de la sección ${sectionName(state.section)}.`;
  } else {
    title.textContent = 'Todas las noticias';
    desc.textContent = 'Busca por palabra clave, filtra por sección y fecha, y consulta el archivo histórico del periódico.';
  }
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.section) p.set('section', state.section);
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  if (state.sort !== 'published') p.set('sort', state.sort);
  if (state.page > 1) p.set('page', String(state.page));
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function renderPagination(el, data, onPage) {
  if (!data || data.pages <= 1) {
    el.innerHTML = '';
    return;
  }
  const btns = [];
  btns.push(`<button ${data.page <= 1 ? 'disabled' : ''} data-p="${data.page - 1}">‹</button>`);
  const start = Math.max(1, data.page - 2);
  const end = Math.min(data.pages, data.page + 2);
  if (start > 1) btns.push(`<button data-p="1">1</button>${start > 2 ? '<button disabled>…</button>' : ''}`);
  for (let i = start; i <= end; i++) {
    btns.push(`<button class="${i === data.page ? 'is-current' : ''}" data-p="${i}">${i}</button>`);
  }
  if (end < data.pages) btns.push(`${end < data.pages - 1 ? '<button disabled>…</button>' : ''}<button data-p="${data.pages}">${data.pages}</button>`);
  btns.push(`<button ${data.page >= data.pages ? 'disabled' : ''} data-p="${data.page + 1}">›</button>`);
  el.innerHTML = btns.join('');
  el.querySelectorAll('button[data-p]').forEach((b) =>
    b.addEventListener('click', () => onPage(Number(b.dataset.p)))
  );
}

async function load() {
  const results = document.getElementById('results');
  const pagination = document.getElementById('pagination');
  results.innerHTML = loadingHtml();
  pagination.innerHTML = '';
  writeUrl();

  try {
    const params = new URLSearchParams({
      q: state.q,
      section: state.section,
      from: state.from,
      to: state.to,
      sort: state.sort,
      page: String(state.page),
      per: '12'
    });
    const data = await API.get(`/api/news?${params.toString()}`);

    if (!data.items.length) {
      results.innerHTML = emptyHtml(
        'Sin resultados',
        'No se han encontrado noticias con esos criterios. Prueba con otra palabra clave o elimina los filtros.'
      );
      return;
    }

    results.innerHTML = `<div class="card-grid">${data.items.map(cardHtml).join('')}</div>`;
    renderPagination(pagination, data, (p) => {
      state.page = p;
      load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    observeReveals(results);
  } catch (err) {
    results.innerHTML = emptyHtml('Error al cargar', err.message);
  }
}

async function fillSections() {
  try {
    const sections = await API.get('/api/sections');
    const sel = document.getElementById('f-section');
    for (const s of sections) {
      const opt = document.createElement('option');
      opt.value = s.slug;
      opt.textContent = `${s.name}${s.count ? ` (${s.count})` : ''}`;
      sel.appendChild(opt);
    }
  } catch {
    /* sin secciones: se queda el desplegable básico */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fillSections().then(() => {
    readParams();
    load();
  });

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = document.getElementById('f-q').value.trim();
    state.section = document.getElementById('f-section').value;
    state.from = document.getElementById('f-from').value;
    state.to = document.getElementById('f-to').value;
    state.sort = document.getElementById('f-sort').value;
    state.page = 1;
    load();
  });

  ['f-section', 'f-from', 'f-to', 'f-sort'].forEach((id) =>
    document.getElementById(id).addEventListener('change', () => {
      document.getElementById('filters').dispatchEvent(new Event('submit'));
    })
  );

  document.getElementById('f-reset').addEventListener('click', () => {
    state.q = '';
    state.section = '';
    state.from = '';
    state.to = '';
    state.sort = 'published';
    state.page = 1;
    document.getElementById('f-q').value = '';
    document.getElementById('f-section').value = '';
    document.getElementById('f-from').value = '';
    document.getElementById('f-to').value = '';
    document.getElementById('f-sort').value = 'published';
    load();
  });
});
