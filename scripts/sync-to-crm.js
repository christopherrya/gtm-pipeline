#!/usr/bin/env node

import { batchUpdate, twentyFetch } from './lib/twenty-client.js';
import { getDirtyLeads, initDb, logSync, markSynced, updateLead } from './lib/db.js';
import { leadToTwentyPayload } from './lib/lead-mappers.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SYNC SQLITE TO TWENTY CRM');
  console.log('═══════════════════════════════════════════════════════════');

  initDb();
  const dirty = getDirtyLeads(500);
  if (dirty.length === 0) {
    console.log('\n  No dirty leads to sync.');
    return;
  }

  const existing = dirty.filter((lead) => lead.twenty_id);
  const creates = dirty.filter((lead) => !lead.twenty_id);

  if (creates.length > 0) {
    console.log(`\n  Creating ${creates.length} new People in Twenty...`);
    for (const lead of creates) {
      try {
        const payload = leadToTwentyPayload(lead);
        delete payload.id;
        const created = await twentyFetch('POST', '/rest/people', payload);
        const twentyId = created?.data?.createPerson?.id || created?.data?.id || created?.id || '';
        if (!twentyId) {
          throw new Error('Twenty create response did not include an id');
        }
        updateLead(lead.id, { twenty_id: twentyId, twenty_dirty: 0, twenty_synced_at: new Date().toISOString() }, { skipDirty: true });
        logSync(lead.id, 'to_crm', Object.keys(payload), true, '');
      } catch (err) {
        logSync(lead.id, 'to_crm', Object.keys(leadToTwentyPayload(lead)), false, err.message);
      }
    }
  }

  if (existing.length > 0) {
    const updates = existing.map(leadToTwentyPayload);
    console.log(`\n  Syncing ${updates.length} dirty leads to Twenty...`);
    const result = await batchUpdate('people', updates);

    for (const lead of existing) {
      const ok = result.errors === 0 && Boolean(lead.twenty_id);
      if (ok) {
        logSync(lead.id, 'to_crm', Object.keys(leadToTwentyPayload(lead)), true, '');
      } else {
        logSync(lead.id, 'to_crm', Object.keys(leadToTwentyPayload(lead)), false, result.errorDetails?.[0] || 'Batch sync failed');
      }
    }
    if (result.errors === 0) {
      markSynced(existing.map((lead) => lead.id));
    }
    console.log(`  Updated: ${result.updated}`);
    console.log(`  Errors: ${result.errors}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
