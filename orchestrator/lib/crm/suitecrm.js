import { createHash } from 'crypto';

function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

function md5(value) {
  return createHash('md5').update(String(value)).digest('hex');
}

function suiteBaseUrl() {
  return getEnv('SUITECRM_BASE_URL', '').replace(/\/+$/, '');
}

function hasSuiteConfig() {
  return Boolean(suiteBaseUrl() && getEnv('SUITECRM_USERNAME') && getEnv('SUITECRM_PASSWORD'));
}

async function suiteFetchForm(form, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${suiteBaseUrl()}/service/v4_1/rest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SuiteCRM REST failed: ${response.status} ${text}`);
    }
    const payload = await response.json();
    if (payload?.name === 'Invalid Session ID') {
      throw new Error('SuiteCRM session invalid');
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeForQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function igHandle(v) {
  if (!v) return '';
  return String(v).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '').replace(/^@/, '');
}

function fieldsFromContact(contact) {
  return [
    { name: 'first_name', value: contact['First Name'] || '' },
    { name: 'last_name', value: contact['Last Name'] || '' },
    { name: 'email1', value: contact.Email || contact['Work Email'] || '' },
    { name: 'account_name', value: contact['Company Name'] || '' },
    { name: 'description', value: `external_lead_id=${contact.external_lead_id || ''}` },
    { name: 'lead_source', value: contact.source_primary || 'Clay' },
    { name: 'status', value: contact.funnel_stage || 'New' },
    // Scoring
    { name: 'icp_score_c', value: String(toInt(contact.icp_score)) },
    { name: 'icp_tier_c', value: contact.icp_tier || '' },
    { name: 'trigger_score_c', value: String(toInt(contact.trigger_score)) },
    // Hooks
    { name: 'hook_text_c', value: contact.hook_text || '' },
    { name: 'hook_variant_c', value: contact.hook_variant || '' },
    { name: 'hook_source_c', value: contact.hook_source || '' },
    // Social profiles
    { name: 'linkedin_url_c', value: contact['LinkedIn Profile'] || contact.linkedin_url || '' },
    { name: 'ig_username_c', value: igHandle(contact['IG handle'] || contact.ig_username || '') },
    // LinkedIn activity
    { name: 'linkedin_headline_c', value: (contact.linkedin_headline || '').substring(0, 255) },
    { name: 'linkedin_days_since_post_c', value: String(toInt(contact.linkedin_days_since_post, 999)) },
    { name: 'linkedin_recent_topic_c', value: (contact.linkedin_recent_topic || '').substring(0, 50) },
    // Instagram activity
    { name: 'ig_followers_c', value: String(toInt(contact.ig_followers)) },
    { name: 'ig_days_since_post_c', value: String(toInt(contact.ig_days_since_post, 999)) },
  ];
}

async function login() {
  const payload = await suiteFetchForm({
    method: 'login',
    input_type: 'JSON',
    response_type: 'JSON',
    rest_data: JSON.stringify({
      user_auth: {
        user_name: getEnv('SUITECRM_USERNAME'),
        password: md5(getEnv('SUITECRM_PASSWORD')),
      },
      application_name: 'discloser_orchestrator',
      name_value_list: [],
    }),
  });
  if (!payload?.id) throw new Error(`SuiteCRM login failed: ${JSON.stringify(payload)}`);
  return payload.id;
}

async function findContactByEmail(sessionId, email) {
  const safeEmail = escapeForQuery(email);
  const payload = await suiteFetchForm({
    method: 'get_entry_list',
    input_type: 'JSON',
    response_type: 'JSON',
    rest_data: JSON.stringify({
      session: sessionId,
      module_name: 'Contacts',
      query: `contacts.deleted = 0 AND contacts.id IN (SELECT eabr.bean_id FROM email_addr_bean_rel eabr INNER JOIN email_addresses ea ON ea.id = eabr.email_address_id WHERE eabr.bean_module = 'Contacts' AND eabr.deleted = 0 AND ea.deleted = 0 AND ea.email_address = '${safeEmail}')`,
      order_by: 'contacts.date_modified DESC',
      offset: 0,
      select_fields: ['id', 'first_name', 'last_name'],
      link_name_to_fields_array: [],
      max_results: 1,
      deleted: 0,
      favorites: false,
    }),
  });
  return payload.entry_list?.[0]?.id || null;
}

async function upsertContact(sessionId, contact) {
  const email = contact.Email || contact['Work Email'] || '';
  const existingId = await findContactByEmail(sessionId, email);
  const nameValueList = fieldsFromContact(contact);
  if (existingId) nameValueList.push({ name: 'id', value: existingId });

  const payload = await suiteFetchForm({
    method: 'set_entry',
    input_type: 'JSON',
    response_type: 'JSON',
    rest_data: JSON.stringify({
      session: sessionId,
      module_name: 'Contacts',
      name_value_list: nameValueList,
    }),
  });
  if (!payload?.id) {
    throw new Error(`SuiteCRM upsert failed for ${email}: ${JSON.stringify(payload)}`);
  }
  return { action: existingId ? 'updated' : 'created', id: payload.id };
}

export async function syncContactsToSuitecrm(contacts, options = {}) {
  const dryRun = String(process.env.CRM_DRY_RUN || 'false').toLowerCase() === 'true';
  const maxPerRun = Number(process.env.CRM_MAX_UPSERT_PER_RUN || options.maxPerRun || 0);

  if (!hasSuiteConfig()) {
    return {
      mode: 'suitecrm-not-configured',
      created: 0,
      updated: 0,
      errors: 0,
      skipped: contacts.length,
      warnings: ['SuiteCRM env vars missing'],
    };
  }
  const limited = maxPerRun > 0 ? contacts.slice(0, maxPerRun) : contacts;
  if (dryRun) {
    return {
      mode: 'suitecrm-dry-run',
      created: 0,
      updated: 0,
      errors: 0,
      skipped: contacts.length - limited.length,
      warnings: [`CRM_DRY_RUN=true, would process ${limited.length} contacts`],
    };
  }

  const sessionId = await login();
  let created = 0;
  let updated = 0;
  let errors = 0;
  let skipped = 0;
  const warnings = [];

  for (const contact of limited) {
    const email = contact.Email || contact['Work Email'] || '';
    if (!email || !email.includes('@')) {
      skipped += 1;
      continue;
    }
    try {
      const result = await upsertContact(sessionId, contact);
      if (result.action === 'created') created += 1;
      if (result.action === 'updated') updated += 1;
    } catch (error) {
      errors += 1;
      warnings.push(error.message);
    }
  }

  return {
    mode: 'suitecrm-api',
    created,
    updated,
    errors,
    skipped: skipped + (contacts.length - limited.length),
    warnings: warnings.slice(0, 30),
  };
}

export { hasSuiteConfig };
