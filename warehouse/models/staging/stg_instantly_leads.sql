with source as (
    select * from {{ ref('raw_instantly_leads') }}
)

select
    lead_id::varchar                        as lead_id,
    trim(lower(email))                      as email,
    trim(first_name)                        as first_name,
    trim(last_name)                         as last_name,
    trim(company_name)                      as company_name,
    campaign_id::varchar                    as campaign_id,
    upper(trim(status))                     as send_status,
    upper(trim(lead_status))                as lead_status,
    upper(trim(substatus))                  as substatus,
    coalesce(interested::boolean, false)    as is_interested,
    try_cast(created_at as timestamp)       as created_at,
    try_cast(last_contacted_at as timestamp) as last_contacted_at,
    coalesce(email_opened::boolean, false)  as has_opened,
    coalesce(email_clicked::boolean, false) as has_clicked,
    coalesce(email_replied::boolean, false) as has_replied,
    coalesce(email_bounced::boolean, false) as has_bounced,
    _loaded_at
from source
where lead_id is not null
  and email is not null
