#!/usr/bin/env node

/**
 * Pipeline Runner — Single entry point for the outbound pipeline
 *
 * Chains: [select → enrich → import →] prepare → personalize → [approval gate] → push
 * With structured logging, run tracking, email notifications, and resume support.
 *
 * Usage:
 *   node scripts/run-pipeline.js --region "SF Bay" --full --auto          # Full automated pipeline
 *   node scripts/run-pipeline.js --region "SF Bay" --mode first_touch --test subject_v1
 *   node scripts/run-pipeline.js --approve run_20260305_102344
 *   node scripts/run-pipeline.js --resume run_20260305_102344 --from-step push
 *   node scripts/run-pipeline.js --region "SF Bay" --dry-run
 *   node scripts/run-pipeline.js --region "SF Bay" --auto
 *   node scripts/run-pipeline.js --region "SF Bay" --skip-personalize
 *
 * --full:           Run upstream steps (select from pool → enrich via Apify → import to CRM)
 * --select-limit N: Max leads to select from pool (default: 500)
 * --min-score N:    Min ICP score for pool selection (default: 55)
 */

import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { createLogger } from './lib/logger.js';
import { RunTracker } from './lib/run-tracker.js';
import { sendFailureAlert, sendRunReport } from './lib/mailer.js';
import { main as prepareBatch } from './prepare-batch.js';
import { main as personalizeBatch } from './personalize-batch.js';
import { main as pushToInstantly } from './push-to-instantly.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const region = getArg('--region');
const mode = getArg('--mode') || 'first_touch';
const testName = getArg('--test');
const campaignStart = getArg('--campaign-start') || process.env.CAMPAIGN_START_DATE || '';
const approveRunId = getArg('--approve');
const resumeRunId = getArg('--resume');
const fromStep = getArg('--from-step');
const dryRun = hasFlag('--dry-run');
const autoMode = hasFlag('--auto');
const skipPersonalize = hasFlag('--skip-personalize');
const maxCost = getArg('--max-cost') ? parseFloat(getArg('--max-cost')) : undefined;
const fullPipeline = hasFlag('--full');
const selectLimit = parseInt(getArg('--select-limit') || '500', 10) || 500;
const selectMinScore = parseInt(getArg('--min-score') || '55', 10) || 55;

// Pipeline steps in order
const STEPS = ['select', 'enrich', 'import', 'prepare', 'personalize', 'push'];
const PUSH_MAX_RETRIES = 2;
const PUSH_RETRY_DELAYS = [5000, 15000];
const PROJECT_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Child process runner (for scripts that don't export main())
// ---------------------------------------------------------------------------

function runChildScript(scriptPath, scriptArgs) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done();
      else fail(new Error(`${scriptPath.split('/').pop()} exited with code ${code}`));
    });
  });
}

function computePipelinePaths() {
  const date = new Date().toISOString().slice(0, 10);
  return {
    selectOutput: join(__dirname, 'output', `to_enrich_${date}.csv`),
    enrichOutput: join(__dirname, '3operational', `to_enrich_${date}`, 'enriched-full.csv'),
  };
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

async function runStep(stepName, fn, tracker, log) {
  tracker.stepStart(stepName);
  try {
    const result = await fn();
    tracker.stepEnd(stepName, { metrics: result?.metrics || {} });
    return result;
  } catch (err) {
    tracker.stepFail(stepName, { error: err.message });
    log.error(`Step "${stepName}" failed`, { error: err.message, stack: err.stack });

    // Send failure email
    try {
      await sendFailureAlert(tracker.summary, stepName, err.message);
    } catch (mailErr) {
      log.warn('Failed to send failure alert email', { error: mailErr.message });
    }

    throw err;
  }
}

async function runStepWithRetry(stepName, fn, tracker, log, maxRetries, delays) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runStep(stepName, fn, tracker, log);
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = delays[attempt] || 5000;
        log.warn(`Retrying step "${stepName}" in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, { error: err.message });
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

async function handleApprove() {
  if (!approveRunId) {
    console.error('Usage: node scripts/run-pipeline.js --approve <runId>');
    process.exit(1);
  }

  const tracker = new RunTracker();
  const summary = tracker.loadRun(approveRunId);
  const log = createLogger({ step: 'runner', runId: approveRunId });

  if (!tracker.isAwaitingApproval()) {
    console.error(`Run ${approveRunId} is not awaiting approval (status: ${summary.status})`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  APPROVING RUN — ${approveRunId}`);
  console.log('═══════════════════════════════════════════════════════════');

  tracker.clearApproval();

  // Find the personalized CSV from artifacts
  const personalizedCsv = summary.artifacts.find(a => a.includes('personalized'));
  if (!personalizedCsv) {
    log.error('No personalized CSV found in run artifacts');
    console.error('Error: No personalized CSV found in run artifacts');
    process.exit(1);
  }

  log.info('Approval granted, running push step', { csvPath: personalizedCsv });

  // Run push step
  const pushLog = createLogger({ step: 'push', runId: approveRunId });
  await runStepWithRetry('push', () => pushToInstantly({
    csvPath: personalizedCsv,
    dryRun: false,
    log: pushLog,
    manifestDir: tracker.runDir,
  }), tracker, log, PUSH_MAX_RETRIES, PUSH_RETRY_DELAYS);

  await tracker.finish({ status: 'ok' });

  // Send run report
  try {
    await sendRunReport(tracker.summary);
  } catch (mailErr) {
    log.warn('Failed to send run report email', { error: mailErr.message });
  }

  printRunSummary(tracker.summary);
}

