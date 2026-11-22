'use strict';
/**
 * Capa de datos: SQLite con node:sqlite (sin dependencias externas).
 * - Inicializa el esquema automáticamente en la primera ejecución.
 * - Carga secciones y fuentes desde config/sources.json.
 * - Inserta noticias de DEMOSTRACIÓN claramente identificadas (is_demo = 1).
 *
 * Uso:  const { init, ... } = require('./database');
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const {
  slugify,
  fingerprint,
  normalizeText,
  textSimilarity,
  canonicalUrl
} = require('./utils');

const ROOT = path.join(__dirname, '..');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(ROOT, '.env'))) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) {}
}
const CONFIG_PATH = path.join(ROOT, 'config', 'sources.json');

let db = null;

function dbPath() {
  const p = process.env.DB_PATH || path.join('data', 'ayamonte.db');
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

function loadConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[db] No se pudo leer config/sources.json:', err.message);
    return { sections: [], sources: [], searchQueries: [], nearbyPlaces: ['Ayamonte'] };
  }
}

/* ------------------------------------------------------------------ */
/* Esquema                                                            */
/* ------------------------------------------------------------------ */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL DEFAULT 'rss',
  kind         TEXT NOT NULL DEFAULT 'provincial',
  enabled      INTEGER NOT NULL DEFAULT 1,
  added_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at  TEXT,
  last_status  TEXT,
  last_error   TEXT
);

CREATE TABLE IF NOT EXISTS news (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  alt_title      TEXT,
  summary        TEXT NOT NULL DEFAULT '',
  body_excerpt   TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL,
  canonical      TEXT NOT NULL DEFAULT '',
  image_url      TEXT,
  image_source   TEXT,
  source_name    TEXT NOT NULL DEFAULT '',
  source_id      INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  published_at   TEXT,
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  primary_section TEXT NOT NULL DEFAULT 'sociedad',
  sections       TEXT NOT NULL DEFAULT '[]',
  tags           TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending',
  featured       INTEGER NOT NULL DEFAULT 0,
  is_demo        INTEGER NOT NULL DEFAULT 0,
  ai_processed   INTEGER NOT NULL DEFAULT 0,
  ai_provider    TEXT,
  fingerprint    TEXT NOT NULL,
  views          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_canonical ON news(canonical) WHERE canonical != '';
CREATE INDEX IF NOT EXISTS idx_news_status ON news(status);
CREATE INDEX IF NOT EXISTS idx_news_section ON news(primary_section);
CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_fingerprint ON news(fingerprint);

CREATE TABLE IF NOT EXISTS search_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  query        TEXT,
  provider     TEXT,
  sources_total INTEGER DEFAULT 0,
  items_found  INTEGER DEFAULT 0,
  new_added    INTEGER DEFAULT 0,
  duplicates   INTEGER DEFAULT 0,
  rejected     INTEGER DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'running',
  message      TEXT
);

CREATE TABLE IF NOT EXISTS errors_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL DEFAULT (datetime('now')),
  module    TEXT NOT NULL,
  level     TEXT NOT NULL DEFAULT 'error',
  message   TEXT NOT NULL,
  detail    TEXT
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agenda (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  event_date  TEXT NOT NULL,
  event_time  TEXT,
  location    TEXT,
  section     TEXT,
  url         TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  origin        TEXT,
  ingredients   TEXT,
  steps         TEXT,
  source_name   TEXT,
  source_url    TEXT,
  image_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'approved',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  news_slug   TEXT NOT NULL,
  author      TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Migración: añadir columna status si no existe
try { getDb().exec("ALTER TABLE recipes ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"); } catch (e) {}

/* ------------------------------------------------------------------ */
/* Inicialización                                                      */
/* ------------------------------------------------------------------ */

function init() {
  if (db) return db;
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(SCHEMA);
  seedConfig();
  seedCategories();
  seedSources();
  seedAgenda();
  return db;
}

function getDb() {
  return db || init();
}

function close() {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
  }
}

