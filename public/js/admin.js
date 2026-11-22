'use strict';
/**
 * admin.js — Panel de administración de AYAMONTE AL DÍA.
 * Autenticación, recopilación manual, moderación, fuentes, agenda,
 * configuración, historial y errores.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || 'No autenticado');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return esc(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function notify(msg, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText =
      'position:fixed;bottom:1.2rem;left:50%;transform:translate(-50%,140%);background:#14171c;color:#fff;padding:.75rem 1.2rem;border-radius:5px;font-size:.88rem;z-index:999;transition:transform .3s;max-width:90vw';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#b3261e' : '#14171c';
  el.textContent = msg;
  requestAnimationFrame(() => (el.style.transform = 'translate(-50%,0)'));
  clearTimeout(notify._t);
  notify._t = setTimeout(() => (el.style.transform = 'translate(-50%,140%)'), 3500);
}

const SECTION_SLUGS = ['ayamonte', 'comarca'];
const SECTION_LABELS = {
  ayamonte: 'Noticias de Ayamonte',
  comarca: 'Noticias comarcales'
};

/* ------------------------------ auth ------------------------------ */

function showLogin() {
  $('#login-wrap').style.display = 'grid';
  $('#admin-shell').classList.remove('show');
}

function showPanel() {
  $('#login-wrap').style.display = 'none';
  $('#admin-shell').classList.add('show');
}

