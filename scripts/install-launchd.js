#!/usr/bin/env node

/**
 * Install launchd plists — macOS native scheduling for Mac Mini
 *
 * Generates and installs two launchd plists:
 *   1. com.discloser.gtm.sync    — runs sync-status.js every 30 minutes
 *   2. com.discloser.gtm.pipeline — runs pipeline weekly (Monday 9am)
 *
 * Usage:
 *   node scripts/install-launchd.js              # Install plists
 *   node scripts/install-launchd.js --uninstall   # Uninstall plists
 *   node scripts/install-launchd.js --status      # Check status
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LOGS_DIR = join(__dirname, 'logs');

const LABELS = {
  sync: 'com.discloser.gtm.sync',
  pipeline: 'com.discloser.gtm.pipeline',
};

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const statusCheck = args.includes('--status');

// ---------------------------------------------------------------------------
// Detect node path
// ---------------------------------------------------------------------------

function getNodePath() {
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return '/usr/local/bin/node';
  }
}

// ---------------------------------------------------------------------------
// Generate plist XML
// ---------------------------------------------------------------------------

function generateSyncPlist(nodePath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABELS.sync}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${join(__dirname, 'sync-status.js')}</string>
    <string>--once</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>StandardOutPath</key>
  <string>${join(LOGS_DIR, 'launchd-sync.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(LOGS_DIR, 'launchd-sync.err')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;
}

function generatePipelinePlist(nodePath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABELS.pipeline}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${join(__dirname, 'run-pipeline.js')}</string>
    <string>--full</string>
    <string>--auto</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>6</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(LOGS_DIR, 'launchd-pipeline.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(LOGS_DIR, 'launchd-pipeline.err')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

function install() {
  const nodePath = getNodePath();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  INSTALL LAUNCHD PLISTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Node:    ${nodePath}`);
  console.log(`  Project: ${PROJECT_ROOT}`);
  console.log(`  Logs:    ${LOGS_DIR}`);
  console.log('');

  // Ensure directories exist
  mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });

  // Unload existing (ignore errors if not loaded)
  for (const label of Object.values(LABELS)) {
    const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
    if (existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
      } catch { /* not loaded */ }
    }
  }

  // Write plists
  const syncPlistPath = join(LAUNCH_AGENTS_DIR, `${LABELS.sync}.plist`);
  writeFileSync(syncPlistPath, generateSyncPlist(nodePath));
  console.log(`  Written: ${syncPlistPath}`);

  const pipelinePlistPath = join(LAUNCH_AGENTS_DIR, `${LABELS.pipeline}.plist`);
  writeFileSync(pipelinePlistPath, generatePipelinePlist(nodePath));
  console.log(`  Written: ${pipelinePlistPath}`);

  // Load plists
  try {
    execSync(`launchctl load "${syncPlistPath}"`);
    console.log(`  Loaded:  ${LABELS.sync} (every 30 minutes)`);
  } catch (err) {
    console.error(`  Failed to load ${LABELS.sync}: ${err.message}`);
  }

  try {
    execSync(`launchctl load "${pipelinePlistPath}"`);
    console.log(`  Loaded:  ${LABELS.pipeline} (Monday 9am)`);
  } catch (err) {
    console.error(`  Failed to load ${LABELS.pipeline}: ${err.message}`);
  }

  console.log('\n  Verify with:');
  console.log('    launchctl list | grep discloser');
  console.log('\n  View logs:');
  console.log(`    tail -f ${join(LOGS_DIR, 'launchd-sync.log')}`);
  console.log(`    tail -f ${join(LOGS_DIR, 'launchd-pipeline.log')}`);
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

function doUninstall() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  UNINSTALL LAUNCHD PLISTS');
  console.log('═══════════════════════════════════════════════════════════');

  for (const [name, label] of Object.entries(LABELS)) {
    const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
    if (existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
        console.log(`  Unloaded: ${label}`);
      } catch { /* not loaded */ }
      unlinkSync(plistPath);
      console.log(`  Removed:  ${plistPath}`);
    } else {
      console.log(`  Not found: ${plistPath}`);
    }
  }

  console.log('\n  Done. Verify with:');
  console.log('    launchctl list | grep discloser');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function checkStatus() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  LAUNCHD STATUS');
  console.log('═══════════════════════════════════════════════════════════');

  for (const [name, label] of Object.entries(LABELS)) {
    const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
    const installed = existsSync(plistPath);

    let loaded = false;
    let status = 'unknown';
    try {
      const output = execSync(`launchctl list "${label}" 2>&1`, { encoding: 'utf-8' });
      loaded = true;
      const lastExitMatch = output.match(/"LastExitStatus"\s*=\s*(\d+)/);
      status = lastExitMatch ? (lastExitMatch[1] === '0' ? 'ok' : `exit ${lastExitMatch[1]}`) : 'loaded';
    } catch {
      loaded = false;
      status = 'not loaded';
    }

    console.log(`\n  ${name}:`);
    console.log(`    Label:     ${label}`);
    console.log(`    Installed: ${installed ? 'yes' : 'no'}`);
    console.log(`    Loaded:    ${loaded ? 'yes' : 'no'}`);
    console.log(`    Status:    ${status}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (uninstall) {
  doUninstall();
} else if (statusCheck) {
  checkStatus();
} else {
  install();
}
