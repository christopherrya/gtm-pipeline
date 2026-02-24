{{ dedup(ref('ingress_instantly_campaign_analytics'), ['campaign_id', 'date'], '_loaded_at') }}
