import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export function buildPrePushReport(csvPath, ctx = {}) {
  const rows = parse(fs.readFileSync(csvPath, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  const tiers = {};
  const variants = {};
  const methods = {};
  const missingHooks = [];

  for (const row of rows) {
    const tier = row.icp_tier || 'unknown';
    tiers[tier] = (tiers[tier] || 0) + 1;

    const variant = row.abVariant || 'unknown';
    variants[variant] = (variants[variant] || 0) + 1;

    const method = row.personalization_method || 'not_personalized';
    methods[method] = (methods[method] || 0) + 1;

    if (!row.personalized_hook && !row.hook_text) {
      missingHooks.push(row.email);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    csvPath,
    strategy: {
      name: ctx.strategyName || '',
      notes: ctx.strategyNotes || '',
      region: ctx.region || '',
      mode: ctx.mode || 'first_touch',
      testName: ctx.testName || '',
      tierFilter: ctx.tierFilter || [],
      selectLimit: ctx.selectLimit || 0,
      selectMinScore: ctx.selectMinScore || 0,
      prepareMinScore: ctx.prepareMinScore || 0,
      allowUnenrichable: Boolean(ctx.allowUnenrichable),
    },
    counts: {
      total: rows.length,
      missingHooks: missingHooks.length,
    },
    tiers,
    variants,
    methods,
    samples: {
      missingHooks: missingHooks.slice(0, 10),
    },
  };
}

export function writePrePushReport(runDir, report) {
  const outPath = path.join(runDir, 'prepush-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  return outPath;
}
