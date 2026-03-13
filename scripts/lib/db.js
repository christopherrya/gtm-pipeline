import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { canTransitionStage } from './lead-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '../../.env') });

const DEFAULT_DB_PATH = path.join(path.dirname(__dirname), 'data', 'gtm-pipeline.sqlite');
let db;

function dbPath() {
  return process.env.GTM_SQLITE_PATH || DEFAULT_DB_PATH;
}

function nowSql() {
  return new Date().toISOString();
}

function compactUpdate(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function normalizeLead(lead) {
  const timestamp = nowSql();
  return {
    id: lead.id || crypto.randomUUID(),
    email: lead.email || '',
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    job_title: lead.job_title || '',
    city: lead.city || '',
    company_name: lead.company_name || '',
    company_id: lead.company_id || '',
    icp_score: lead.icp_score ?? 0,
    icp_tier: lead.icp_tier || '',
    trigger_score: lead.trigger_score ?? 0,
    hook_text: lead.hook_text || '',
    hook_variant: lead.hook_variant || '',
    hook_source: lead.hook_source || '',
    region: lead.region || '',
    ig_username: lead.ig_username || '',
    ig_followers: lead.ig_followers ?? 0,
    ig_days_since_post: lead.ig_days_since_post ?? 999,
    ig_recent_addresses: lead.ig_recent_addresses || '',
    ig_neighborhoods: lead.ig_neighborhoods || '',
    ig_listing_posts_count: lead.ig_listing_posts_count ?? 0,
    ig_sold_posts_count: lead.ig_sold_posts_count ?? 0,
    linkedin_url: lead.linkedin_url || '',
    linkedin_headline: lead.linkedin_headline || '',
    linkedin_days_since_post: lead.linkedin_days_since_post ?? 999,
    linkedin_recent_topic: lead.linkedin_recent_topic || '',
    funnel_stage: lead.funnel_stage || 'new',
    last_outreach_date: lead.last_outreach_date || '',
    outreach_status: lead.outreach_status || '',
    ab_variant: lead.ab_variant || '',
    ab_test_name: lead.ab_test_name || '',
    ab_test_history: lead.ab_test_history || '',
    assigned_inbox: lead.assigned_inbox || '',
    campaign_label: lead.campaign_label || '',
    instantly_campaign_id: lead.instantly_campaign_id || '',
    reply_to_address: lead.reply_to_address || '',
    first_contacted_at: lead.first_contacted_at || '',
    email_opened_at: lead.email_opened_at || '',
    replied_at: lead.replied_at || '',
    re_engage_attempts: lead.re_engage_attempts ?? 0,
    enriched_at: lead.enriched_at || '',
    external_lead_id: lead.external_lead_id || '',
    lead_source: lead.lead_source || 'Clay',
    personalized_subject: lead.personalized_subject || '',
    personalized_hook: lead.personalized_hook || '',
    personalization_method: lead.personalization_method || '',
    twenty_id: lead.twenty_id || '',
    twenty_dirty: lead.twenty_dirty != null ? Number(lead.twenty_dirty) : 1,
    twenty_synced_at: lead.twenty_synced_at || '',
    source_file: lead.source_file || '',
    pool_selected_at: lead.pool_selected_at || '',
    created_at: lead.created_at || timestamp,
    updated_at: lead.updated_at || timestamp,
  };
}

function rowToLead(row) {
  if (!row) return null;
  return {
    ...row,
    twenty_dirty: Number(row.twenty_dirty || 0),
    name: {
      firstName: row.first_name || '',
      lastName: row.last_name || '',
    },
    emails: {
      primaryEmail: row.email || '',
    },
    company: row.company_name ? { name: row.company_name } : null,
    companyName: row.company_name || '',
    funnelStage: row.funnel_stage || '',
    icpScore: row.icp_score || 0,
    icpTier: row.icp_tier || '',
    triggerScore: row.trigger_score || 0,
    hookText: row.hook_text || '',
    hookVariant: row.hook_variant || '',
    hookSource: row.hook_source || '',
    igUsername: row.ig_username || '',
    igFollowers: row.ig_followers || 0,
    igDaysSincePost: row.ig_days_since_post || 999,
    igRecentAddresses: row.ig_recent_addresses || '',
    igNeighborhoods: row.ig_neighborhoods || '',
    igListingPostsCount: row.ig_listing_posts_count || 0,
    igSoldPostsCount: row.ig_sold_posts_count || 0,
    linkedinUrl: row.linkedin_url || '',
    linkedinHeadline: row.linkedin_headline || '',
    linkedinDaysSincePost: row.linkedin_days_since_post || 999,
    linkedinRecentTopic: row.linkedin_recent_topic || '',
    lastOutreachDate: row.last_outreach_date || '',
    outreachStatus: row.outreach_status || '',
    abVariant: row.ab_variant || '',
    abTestName: row.ab_test_name || '',
    abTestHistory: row.ab_test_history || '',
    assignedInbox: row.assigned_inbox || '',
    campaignLabel: row.campaign_label || '',
    instantlyCampaignId: row.instantly_campaign_id || '',
    replyToAddress: row.reply_to_address || '',
    firstContactedAt: row.first_contacted_at || '',
    emailOpenedAt: row.email_opened_at || '',
    repliedAt: row.replied_at || '',
    reEngageAttempts: row.re_engage_attempts || 0,
    enrichedAt: row.enriched_at || '',
    externalLeadId: row.external_lead_id || '',
    leadSource: row.lead_source || '',
    personalizedSubject: row.personalized_subject || '',
    personalizedHook: row.personalized_hook || '',
    personalizationMethod: row.personalization_method || '',
    twentyId: row.twenty_id || '',
    twentySyncedAt: row.twenty_synced_at || '',
    sourceFile: row.source_file || '',
    poolSelectedAt: row.pool_selected_at || '',
  };
}

export function getDb() {
  if (!db) {
    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function initDb() {
  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      job_title TEXT DEFAULT '',
      city TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      company_id TEXT DEFAULT '',
      icp_score INTEGER DEFAULT 0,
      icp_tier TEXT DEFAULT '',
      trigger_score INTEGER DEFAULT 0,
      hook_text TEXT DEFAULT '',
      hook_variant TEXT DEFAULT '',
      hook_source TEXT DEFAULT '',
      region TEXT DEFAULT '',
      ig_username TEXT DEFAULT '',
      ig_followers INTEGER DEFAULT 0,
      ig_days_since_post INTEGER DEFAULT 999,
      ig_recent_addresses TEXT DEFAULT '',
      ig_neighborhoods TEXT DEFAULT '',
      ig_listing_posts_count INTEGER DEFAULT 0,
      ig_sold_posts_count INTEGER DEFAULT 0,
      linkedin_url TEXT DEFAULT '',
      linkedin_headline TEXT DEFAULT '',
      linkedin_days_since_post INTEGER DEFAULT 999,
      linkedin_recent_topic TEXT DEFAULT '',
      funnel_stage TEXT NOT NULL DEFAULT 'new',
      last_outreach_date TEXT DEFAULT '',
      outreach_status TEXT DEFAULT '',
      ab_variant TEXT DEFAULT '',
      ab_test_name TEXT DEFAULT '',
      ab_test_history TEXT DEFAULT '',
      assigned_inbox TEXT DEFAULT '',
      campaign_label TEXT DEFAULT '',
      instantly_campaign_id TEXT DEFAULT '',
      reply_to_address TEXT DEFAULT '',
      first_contacted_at TEXT DEFAULT '',
      email_opened_at TEXT DEFAULT '',
      replied_at TEXT DEFAULT '',
      re_engage_attempts INTEGER DEFAULT 0,
      enriched_at TEXT DEFAULT '',
      external_lead_id TEXT DEFAULT '',
      lead_source TEXT DEFAULT 'Clay',
      personalized_subject TEXT DEFAULT '',
      personalized_hook TEXT DEFAULT '',
      personalization_method TEXT DEFAULT '',
      twenty_id TEXT DEFAULT '',
      twenty_dirty INTEGER DEFAULT 1,
      twenty_synced_at TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      pool_selected_at TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pool_emails (
      email TEXT PRIMARY KEY,
      source_file TEXT NOT NULL,
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      fields_synced TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_leads_funnel_stage ON leads(funnel_stage);
    CREATE INDEX IF NOT EXISTS idx_leads_icp_tier ON leads(icp_tier);
    CREATE INDEX IF NOT EXISTS idx_leads_stage_score ON leads(funnel_stage, icp_score DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_stage_region ON leads(funnel_stage, region);
    CREATE INDEX IF NOT EXISTS idx_leads_twenty_dirty ON leads(twenty_dirty) WHERE twenty_dirty = 1;
    CREATE INDEX IF NOT EXISTS idx_leads_instantly_campaign ON leads(instantly_campaign_id) WHERE instantly_campaign_id != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_lower ON companies(lower(name));
  `);
  return conn;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function upsertLeadStatement(conn) {
  return conn.prepare(`
    INSERT INTO leads (
      id, email, first_name, last_name, job_title, city, company_name, company_id,
      icp_score, icp_tier, trigger_score, hook_text, hook_variant, hook_source, region,
      ig_username, ig_followers, ig_days_since_post, ig_recent_addresses, ig_neighborhoods,
      ig_listing_posts_count, ig_sold_posts_count, linkedin_url, linkedin_headline,
      linkedin_days_since_post, linkedin_recent_topic, funnel_stage, last_outreach_date,
      outreach_status, ab_variant, ab_test_name, ab_test_history, assigned_inbox,
      campaign_label, instantly_campaign_id, reply_to_address, first_contacted_at,
      email_opened_at, replied_at, re_engage_attempts, enriched_at, external_lead_id,
      lead_source, personalized_subject, personalized_hook, personalization_method,
      twenty_id, twenty_dirty, twenty_synced_at, source_file, pool_selected_at,
      created_at, updated_at
    ) VALUES (
      @id, @email, @first_name, @last_name, @job_title, @city, @company_name, @company_id,
      @icp_score, @icp_tier, @trigger_score, @hook_text, @hook_variant, @hook_source, @region,
      @ig_username, @ig_followers, @ig_days_since_post, @ig_recent_addresses, @ig_neighborhoods,
      @ig_listing_posts_count, @ig_sold_posts_count, @linkedin_url, @linkedin_headline,
      @linkedin_days_since_post, @linkedin_recent_topic, @funnel_stage, @last_outreach_date,
      @outreach_status, @ab_variant, @ab_test_name, @ab_test_history, @assigned_inbox,
      @campaign_label, @instantly_campaign_id, @reply_to_address, @first_contacted_at,
      @email_opened_at, @replied_at, @re_engage_attempts, @enriched_at, @external_lead_id,
      @lead_source, @personalized_subject, @personalized_hook, @personalization_method,
      @twenty_id, @twenty_dirty, @twenty_synced_at, @source_file, @pool_selected_at,
      COALESCE(@created_at, datetime('now')), COALESCE(@updated_at, datetime('now'))
    )
    ON CONFLICT(email) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      job_title = excluded.job_title,
      city = excluded.city,
      company_name = excluded.company_name,
      company_id = excluded.company_id,
      icp_score = excluded.icp_score,
      icp_tier = excluded.icp_tier,
      trigger_score = excluded.trigger_score,
      hook_text = excluded.hook_text,
      hook_variant = excluded.hook_variant,
      hook_source = excluded.hook_source,
      region = excluded.region,
      ig_username = excluded.ig_username,
      ig_followers = excluded.ig_followers,
      ig_days_since_post = excluded.ig_days_since_post,
      ig_recent_addresses = excluded.ig_recent_addresses,
      ig_neighborhoods = excluded.ig_neighborhoods,
      ig_listing_posts_count = excluded.ig_listing_posts_count,
      ig_sold_posts_count = excluded.ig_sold_posts_count,
      linkedin_url = excluded.linkedin_url,
      linkedin_headline = excluded.linkedin_headline,
      linkedin_days_since_post = excluded.linkedin_days_since_post,
      linkedin_recent_topic = excluded.linkedin_recent_topic,
      funnel_stage = excluded.funnel_stage,
      last_outreach_date = excluded.last_outreach_date,
      outreach_status = excluded.outreach_status,
      ab_variant = excluded.ab_variant,
      ab_test_name = excluded.ab_test_name,
      ab_test_history = excluded.ab_test_history,
      assigned_inbox = excluded.assigned_inbox,
      campaign_label = excluded.campaign_label,
      instantly_campaign_id = excluded.instantly_campaign_id,
      reply_to_address = excluded.reply_to_address,
      first_contacted_at = excluded.first_contacted_at,
      email_opened_at = excluded.email_opened_at,
      replied_at = excluded.replied_at,
      re_engage_attempts = excluded.re_engage_attempts,
      enriched_at = excluded.enriched_at,
      external_lead_id = excluded.external_lead_id,
      lead_source = excluded.lead_source,
      personalized_subject = excluded.personalized_subject,
      personalized_hook = excluded.personalized_hook,
      personalization_method = excluded.personalization_method,
      twenty_id = excluded.twenty_id,
      twenty_dirty = MAX(leads.twenty_dirty, excluded.twenty_dirty),
      source_file = CASE WHEN excluded.source_file != '' THEN excluded.source_file ELSE leads.source_file END,
      pool_selected_at = CASE WHEN excluded.pool_selected_at != '' THEN excluded.pool_selected_at ELSE leads.pool_selected_at END,
      updated_at = datetime('now')
  `);
}

export function findLeadByEmail(email) {
  const row = getDb().prepare('SELECT * FROM leads WHERE lower(email) = lower(?)').get(email);
  return rowToLead(row);
}

export function findLeadById(id) {
  return rowToLead(getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id));
}

export function findLeadsByStage(stage, opts = {}) {
  const filters = ['funnel_stage = @stage'];
  const params = { stage };
  if (opts.region) {
    filters.push('region = @region');
    params.region = opts.region;
  }
  if (opts.minScore != null) {
    filters.push('icp_score >= @minScore');
    params.minScore = opts.minScore;
  }
  if (opts.campaignIdRequired) {
    filters.push("instantly_campaign_id != ''");
  }
  if (opts.tierFilter && opts.tierFilter.length > 0) {
    filters.push(`lower(icp_tier) IN (${opts.tierFilter.map((_, i) => `@tier${i}`).join(', ')})`);
    opts.tierFilter.forEach((tier, i) => { params[`tier${i}`] = tier.toLowerCase(); });
  }
  const limitClause = opts.limit ? ` LIMIT ${Number(opts.limit)}` : '';
  const rows = getDb().prepare(`
    SELECT * FROM leads
    WHERE ${filters.join(' AND ')}
    ORDER BY icp_score DESC, created_at ASC
    ${limitClause}
  `).all(params);
  return rows.map(rowToLead);
}

export function findLeadsWithCampaignId() {
  return getDb().prepare("SELECT * FROM leads WHERE instantly_campaign_id != '' ORDER BY updated_at DESC").all().map(rowToLead);
}

export function getAllLeads() {
  return getDb().prepare('SELECT * FROM leads ORDER BY created_at ASC').all().map(rowToLead);
}

export function insertLead(lead) {
  const conn = initDb();
  upsertLeadStatement(conn).run(normalizeLead(lead));
  return findLeadByEmail(lead.email);
}

export function insertLeads(leads) {
  const conn = initDb();
  const stmt = upsertLeadStatement(conn);
  const tx = conn.transaction((rows) => {
    for (const row of rows) stmt.run(normalizeLead(row));
  });
  tx(leads);
}

export function updateLead(id, fields, opts = {}) {
  const conn = initDb();
  const next = compactUpdate({ ...fields });
  if (Object.keys(next).length === 0) return findLeadById(id);
  if (!opts.skipDirty) next.twenty_dirty = 1;
  next.updated_at = nowSql();
  const assignments = Object.keys(next).map((key) => `${key} = @${key}`).join(', ');
  conn.prepare(`UPDATE leads SET ${assignments} WHERE id = @id`).run({ id, ...next });
  return findLeadById(id);
}

export function updateLeads(updates, opts = {}) {
  const conn = initDb();
  const tx = conn.transaction((rows) => {
    for (const row of rows) {
      updateLead(row.id, row, opts);
    }
  });
  tx(updates);
}

export function transitionStage(id, newStage, extraFields = {}) {
  const current = findLeadById(id);
  if (!current) throw new Error(`Lead not found: ${id}`);
  if (!canTransitionStage(current.funnel_stage, newStage)) {
    throw new Error(`Invalid stage transition: ${current.funnel_stage} -> ${newStage}`);
  }
  const fields = { ...extraFields, funnel_stage: newStage, twenty_dirty: 1 };
  return updateLead(id, fields);
}

export function emailExists(email) {
  const row = getDb().prepare(`
    SELECT 1 FROM leads WHERE lower(email) = lower(?)
    UNION
    SELECT 1 FROM pool_emails WHERE lower(email) = lower(?)
    LIMIT 1
  `).get(email, email);
  return Boolean(row);
}

export function loadAllEmails() {
  const rows = getDb().prepare(`
    SELECT email FROM leads
    UNION
    SELECT email FROM pool_emails
  `).all();
  return new Set(rows.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
}

export function insertPoolEmails(rows) {
  const conn = initDb();
  const stmt = conn.prepare(`
    INSERT INTO pool_emails (email, source_file, imported_at)
    VALUES (@email, @source_file, COALESCE(@imported_at, datetime('now')))
    ON CONFLICT(email) DO UPDATE SET
      source_file = excluded.source_file,
      imported_at = excluded.imported_at
  `);
  const tx = conn.transaction((items) => {
    for (const item of items) {
      stmt.run({
        email: item.email,
        source_file: item.source_file,
        imported_at: item.imported_at || null,
      });
    }
  });
  tx(rows);
}

export function findCompanyByName(name) {
  if (!name) return null;
  return getDb().prepare('SELECT * FROM companies WHERE lower(name) = lower(?)').get(name);
}

export function upsertCompany(name, domain = '') {
  if (!name) return null;
  const conn = initDb();
  const existing = findCompanyByName(name);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  conn.prepare('INSERT INTO companies (id, name, domain) VALUES (?, ?, ?)').run(id, name, domain);
  return id;
}

export function getDirtyLeads(limit = 500) {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE twenty_dirty = 1
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(limit).map(rowToLead);
}

export function markSynced(ids) {
  if (!ids || ids.length === 0) return;
  const conn = initDb();
  const stmt = conn.prepare('UPDATE leads SET twenty_dirty = 0, twenty_synced_at = ?, updated_at = updated_at WHERE id = ?');
  const tx = conn.transaction((leadIds) => {
    const timestamp = nowSql();
    for (const id of leadIds) stmt.run(timestamp, id);
  });
  tx(ids);
}

export function logSync(leadId, direction, fields, success, error = '') {
  getDb().prepare(`
    INSERT INTO sync_log (lead_id, direction, fields_synced, success, error_message)
    VALUES (?, ?, ?, ?, ?)
  `).run(leadId, direction, Array.isArray(fields) ? fields.join(',') : String(fields || ''), success ? 1 : 0, error);
}

export function funnelSnapshot() {
  return getDb().prepare(`
    SELECT funnel_stage AS stage, COUNT(*) AS count
    FROM leads
    GROUP BY funnel_stage
    ORDER BY count DESC
  `).all();
}

export function abTestReport(testName) {
  return getDb().prepare(`
    SELECT campaign_label,
           COUNT(*) AS sent,
           SUM(CASE WHEN funnel_stage IN ('opened', 'replied', 'opened_no_reply') THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN funnel_stage IN ('replied', 'replied_went_cold') THEN 1 ELSE 0 END) AS replied,
           SUM(CASE WHEN funnel_stage = 'bounced' THEN 1 ELSE 0 END) AS bounced
    FROM leads
    WHERE ab_test_name = ?
    GROUP BY campaign_label
    ORDER BY campaign_label
  `).all(testName);
}

export function getQueuedWithoutCampaign() {
  return getDb().prepare(`
    SELECT * FROM leads
    WHERE funnel_stage = 'queued' AND instantly_campaign_id = ''
    ORDER BY icp_score DESC
  `).all().map(rowToLead);
}

export function countTable(tableName) {
  const allowed = new Set(['leads', 'pool_emails', 'companies', 'sync_log']);
  if (!allowed.has(tableName)) throw new Error(`Unsupported table: ${tableName}`);
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  return row.count;
}
