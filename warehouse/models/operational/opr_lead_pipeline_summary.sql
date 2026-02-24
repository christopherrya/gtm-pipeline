/*
    Lead pipeline summary by ICP tier and lead stage.
    Gives a snapshot of how many leads are at each stage,
    conversion rates between stages, and where leads are stalling.
*/

with leads as (
    select * from {{ ref('anl_lead_journey') }}
),

summary as (
    select
        icp_tier,
        lead_stage,
        count(*) as lead_count,
        avg(icp_score) as avg_icp_score,
        avg(combined_lead_score) as avg_combined_score,
        avg(email_engagement_score) as avg_engagement_score,

        -- sub-score averages
        avg(clay_base_score) as avg_clay_score,
        avg(linkedin_score) as avg_linkedin_score,
        avg(instagram_score) as avg_instagram_score,
        avg(transaction_score) as avg_transaction_score,

        -- enrichment coverage
        count(*) filter (where linkedin_url is not null)::decimal / count(*) as linkedin_coverage,
        count(*) filter (where instagram_handle is not null)::decimal / count(*) as instagram_coverage,
        count(*) filter (where ai_hook is not null)::decimal / count(*) as ai_hook_coverage,

        -- email engagement breakdown
        count(*) filter (where has_opened) as opened_count,
        count(*) filter (where has_clicked) as clicked_count,
        count(*) filter (where has_replied) as replied_count,
        count(*) filter (where has_bounced) as bounced_count,
        count(*) filter (where is_interested) as interested_count

    from leads
    group by icp_tier, lead_stage
)

select
    *,
    -- stage conversion rates (within tier)
    sum(lead_count) over (partition by icp_tier) as tier_total,
    lead_count::decimal / sum(lead_count) over (partition by icp_tier) as stage_pct_of_tier
from summary
order by
    case icp_tier
        when 'Hot' then 1
        when 'High' then 2
        when 'Medium' then 3
        when 'Low' then 4
        else 5
    end,
    case lead_stage
        when 'INTERESTED_REPLY' then 1
        when 'REPLIED' then 2
        when 'CLICKED' then 3
        when 'OPENED' then 4
        when 'SENT' then 5
        when 'BOUNCED' then 6
        when 'ENRICHED_ONLY' then 7
        else 8
    end
