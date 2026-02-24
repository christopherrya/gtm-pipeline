with source as (
    select * from {{ ref('raw_facebook_ad_sets') }}
)

select
    id::varchar                             as ad_set_id,
    campaign_id::varchar                    as campaign_id,
    trim(name)                              as ad_set_name,
    upper(trim(status))                     as ad_set_status,
    coalesce(try_cast(daily_budget as decimal(18,2)) / 100, 0)   as daily_budget_usd,
    coalesce(try_cast(lifetime_budget as decimal(18,2)) / 100, 0) as lifetime_budget_usd,
    coalesce(try_cast(bid_amount as decimal(18,2)) / 100, 0)     as bid_amount_usd,
    bid_strategy,
    billing_event,
    optimization_goal,
    targeting::varchar                      as targeting_json,
    try_cast(start_time as timestamp)       as starts_at,
    try_cast(end_time as timestamp)         as ends_at,
    try_cast(created_time as timestamp)     as created_at,
    try_cast(updated_time as timestamp)     as updated_at,
    _loaded_at
from source
where id is not null