// ---------------------------------------------------------------------------
// Resume flow
// ---------------------------------------------------------------------------

async function handleResume() {
  if (!resumeRunId) {
    console.error('Usage: node scripts/run-pipeline.js --resume <runId> [--from-step <step>]');
    process.exit(1);
  }

  const tracker = new RunTracker();
  const summary = tracker.loadRun(resumeRunId);
  const log = createLogger({ step: 'runner', runId: resumeRunId });

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  RESUMING RUN — ${resumeRunId}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Determine which step to start from
  let startStep = fromStep;
  if (!startStep) {
    const failedStep = tracker.firstFailedStep();
    if (failedStep) {
      startStep = failedStep;
    } else {
      const lastOk = tracker.lastSuccessfulStep();
      const lastIdx = lastOk ? STEPS.indexOf(lastOk) : -1;
      startStep = STEPS[lastIdx + 1] || STEPS[0];
    }
  }

  const startIdx = STEPS.indexOf(startStep);
  if (startIdx === -1) {
    console.error(`Unknown step: ${startStep}. Valid steps: ${STEPS.join(', ')}`);
    process.exit(1);
  }

  log.info('Resuming from step', { step: startStep, runId: resumeRunId });

  // Get config from the original run
  const ctx = {
    region: summary.config.region,
    mode: summary.config.mode,
    testName: summary.config.testName,
    dryRun: summary.config.dryRun || false,
    selectLimit: summary.config.selectLimit || 500,
    selectMinScore: summary.config.selectMinScore || 55,
  };

  // Find existing artifacts for context (skip upstream artifacts)
  const batchCsv = summary.artifacts.find(a => {
    const name = a.split('/').pop();
    return !name.includes('personalized') && !name.startsWith('to_enrich_') && !name.includes('enriched-full');
  });
  const personalizedCsv = summary.artifacts.find(a => a.includes('personalized'));

  // Run remaining steps
  await executeSteps(tracker, log, ctx, startIdx, batchCsv, personalizedCsv);
}

// ---------------------------------------------------------------------------
// New run
// ---------------------------------------------------------------------------