async function checkSession() {
  try {
    const me = await api('/api/admin/me');
    showPanel();
    await loadDashboard();
    return me;
  } catch {
    showLogin();
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-error');
  err.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  try {
    await api('/api/admin/login', 'POST', {
      username: $('#username').value.trim(),
      password: $('#password').value
    });
    showPanel();
    await loadDashboard();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/admin/logout', 'POST', {}).catch(() => {});
  showLogin();
});

/* ------------------------------ navegación ------------------------------ */

$$('.admin-nav button').forEach((b) => {
  b.addEventListener('click', async () => {
    $$('.admin-nav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${b.dataset.view}`).classList.add('active');
    try {
      await ({
        dashboard: loadDashboard,
        news: loadNews,
        sources: loadSources,
        agenda: loadAgenda,
        recipes: loadRecipes,
        config: loadConfig,
        history: loadHistory,
        errors: loadErrors
      })[b.dataset.view]();
    } catch (e) {
      notify(e.message, true);
    }
  });
});

/* ------------------------------ dashboard ------------------------------ */

async function loadDashboard() {
  const st = await api('/api/admin/status');

  $('#dash-updated').textContent = st.lastCollect
    ? `Última actualización: ${fmt(st.lastCollect)}`
    : 'Todavía no se ha ejecutado ninguna búsqueda';

  const pend = st.counts.pending;
  const pub = st.counts.published;
  const mode = st.publicationMode === 'auto' ? 'Automática' : 'Previa aprobación';
  const sched = st.scheduler.enabled
    ? `Cada ${st.scheduler.minutes} min`
    : 'Desactivada';

  $('#stat-grid').innerHTML = `
    <div class="stat"><div class="k">Publicadas</div><div class="v ok">${pub}</div></div>
    <div class="stat"><div class="k">Pendientes</div><div class="v ${pend ? 'warn' : ''}">${pend}</div></div>
    <div class="stat"><div class="k">Búsqueda automática</div><div class="v ${st.scheduler.enabled ? 'ok' : 'err'}" style="font-size:1.05rem;padding-top:.35rem">${esc(sched)}</div></div>
    <div class="stat"><div class="k">Publicación</div><div class="v" style="font-size:1.05rem;padding-top:.35rem">${esc(mode)}</div></div>
    <div class="stat"><div class="k">Proveedor búsqueda</div><div class="v ${st.searchProvider.configured ? 'ok' : ''}" style="font-size:1.05rem;padding-top:.35rem">${esc(st.searchProvider.provider)}${st.searchProvider.configured ? '' : ' (solo RSS)'}</div></div>
    <div class="stat"><div class="k">Proveedor IA</div><div class="v ${st.aiProvider.configured ? 'ok' : ''}" style="font-size:1.05rem;padding-top:.35rem">${esc(st.aiProvider.provider)}${st.aiProvider.configured ? '' : ' (reglas locales)'}</div></div>
  `;

  const pendBadge = $('#badge-pending');
  if (pendBadge) pendBadge.textContent = pend;

  const ok = st.sources.filter((s) => s.lastStatus === 'ok').length;
  const errs = st.sources.filter((s) => s.lastStatus === 'error').length;
  $('#src-summary').textContent = `${st.sources.length} fuentes · ${ok} OK · ${errs} con error`;
  $('#src-summary').className = `pill ${errs ? 'error' : 'ok'}`;

  $('#sources-status').innerHTML = st.sources.length
    ? st.sources
        .map(
          (s) => `<tr>
            <td><b>${esc(s.name)}</b></td>
            <td>${esc(s.kind)}</td>
            <td><span class="pill ${s.lastStatus === 'ok' ? 'ok' : s.lastStatus === 'error' ? 'error' : 'demo'}">${s.enabled ? (s.lastStatus || 'sin ejecutar') : 'desactivada'}</span></td>
            <td>${fmt(s.lastRunAt)}</td>
            <td>${esc(s.lastError || '—')}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5">No hay fuentes configuradas.</td></tr>';

  const recent = await api('/api/admin/news?status=all&per=8&sort=fetched');
  $('#recent-news').innerHTML = recent.items.length
    ? recent.items
        .map(
          (n) => `<tr>
            <td><div class="t-title">${esc(n.title)}</div>
                <div class="t-sub">${esc(n.source_name)}${n.is_demo ? ' · demo' : ''}</div></td>
            <td>${esc(SECTION_LABELS[n.primary_section] || n.primary_section)}</td>
            <td><span class="pill ${n.status}">${esc(n.status)}</span></td>
            <td>${fmt(n.published_at || n.fetched_at)}</td>
            <td class="row-actions">
              <button class="btn-a ghost small" data-edit="${n.id}">Editar</button>
            </td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5">Sin noticias todavía.</td></tr>';

  const errLog = await api('/api/admin/errors').catch(() => []);
  const badge = $('#badge-errors');
  if (badge) badge.textContent = Array.isArray(errLog) ? errLog.length : 0;
}

/* ------------------------------ recopilación manual ------------------------------ */

$('#run-collect').addEventListener('click', async () => {
  const btn = $('#run-collect');
  const note = $('#collect-note');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⟳</span> Buscando…';
  note.hidden = false;
  try {
    const query = $('#manual-query').value.trim();
    const res = await api('/api/admin/collect', 'POST', query ? { query } : {});
    if (res.skipped) {
      notify(res.message, true);
    } else {
      notify(
        `Búsqueda completada: ${res.newAdded} nuevas · ${res.duplicates} duplicadas · ${res.rejected} descartadas`
      );
      await loadDashboard();
    }
  } catch (e) {
    notify(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Ejecutar búsqueda ahora';
    note.hidden = true;
  }
});

/* ------------------------------ noticias ------------------------------ */

const newsState = { status: 'pending', section: '', q: '', page: 1 };

async function loadNews() {
  newsState.status = $('#news-status').value;
  newsState.section = $('#news-section').value;
  newsState.q = $('#news-q').value.trim();

  const params = new URLSearchParams({
    status: newsState.status,
    page: String(newsState.page),
    per: '20'
  });
  if (newsState.section) params.set('section', newsState.section);
  if (newsState.q) params.set('q', newsState.q);

  const data = await api(`/api/admin/news?${params}`);
  const tbody = $('#news-table');

  tbody.innerHTML = data.items.length
    ? data.items
        .map(
          (n) => `<tr>
          <td>
            <div class="t-title">${esc(n.title)}</div>
            <div class="t-sub">
              ${esc(n.source_name)} · ${n.is_demo ? '<span class="pill demo">demo</span> ' : ''}
              <a href="/noticia/${encodeURIComponent(n.slug)}" target="_blank" rel="noopener">ver ↗</a>
            </div>
          </td>
          <td>${esc(SECTION_LABELS[n.primary_section] || n.primary_section)}</td>
          <td><span class="pill ${n.status}">${esc(n.status)}</span></td>
          <td>${fmt(n.published_at || n.fetched_at)}</td>
          <td>${esc((n.source_name || '').slice(0, 24))}</td>
          <td class="row-actions">
            ${n.status !== 'approved' ? `<button class="btn-a green small" data-act="approve" data-id="${n.id}">Aprobar</button>` : ''}
            ${n.status !== 'rejected' ? `<button class="btn-a ghost small" data-act="reject" data-id="${n.id}">Rechazar</button>` : ''}
            <button class="btn-a ghost small" data-edit="${n.id}">Editar</button>
            <button class="btn-a ghost small" data-act="feature" data-id="${n.id}" data-val="${n.featured ? 0 : 1}">${n.featured ? '★ Quitar destacada' : '☆ Destacar'}</button>
            <button class="btn-a small" style="background:#b3261e" data-act="delete" data-id="${n.id}">Eliminar</button>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6">No hay noticias con este filtro.</td></tr>';

  $('#news-page-info').textContent = `Página ${data.page} de ${data.pages} · ${data.total} noticias`;
  $('#news-prev').disabled = data.page <= 1;
  $('#news-next').disabled = data.page >= data.pages;
  newsState._pages = data.pages;

  tbody.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => newsAction(b.dataset.act, Number(b.dataset.id), b.dataset.val))
  );
  tbody.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEditor(Number(b.dataset.edit)))
  );
}

async function newsAction(act, id, val) {
  const confirmMap = { delete: '¿Eliminar definitivamente esta noticia?', reject: '¿Rechazar esta noticia?' };
  if (confirmMap[act] && !confirm(confirmMap[act])) return;
  try {
    if (act === 'approve') await api(`/api/admin/news/${id}`, 'PATCH', { status: 'approved' });
    if (act === 'reject') await api(`/api/admin/news/${id}`, 'PATCH', { status: 'rejected' });
    if (act === 'feature') await api(`/api/admin/news/${id}`, 'PATCH', { featured: val === '1' });
    if (act === 'delete') await api(`/api/admin/news/${id}`, 'DELETE');
    notify('Hecho');
    await loadNews();
    await loadDashboard().catch(() => {});
  } catch (e) {
    notify(e.message, true);
  }
}

$('#news-search').addEventListener('click', () => {
  newsState.page = 1;
  loadNews();
});
$('#news-status').addEventListener('change', () => {
  newsState.page = 1;
  loadNews();
});
$('#news-prev').addEventListener('click', () => {
  if (newsState.page > 1) {
    newsState.page--;
    loadNews();
  }
});
$('#news-next').addEventListener('click', () => {
  if (newsState.page < (newsState._pages || 1)) {
    newsState.page++;
    loadNews();
  }
});

/* ------------------------------ editor ------------------------------ */

async function openEditor(id) {
  const n = await api(`/api/admin/news/${id}`);
  if (!n) return notify('Noticia no encontrada', true);

  $('#ed-id').value = n.id;
  $('#ed-title').value = n.title;
  $('#ed-alt').value = n.alt_title || '';
  $('#ed-summary').value = n.summary || '';
  $('#ed-status').value = n.status;
  $('#ed-tags').value = (n.tags || []).join(', ');
  $('#ed-featured').checked = !!n.featured;

  const sel = $('#ed-section');
  sel.innerHTML = SECTION_SLUGS.map(
    (s) => `<option value="${s}" ${s === n.primary_section ? 'selected' : ''}>${esc(SECTION_LABELS[s])}</option>`
  ).join('');

  $('#editor-sub').textContent = n.source_name || '';
  $('#editor-wrap').style.display = 'grid';
}

$('#editor-cancel').addEventListener('click', () => {
  $('#editor-wrap').style.display = 'none';
});

$('#editor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = Number($('#ed-id').value);
  try {
    await api(`/api/admin/news/${id}`, 'PATCH', {
      title: $('#ed-title').value.trim(),
      alt_title: $('#ed-alt').value.trim() || null,
      summary: $('#ed-summary').value.trim(),
      primary_section: $('#ed-section').value,
      status: $('#ed-status').value,
      tags: $('#ed-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      featured: $('#ed-featured').checked
    });
    notify('Noticia actualizada');
    $('#editor-wrap').style.display = 'none';
    await loadNews();
  } catch (e2) {
    notify(e2.message, true);
  }
});

/* ------------------------------ fuentes ------------------------------ */

async function loadSources() {
  const sources = await api('/api/admin/sources');
  $('#sources-table').innerHTML = sources.length
    ? sources
        .map(
          (s) => `<tr>
          <td><b>${esc(s.name)}</b></td>
          <td style="max-width:280px;word-break:break-all;font-size:.78rem">${esc(s.url)}</td>
          <td>${esc(s.type)} · ${esc(s.kind)}</td>
          <td>
            <label class="check-line" style="margin:0">
              <input type="checkbox" data-toggle="${s.id}" ${s.enabled ? 'checked' : ''}>
            </label>
          </td>
          <td><span class="pill ${s.last_status === 'ok' ? 'ok' : s.last_status === 'error' ? 'error' : 'demo'}">${s.last_status || 'sin ejecutar'}</span>
              <div class="t-sub">${fmt(s.last_run_at)}</div></td>
          <td class="row-actions">
            <button class="btn-a ghost small" data-test="${s.id}" data-url="${esc(s.url)}">Probar</button>
            <button class="btn-a small" style="background:#b3261e" data-del="${s.id}">Borrar</button>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6">No hay fuentes. Añade la primera arriba.</td></tr>';

  $('#sources-table').querySelectorAll('[data-toggle]').forEach((c) =>
    c.addEventListener('change', async () => {
      try {
        await api(`/api/admin/sources/${c.dataset.toggle}`, 'PATCH', { enabled: c.checked });
        notify(c.checked ? 'Fuente activada' : 'Fuente desactivada');
      } catch (e) {
        notify(e.message, true);
      }
    })
  );
  $('#sources-table').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta fuente?')) return;
      try {
        await api(`/api/admin/sources/${b.dataset.del}`, 'DELETE');
        notify('Fuente eliminada');
        await loadSources();
      } catch (e) {
        notify(e.message, true);
      }
    })
  );
  $('#sources-table').querySelectorAll('[data-test]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Probando…';
      try {
        // Prueba rápida de conectividad directa al feed
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(b.dataset.url, { signal: ctrl.signal });
        clearTimeout(t);
        notify(r.ok ? `Feed responde: HTTP ${r.status}` : `Feed responde: HTTP ${r.status}`, !r.ok);
      } catch (e) {
        notify(`El feed no responde: ${e.message}`, true);
      } finally {
        b.disabled = false;
        b.textContent = 'Probar';
      }
    })
  );
}

