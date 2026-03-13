#!/usr/bin/env node

import { paginateAll } from './lib/twenty-client.js';
import { getDb, initDb, insertLeads, insertPoolEmails } from './lib/db.js';
import { twentyPersonToLead } from './lib/lead-mappers.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SEED SQLITE FROM TWENTY CRM');
  console.log('═══════════════════════════════════════════════════════════');

  initDb();

  console.log('\n  Loading people from Twenty...');
  const people = await paginateAll('people');
  console.log(`  People: ${people.length}`);

  console.log('  Loading companies from Twenty...');
  const companies = await paginateAll('companies');
  console.log(`  Companies: ${companies.length}`);

  const companyStmt = getDb().prepare(`
    INSERT INTO companies (id, name, domain, created_at)
    VALUES (@id, @name, @domain, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      domain = excluded.domain
  `);
  const companyTx = getDb().transaction((rows) => {
    for (const row of rows) {
      companyStmt.run({
        id: row.id,
        name: row.name || '',
        domain: row.domainName?.primaryLinkUrl || row.domain || '',
      });
    }
  });
  companyTx(companies);

  const leads = people
    .map(twentyPersonToLead)
    .filter((lead) => lead.email);

  insertLeads(leads);
  insertPoolEmails(leads.map((lead) => ({
    email: lead.email,
    source_file: lead.source_file || 'seed-db-from-crm',
  })));

  console.log(`\n  Seeded ${leads.length} leads into SQLite`);
  console.log('  Seed complete');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
