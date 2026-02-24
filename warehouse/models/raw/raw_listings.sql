-- listings dedup on address (the closest thing to a natural key)
{{ dedup(ref('ingress_listings'), 'address', '_loaded_at') }}
