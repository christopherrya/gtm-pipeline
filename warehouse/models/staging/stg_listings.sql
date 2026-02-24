with source as (
    select * from {{ ref('raw_listings') }}
)

select
    trim(address)                           as address,
    trim(lower(agent_name))                 as agent_name,
    trim(brokerage)                         as brokerage,
    try_cast(price as decimal(18,2))        as list_price,
    try_cast(bedrooms as int)               as bedrooms,
    try_cast(bathrooms as decimal(4,1))     as bathrooms,
    try_cast(sqft as int)                   as sqft,
    trim(status)                            as listing_status,
    trim(property_type)                     as property_type,
    trim(neighborhood)                      as neighborhood,
    trim(city)                              as city,
    trim(state)                             as state,
    trim(zip)                               as zip_code,
    try_cast(listed_date as date)           as listed_at,
    try_cast(scraped_at as timestamp)       as scraped_at,
    trim(source_url)                        as source_url,
    trim(source_site)                       as source_site,
    _loaded_at
from source
where address is not null
