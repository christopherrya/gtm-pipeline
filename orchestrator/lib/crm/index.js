import { hasTwentyConfig, syncContactsToTwenty } from './twenty.js';

function provider() {
  return (process.env.CRM_PROVIDER || 'local').toLowerCase();
}

export function activeCrmProvider() {
  return provider();
}

export function hasCrmConfig() {
  if (provider() === 'twenty') return hasTwentyConfig();
  return true;
}

export async function syncContactsToCrm(contacts) {
  const p = provider();
  if (p === 'twenty') return syncContactsToTwenty(contacts);
  return {
    mode: 'local-only',
    created: 0,
    updated: 0,
    errors: 0,
    skipped: contacts.length,
    warnings: ['CRM_PROVIDER=local, remote CRM sync skipped'],
  };
}
