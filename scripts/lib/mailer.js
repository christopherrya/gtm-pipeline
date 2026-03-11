import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

function getConfig() {
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.ALERT_EMAIL_TO,
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.user && c.pass && c.to);
}

function createTransport() {
  const c = getConfig();
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
}

function fmtDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function stepStatusIcon(status) {
  if (status === 'ok') return '\u2713';
  if (status === 'error') return '\u2717';
  return '?';
}

function formatStepLine(step) {
  const icon = stepStatusIcon(step.status);
  const status = step.status === 'ok' ? 'OK' : step.status === 'error' ? 'FAILED' : step.status;
  const duration = fmtDuration(step.durationMs);
  const metricsStr = step.metrics
    ? Object.entries(step.metrics).map(([k, v]) => `${k}=${v}`).join(', ')
    : '';
  return `  ${icon} ${step.step.padEnd(14)} ${status.padEnd(8)} ${duration.padEnd(9)} ${metricsStr}`;
}

/**
 * Send a failure alert email.
 * @param {object} summary - The run summary from RunTracker
 * @param {string} failedStep - Name of the failed step
 * @param {string} errorMsg - Error message
 */
export async function sendFailureAlert(summary, failedStep, errorMsg) {
  if (!isConfigured()) return;

  const c = getConfig();
  const subject = `[GTM Pipeline] FAILURE in step "${failedStep}" — ${summary.runId}`;
  const region = summary.config?.region || '—';

  let body = `PIPELINE FAILURE\n`;
  body += `${'='.repeat(40)}\n\n`;
  body += `Step:    ${failedStep}\n`;
  body += `Error:   ${errorMsg}\n`;
  body += `Run ID:  ${summary.runId}\n`;
  body += `Region:  ${region}\n`;
  body += `Time:    ${new Date().toISOString()}\n\n`;
  body += `Step Results:\n`;
  for (const step of summary.steps) {
    body += formatStepLine(step) + '\n';
  }

  const transport = createTransport();
  await transport.sendMail({
    from: c.user,
    to: c.to,
    subject,
    text: body,
  });
}

/**
 * Send a run completion report email.
 * @param {object} summary - The completed run summary
 */
export async function sendRunReport(summary) {
  if (!isConfigured()) return;

  const c = getConfig();
  const totalPushed = summary.steps.find(s => s.step === 'push')?.metrics?.pushed || '—';
  const subject = `[GTM Pipeline] Run Complete — ${totalPushed} leads pushed — ${summary.runId}`;
  const region = summary.config?.region || '—';

  let body = `PIPELINE RUN SUMMARY\n`;
  body += `${'='.repeat(40)}\n\n`;
  body += `Run ID:   ${summary.runId}\n`;
  body += `Region:   ${region}\n`;
  body += `Duration: ${fmtDuration(summary.durationMs)}\n`;
  body += `Status:   ${summary.status === 'ok' ? 'SUCCESS' : summary.status.toUpperCase()}\n\n`;
  body += `Step Results:\n`;
  body += `${'─'.repeat(70)}\n`;
  for (const step of summary.steps) {
    body += formatStepLine(step) + '\n';
  }
  body += `${'─'.repeat(70)}\n\n`;

  const llmCost = summary.steps.find(s => s.step === 'personalize')?.metrics?.cost_usd;
  if (llmCost !== undefined) {
    body += `Cost:      $${Number(llmCost).toFixed(4)} (LLM personalization)\n`;
  }
  if (summary.artifacts.length) {
    body += `Artifacts: ${summary.artifacts.join(', ')}\n`;
  }

  const transport = createTransport();
  await transport.sendMail({
    from: c.user,
    to: c.to,
    subject,
    text: body,
  });
}

/**
 * Test email configuration.
 */
export async function sendTestEmail() {
  if (!isConfigured()) {
    console.log('Email not configured. Set SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO in .env');
    return;
  }

  const c = getConfig();
  const transport = createTransport();
  await transport.sendMail({
    from: c.user,
    to: c.to,
    subject: '[GTM Pipeline] Test Email',
    text: 'If you see this, email notifications are working.',
  });
  console.log(`Test email sent to ${c.to}`);
}