$('#source-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/sources', 'POST', {
      name: $('#src-name').value.trim(),
      url: $('#src-url').value.trim(),
      type: $('#src-type').value,
      kind: $('#src-kind').value
    });
    notify('Fuente añadida');
    e.target.reset();
    await loadSources();
  } catch (err) {
    notify(err.message, true);
  }
});

/* ------------------------------ agenda ------------------------------ */

async function loadAgenda() {
  const items = await api('/api/admin/agenda');
  $('#agenda-table').innerHTML = items.length
    ? items
        .map(
          (a) => `<tr>
          <td>${esc(a.event_date)} ${a.event_time ? '· ' + esc(a.event_time) : ''}</td>
          <td><b>${esc(a.title)}</b>${a.is_demo ? ' <span class="pill demo">demo</span>' : ''}</td>
          <td>${esc(a.location || '—')}</td>
          <td><button class="btn-a small" style="background:#b3261e" data-del-ag="${a.id}">Borrar</button></td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="4">Sin eventos.</td></tr>';

  $('#agenda-table').querySelectorAll('[data-del-ag]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/api/admin/agenda/${b.dataset.delAg}`, 'DELETE');
        notify('Evento eliminado');
        await loadAgenda();
      } catch (e) {
        notify(e.message, true);
      }
    })
  );
}