function seedConfig() {
  const cfg = loadConfigFile();
  const defaults = {
    publication_mode: process.env.PUBLICATION_MODE === 'auto' ? 'auto' : 'manual',
    auto_collect_minutes: String(process.env.AUTO_COLLECT_MINUTES || 30),
    search_provider: process.env.SEARCH_PROVIDER || 'none',
    ai_provider: process.env.AI_PROVIDER || 'none',
    ai_model: process.env.AI_MODEL || '',
    search_queries: (cfg.searchQueries || []).join(', '),
    demo_mode: cfg.demoMode === false ? '0' : '1',
    last_collect_at: '',
    site_name: 'AYAMONTE AL DÍA'
  };
  const stmt = getDb().prepare('INSERT OR IGNORE INTO config(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) stmt.run(k, String(v));
}

function seedCategories() {
  const cfg = loadConfigFile();
  const stmt = getDb().prepare('INSERT OR IGNORE INTO categories(slug, name, position) VALUES (?, ?, ?)');
  cfg.sections.forEach((s, i) => stmt.run(s.slug, s.name, i));
}

function seedSources() {
  const cfg = loadConfigFile();
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO sources(name, url, type, kind, enabled) VALUES (?, ?, ?, ?, ?)'
  );
  for (const s of cfg.sources || []) {
    stmt.run(s.name, s.url, s.type || 'rss', s.kind || 'provincial', s.enabled ? 1 : 0);
  }
}

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

