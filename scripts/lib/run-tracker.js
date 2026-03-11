import fs from 'fs';
import path from 'path';
import { pruneOldRuns } from './logger.js';

const LOG_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..', 'logs');

function genRunId() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `run_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export class RunTracker {
  /**
   * @param {object} opts
   * @param {number} [opts.retainRuns=30]
   */
  constructor(opts = {}) {
    this.retainRuns = opts.retainRuns || parseInt(process.env.LOG_RETAIN_RUNS || '30', 10);
    this.runId = null;
    this.runDir = null;
    this.summary = null;
  }

  /**
   * Start a new pipeline run.
   * @param {object} config - Run configuration (region, mode, etc.)
   */
  async start(config = {}) {
    this.runId = genRunId();
    this.runDir = path.join(LOG_DIR, 'runs', this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });

    this.summary = {
      runId: this.runId,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      config,
      steps: [],
      artifacts: [],
    };

    this._writeSummary();
    pruneOldRuns(this.retainRuns);
    return this.runId;
  }

  /**
   * Load a previous run for resume.
   * @param {string} runId
   * @returns {object} The loaded run summary
   */
  loadRun(runId) {
    this.runId = runId;
    this.runDir = path.join(LOG_DIR, 'runs', runId);
    const summaryPath = path.join(this.runDir, 'run-summary.json');

    if (!fs.existsSync(summaryPath)) {
      throw new Error(`Run ${runId} not found at ${summaryPath}`);
    }

    this.summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    return this.summary;
  }

  /**
   * Get the last successful step name, or null if none completed.
   */
  lastSuccessfulStep() {
    const okSteps = this.summary.steps.filter(s => s.status === 'ok');
    return okSteps.length ? okSteps[okSteps.length - 1].step : null;
  }

  /**
   * Get the first failed step name, or null if none failed.
   */
  firstFailedStep() {
    const failed = this.summary.steps.find(s => s.status === 'error');
    return failed ? failed.step : null;
  }

  /**
   * Mark a step as started.
   * @param {string} stepName
   */
  stepStart(stepName) {
    // Remove any previous entry for this step (on resume)
    this.summary.steps = this.summary.steps.filter(s => s.step !== stepName);

    this.summary.steps.push({
      step: stepName,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      metrics: {},
    });
    this._writeSummary();
  }

  /**
   * Mark a step as completed successfully.
   * @param {string} stepName
   * @param {object} opts
   * @param {object} [opts.metrics] - Step-specific metrics
   */
  stepEnd(stepName, opts = {}) {
    const step = this._findStep(stepName);
    const now = new Date();
    step.status = 'ok';
    step.endedAt = now.toISOString();
    step.durationMs = now.getTime() - new Date(step.startedAt).getTime();
    if (opts.metrics) step.metrics = opts.metrics;
    this._writeSummary();
  }

  /**
   * Mark a step as failed.
   * @param {string} stepName
   * @param {object} opts
   * @param {string} [opts.error] - Error message
   * @param {object} [opts.metrics] - Partial metrics
   */
  stepFail(stepName, opts = {}) {
    const step = this._findStep(stepName);
    const now = new Date();
    step.status = 'error';
    step.endedAt = now.toISOString();
    step.durationMs = now.getTime() - new Date(step.startedAt).getTime();
    if (opts.error) step.error = opts.error;
    if (opts.metrics) step.metrics = opts.metrics;
    this._writeSummary();
  }

  /**
   * Add an artifact path to the run.
   * @param {string} artifactPath
   */
  addArtifact(artifactPath) {
    this.summary.artifacts.push(artifactPath);
    this._writeSummary();
  }

  /**
   * Finalize the run.
   * @param {object} opts
   * @param {string} [opts.status='ok'] - Final status
   */
  async finish(opts = {}) {
    const now = new Date();
    this.summary.status = opts.status || 'ok';
    this.summary.endedAt = now.toISOString();
    this.summary.durationMs = now.getTime() - new Date(this.summary.startedAt).getTime();
    this._writeSummary();
    return this.summary;
  }

  /**
   * Write an approval-required marker file.
   */
  writeApprovalRequired() {
    fs.writeFileSync(path.join(this.runDir, 'APPROVAL_REQUIRED'), '');
    this.summary.status = 'awaiting_approval';
    this._writeSummary();
  }

  /**
   * Check if this run is awaiting approval.
   */
  isAwaitingApproval() {
    return fs.existsSync(path.join(this.runDir, 'APPROVAL_REQUIRED'));
  }

  /**
   * Clear the approval marker.
   */
  clearApproval() {
    const marker = path.join(this.runDir, 'APPROVAL_REQUIRED');
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    this.summary.status = 'running';
    this._writeSummary();
  }

  _findStep(stepName) {
    const step = this.summary.steps.find(s => s.step === stepName);
    if (!step) throw new Error(`Step "${stepName}" not found in run ${this.runId}`);
    return step;
  }

  _writeSummary() {
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.runDir, 'run-summary.json'),
      JSON.stringify(this.summary, null, 2) + '\n',
    );
  }
}
