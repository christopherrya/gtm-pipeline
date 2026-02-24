with source as (
    select * from {{ ref('raw_instantly_campaign_analytics') }}
)

select
    campaign_id::varchar                    as campaign_id,
    trim(campaign_name)                     as campaign_name,
    try_cast(date as date)                  as report_date,
    coalesce(sent::int, 0)                  as emails_sent,
    coalesce(opened::int, 0)                as emails_opened,
    coalesce(unique_opened::int, 0)         as emails_unique_opened,
    coalesce(clicked::int, 0)               as emails_clicked,
    coalesce(unique_clicked::int, 0)        as emails_unique_clicked,
    coalesce(replied::int, 0)               as emails_replied,
    coalesce(bounced::int, 0)               as emails_bounced,
    coalesce(unsubscribed::int, 0)          as emails_unsubscribed,
    _loaded_at
from source
where campaign_id is not null
  and date is not null