$('#agenda-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/agenda', 'POST', {
      title: $('#ag-title').value.trim(),
      event_date: $('#ag-date').value,
      event_time: $('#ag-time').value || null,
      location: $('#ag-loc').value.trim() || null
    });
    notify('Evento añadido');
    e.target.reset();
    await loadAgenda();
  } catch (err) {
    notify(err.message, true);
  }
});

/* ------------------------------ configuración ------------------------------ */

async function loadConfig() {
  const data = await api('/api/admin/config');
  const c = data.config;
  $('#cfg-mode').value = c.publication_mode || 'manual';
  $('#cfg-minutes').value = c.auto_collect_minutes || 30;
  $('#cfg-demo').value = c.demo_mode || '1';
  $('#cfg-queries').value = c.search_queries || '';

  $('#integrations-table').innerHTML = `
    <tr>
      <td>Búsqueda web</td>
      <td>${esc(data.env.searchProvider.provider)}</td>
      <td><span class="pill ${data.env.searchProvider.configured ? 'ok' : 'demo'}">${data.env.searchProvider.configured ? 'Configurado' : 'Sin configurar (solo RSS)'}</span></td>
    </tr>
    <tr>
      <td>Inteligencia artificial</td>
      <td>${esc(data.env.aiProvider.provider)}${data.env.aiProvider.model ? ' · ' + esc(data.env.aiProvider.model) : ''}</td>
      <td><span class="pill ${data.env.aiProvider.configured ? 'ok' : 'demo'}">${data.env.aiProvider.configured ? 'Configurado' : 'Sin configurar (reglas locales)'}</span></td>
    </tr>`;
}