async function handleNewRun() {
  if (!region && !fullPipeline) {
    console.error('Usage: node scripts/run-pipeline.js --region "SF Bay" [--mode first_touch] [--test name] [--dry-run] [--auto]');
    console.error('       node scripts/run-pipeline.js --full --auto  (all regions)');
    process.exit(1);
  }

  const tracker = new RunTracker();
  const runId = await tracker.start({
    region,
    mode,
    testName: testName || '',
    dryRun,
    autoMode,
    skipPersonalize,
    fullPipeline,
    selectLimit,
    selectMinScore,
  });

  const log = createLogger({ step: 'runner', runId });

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  PIPELINE RUN — ${runId}`);
  console.log('═══════════════════════════════════════════════════════════');
  if (fullPipeline) console.log(`  FULL PIPELINE (select → enrich → import → prepare → push)`);
  console.log(`  Region:      ${region}`);
  console.log(`  Mode:        ${mode}`);
  if (testName) console.log(`  Test:        ${testName}`);
  if (fullPipeline) console.log(`  Select:      limit=${selectLimit}, min-score=${selectMinScore}`);
  if (dryRun) console.log(`  DRY RUN`);
  if (autoMode) console.log(`  AUTO MODE (no approval gate)`);
  if (skipPersonalize) console.log(`  SKIP PERSONALIZE`);
  console.log('');

  log.info('Pipeline run started', { runId, region, mode, testName, dryRun, autoMode, fullPipeline });

  const ctx = { region, mode, testName, dryRun, selectLimit, selectMinScore, campaignStart };
  const startIdx = fullPipeline ? 0 : STEPS.indexOf('prepare');
  await executeSteps(tracker, log, ctx, startIdx, null, null);
}

// ---------------------------------------------------------------------------
// Step execution engine
// ---------------------------------------------------------------------------

async function executeSteps(tracker, log, ctx, startIdx, existingBatchCsv, existingPersonalizedCsv) {
  let batchCsvPath = existingBatchCsv || null;
  let personalizedCsvPath = existingPersonalizedCsv || null;

  // Compute intermediate file paths for upstream steps
  const paths = computePipelinePaths();
  const selectOutputPath = paths.selectOutput;
  const enrichOutputPath = paths.enrichOutput;

  try {
    // Step: select (pick fresh leads from pool, dedup against CRM)
    if (startIdx <= STEPS.indexOf('select')) {
      await runStep('select', async () => {
        const selectArgs = ['--limit', String(ctx.selectLimit || 500)];
        if (ctx.region) selectArgs.push('--region', ctx.region);
        if ((ctx.selectMinScore || 0) > 0) selectArgs.push('--min-score', String(ctx.selectMinScore));
        await runChildScript(join(__dirname, 'select-from-pool.js'), selectArgs);

        if (!existsSync(selectOutputPath)) {
          throw new Error('No leads available in pool — nothing to process');
        }
        return { metrics: { output: selectOutputPath } };
      }, tracker, log);
      tracker.addArtifact(selectOutputPath);
    }

    // Step: enrich (LinkedIn + Instagram via Apify, ICP scoring, hooks)
    if (startIdx <= STEPS.indexOf('enrich')) {
      await runStep('enrich', async () => {
        const enrichArgs = ['--input', selectOutputPath, '--region', ctx.region || 'Unknown'];
        await runChildScript(join(__dirname, '..', 'enrichment', 'enrich-leads.js'), enrichArgs);

        if (!existsSync(enrichOutputPath)) {
          throw new Error('Enrichment produced no output (enriched-full.csv not found)');
        }
        return { metrics: { output: enrichOutputPath } };
      }, tracker, log);
      tracker.addArtifact(enrichOutputPath);
    }

    // Step: import (load enriched leads into Twenty CRM)
    if (startIdx <= STEPS.indexOf('import')) {
      await runStep('import', async () => {
        const importArgs = [enrichOutputPath];
        if (ctx.region) importArgs.push('--region', ctx.region);
        if (ctx.dryRun) importArgs.push('--dry-run');
        await runChildScript(join(__dirname, 'bulk-import-twenty.js'), importArgs);
        return { metrics: {} };
      }, tracker, log);
    }

    // Step: prepare
    if (startIdx <= STEPS.indexOf('prepare')) {
      const prepareLog = createLogger({ step: 'prepare', runId: tracker.runId });
      const prepResult = await runStep('prepare', () => prepareBatch({
        region: ctx.region,
        mode: ctx.mode,
        testName: ctx.testName,
        campaignStart: ctx.campaignStart,
        dryRun: ctx.dryRun,
        log: prepareLog,
      }), tracker, log);

      batchCsvPath = prepResult?.csvPath;
      if (batchCsvPath) tracker.addArtifact(batchCsvPath);

      if (!batchCsvPath) {
        log.info('No candidates found, pipeline complete');
        await tracker.finish({ status: 'ok' });
        printRunSummary(tracker.summary);
        return;
      }
    }

    // Step: personalize
    if (startIdx <= STEPS.indexOf('personalize') && !skipPersonalize) {
      const persLog = createLogger({ step: 'personalize', runId: tracker.runId });
      const persResult = await runStep('personalize', () => personalizeBatch({
        csvPath: batchCsvPath,
        dryRun: ctx.dryRun,
        maxCost: maxCost,
        log: persLog,
      }), tracker, log);

      personalizedCsvPath = persResult?.csvPath;
      if (personalizedCsvPath) tracker.addArtifact(personalizedCsvPath);
    } else if (skipPersonalize && startIdx <= STEPS.indexOf('personalize')) {
      // Skip personalize — use the batch CSV directly
      personalizedCsvPath = batchCsvPath;
      tracker.stepStart('personalize');
      tracker.stepEnd('personalize', { metrics: { skipped: true } });
      log.info('Personalize step skipped');
    }

    // Approval gate (unless --auto or --dry-run)
    if (!autoMode && !ctx.dryRun && startIdx <= STEPS.indexOf('personalize')) {
      tracker.writeApprovalRequired();
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  APPROVAL REQUIRED');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Personalization complete. Review the batch CSV:`);
      console.log(`    ${personalizedCsvPath}`);
      console.log(`\n  To approve and push to Instantly:`);
      console.log(`    node scripts/run-pipeline.js --approve ${tracker.runId}`);
      console.log(`\n  Run ID: ${tracker.runId}`);
      log.info('Approval gate — pausing before push', { runId: tracker.runId });
      return; // Exit cleanly — user will --approve later
    }

    // Step: push
    if (startIdx <= STEPS.indexOf('push')) {
      const pushLog = createLogger({ step: 'push', runId: tracker.runId });
      const csvForPush = personalizedCsvPath || batchCsvPath;

      await runStepWithRetry('push', () => pushToInstantly({
        csvPath: csvForPush,
        dryRun: ctx.dryRun,
        log: pushLog,
        manifestDir: tracker.runDir,
      }), tracker, log, PUSH_MAX_RETRIES, PUSH_RETRY_DELAYS);
    }

    await tracker.finish({ status: 'ok' });

    // Send run report
    if (!ctx.dryRun) {
      try {
        await sendRunReport(tracker.summary);
      } catch (mailErr) {
        log.warn('Failed to send run report email', { error: mailErr.message });
      }
    }

    printRunSummary(tracker.summary);

  } catch (err) {
    await tracker.finish({ status: 'error' });
    printRunSummary(tracker.summary);
    console.error(`\n  Pipeline failed. Resume with:`);
    console.error(`    node scripts/run-pipeline.js --resume ${tracker.runId}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function printRunSummary(summary) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  PIPELINE RUN SUMMARY — ${summary.runId}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Status:   ${summary.status === 'ok' ? 'SUCCESS' : summary.status.toUpperCase()}`);
  console.log(`  Duration: ${fmtDuration(summary.durationMs)}`);
  console.log(`  Region:   ${summary.config?.region || '—'}`);

  if (summary.steps.length > 0) {
    console.log('\n  Steps:');
    console.log('  ┌──────────────┬──────────┬─────────┬──────────────────────────────┐');
    console.log('  │ Step         │ Status   │ Runtime │ Key Metrics                  │');
    console.log('  ├──────────────┼──────────┼─────────┼──────────────────────────────┤');
    for (const step of summary.steps) {
      const icon = step.status === 'ok' ? '\u2713' : step.status === 'error' ? '\u2717' : '?';
      const status = `${icon} ${(step.status === 'ok' ? 'OK' : step.status.toUpperCase()).padEnd(6)}`;
      const duration = fmtDuration(step.durationMs).padEnd(7);
      const metricsStr = step.metrics
        ? Object.entries(step.metrics).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(', ')
        : '';
      console.log(`  │ ${step.step.padEnd(12)} │ ${status} │ ${duration} │ ${metricsStr.padEnd(28)} │`);
    }
    console.log('  └──────────────┴──────────┴─────────┴──────────────────────────────┘');
  }

  if (summary.artifacts.length > 0) {
    console.log('\n  Artifacts:');
    for (const a of summary.artifacts) {
      console.log(`    ${a}`);
    }
  }

  console.log(`\n  Run log: scripts/logs/runs/${summary.runId}/`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function run() {
  if (approveRunId) {
    await handleApprove();
  } else if (resumeRunId) {
    await handleResume();
  } else {
    await handleNewRun();
  }
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
