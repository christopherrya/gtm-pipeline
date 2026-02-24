/*
    Unified lead journey: enrichment data + email engagement.
    Joins enriched leads (from the enrichment pipeline) with Instantly
    email engagement data to build a full lead lifecycle view.
*/

with leads as (
    select * from {{ ref('stg_enriched_leads') }}
),

email_engagement as (
    select * from {{ ref('stg_instantly_leads') }}
),

joined as (
    select
        l.email,
        l.first_name,
        l.last_name,
        l.company,
        l.title,
        l.linkedin_url,
        l.instagram_handle,

        -- ICP scoring
        l.icp_score,
        l.icp_tier,
        l.clay_base_score,
        l.linkedin_score,
        l.instagram_score,
        l.transaction_score,
        l.recency_score,

        -- enrichment signals
        l.linkedin_headline,
        l.linkedin_post_count,
        l.instagram_followers,
        l.listing_count,
        l.ai_hook,
        l.segment,
        l.ab_variant,

        -- email engagement (from Instantly)
        e.lead_id as instantly_lead_id,
        e.campaign_id as email_campaign_id,
        e.send_status,
        e.lead_status as email_lead_status,
        e.is_interested,
        e.last_contacted_at,
        e.has_opened,
        e.has_clicked,
        e.has_replied,
        e.has_bounced,

        -- derived: engagement score (0-4)
        (case when e.has_opened then 1 else 0 end
         + case when e.has_clicked then 1 else 0 end
         + case when e.has_replied then 2 else 0 end
        ) as email_engagement_score,

        -- derived: combined lead quality (ICP + engagement)
        coalesce(l.icp_score, 0) + (
            case when e.has_opened then 5 else 0 end
            + case when e.has_clicked then 10 else 0 end
            + case when e.has_replied then 20 else 0 end
        ) as combined_lead_score,

        -- derived: lead stage
        case
            when e.has_replied and e.is_interested then 'INTERESTED_REPLY'
            when e.has_replied then 'REPLIED'
            when e.has_clicked then 'CLICKED'
            when e.has_opened then 'OPENED'
            when e.has_bounced then 'BOUNCED'
            when e.send_status is not null then 'SENT'
            else 'ENRICHED_ONLY'
        end as lead_stage,

        l._loaded_at as enrichment_loaded_at,
        e._loaded_at as email_loaded_at

    from leads l
    left join email_engagement e on l.email = e.email
)

select * from joined
