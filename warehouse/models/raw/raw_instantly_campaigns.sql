{{ dedup(ref('ingress_instantly_campaigns'), 'campaign_id', '_loaded_at') }}
