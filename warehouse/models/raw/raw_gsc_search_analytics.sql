{{ dedup(ref('ingress_gsc_search_analytics'), ['date', 'query', 'page', 'device', 'country'], '_loaded_at') }}