$('#config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/config', 'PUT', {
      publication_mode: $('#cfg-mode').value,
      auto_collect_minutes: $('#cfg-minutes').value,
      demo_mode: $('#cfg-demo').value,
      search_queries: $('#cfg-queries').value
    });
    notify('Configuración guardada');
    await loadDashboard();
  } catch (err) {
    notify(err.message, true);
  }
});

/* ------------------------------ historial y errores ------------------------------ */

async function loadHistory() {
  const rows = await api('/api/admin/history');
  $('#history-table').innerHTML = rows.length
    ? rows
        .map(
          (h) => `<tr>
          <td>${h.id}</td>
          <td>${fmt(h.started_at)}</td>
          <td>${fmt(h.finished_at)}</td>
          <td>${esc(h.trigger_type)}</td>
          <td>${h.sources_total}</td>
          <td>${h.items_found}</td>
          <td><b>${h.new_added}</b></td>
          <td>${h.duplicates}</td>
          <td>${h.rejected}</td>
          <td><span class="pill ${h.status === 'ok' ? 'ok' : 'error'}">${esc(h.status)}</span></td>
          <td style="max-width:280px;font-size:.78rem">${esc(h.message || '')}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="11">Sin registros todavía.</td></tr>';
}

$('#refresh-history').addEventListener('click', () => loadHistory().catch((e) => notify(e.message, true)));

async function loadErrors() {
  const rows = await api('/api/admin/errors');
  $('#errors-list').innerHTML = rows.length
    ? rows
        .map(
          (e) => `<div class="log-line ${esc(e.level)}">
            <span class="ts">${fmt(e.ts)}</span>
            <span><b>[${esc(e.module)}]</b> ${esc(e.message)}${e.detail ? `<br><span style="color:#6b7280">${esc(e.detail)}</span>` : ''}</span>
          </div>`
        )
        .join('')
    : '<div class="sub">No hay errores registrados. ✓</div>';
}

$('#refresh-errors').addEventListener('click', () => loadErrors().catch((e) => notify(e.message, true)));

/* ------------------------------ secciones y arranque ------------------------------ */

function fillSectionSelect() {
  const sel = $('#news-section');
  SECTION_SLUGS.forEach((s) => {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = SECTION_LABELS[s];
    sel.appendChild(o);
  });
}

fillSectionSelect();
checkSession();async function loadRecipes() {
  const items = await api('/api/admin/recipes');
  $('#recipes-table').innerHTML = items.length
    ? items.map((r) => `<tr>
        <td><b>${esc(r.title)}</b>${r.status === 'pending' ? ' <span class="pill demo">pendiente</span>' : ''}</td>
        <td>${esc(r.origin || '')}</td>
        <td>${esc(r.source_name || '')}</td>
        <td>
          ${r.status === 'pending' ? '<button class="btn-a small" style="background:#166534" data-appr-rc="' + r.id + '">Aprobar</button> ' : ''}
          <button class="btn-a small" style="background:#b3261e" data-del-rc="${r.id}">Borrar</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="4">Sin recetas.</td></tr>';

  $('#recipes-table').querySelectorAll('[data-del-rc]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('/api/admin/recipes/' + b.dataset.delRc, 'DELETE');
        notify('Receta eliminada');
        await loadRecipes();
      } catch (e) { notify(e.message, true); }
    })
  );
  $('#recipes-table').querySelectorAll('[data-appr-rc]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api('/api/admin/recipes/' + b.dataset.apprRc, 'PATCH', { status: 'approved' });
        notify('Receta aprobada');
        await loadRecipes();
      } catch (e) { notify(e.message, true); }
    })
  );
}

document.getElementById('recipe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/recipes', 'POST', {
      title: document.getElementById('rc-title').value.trim(),
      origin: document.getElementById('rc-origin').value.trim(),
      ingredients: document.getElementById('rc-ingredients').value.trim(),
      steps: document.getElementById('rc-steps').value.trim(),
      source_name: document.getElementById('rc-source').value.trim(),
      source_url: document.getElementById('rc-url').value.trim()
    });
    notify('Receta añadida');
    document.getElementById('recipe-form').reset();
    await loadRecipes();
  } catch (e) { notify(e.message, true); }
});


