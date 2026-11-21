'use strict';
/**
 * auth.js — Autenticación del panel de administración.
 * - Usuario/clave desde variables de entorno (ADMIN_USER / ADMIN_PASSWORD).
 * - Clave guardada con scrypt (se puede fijar ADMIN_PASSWORD_HASH en .env).
 * - Sesiones con token aleatorio en cookie HttpOnly + SameSite=Strict.
 * - Limitación de intentos de acceso.
 */
const db = require('./database');
const { randomToken, hashPassword, verifyPassword, rateLimiter } = require('./utils');

const COOKIE_NAME = 'aad_session';
const loginLimiter = rateLimiter(8, 5 * 60 * 1000); // 8 intentos / 5 min

function adminUser() {
  return process.env.ADMIN_USER || 'admin';
}

/** Hash precalculado o clave en claro de entorno (solo servidor). */
function adminHash() {
  if (process.env.ADMIN_PASSWORD_HASH) return process.env.ADMIN_PASSWORD_HASH;
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  if (!adminHash._cache) adminHash._cache = hashPassword(pw);
  return adminHash._cache;
}

function login(username, password, ip = '') {
  const key = `login:${ip || 'local'}`;
  if (!loginLimiter(key)) {
    return { ok: false, error: 'Demasiados intentos. Espera unos minutos.' };
  }
  const u = String(username || '');
  const p = String(password || '');
  if (!u || !p) return { ok: false, error: 'Usuario y clave obligatorios.' };

  const validUser = u === adminUser();
  const validPass = verifyPassword(p, adminHash());
  if (!validUser || !validPass) {
    db.logError('auth', 'Intento de acceso fallido', `Usuario: ${u.slice(0, 40)} · IP: ${ip}`, 'warn');
    return { ok: false, error: 'Usuario o clave incorrectos.' };
  }

  const token = randomToken(32);
  db.createSession(token, u, 12);
  return { ok: true, token };
}

function logout(token) {
  if (token) db.deleteSession(token);
}

function getSession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  return db.getSession(token);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function buildSessionCookie(token) {
  // Secure solo si el proceso está en producción con HTTPS delante
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${secure}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Middleware: comprueba sesión para rutas /api/admin/* */
function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'No autenticado' }));
    return null;
  }
  return session;
}

module.exports = { login, logout, getSession, buildSessionCookie, clearCookie, requireAuth, COOKIE_NAME };
