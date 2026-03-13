import fs from 'fs';
import path from 'path';

function normalizeTierList(value) {
  if (!value) return null;
  const items = Array.isArray(value) ? value : String(value).split(',');
  const tiers = items.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return tiers.length > 0 ? tiers : null;
}

export function loadRunManifest(manifestPath) {
  if (!manifestPath) return null;
  const fullPath = path.resolve(manifestPath);
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

  const strategy = {
    manifestPath: fullPath,
    name: raw.name || path.basename(fullPath, path.extname(fullPath)),
    notes: raw.notes || '',
    region: raw.region ?? null,
    mode: raw.mode || 'first_touch',
    testName: raw.testName || raw.test_name || '',
    dryRun: raw.dryRun ?? raw.dry_run ?? false,
    pushDryRun: raw.pushDryRun ?? raw.push_dry_run ?? false,
    autoMode: raw.autoMode ?? raw.auto_mode ?? false,
    skipPersonalize: raw.skipPersonalize ?? raw.skip_personalize ?? false,
    fullPipeline: raw.fullPipeline ?? raw.full_pipeline ?? false,
    selectLimit: Number(raw.selectLimit ?? raw.select_limit ?? 500) || 500,
    selectMinScore: Number(raw.selectMinScore ?? raw.select_min_score ?? 55) || 0,
    prepareMinScore: Number(raw.prepareMinScore ?? raw.prepare_min_score ?? 50) || 0,
    tierFilter: normalizeTierList(raw.tierFilter ?? raw.tier_filter),
    campaignStart: raw.campaignStart || raw.campaign_start || '',
    maxCost: raw.maxCost != null ? Number(raw.maxCost) : raw.max_cost != null ? Number(raw.max_cost) : undefined,
    allowUnenrichable: raw.allowUnenrichable ?? raw.allow_unenrichable ?? false,
  };

  return strategy;
}

export function applyManifestToConfig(base, manifest) {
  if (!manifest) return { ...base };
  return {
    ...base,
    manifestPath: manifest.manifestPath,
    strategyName: manifest.name,
    strategyNotes: manifest.notes,
    region: manifest.region ?? base.region,
    mode: manifest.mode || base.mode,
    testName: manifest.testName || base.testName,
    dryRun: manifest.dryRun ?? base.dryRun,
    pushDryRun: manifest.pushDryRun ?? base.pushDryRun,
    autoMode: manifest.autoMode ?? base.autoMode,
    skipPersonalize: manifest.skipPersonalize ?? base.skipPersonalize,
    fullPipeline: manifest.fullPipeline ?? base.fullPipeline,
    selectLimit: manifest.selectLimit ?? base.selectLimit,
    selectMinScore: manifest.selectMinScore ?? base.selectMinScore,
    prepareMinScore: manifest.prepareMinScore ?? base.prepareMinScore,
    tierFilter: manifest.tierFilter ?? base.tierFilter,
    campaignStart: manifest.campaignStart || base.campaignStart,
    maxCost: manifest.maxCost ?? base.maxCost,
    allowUnenrichable: manifest.allowUnenrichable ?? base.allowUnenrichable,
  };
}
