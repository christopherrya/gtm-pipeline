with source as (
    select * from {{ ref('raw_facebook_insights') }}
)

select
    ad_id::varchar                              as ad_id,
    try_cast(date_start as date)                as report_date,
    try_cast(date_stop as date)                 as report_date_end,
    coalesce(try_cast(impressions as bigint), 0)            as impressions,
    coalesce(try_cast(clicks as bigint), 0)                 as clicks,
    coalesce(try_cast(spend as decimal(18,2)), 0)           as spend_usd,
    coalesce(try_cast(cpm as decimal(18,4)), 0)             as cpm,
    coalesce(try_cast(cpc as decimal(18,4)), 0)             as cpc,
    coalesce(try_cast(ctr as decimal(10,6)), 0)             as ctr,
    coalesce(try_cast(reach as bigint), 0)                  as reach,
    coalesce(try_cast(frequency as decimal(10,4)), 0)       as frequency,
    -- common action types flattened
    try_cast("actions__link_click" as bigint)               as link_clicks,
    try_cast("actions__landing_page_view" as bigint)        as landing_page_views,
    try_cast("actions__lead" as bigint)                     as leads,
    try_cast("actions__purchase" as bigint)                 as purchases,
    try_cast("cost_per_action_type__link_click" as decimal(18,4))   as cost_per_link_click,
    try_cast("cost_per_action_type__lead" as decimal(18,4))         as cost_per_lead,
    try_cast("cost_per_action_type__purchase" as decimal(18,4))     as cost_per_purchase,
    _loaded_at
from source
where ad_id is not null
  and date_start is not null
