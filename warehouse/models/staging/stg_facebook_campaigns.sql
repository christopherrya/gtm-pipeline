with source as (
    select * from {{ ref('raw_facebook_campaigns') }}
)

select
    id::varchar                         as campaign_id,
    trim(name)                          as campaign_name,
    upper(trim(status))                 as campaign_status,
    upper(trim(objective))              as campaign_objective,
    coalesce(daily_budget::decimal(18,2) / 100, 0)   as daily_budget_usd,
    coalesce(lifetime_budget::decimal(18,2) / 100, 0) as lifetime_budget_usd,
    buying_type,
    try_cast(created_time as timestamp) as created_at,
    try_cast(updated_time as timestamp) as updated_at,
    _loaded_at
from source
where id is not null
