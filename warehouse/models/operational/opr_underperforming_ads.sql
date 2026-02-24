/*
    Identifies ads that should be paused or investigated.

    An ad is flagged as underperforming when:
    1. CPM is above the 7d rolling average by > 30%
    2. CTR is below 0.5% (industry floor for cold traffic)
    3. Spend is > $10/day with zero conversions
    4. Frequency > 3 (audience fatigue)

    This feeds directly into the "turn off low-performing ads" use case.
*/

with latest_day as (
    -- get the most recent day of data per ad (single scan via QUALIFY)
    select *
    from {{ ref('anl_facebook_ad_performance') }}
    qualify report_date = max(report_date) over ()
),

flagged as (
    select
        ad_id,
        ad_name,
        ad_set_name,
        campaign_name,
        campaign_objective,
        ad_status,
        report_date,

        -- current metrics
        spend_usd,
        cpm,
        ctr,
        impressions,
        clicks,
        leads,
        purchases,
        frequency,

        -- benchmarks
        cpm_7d_avg,
        ctr_7d_avg,
        spend_7d_avg,
        cumulative_spend_usd,

        -- flags
        (cpm > cpm_7d_avg * 1.3 and cpm_7d_avg > 0)   as is_cpm_spike,
        (ctr < 0.005 and impressions > 100)              as is_low_ctr,
        (spend_usd > 10 and coalesce(leads, 0) = 0
         and coalesce(purchases, 0) = 0)                 as is_zero_conversions,
        (frequency > 3)                                  as is_audience_fatigued,

        -- severity score (0-4, higher = more urgent to pause)
        (case when cpm > cpm_7d_avg * 1.3 and cpm_7d_avg > 0 then 1 else 0 end
         + case when ctr < 0.005 and impressions > 100 then 1 else 0 end
         + case when spend_usd > 10 and coalesce(leads, 0) = 0
                     and coalesce(purchases, 0) = 0 then 1 else 0 end
         + case when frequency > 3 then 1 else 0 end
        ) as severity_score,

        -- recommended action
        case
            when frequency > 3 and ctr < 0.005 then 'PAUSE — audience fatigued + low CTR'
            when spend_usd > 10 and coalesce(leads, 0) = 0
                 and coalesce(purchases, 0) = 0 then 'PAUSE — burning budget, zero conversions'
            when cpm > cpm_7d_avg * 1.5 then 'PAUSE — CPM 50%+ above rolling avg'
            when cpm > cpm_7d_avg * 1.3 then 'REVIEW — CPM trending up'
            when ctr < 0.005 and impressions > 100 then 'REVIEW — CTR below floor'
            else 'MONITOR'
        end as recommended_action

    from latest_day
    where ad_status = 'ACTIVE'
)

select *
from flagged
where severity_score > 0
order by severity_score desc, spend_usd desc
