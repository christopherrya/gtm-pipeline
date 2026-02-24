with source as (
    select * from {{ ref('raw_enriched_leads') }}
)

select
    trim(lower(email))                      as email,
    trim("First Name")                      as first_name,
    trim("Last Name")                       as last_name,
    trim("Company")                         as company,
    trim("Title")                           as title,
    trim("LinkedIn URL")                    as linkedin_url,
    trim("Instagram Handle")               as instagram_handle,

    -- ICP scoring fields
    try_cast("ICP Score" as int)            as icp_score,
    trim("ICP Tier")                        as icp_tier,
    try_cast("Clay Score" as int)           as clay_base_score,
    try_cast("LinkedIn Score" as int)       as linkedin_score,
    try_cast("Instagram Score" as int)      as instagram_score,
    try_cast("Transaction Score" as int)    as transaction_score,
    try_cast("Recency Score" as int)        as recency_score,

    -- enrichment fields
    trim("LinkedIn Headline")              as linkedin_headline,
    try_cast("LinkedIn Post Count" as int) as linkedin_post_count,
    try_cast("Instagram Followers" as int) as instagram_followers,
    try_cast("Listing Count" as int)       as listing_count,

    -- outreach fields
    trim("AI Hook")                         as ai_hook,
    trim("Segment")                         as segment,
    trim("A/B Variant")                     as ab_variant,

    _loaded_at
from source
where email is not null
