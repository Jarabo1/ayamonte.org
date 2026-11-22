'use strict';
/**
 * server.js — Servidor HTTP del periódico digital AYAMONTE AL DÍA.
 * Node.js puro (sin frameworks): estático + API JSON + SEO (sitemap/robots).
 *
 * Rutas públicas:
 *   GET /api/sections          secciones
 *   GET /api/news              listado (q, section, page, from, to, sort)
 *   GET /api/news/:slug        detalle + relacionadas
 *   GET /api/search            buscador (?q=)
 *   GET /api/popular           más leídas
 *   GET /api/latest            últimas
 *   GET /api/agenda            agenda
 *   GET /api/status            estado público (última actualización)
 *   GET /sitemap.xml, /robots.txt
 *
 * Rutas privadas (cookie de sesión):
 *   POST /api/admin/login | /logout      GET /api/admin/me
 *   POST /api/admin/collect              GET /api/admin/status
 *   GET/PATCH/DELETE /api/admin/news     GET /api/admin/pending
 *   GET/POST/PATCH/DELETE /api/admin/sources
 *   GET/PUT /api/admin/config            GET /api/admin/history | /errors
 *   GET/POST/DELETE /api/admin/agenda
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(ROOT, '.env'))) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) {}
}

const db = require('./database');
const auth = require('./auth');
const collector = require('./newsCollector');
const scheduler = require('./scheduler');
const searchProvider = require('./searchProvider');
const aiProcessor = require('./aiProcessor');
const { escapeHtml, rateLimiter, isSafeUrl } = require('./utils');

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

let shuttingDown = false;
let activeRequests = 0;
const openSockets = new Set();

const apiLimiter = rateLimiter(180, 60000); // 180 req/min por IP

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/* ------------------------------------------------------------------ */
/* Helpers HTTP                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

function readBody(req, limit = 1024 * 512) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('JSON no válido'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'local';
}

/** Cabeceras de seguridad comunes. */
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

/** Página de error amigable. */
function errorPage(res, status, title, message) {
  sendHtml(
    res,
    status,
    `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · AYAMONTE AL DÍA</title>
<style>body{font-family:Georgia,serif;background:#fff;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
.box{max-width:520px;padding:2rem}h1{font-size:3rem;margin:0;color:#b3261e}p{line-height:1.6}a{color:#111}</style></head>
<body><div class="box"><h1>${status}</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>
<p><a href="/">← Volver a la portada</a></p></div></body></html>`
  );
}

/* ------------------------------------------------------------------ */
/* Ficheros estáticos (protegidos contra path traversal)               */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Normalizar slashes a estilo web ('/')
  let cleanRel = rel.replace(/\\/g, '/');
  if (cleanRel.length > 1 && cleanRel.endsWith('/')) {
    cleanRel = cleanRel.slice(0, -1);
  }

  // Prevenir path traversal
  if (cleanRel.includes('..')) {
    return errorPage(res, 403, 'Acceso denegado', 'Ruta no permitida.');
  }

  // Mapeo explícito de páginas limpias
  if (cleanRel === '/admin') {
    return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), '.html');
  }
  if (cleanRel === '/noticias') {
    return serveFile(res, path.join(PUBLIC_DIR, 'noticias.html'), '.html');
  }
  if (cleanRel === '/aviso-legal') {
    return serveFile(res, path.join(PUBLIC_DIR, 'aviso-legal.html'), '.html');
  }
  if (cleanRel === '/privacidad') {
    return serveFile(res, path.join(PUBLIC_DIR, 'privacidad.html'), '.html');
  }
  if (cleanRel === '/recorrido-3d' || cleanRel === '/recorrido') {
    return serveFile(res, path.join(PUBLIC_DIR, 'recorrido-3d.html'), '.html');
  }
  if (cleanRel === '/resumen' || cleanRel === '/en-2-minutos') {
    return serveFile(res, path.join(PUBLIC_DIR, 'resumen.html'), '.html');
  }
  if (cleanRel === '/chat' || cleanRel === '/asistente') {
    return serveFile(res, path.join(PUBLIC_DIR, 'chat.html'), '.html');
  }
  if (cleanRel === '/tiempo' || cleanRel === '/tiempo-y-mareas') {
    return serveFile(res, path.join(PUBLIC_DIR, 'tiempo.html'), '.html');
  }
  if (cleanRel === '/recetas') {
    return serveFile(res, path.join(PUBLIC_DIR, 'recetas.html'), '.html');
  }

  // Rutas dinámicas amigables: /seccion/xxx -> seccion.html, /noticia/xxx -> noticia.html
  const dynamicMatch = cleanRel.match(/^\/(seccion|noticia)\/(.+)$/);
  if (dynamicMatch) {
    const target = path.join(PUBLIC_DIR, `${dynamicMatch[1]}.html`);
    return serveFile(res, target, '.html');
  }

  // Fichero estático directo
  const directFile = path.join(PUBLIC_DIR, cleanRel);
  fs.stat(directFile, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(directFile).toLowerCase();
      return serveFile(res, directFile, ext);
    }

    // Comprobar si existe agregando .html
    const htmlFile = directFile + '.html';
    fs.stat(htmlFile, (e2, stat2) => {
      if (!e2 && stat2.isFile()) {
        return serveFile(res, htmlFile, '.html');
      }
      return notFound(res);
    });
  });
}

