import fs from 'fs';
import path from 'path';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = {
  debug: '\x1b[90m',   // gray
  info:  '\x1b[36m',   // cyan
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
  reset: '\x1b[0m',
};

const LOG_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..', 'logs');
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_RETAIN_RUNS = parseInt(process.env.LOG_RETAIN_RUNS || '30', 10);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendLine(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

function formatConsole(level, step, msg, data) {
  const ts = new Date().toISOString();
  const color = COLORS[level] || '';
  const tag = step ? `[${step}] ` : '';
  const kvPairs = data && Object.keys(data).length
    ? '  ' + Object.entries(data).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';
  return `${color}[${ts}] [${level.toUpperCase()}] ${tag}${msg}${kvPairs}${COLORS.reset}`;
}

/**
 * Prune old run directories, keeping only the most recent `retain` runs.
 */
export function pruneOldRuns(retain = LOG_RETAIN_RUNS) {
  const runsDir = path.join(LOG_DIR, 'runs');
  if (!fs.existsSync(runsDir)) return;

  const entries = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run_'))
    .sort()
    .reverse();

  for (const dir of entries.slice(retain)) {
    const fullPath = path.join(runsDir, dir);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

/**
 * Create a structured logger.
 *
 * @param {object} opts
 * @param {string} opts.step - Step name (e.g. 'prepare', 'push')
 * @param {string} [opts.runId] - Run ID for file routing
 * @param {boolean} [opts.silent] - Suppress console output (for testing)
 * @returns {{ debug, info, warn, error }}
 */
export function createLogger(opts = {}) {
  const { step, runId, silent = false } = opts;
  const threshold = LEVELS[LOG_LEVEL] ?? LEVELS.info;

  function log(level, msg, data = {}) {
    if (LEVELS[level] < threshold) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      ...(runId && { runId }),
      ...(step && { step }),
      msg,
      ...data,
    };

    // Console output
    if (!silent) {
      console.log(formatConsole(level, step, msg, data));
    }

    // Per-step log (if runId provided)
    if (runId && step) {
      appendLine(path.join(LOG_DIR, 'runs', runId, `step-${step}.jsonl`), entry);
    }

    // Combined rolling log
    appendLine(path.join(LOG_DIR, 'pipeline.jsonl'), entry);

    // Failures log
    if (level === 'error') {
      appendLine(path.join(LOG_DIR, 'failures.jsonl'), entry);
    }
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info:  (msg, data) => log('info', msg, data),
    warn:  (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
