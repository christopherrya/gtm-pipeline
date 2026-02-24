with source as (
    select * from {{ ref('raw_facebook_ads') }}
)

select
    id::varchar                         as ad_id,
    adset_id::varchar                   as ad_set_id,
    campaign_id::varchar                as campaign_id,
    trim(name)                          as ad_name,
    upper(trim(status))                 as ad_status,
    creative::varchar                   as creative_json,
    try_cast(created_time as timestamp) as created_at,
    try_cast(updated_time as timestamp) as updated_at,
    _loaded_at
from source
where id is not null