function serveFile(res, filePath, ext) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return notFound(res);
    const mime = MIME[ext] || 'application/octet-stream';
    const immutable = ext !== '.html' && !['.js', '.css'].includes(ext) && ['/assets/'].some((p) => filePath.includes(p));
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': immutable ? 'public, max-age=3600' : 'no-cache'
    });
    res.end(buf);
  });
}

function notFound(res) {
  errorPage(res, 404, 'Página no encontrada', 'La dirección solicitada no existe o ha cambiado.');
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

function publicStatus() {
  return {
    site: db.getConfig('site_name', 'AYAMONTE AL DÍA'),
    lastCollect: db.getConfig('last_collect_at', ''),
    demoMode: db.getConfig('demo_mode', '1') === '1',
    publicationMode: db.getConfig('publication_mode', 'manual'),
    autoMinutes: Number(db.getConfig('auto_collect_minutes', 30)),
    searchProvider: searchProvider.status(),
    aiProvider: aiProcessor.status(),
    counts: {
      published: db.getDb().prepare("SELECT COUNT(*) c FROM news WHERE status='approved'").get().c,
      pending: db.getDb().prepare("SELECT COUNT(*) c FROM news WHERE status='pending'").get().c
    }
  };
}

function newsJson(n, { detail = false } = {}) {
  const base = {
    slug: n.slug,
    title: n.title,
    altTitle: n.alt_title,
    summary: n.summary,
    imageUrl: n.image_url,
    imageSource: n.image_source,
    source: n.source_name,
    url: n.url,
    publishedAt: n.published_at,
    fetchedAt: n.fetched_at,
    section: n.primary_section,
    sections: n.sections,
    tags: n.tags,
    featured: !!n.featured,
    isDemo: !!n.is_demo,
    views: n.views
  };
  if (detail) base.bodyExcerpt = n.body_excerpt;
  return base;
}

async function handleApi(req, res, parsed) {
  const pathname = parsed.pathname;
  const q = parsed.searchParams;

  if (!apiLimiter(clientIp(req))) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones' });
  }

  // ---------- públicas ----------
  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, publicStatus());
  }

  if (pathname === '/api/sections' && req.method === 'GET') {
    const cats = db.getCategories();
    const counts = {};
    const rows = db
      .getDb()
      .prepare("SELECT primary_section s, COUNT(*) c FROM news WHERE status='approved' GROUP BY primary_section")
      .all();
    for (const r of rows) counts[r.s] = r.c;
    return sendJson(res, 200, cats.map((c) => ({ ...c, count: counts[c.slug] || 0 })));
  }

  if (pathname === '/api/news' && req.method === 'GET') {
    const result = db.listNews({
      status: q.get('status') === 'all' && !q.get('q') ? 'approved' : 'approved',
      section: q.get('section') || null,
      q: q.get('q') ? q.get('q').slice(0, 120) : null,
      from: q.get('from') || null,
      to: q.get('to') || null,
      featured: q.get('featured') === '1' ? true : null,
      page: Number(q.get('page') || 1),
      perPage: Number(q.get('per') || 12),
      sort: q.get('sort') || 'published'
    });
    return sendJson(res, 200, {
      ...result,
      items: result.items.map((n) => newsJson(n))
    });
  }

  if (pathname === '/api/search' && req.method === 'GET') {
    const term = (q.get('q') || '').slice(0, 120);
    if (!term) return sendJson(res, 200, { items: [], total: 0, page: 1, pages: 0 });
    const result = db.listNews({
      status: 'approved',
      q: term,
      page: Number(q.get('page') || 1),
      perPage: Number(q.get('per') || 12)
    });
    return sendJson(res, 200, { ...result, items: result.items.map((n) => newsJson(n)) });
  }

  if (pathname === '/api/popular' && req.method === 'GET') {
    const items = db.getPopularNews(Number(q.get('limit') || 6));
    return sendJson(res, 200, items.map((n) => newsJson(n)));
  }

  if (pathname === '/api/latest' && req.method === 'GET') {
    const items = db.getLatestNews(Number(q.get('limit') || 8));
    return sendJson(res, 200, items.map((n) => newsJson(n)));
  }

  if (pathname === '/api/agenda' && req.method === 'GET') {
    return sendJson(res, 200, db.getAgenda(Number(q.get('limit') || 8)));
  }
  if (pathname === '/api/recipes' && req.method === 'GET') {
    return sendJson(res, 200, db.getRecipes(Number(q.get('limit') || 50), true));
  }
  if (pathname === '/api/recipes' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.title || !body.ingredients || !body.steps) return sendJson(res, 400, { error: 'Título, ingredientes y elaboración obligatorios' });
    db.addRecipe({ ...body, status: 'pending', is_demo: 0 });
    return sendJson(res, 200, { ok: true, message: 'Receta enviada para revisión' });
  }

  const detailMatch = pathname.match(/^\/api\/news\/([^/]+)$/);
  if (detailMatch && req.method === 'GET') {
    const slug = decodeURIComponent(detailMatch[1]);
    const news = db.getNewsBySlug(slug, { incrementViews: true });
    if (!news) return sendJson(res, 404, { error: 'Noticia no encontrada' });
    const related = db.getRelatedNews(news, 4);
    return sendJson(res, 200, {
      news: newsJson(news, { detail: true }),
      related: related.map((n) => newsJson(n))
    });
  }

  // ---------- administración ----------
  if (pathname.startsWith('/api/admin/')) {
    return handleAdminApi(req, res, parsed);
  }

  return sendJson(res, 404, { error: 'Ruta no encontrada' });
}