function getConfig(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setConfig(key, value) {
  getDb()
    .prepare('INSERT INTO config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getAllConfig() {
  const rows = getDb().prepare('SELECT key, value FROM config').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/* ------------------------------------------------------------------ */
/* Categorías y fuentes                                                */
/* ------------------------------------------------------------------ */

function getCategories() {
  return getDb().prepare('SELECT * FROM categories ORDER BY position').all();
}

function getSources() {
  return getDb().prepare('SELECT * FROM sources ORDER BY name').all();
}

function addSource({ name, url, type = 'rss', kind = 'provincial', enabled = 1 }) {
  getDb()
    .prepare('INSERT INTO sources(name, url, type, kind, enabled) VALUES (?, ?, ?, ?, ?)')
    .run(name, url, type, kind, enabled ? 1 : 0);
}

function updateSource(id, fields) {
  const allowed = ['name', 'url', 'type', 'kind', 'enabled'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(k === 'enabled' ? (fields[k] ? 1 : 0) : fields[k]);
    }
  }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteSource(id) {
  getDb().prepare('DELETE FROM sources WHERE id = ?').run(id);
}

function markSourceResult(id, status, error) {
  getDb()
    .prepare('UPDATE sources SET last_run_at = datetime(\'now\'), last_status = ?, last_error = ? WHERE id = ?')
    .run(status, error || null, id);
}

/* ------------------------------------------------------------------ */
/* Noticias                                                            */
/* ------------------------------------------------------------------ */

function rowToNews(row) {
  if (!row) return null;
  return {
    ...row,
    sections: safeJson(row.sections, []),
    tags: safeJson(row.tags, []),
    featured: !!row.featured,
    is_demo: !!row.is_demo,
    ai_processed: !!row.ai_processed
  };
}

function safeJson(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * Inserta una noticia si no existe duplicado.
 * Duplicado = misma URL canónica, misma huella o titular muy similar reciente.
 * @returns {{inserted:boolean, reason?:string, id?:number}}
 */
function insertNews(item) {
  const d = getDb();
  const canonical = canonicalUrl(item.url);
  const fp = item.fingerprint || fingerprint(item);

  if (canonical) {
    const byUrl = d.prepare('SELECT id FROM news WHERE canonical = ?').get(canonical);
    if (byUrl) return { inserted: false, reason: 'url', id: byUrl.id };
  }

  const byFp = d.prepare('SELECT id FROM news WHERE fingerprint = ?').get(fp);
  if (byFp) return { inserted: false, reason: 'fingerprint', id: byFp.id };

  // Duplicado semántico: mismo titular (sin fuente) publicado en los últimos 15 días
  const recent = d
    .prepare("SELECT id, title FROM news WHERE created_at >= datetime('now', '-15 days') LIMIT 400")
    .all();
  for (const r of recent) {
    if (textSimilarity(r.title, item.title) > 0.72) {
      return { inserted: false, reason: 'similar-title', id: r.id };
    }
  }

  const sections = Array.isArray(item.sections) && item.sections.length ? item.sections : ['sociedad'];
  const primary = item.primary_section || sections[0];
  const slugBase = slugify(item.alt_title || item.title);
  let slug = slugBase;
  let n = 2;
  while (d.prepare('SELECT 1 FROM news WHERE slug = ?').get(slug)) slug = `${slugBase}-${n++}`;

  const res = d
    .prepare(
      `INSERT INTO news
        (slug, title, alt_title, summary, body_excerpt, url, canonical, image_url, image_source,
         source_name, source_id, published_at, primary_section, sections, tags, status, featured,
         is_demo, ai_processed, ai_provider, fingerprint)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      slug,
      item.title,
      item.alt_title || null,
      item.summary || '',
      item.body_excerpt || '',
      item.url,
      canonical,
      item.image_url || null,
      item.image_source || null,
      item.source_name || '',
      item.source_id || null,
      item.published_at || null,
      primary,
      JSON.stringify(sections),
      JSON.stringify(item.tags || []),
      item.status || 'pending',
      item.featured ? 1 : 0,
      item.is_demo ? 1 : 0,
      item.ai_processed ? 1 : 0,
      item.ai_provider || null,
      fp
    );
  return { inserted: true, id: Number(res.lastInsertRowid) };
}

/** Lista noticias con filtros, paginación y orden. */
function listNews({
  status = 'approved',
  section = null,
  q = null,
  from = null,
  to = null,
  featured = null,
  isDemo = null,
  page = 1,
  perPage = 12,
  sort = 'published'
} = {}) {
  const d = getDb();
  const where = [];
  const params = [];

  if (status === 'all') {
    /* sin filtro */
  } else if (status === 'pending-or-approved') {
    where.push("status IN ('pending','approved')");
  } else {
    where.push('status = ?');
    params.push(status);
  }

  if (section) {
    // primary_section o sección secundaria (JSON array)
    where.push("(primary_section = ? OR sections LIKE ?)");
    params.push(section, `%"${section}"%`);
  }

  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    where.push('(title LIKE ? OR summary LIKE ? OR tags LIKE ? OR body_excerpt LIKE ?)');
    params.push(like, like, like, like);
  }

  if (from) {
    where.push('published_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('published_at <= ?');
    params.push(to + 'T23:59:59');
  }
  if (featured === true) where.push('featured = 1');
  if (isDemo === true) where.push('is_demo = 1');
  if (isDemo === false) where.push('is_demo = 0');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const order =
    sort === 'fetched'
      ? 'ORDER BY fetched_at DESC, id DESC'
      : sort === 'views'
        ? 'ORDER BY views DESC, id DESC'
        : "ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC";

  const total = d.prepare(`SELECT COUNT(*) AS c FROM news ${whereSql}`).get(...params).c;
  const per = Math.min(Math.max(1, perPage), 60);
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, page), pages);
  const rows = d
    .prepare(`SELECT * FROM news ${whereSql} ${order} LIMIT ? OFFSET ?`)
    .all(...params, per, (p - 1) * per);

  return { items: rows.map(rowToNews), total, page: p, pages, perPage: per };
}

function getNewsBySlug(slug, { incrementViews = false } = {}) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM news WHERE slug = ?').get(slug);
  if (!row) return null;
  if (incrementViews) {
    d.prepare('UPDATE news SET views = views + 1 WHERE id = ?').run(row.id);
    row.views += 1;
  }
  return rowToNews(row);
}

function getNewsById(id) {
  return rowToNews(getDb().prepare('SELECT * FROM news WHERE id = ?').get(id));
}

/** Actualiza campos editables de una noticia desde el panel de administración. */
function updateNews(id, fields) {
  const allowed = [
    'title', 'alt_title', 'summary', 'body_excerpt', 'primary_section',
    'sections', 'tags', 'status', 'featured', 'image_url', 'published_at'
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] === undefined) continue;
    let v = fields[k];
    if (k === 'sections' || k === 'tags') v = JSON.stringify(v || []);
    if (k === 'featured') v = v ? 1 : 0;
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (!sets.length) return false;
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  getDb().prepare(`UPDATE news SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return true;
}

function deleteNews(id) {
  getDb().prepare('DELETE FROM news WHERE id = ?').run(id);
}

function getPopularNews(limit = 6) {
  return getDb()
    .prepare("SELECT * FROM news WHERE status = 'approved' ORDER BY views DESC, published_at DESC LIMIT ?")
    .all(limit)
    .map(rowToNews);
}

function getLatestNews(limit = 8, excludeSlugs = []) {
  const rows = getDb()
    .prepare(
      `SELECT * FROM news WHERE status = 'approved'
       ORDER BY fetched_at DESC, id DESC LIMIT ?`
    )
    .all(limit + excludeSlugs.length);
  return rows.map(rowToNews).filter((n) => !excludeSlugs.includes(n.slug)).slice(0, limit);
}

/** Noticias relacionadas: misma sección o etiquetas compartidas. */
function getRelatedNews(news, limit = 4) {
  const tags = news.tags || [];
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT * FROM news
       WHERE status = 'approved' AND id != ?
         AND (primary_section = ? OR sections LIKE ?)
       ORDER BY published_at DESC LIMIT 25`
    )
    .all(news.id, news.primary_section, `%"${news.primary_section}"%`)
    .map(rowToNews);

  const scored = rows.map((r) => {
    const shared = (r.tags || []).filter((t) => tags.includes(t)).length;
    return { r, score: shared };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.r);
}

/* ------------------------------------------------------------------ */
/* Historial, errores, agenda                                          */
/* ------------------------------------------------------------------ */

function startHistory({ triggerType = 'manual', query = null, provider = null }) {
  const res = getDb()
    .prepare('INSERT INTO search_history(trigger_type, query, provider) VALUES (?, ?, ?)')
    .run(triggerType, query, provider);
  return Number(res.lastInsertRowid);
}

function finishHistory(id, data) {
  getDb()
    .prepare(
      `UPDATE search_history SET finished_at = datetime('now'), sources_total = ?, items_found = ?,
        new_added = ?, duplicates = ?, rejected = ?, status = ?, message = ? WHERE id = ?`
    )
    .run(
      data.sourcesTotal || 0,
      data.itemsFound || 0,
      data.newAdded || 0,
      data.duplicates || 0,
      data.rejected || 0,
      data.status || 'ok',
      data.message || null,
      id
    );
}

function listHistory(limit = 30) {
  return getDb()
    .prepare('SELECT * FROM search_history ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function logError(module, message, detail, level = 'error') {
  try {
    getDb()
      .prepare('INSERT INTO errors_log(module, level, message, detail) VALUES (?, ?, ?, ?)')
      .run(module, level, String(message).slice(0, 500), detail ? String(detail).slice(0, 4000) : null);
  } catch (e) {
    console.error('[db] error al registrar log:', e.message);
  }
}

function listErrors(limit = 100) {
  return getDb().prepare('SELECT * FROM errors_log ORDER BY id DESC LIMIT ?').all(limit);
}

function getAgenda(limit = 10) {
  return getDb()
    .prepare('SELECT * FROM agenda WHERE event_date >= date(\'now\', \'-1 day\') ORDER BY event_date, event_time LIMIT ?')
    .all(limit);
}

function addAgenda(item) {
  getDb()
    .prepare(
      'INSERT INTO agenda(title, description, event_date, event_time, location, section, url, is_demo) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(item.title, item.description || null, item.event_date, item.event_time || null, item.location || null, item.section || null, item.url || null, item.is_demo ? 1 : 0);
}

function deleteAgenda(id) {
  getDb().prepare('DELETE FROM agenda WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ */
/* Recetas gastronómicas                                               */
/* ------------------------------------------------------------------ */
function getRecipes(limit = 50, onlyApproved = true) {
  const sql = onlyApproved
    ? 'SELECT * FROM recipes WHERE status = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM recipes ORDER BY created_at DESC LIMIT ?';
  return onlyApproved
    ? getDb().prepare(sql).all('approved', limit)
    : getDb().prepare(sql).all(limit);
}
function addRecipe(item) {
  getDb()
    .prepare('INSERT INTO recipes(title, origin, ingredients, steps, source_name, source_url, image_url, status, is_demo) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(item.title, item.origin || null, item.ingredients || null, item.steps || null, item.source_name || null, item.source_url || null, item.image_url || null, item.status || 'approved', item.is_demo ? 1 : 0);
}
function updateRecipe(id, fields) {
  const sets = [];
  const vals = [];
  const allowed = ['title', 'origin', 'ingredients', 'steps', 'source_name', 'source_url', 'image_url'];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
function deleteRecipe(id) {
  getDb().prepare('DELETE FROM recipes WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ */
/* Comentarios                                                         */
/* ------------------------------------------------------------------ */
function getComments(slug, onlyApproved = true) {
  const sql = onlyApproved
    ? 'SELECT * FROM comments WHERE news_slug = ? AND status = ? ORDER BY created_at DESC'
    : 'SELECT * FROM comments WHERE news_slug = ? ORDER BY created_at DESC';
  return onlyApproved
    ? getDb().prepare(sql).all(slug, 'approved')
    : getDb().prepare(sql).all(slug);
}
function addComment(item) {
  getDb()
    .prepare('INSERT INTO comments(news_slug, author, content, status) VALUES (?,?,?,?)')
    .run(item.news_slug, item.author, item.content, item.status || 'pending');
}
function updateComment(id, fields) {
  const sets = [];
  const vals = [];
  if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE comments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
function deleteComment(id) {
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(id);
}
function getAllComments(limit = 100, status = null) {
  if (status) return getDb().prepare('SELECT * FROM comments WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit);
  return getDb().prepare('SELECT * FROM comments ORDER BY created_at DESC LIMIT ?').all(limit);
}

/* ------------------------------------------------------------------ */
/* Sesiones                                                            */
/* ------------------------------------------------------------------ */

function createSession(token, username, hours = 12) {
  getDb()
    .prepare('INSERT INTO sessions(token, username, expires_at) VALUES (?, ?, datetime(\'now\', ?))')
    .run(token, username, `+${hours} hours`);
}

function getSession(token) {
  if (!token) return null;
  return getDb()
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .get(token);
}

function deleteSession(token) {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* ------------------------------------------------------------------ */
/* Semillas de demostración                                            */
/* ------------------------------------------------------------------ */

function seedDemoNews() {
  const cfg = loadConfigFile();
  const sectionsCfg = cfg.sections || [];
  const byName = (slug) => sectionsCfg.find((s) => s.slug === slug)?.name || slug;

  // Contenido DE DEMOSTRACIÓN: no son noticias reales, sirven para
  // mostrar el funcionamiento de la interfaz antes de configurar fuentes/IA.
  const demo = [
    {
      title: '[DEMO] El Ayuntamiento de Ayamonte presenta su plan de mejora de calzadas para el próximo ejercicio',
      summary:
        'Noticia de demostración generada para ilustrar el diseño de la portada. En una aplicación real, este espacio lo ocuparía un resumen elaborado por el módulo de IA a partir de la noticia publicada por el medio de origen, con enlace y atribución al original.',
      section: 'ayuntamiento',
      tags: ['ayuntamiento', 'urbanismo', 'demo'],
      hoursAgo: 2,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] La Semana Santa de Ayamonte ultima los preparos de sus cofradías',
      summary:
        'Resumen de demostración. El sistema clasificaría automáticamente esta noticia en las secciones Semana Santa y Sociedad, detectaría posibles duplicados en otros medios y generaría un titular alternativo si la longitud lo aconseja.',
      section: 'semana-santa',
      tags: ['semana-santa', 'cofradías', 'demo'],
      hoursAgo: 5,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] El CD Ayamonte se enfrenta al rival del derbi comarcal en la próxima jornada',
      summary:
        'Contenido de demostración para la sección de Deportes. Las tarjetas muestran fotografía, sección, titular, resumen, fecha, medio de procedencia y enlace a la noticia original.',
      section: 'deportes',
      tags: ['deportes', 'fútbol', 'demo'],
      hoursAgo: 8,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] Isla Cristina y Ayamonte coordinan acciones turísticas para la temporada de primavera',
      summary:
        'Noticia de demostración de la sección Comarca, que recoge información de Isla Cristina, Lepe, Villablanca, Cartaya y Villanueva de los Castillejos, entre otros municipios próximos.',
      section: 'comarca',
      tags: ['comarca', 'turismo', 'demo'],
      hoursAgo: 12,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] La cultura de Ayamonte abre el plazo de inscripción para sus talleres de invierno',
      summary:
        'Resumen de demostración. En producción, el módulo de IA redacta un resumen original en español natural a partir del contenido disponible, sin inventar declaraciones ni fechas.',
      section: 'cultura',
      tags: ['cultura', 'talleres', 'demo'],
      hoursAgo: 20,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] Aumentan las consultas por empleo en la comarca de Isla Cristina-Lepe',
      summary:
        'Contenido de demostración para Economía y Empleo. La plataforma conserva siempre el enlace a la noticia original y atribuye correctamente su procedencia.',
      section: 'economia',
      tags: ['empleo', 'economía', 'demo'],
      hoursAgo: 26,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] La policía local intensifica la vigilancia en los accesos al casco histórico',
      summary:
        'Noticia de demostración de la sección Sucesos. El estado de aprobación permite al administrador revisar cada noticia antes de su publicación.',
      section: 'sucesos',
      tags: ['seguridad', 'demo'],
      hoursAgo: 30,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] El Guadiana recibe más visitas tras la mejora de los itinerarios naturales',
      summary:
        'Resumen de demostración de Medio Ambiente. Cuando no existe imagen disponible, el sistema muestra una imagen genérica de la sección.',
      section: 'medio-ambiente',
      tags: ['guadiana', 'naturaleza', 'demo'],
      hoursAgo: 40,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] La oferta hotelera de la costa ayamontana prepara la temporada alta',
      summary:
        'Contenido de demostración para Turismo. Los filtros por fecha y sección permiten localizar noticias del archivo histórico.',
      section: 'turismo',
      tags: ['turismo', 'costa', 'demo'],
      hoursAgo: 50,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] El pleno municipal debatió varias mociones en la sesión ordinaria',
      summary:
        'Noticia de demostración de la sección Política. El panel de administración permite cambiar la sección, editar titulares y aprobar o rechazar cada noticia.',
      section: 'politica',
      tags: ['pleno', 'política', 'demo'],
      hoursAgo: 60,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] Sociedad civil organiza una jornada de voluntariado en Ayamonte',
      summary:
        'Resumen de demostración para la sección Sociedad. El sistema detecta duplicados cuando varios periódicos publican el mismo acontecimiento.',
      section: 'sociedad',
      tags: ['voluntariado', 'demo'],
      hoursAgo: 72,
      source: 'Datos de demostración'
    },
    {
      title: '[DEMO] El Carnaval de Ayamonte presenta el cartel de la próxima edición',
      summary:
        'Contenido de demostración de la sección Carnaval, una de las citas festivas más esperadas del calendario local.',
      section: 'carnaval',
      tags: ['carnaval', 'fiestas', 'demo'],
      hoursAgo: 84,
      source: 'Datos de demostración'
    }
  ];

  let added = 0;
  for (const d of demo) {
    const published = new Date(Date.now() - d.hoursAgo * 3600 * 1000).toISOString();
    const sections = [d.section];
    if (d.section === 'semana-santa') sections.push('cultura');
    if (d.section === 'comarca') sections.push('turismo');
    const res = insertNews({
      title: d.title,
      alt_title: null,
      summary: d.summary,
      body_excerpt: d.summary,
      url: `https://demo.ayamontealdia.local/${slugify(d.title)}`,
      image_url: `/assets/images/placeholder-${d.section}.svg`,
      image_source: 'Imagen genérica de demostración',
      source_name: d.source,
      published_at: published,
      primary_section: d.section,
      sections,
      tags: d.tags,
      status: 'approved',
      featured: d.hoursAgo === 2 ? 1 : 0,
      is_demo: 1,
      ai_processed: 1,
      ai_provider: 'demo'
    });
    if (res.inserted) added++;
  }
  return added;
}

function seedAgenda() {
  // No se insertan eventos demo automáticamente.
  return;
  const c = getDb().prepare('SELECT COUNT(*) AS c FROM agenda').get().c;
  if (c > 0) return;
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const items = [
    {
      title: '[DEMO] Mercado de productores locales',
      description: 'Evento de demostración para la agenda de la portada.',
      event_date: day(3),
      event_time: '10:00',
      location: 'Paseo de la Ribera, Ayamonte',
      section: 'sociedad',
      is_demo: 1
    },
    {
      title: '[DEMO] Concierto de música en el auditorio',
      description: 'Entrada de agenda de demostración.',
      event_date: day(7),
      event_time: '20:30',
      location: 'Auditorio de Ayamonte',
      section: 'cultura',
      is_demo: 1
    },
    {
      title: '[DEMO] Visita guiada por el casco histórico',
      description: 'Entrada de agenda de demostración.',
      event_date: day(12),
      event_time: '11:00',
      location: 'Oficina de Turismo',
      section: 'turismo',
      is_demo: 1
    }
  ];
  for (const it of items) addAgenda(it);
}

/* ------------------------------------------------------------------ */
/* CLI: node server/database.js --init                                 */
/* ------------------------------------------------------------------ */

if (require.main === module) {
  init();
  const added = seedDemoNews();
  console.log(`[db] Base de datos inicializada en ${dbPath()}`);
  console.log(`[db] Noticias de demostración insertadas: ${added}`);
}

module.exports = {
  init,
  getDb,
  close,
  dbPath,
  // config
  getConfig,
  setConfig,
  getAllConfig,
  // categorías / fuentes
  getCategories,
  getSources,
  addSource,
  updateSource,
  deleteSource,
  markSourceResult,
  // noticias
  insertNews,
  listNews,
  getNewsBySlug,
  getNewsById,
  updateNews,
  deleteNews,
  getPopularNews,
  getLatestNews,
  getRelatedNews,
  // historial / errores / agenda
  startHistory,
  finishHistory,
  listHistory,
  logError,
  listErrors,
  getAgenda,
  addAgenda,
  deleteAgenda,
  // recetas
  getRecipes,
  addRecipe,
  updateRecipe,
  deleteRecipe,
  // comentarios
  getComments,
  addComment,
  updateComment,
  deleteComment,
  getAllComments,
  // sesiones
  createSession,
  getSession,
  deleteSession,
  // seeds
  seedDemoNews,
  loadConfigFile
};
