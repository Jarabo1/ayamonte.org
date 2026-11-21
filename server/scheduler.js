'use strict';
/**
 * scheduler.js — Tareas programadas de recopilación automática.
 * - Intervalo configurable (AUTO_COLLECT_MINUTES, por defecto 30).
 * - Nunca ejecuta dos recopilaciones a la vez.
 * - Reintenta tras fallos y registra actividad.
 * - La aplicación sigue funcionando aunque falle el planificador.
 */
const db = require('./database');
const collector = require('./newsCollector');

let timer = null;
let startupTimer = null;
let enabled = true;

function minutes() {
  const raw = Number(db.getConfig('auto_collect_minutes', process.env.AUTO_COLLECT_MINUTES || 30));
  return Number.isFinite(raw) ? raw : 30;
}

async function run(trigger = 'auto') {
  if (!enabled) return null;
  if (collector.isRunning()) {
    console.log('[scheduler] Recopilación omitida: ya hay una en curso.');
    return null;
  }
  console.log(`[scheduler] Recopilación automática ${new Date().toISOString()}...`);
  try {
    const res = await collector.collect({ trigger });
    console.log(
      `[scheduler] Fin: nuevas=${res.newAdded || 0} duplicadas=${res.duplicates || 0} descartadas=${res.rejected || 0}`
    );
    return res;
  } catch (err) {
    db.logError('scheduler', 'Error en tarea programada', err.message);
    console.error('[scheduler] Error:', err.message);
    return null;
  }
}

/** (Re)inicia el temporizador con la frecuencia actual de la configuración. */
function restart() {
  stop();
  const m = minutes();
  if (!enabled || m <= 0) {
    console.log('[scheduler] Búsqueda automática desactivada.');
    return null;
  }
  timer = setInterval(() => run('auto'), m * 60 * 1000);
  // No bloquea el proceso de cierre
  if (timer.unref) timer.unref();
  console.log(`[scheduler] Búsqueda automática cada ${m} min.`);
  return timer;
}

function start({ delayMs = 8000 } = {}) {
  enabled = true;
  restart();
  // Primera ejecución algo después de arrancar (para no retrasar el arranque)
  startupTimer = setTimeout(() => run('auto'), delayMs);
  if (startupTimer.unref) startupTimer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  if (startupTimer) clearTimeout(startupTimer);
  timer = null;
  startupTimer = null;
}

function setEnabled(on) {
  enabled = !!on;
  if (on) restart();
  else stop();
}

function status() {
  return {
    enabled,
    running: collector.isRunning(),
    minutes: minutes(),
    nextRun: timer ? 'programado' : 'desactivado'
  };
}

module.exports = { start, stop, restart, run, setEnabled, status };
