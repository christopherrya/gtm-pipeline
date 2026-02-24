{{ dedup(ref('ingress_facebook_insights'), ['ad_id', 'date_start'], '_loaded_at') }}
