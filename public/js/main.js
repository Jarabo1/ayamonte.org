'use strict';
/**
 * main.js — Cabecera, navegación, pie y portada.
 */

const SECTIONS = [
  { slug: 'ayamonte', name: 'Noticias de Ayamonte' },
  { slug: 'comarca', name: 'Noticias comarcales' }
];

/* ------------------------------ plantillas ------------------------------ */

function renderChrome(activeSlug = '') {
  const topbar = document.getElementById('topbar');
  const nav = document.getElementById('mainnav');
  const footer = document.getElementById('site-footer');

  const now = new Date();
  const dateStr = now.toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  if (topbar) {
  if (topbar) {
  if (topbar) {
    topbar.innerHTML = `
      <div class="container">
        <time datetime="${now.toISOString()}">${esc(dateStr)}</time>
        <div class="topbar-links">
          <a href="/noticias">Archivo</a>
          <a href="/privacidad">Privacidad</a>
          <a href="/admin">Admin <span id="pending-badge" class="pending-badge" hidden></span></a>
          <span class="demo-badge" id="demo-flag" hidden>Datos de demostraci�n</span>
          <div id="google_translate_element" style="display:none"></div>
          <div class="lang-flags">
            <button type="button" class="lang-flag" data-lang="es" title="Espa�ol"><svg viewBox="0 0 3 2" width="22" height="15"><rect width="3" height="2" fill="#c60b1e"/><rect y="0.5" width="3" height="1" fill="#ffc400"/></svg></button>
            <button type="button" class="lang-flag" data-lang="en" title="English"><svg viewBox="0 0 60 30" width="22" height="11"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="4"/><rect x="24" width="12" height="30" fill="#fff"/><rect y="9" width="60" height="12" fill="#fff"/><rect x="26" width="8" height="30" fill="#C8102E"/><rect y="11" width="60" height="8" fill="#C8102E"/></svg></button>
            <button type="button" class="lang-flag" data-lang="fr" title="Fran�ais"><svg viewBox="0 0 3 2" width="22" height="15"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg></button>
          </div>
        </div>
      </div>`;
  }
  }
  }

  // Indicador de pendientes para el admin
  API.get('/api/pending').then((p) => {
    const badge = document.getElementById('pending-badge');
    if (badge && p && p.total > 0) {
      badge.textContent = p.total;
      badge.hidden = false;
    }
  }).catch(() => {});

  if (nav) {
    const links = SECTIONS.map(
      (s) =>
        `<a class="nav-link${s.slug === activeSlug ? ' is-active' : ''}" href="/seccion/${s.slug}">${esc(s.name)}</a>`
    ).join('');
    nav.innerHTML = `
      <div class="container">
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links">☰ Secciones</button>
        <div class="nav-links" id="nav-links">
          <a class="nav-link${!activeSlug ? ' is-active' : ''}" href="/">Portada</a>
          ${links}
           <a class="nav-link${activeSlug === 'recorrido' ? ' is-active' : ''}" href="/recorrido-3d">Recorrido 3D</a>
           <a class="nav-link${activeSlug === 'tiempo' ? ' is-active' : ''}" href="/tiempo">Tiempo y mareas</a>
           <a class="nav-link${activeSlug === 'recetas' ? ' is-active' : ''}" href="/recetas">Recetas</a>
           <a class="nav-link${activeSlug === 'chat' ? ' is-active' : ''}" href="/chat">Asistente</a>
           <a class="nav-link${activeSlug === 'resumen' ? ' is-active' : ''}" href="/resumen">En 2 minutos</a>
        </div>
      </div>`;
    const toggle = nav.querySelector('.nav-toggle');
    const list = nav.querySelector('#nav-links');
    toggle.addEventListener('click', () => {
      const open = list.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  if (footer) {
    footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <span class="logo">Ayamonte<span class="logo-accent">.org</span></span>
            <p>Periódico digital independiente centrado en la actualidad y noticias de Ayamonte (Huelva) y su comarca. Recopilación y clasificación automatizada de información con enlace directo y atribución a la fuente original.</p>
          </div>
          <div>
            <h3>Categorías</h3>
            <ul>${SECTIONS.map((s) => `<li><a href="/seccion/${esc(s.slug)}">${esc(s.name)}</a></li>`).join('')}</ul>
          </div>
          <div>
            <h3>Servicios</h3>
            <ul>
              <li><a href="/noticias">Archivo de noticias</a></li>
              <li><a href="/recetas">Recetas</a></li>
              <li><a href="/tiempo">Tiempo y mareas</a></li>
              <li><a href="/recorrido-3d">Recorrido 3D</a></li>
              <li><a href="/resumen">En 2 minutos</a></li>
              <li><a href="/chat">Asistente</a></li>
            </ul>
          </div>
          <div>
            <h3>Información</h3>
            <ul>
              <li><a href="/privacidad">Política de privacidad</a></li>
              <li><a href="/aviso-legal">Aviso legal</a></li>
              <li><a href="/sitemap.xml">Sitemap</a></li>
              <li><a href="/admin">Panel de administración</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${now.getFullYear()} Ayamonte.org — Periódico digital de Ayamonte.</span>
          <span>Las noticias pertenecen a sus autores y medios de origen.</span>
        </div>
      </div>`;
  }
  // Aviso de modo demostración
  API.get('/api/status')
    .then((st) => {
      const flag = document.getElementById('demo-flag');
      if (flag && st.demoMode) flag.hidden = false;
    })
    .catch(() => {});
}

function stickyNav() {
  const nav = document.getElementById('mainnav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 140);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------ portada ------------------------------ */

function cardGrid(items) {
  return `<div class="card-grid">${items.map(cardHtml).join('')}</div>`;
}

async function loadHome() {
  const heroEl = document.getElementById('hero');
  const latestEl = document.getElementById('latest-block');
  const localEl = document.getElementById('local-block');
  const sectionsEl = document.getElementById('sections-block');
  const popularEl = document.getElementById('popular-list');
  const agendaEl = document.getElementById('agenda-list');
  const tickerEl = document.getElementById('ticker-track');

  heroEl.innerHTML = loadingHtml();

  try {
    const [featuredRes, latest, popular, agenda, sections] = await Promise.all([
      API.get('/api/news?per=4&sort=published'),
      API.get('/api/latest?limit=8'),
      API.get('/api/popular?limit=6'),
      API.get('/api/agenda?limit=5'),
      API.get('/api/sections')
    ]);

    const featured = featuredRes.items || [];

    /* Hero: 1 principal + 3 secundarias */
    if (!featured.length) {
      heroEl.innerHTML = emptyHtml(
        'Todavía no hay noticias publicadas',
        'Ejecuta una búsqueda desde el panel de administración o configura las fuentes RSS y la API de IA.'
      );
    } else {
      heroEl.innerHTML =
        heroLeadHtml(featured[0]) +
        `<div class="hero-side">${featured.slice(1, 4).map(heroSecondaryHtml).join('')}</div>`;
    }

    /* Ticker última hora */
    if (tickerEl) {
      const items = latest.length ? latest : featured;
      const html = items
        .map((n) => `<span class="ticker-item"><a href="${newsHref(n)}">${esc(n.title)}</a></span>`)
        .join('');
      tickerEl.innerHTML = html + html; // duplicado para bucle continuo
    }

    /* Últimas noticias */
    if (latestEl) {
      latestEl.innerHTML = `<div class="block-head">
          <h2>Últimas noticias</h2>
          <a class="more" href="/noticias">Ver todas →</a>
        </div>${cardGrid(latest.slice(0, 3))}`;
    }

    /* Noticias de Ayamonte (Categoría principal) */
    if (localEl) {
      const ayamonteRes = await API.get('/api/news?section=ayamonte&per=6').catch(() => ({ items: [] }));
      const ayamonteItems = ayamonteRes.items || [];
      localEl.innerHTML = `<div class="block-head">
          <h2>Noticias de Ayamonte</h2>
          <a class="more" href="/seccion/ayamonte">Ver todas de Ayamonte →</a>
        </div>` +
        (ayamonteItems.length
          ? `<div class="card-list">${ayamonteItems.map(rowHtml).join('')}</div>`
          : emptyHtml('Sin noticias todavía', 'No se han encontrado noticias recientes de Ayamonte.'));
    }

    /* Noticias comarcales (Categoría secundaria) */
    if (sectionsEl) {
      const comarcaRes = await API.get('/api/news?section=comarca&per=6').catch(() => ({ items: [] }));
      const comarcaItems = comarcaRes.items || [];
      sectionsEl.innerHTML = `<div class="block reveal">
        <div class="block-head">
          <h2><a href="/seccion/comarca">Noticias comarcales</a></h2>
          <a class="more" href="/seccion/comarca">Ver más noticias comarcales →</a>
        </div>
        ${comarcaItems.length ? cardGrid(comarcaItems) : emptyHtml('Sin noticias comarcales', 'No hay noticias recientes en esta sección.')}
      </div>`;
    }

    /* Más leídas */
    if (popularEl) {
      popularEl.innerHTML = popular.length
        ? popular
            .map(
              (n) => `<li>
                <div>
                  <a href="${newsHref(n)}">${esc(n.title)}</a>
                  <div class="meta"><span>${esc(sectionName(n.section))}</span><span class="dot">${esc(fmtRelative(n.publishedAt || n.fetchedAt))}</span></div>
                </div>
              </li>`
            )
            .join('')
        : '<li><div class="meta">Sin datos todavía.</div></li>';
    }

    /* Agenda */
    if (agendaEl) {
      agendaEl.innerHTML = agenda.length
        ? agenda
            .map((ev) => {
              const d = new Date(ev.event_date + 'T00:00:00');
              const day = String(d.getDate()).padStart(2, '0');
              const month = d.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
              return `<li>
                <div class="agenda-date"><span class="d">${day}</span><span class="m">${esc(month)}</span></div>
                <div>
                  <div class="agenda-title">${esc(ev.title)}</div>
                  <div class="agenda-info">${esc(ev.event_time || '')} ${ev.location ? '· ' + esc(ev.location) : ''}</div>
                </div>
              </li>`;
            })
            .join('')
        : '<li><div class="agenda-info">No hay eventos programados.</div></li>';
    }

    observeReveals();
  } catch (err) {
    heroEl.innerHTML = emptyHtml('Error al cargar', err.message);
  }
}

/* ------------------------------ arranque ------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const active = document.body.dataset.section || '';
  renderChrome(active);
  // Botones de idioma (banderas)
  document.querySelectorAll(".lang-flag").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var lang = btn.getAttribute("data-lang");
      if (lang === "es") {
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + location.hostname + ";";
      } else {
        document.cookie = "googtrans=/es/" + lang + "; path=/";
      }
      location.reload();
    });
  });
  stickyNav();

  if (document.body.dataset.page === 'home') {
    loadHome();
  }

  observeReveals();
  if (!window.__gt_loaded) {
    window.googleTranslateElementInit = function () {
      new google.translate.TranslateElement({ pageLanguage: "es", includedLanguages: "en,fr", layout: google.translate.TranslateElement.InlineLayout.SIMPLE }, "google_translate_element");
    };
    const gtScript = document.createElement("script");
    gtScript.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    document.head.appendChild(gtScript);
    window.__gt_loaded = true;
  }
});

