/*
    Ad-level performance with derived metrics.
    Joins insights → ads → ad_sets → campaigns to get full hierarchy.
    Computes rolling averages, efficiency ratios, and trend indicators.
*/

with insights as (
    select * from {{ ref('stg_facebook_insights') }}
),

ads as (
    select * from {{ ref('stg_facebook_ads') }}
),

ad_sets as (
    select * from {{ ref('stg_facebook_ad_sets') }}
),

campaigns as (
    select * from {{ ref('stg_facebook_campaigns') }}
),

enriched as (
    select
        i.ad_id,
        i.report_date,
        a.ad_name,
        a.ad_status,
        a.ad_set_id,
        s.ad_set_name,
        s.optimization_goal,
        a.campaign_id,
        c.campaign_name,
        c.campaign_objective,
        c.campaign_status,

        -- raw metrics
        i.impressions,
        i.clicks,
        i.spend_usd,
        i.cpm,
        i.cpc,
        i.ctr,
        i.reach,
        i.frequency,
        i.link_clicks,
        i.landing_page_views,
        i.leads,
        i.purchases,
        i.cost_per_link_click,
        i.cost_per_lead,
        i.cost_per_purchase,

        -- derived: efficiency ratios
        case
            when i.impressions > 0
            then i.clicks::decimal / i.impressions
            else 0
        end as click_rate,

        case
            when i.clicks > 0
            then coalesce(i.landing_page_views, 0)::decimal / i.clicks
            else 0
        end as landing_page_rate,

        case
            when i.landing_page_views > 0
            then coalesce(i.leads, 0)::decimal / i.landing_page_views
            else 0
        end as lead_conversion_rate,

        -- derived: rolling 7d averages (window)
        avg(i.spend_usd) over (
            partition by i.ad_id
            order by i.report_date
            rows between 6 preceding and current row
        ) as spend_7d_avg,

        avg(i.cpm) over (
            partition by i.ad_id
            order by i.report_date
            rows between 6 preceding and current row
        ) as cpm_7d_avg,

        avg(i.ctr) over (
            partition by i.ad_id
            order by i.report_date
            rows between 6 preceding and current row
        ) as ctr_7d_avg,

        -- derived: day-over-day spend change
        i.spend_usd - lag(i.spend_usd, 1, i.spend_usd) over (
            partition by i.ad_id
            order by i.report_date
        ) as spend_dod_change,

        -- derived: cumulative spend
        sum(i.spend_usd) over (
            partition by i.ad_id
            order by i.report_date
        ) as cumulative_spend_usd

    from insights i
    left join ads a on i.ad_id = a.ad_id
    left join ad_sets s on a.ad_set_id = s.ad_set_id
    left join campaigns c on a.campaign_id = c.campaign_id
)

select * from enriched
