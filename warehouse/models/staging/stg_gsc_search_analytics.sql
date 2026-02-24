with source as (
    select * from {{ ref('raw_gsc_search_analytics') }}
)

select
    try_cast(date as date)                  as report_date,
    trim(lower(query))                      as query,
    trim(page)                              as page_url,
    -- extract path from full URL for easier grouping
    regexp_extract(page, 'https?://[^/]+(.*)', 1)  as page_path,
    lower(trim(device))                     as device,
    upper(trim(country))                    as country_code,
    coalesce(clicks::bigint, 0)             as clicks,
    coalesce(impressions::bigint, 0)        as impressions,
    coalesce(ctr::decimal(10,6), 0)         as ctr,
    coalesce(position::decimal(10,2), 0)    as avg_position,
    _loaded_at
from source
where date is not null
  and query is not null
