'use strict';
/**
 * secciones.js — Página de sección (/seccion/:slug).
 */

const state = { slug: '', q: '', sort: 'published', page: 1 };

function slugFromPath() {
  const m = location.pathname.match(/\/seccion\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function loadSectionsNav() {
  try {
    const sections = await API.get('/api/sections');
    const nav = document.getElementById('mainnav');
    if (nav) {
      const list = nav.querySelector('#nav-links');
      if (list) {
        list.querySelectorAll('.nav-link').forEach((a) => {
          a.classList.toggle('is-active', a.getAttribute('href') === `/seccion/${state.slug}`);
        });
      }
    }
    return sections;
  } catch {
    return [];
  }
}

async function load() {
  const results = document.getElementById('results');
  const pagination = document.getElementById('pagination');
  results.innerHTML = loadingHtml();
  pagination.innerHTML = '';

  try {
    const params = new URLSearchParams({
      section: state.slug,
      q: state.q,
      sort: state.sort,
      page: String(state.page),
      per: '12'
    });
    const data = await API.get(`/api/news?${params.toString()}`);

    if (!data.items.length) {
      results.innerHTML = state.q
        ? emptyHtml('Sin resultados', `No hay noticias que coincidan con “${state.q}” en esta sección.`)
        : emptyHtml('Sección sin noticias', 'Todavía no hay noticias publicadas en esta sección. Vuelve pronto o ejecuta una búsqueda desde el panel de administración.');
      pagination.innerHTML = '';
      return;
    }

    results.innerHTML = `<div class="card-grid">${data.items.map(cardHtml).join('')}</div>`;

    if (data.pages > 1) {
      const btns = [];
      btns.push(`<button ${data.page <= 1 ? 'disabled' : ''} data-p="${data.page - 1}">‹</button>`);
      for (let i = 1; i <= data.pages; i++) {
        btns.push(`<button class="${i === data.page ? 'is-current' : ''}" data-p="${i}">${i}</button>`);
      }
      btns.push(`<button ${data.page >= data.pages ? 'disabled' : ''} data-p="${data.page + 1}">›</button>`);
      pagination.innerHTML = btns.join('');
      pagination.querySelectorAll('button[data-p]').forEach((b) =>
        b.addEventListener('click', () => {
          state.page = Number(b.dataset.p);
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        })
      );
    }
    observeReveals(results);
  } catch (err) {
    results.innerHTML = emptyHtml('Error al cargar', err.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  state.slug = slugFromPath() || 'sociedad';
  document.body.dataset.section = state.slug;

  const sections = await loadSectionsNav();
  const meta = sections.find((s) => s.slug === state.slug);
  const name = meta ? meta.name : sectionName(state.slug);

  document.title = `${name} — Ayamonte.org`;
  document.getElementById('section-title').textContent = name;
  document.getElementById('crumb').textContent = name;

  const descriptions = {
    comarca: 'Noticias de Isla Cristina, Lepe, Villablanca, Cartaya, Villanueva de los Castillejos y demás municipios de la comarca.',
    'semana-santa': 'Cofradías, preparativos y actualidad de la Semana Santa de Ayamonte.',
    carnaval: 'Comparsas, programación y fiestas del Carnaval de Ayamonte.',
    ayuntamiento: 'Plenos, obras y servicios municipales del Ayuntamiento de Ayamonte.'
  };
  document.getElementById('section-desc').textContent =
    descriptions[state.slug] || `Últimas noticias de ${name.toLowerCase()} en Ayamonte y su entorno.`;

  load();

  document.getElementById('section-search').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = document.getElementById('s-q').value.trim();
    state.page = 1;
    load();
  });
  document.getElementById('s-sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.page = 1;
    load();
  });
});
