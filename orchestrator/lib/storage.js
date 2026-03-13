import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = join(__dirname, '..', '..');
const DATA_ROOT = join(PROJECT_ROOT, 'data', 'orchestrator');

export const PATHS = {
  root: DATA_ROOT,
  ingestion: join(DATA_ROOT, 'ingestion'),
  staging: join(DATA_ROOT, 'staging'),
  curated: join(DATA_ROOT, 'curated'),
  output: join(DATA_ROOT, 'output'),
  runs: join(DATA_ROOT, 'runs'),
  state: join(DATA_ROOT, 'state'),
};

export function ensureDataDirs() {
  Object.values(PATHS).forEach((p) => {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  });
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function getState(name, fallback = {}) {
  return readJson(join(PATHS.state, `${name}.json`), fallback);
}

export function setState(name, value) {
  writeJson(join(PATHS.state, `${name}.json`), value);
}

export function listRuns(limit = 25) {
  if (!existsSync(PATHS.runs)) return [];
  return readdirSync(PATHS.runs)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
    .map((runId) => readJson(join(PATHS.runs, runId, 'run-summary.json')))
    .filter(Boolean);
}

export function runDir(runId) {
  const dir = join(PATHS.runs, runId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