/* ------------------------------------------------------------------ */
/* API administración                                                   */
/* ------------------------------------------------------------------ */

async function handleAdminApi(req, res, parsed) {
  const pathname = parsed.pathname;
  const sub = pathname.replace('/api/admin/', '');
  const method = req.method;

  // ---- login / logout (sin sesión) ----
  if (sub === 'login' && method === 'POST') {
    const body = await readBody(req);
    const result = auth.login(body.username, body.password, clientIp(req));
    if (!result.ok) return sendJson(res, 401, { error: result.error });
    return sendJson(res, 200, { ok: true, user: body.username }, {
      'Set-Cookie': auth.buildSessionCookie(result.token)
    });
  }

  if (sub === 'logout' && method === 'POST') {
    const session = auth.getSession(req);
    if (session) auth.logout(session.token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  // ---- resto: requieren sesión ----
  const session = auth.requireAuth(req, res);
  if (!session) return;

  if (sub === 'me' && method === 'GET') {
    return sendJson(res, 200, { user: session.username });
  }

  if (sub === 'status' && method === 'GET') {
    const last = db.listHistory(1)[0] || null;
    return sendJson(res, 200, {
      ...publicStatus(),
      collectorRunning: collector.isRunning(),
      scheduler: scheduler.status(),
      lastHistory: last,
      sources: db.getSources().map((s) => ({
        id: s.id, name: s.name, url: s.url, enabled: !!s.enabled,
        lastRunAt: s.last_run_at, lastStatus: s.last_status, lastError: s.last_error
      }))
    });
  }

  if (sub === 'collect' && method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const result = await collector.collect({
      trigger: 'manual',
      query: body.query ? String(body.query).slice(0, 200) : null
    });
    return sendJson(res, 200, result);
  }

  if (sub === 'history' && method === 'GET') {
    return sendJson(res, 200, db.listHistory(50));
  }

  if (sub === 'errors' && method === 'GET') {
    return sendJson(res, 200, db.listErrors(150));
  }

  // ---- noticias ----
  if (sub === 'news' && method === 'GET') {
    const result = db.listNews({
      status: parsed.searchParams.get('status') || 'pending',
      section: parsed.searchParams.get('section') || null,
      q: parsed.searchParams.get('q') || null,
      isDemo: parsed.searchParams.get('demo') === '1' ? true : null,
      page: Number(parsed.searchParams.get('page') || 1),
      perPage: Number(parsed.searchParams.get('per') || 20),
      sort: parsed.searchParams.get('sort') || 'fetched'
    });
    return sendJson(res, 200, result);
  }

  const newsMatch = sub.match(/^news\/(\d+)$/);
  if (newsMatch && method === 'GET') {
    const news = db.getNewsById(Number(newsMatch[1]));
    return news ? sendJson(res, 200, news) : sendJson(res, 404, { error: 'No encontrada' });
  }
  if (newsMatch && method === 'PATCH') {
    const id = Number(newsMatch[1]);
    const body = await readBody(req);
    const fields = {};
    const allow = ['title', 'alt_title', 'summary', 'primary_section', 'sections', 'tags', 'status', 'featured', 'image_url', 'published_at'];
    for (const k of allow) if (body[k] !== undefined) fields[k] = body[k];
    if (fields.status && !['pending', 'approved', 'rejected'].includes(fields.status)) {
      return sendJson(res, 400, { error: 'Estado no válido' });
    }
    if (fields.sections && !Array.isArray(fields.sections)) {
      return sendJson(res, 400, { error: 'Secciones no válidas' });
    }
    const ok = db.updateNews(id, fields);
    return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'No encontrada' });
  }

  if (newsMatch && method === 'DELETE') {
    db.deleteNews(Number(newsMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ---- fuentes ----
  if (sub === 'sources' && method === 'GET') {
    return sendJson(res, 200, db.getSources());
  }
  if (sub === 'sources' && method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !isSafeUrl(body.url)) {
      return sendJson(res, 400, { error: 'Nombre y URL (http/https) obligatorios' });
    }
    try {
      db.addSource({ name: String(body.name).slice(0, 120), url: body.url, type: body.type || 'rss', kind: body.kind || 'provincial', enabled: 1 });
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message.includes('UNIQUE') ? 'Esa URL ya existe' : e.message });
    }
  }
  const srcMatch = sub.match(/^sources\/(\d+)$/);
  if (srcMatch && method === 'PATCH') {
    const body = await readBody(req);
    if (body.url && !isSafeUrl(body.url)) return sendJson(res, 400, { error: 'URL no válida' });
    db.updateSource(Number(srcMatch[1]), body);
    return sendJson(res, 200, { ok: true });
  }
  if (srcMatch && method === 'DELETE') {
    db.deleteSource(Number(srcMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ---- configuración ----
  if (sub === 'config' && method === 'GET') {
    const cfg = db.getAllConfig();
    // Nunca se devuelven claves API al frontend
    delete cfg.SEARCH_API_KEY;
    delete cfg.AI_API_KEY;
    return sendJson(res, 200, {
      config: cfg,
      env: {
        searchProvider: searchProvider.status(),
        aiProvider: aiProcessor.status()
      }
    });
  }
  if (sub === 'config' && method === 'PUT') {
    const body = await readBody(req);
    const editable = ['publication_mode', 'auto_collect_minutes', 'search_queries', 'demo_mode', 'site_name'];
    for (const k of editable) {
      if (body[k] !== undefined) db.setConfig(k, String(body[k]).slice(0, 4000));
    }
    if (body.publication_mode && !['auto', 'manual'].includes(body.publication_mode)) {
      return sendJson(res, 400, { error: 'Modo de publicación no válido' });
    }
    scheduler.restart();
    return sendJson(res, 200, { ok: true, config: db.getAllConfig() });
  }

  // ---- agenda ----
  if (sub === 'agenda' && method === 'GET') {
    return sendJson(res, 200, db.getDb().prepare('SELECT * FROM agenda ORDER BY event_date LIMIT 50').all());
  }
  if (sub === 'agenda' && method === 'POST') {
    const body = await readBody(req);
    if (!body.title || !body.event_date) return sendJson(res, 400, { error: 'Título y fecha obligatorios' });
    db.addAgenda({ ...body, is_demo: 0 });
    return sendJson(res, 200, { ok: true });
  }
  const agMatch = sub.match(/^agenda\/(\d+)$/);
  if (agMatch && method === 'DELETE') {
    db.deleteAgenda(Number(agMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ---- recetas ----
  if (sub === 'recipes' && method === 'GET') {
    const rq = parsed.searchParams;
    return sendJson(res, 200, db.getRecipes(Number(rq.get('limit') || 50), false));
  }
  if (sub === 'recipes' && method === 'POST') {
    const body = await readBody(req);
    if (!body.title) return sendJson(res, 400, { error: 'Título obligatorio' });
    db.addRecipe({ ...body, is_demo: 0 });
    return sendJson(res, 200, { ok: true });
  }
  const recipeMatch = sub.match(/^recipes\/(\d+)$/);
  if (recipeMatch && method === 'PATCH') {
    const body = await readBody(req);
    db.updateRecipe(Number(recipeMatch[1]), body);
    return sendJson(res, 200, { ok: true });
  }
  if (recipeMatch && method === 'DELETE') {
    db.deleteRecipe(Number(recipeMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Ruta no encontrada' });
}

/* ------------------------------------------------------------------ */
/* SEO: sitemap.xml y robots.txt                                        */
/* ------------------------------------------------------------------ */

function siteOrigin(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function serveSitemap(req, res) {
  const origin = siteOrigin(req);
  const rows = db
    .getDb()
    .prepare("SELECT slug, updated_at, primary_section FROM news WHERE status='approved' ORDER BY published_at DESC LIMIT 1000")
    .all();
  const sections = db.getCategories();

  const urls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'hourly' },
    { loc: `${origin}/noticias`, priority: '0.8', changefreq: 'hourly' },
    ...sections.map((s) => ({ loc: `${origin}/seccion/${s.slug}`, priority: '0.7', changefreq: 'daily' })),
    { loc: `${origin}/privacidad`, priority: '0.2', changefreq: 'monthly' },
    { loc: `${origin}/recorrido-3d`, priority: '0.5', changefreq: 'monthly' },
    { loc: `${origin}/resumen`, priority: '0.7', changefreq: 'daily' },
    { loc: `${origin}/chat`, priority: '0.4', changefreq: 'monthly' },
    { loc: `${origin}/tiempo`, priority: '0.6', changefreq: 'daily' },
    { loc: `${origin}/recetas`, priority: '0.6', changefreq: 'weekly' },
    { loc: `${origin}/aviso-legal`, priority: '0.2', changefreq: 'monthly' },
    ...rows.map((n) => ({
      loc: `${origin}/noticia/${n.slug}`,
      lastmod: (n.updated_at || '').slice(0, 10),
      priority: '0.6',
      changefreq: 'weekly'
    }))
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${escapeHtml(u.loc)}</loc>\n` +
          (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
          `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join('\n') +
    `\n</urlset>\n`;

  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.end(xml);
}

function serveRobots(req, res) {
  const origin = siteOrigin(req);
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
}

/* ------------------------------------------------------------------ */
/* Servidor                                                             */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  activeRequests++;
  res.on('close', () => {
    activeRequests = Math.max(0, activeRequests - 1);
    if (shuttingDown && activeRequests === 0) destroyIdleSockets();
  });
  if (shuttingDown) {
    sendJson(res, 503, { error: 'Servidor en cierre' });
    return;
  }
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsed.pathname;

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, parsed);
    }
    if (pathname === '/sitemap.xml') return serveSitemap(req, res);
    if (pathname === '/robots.txt') return serveRobots(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Método no permitido' });
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    db.logError('server', 'Error interno', `${req.method} ${req.url} — ${err.message}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor' });
  }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                             */
/* ------------------------------------------------------------------ */

function bootstrap() {
  db.init();

  // Primera ejecución: insertar noticias de demostración si la BD está vacía
  const demoMode = db.getConfig('demo_mode', '1') === '1';
  const count = db.getDb().prepare('SELECT COUNT(*) c FROM news').get().c;
  if (count === 0 && demoMode) {
    const added = db.seedDemoNews();
    console.log(`[server] Base de datos vacía: insertadas ${added} noticias de demostración.`);
  }
  if (!demoMode) {
    const del = db.getDb().prepare('DELETE FROM news WHERE is_demo = 1').run();
    if (del.changes > 0) console.log(`[server] Eliminadas ${del.changes} noticias de demostración.`);
  }

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │   Ayamonte.org — periódico digital          │');
    console.log(`  │   http://${HOST}:${PORT}                     │`);
    console.log(`  │   Panel admin: http://${HOST}:${PORT}/admin    │`);
    console.log('  └─────────────────────────────────────────────┘');
    console.log(`  [server] Modo publicación: ${db.getConfig('publication_mode', 'manual')}`);
    console.log(`  [server] Proveedor búsqueda: ${searchProvider.getProvider()} · IA: ${aiProcessor.getProvider()}`);
    console.log('');
    scheduler.start();
  });

  const shutdown = () => {
    console.log('\n[server] Cerrando...');
    scheduler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    db.logError('server', 'Excepción no capturada', err.stack || err.message);
    console.error('[server] Excepción no capturada:', err.message);
  });
  process.on('unhandledRejection', (err) => {
    db.logError('server', 'Rechazo de promesa no capturado', String(err && err.stack || err));
    console.error('[server] Rechazo no capturado:', err);
  });
}

bootstrap();

module.exports = { server };
