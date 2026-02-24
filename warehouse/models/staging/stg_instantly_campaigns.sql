with source as (
    select * from {{ ref('raw_instantly_campaigns') }}
)

select
    campaign_id::varchar                    as campaign_id,
    trim(name)                              as campaign_name,
    upper(trim(status))                     as campaign_status,
    daily_limit::int                        as daily_send_limit,
    try_cast(created_at as timestamp)       as created_at,
    try_cast(updated_at as timestamp)       as updated_at,
    _loaded_at
from source
where campaign_id is not null
