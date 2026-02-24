-- enriched leads don't have a stable PK from Clay, so we dedup on email
-- which is the most reliable unique identifier across enrichment runs
{{ dedup(ref('ingress_enriched_leads'), 'email', '_loaded_at') }}
