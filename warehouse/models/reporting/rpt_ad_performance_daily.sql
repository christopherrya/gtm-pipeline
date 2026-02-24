/*
    Daily ad performance dashboard view.
    Aggregates to campaign level with pivoted metrics for time-series dashboards.
    Includes budget pacing and efficiency benchmarks.
*/

with ad_perf as (
    select * from {{ ref('anl_facebook_ad_performance') }}
),

-- campaign-day grain
campaign_daily as (
    select
        report_date,
        campaign_id,
        campaign_name,
        campaign_objective,
        campaign_status,

        -- aggregate ad-level metrics to campaign
        count(distinct ad_id) as active_ads,
        sum(impressions) as impressions,
        sum(clicks) as clicks,
        sum(spend_usd) as spend_usd,
        sum(reach) as reach,
        sum(link_clicks) as link_clicks,
        sum(landing_page_views) as landing_page_views,
        sum(leads) as leads,
        sum(purchases) as purchases,

        -- weighted CPM (spend / impressions * 1000)
        case
            when sum(impressions) > 0
            then sum(spend_usd) / sum(impressions) * 1000
            else 0
        end as blended_cpm,

        -- weighted CTR
        case
            when sum(impressions) > 0
            then sum(clicks)::decimal / sum(impressions)
            else 0
        end as blended_ctr,

        -- weighted CPC
        case
            when sum(clicks) > 0
            then sum(spend_usd) / sum(clicks)
            else 0
        end as blended_cpc,

        -- cost per lead
        case
            when sum(leads) > 0
            then sum(spend_usd) / sum(leads)
            else null
        end as cost_per_lead

    from ad_perf
    group by report_date, campaign_id, campaign_name, campaign_objective, campaign_status
),

-- add running totals and pacing
with_pacing as (
    select
        *,

        -- MTD spend
        sum(spend_usd) over (
            partition by campaign_id, date_trunc('month', report_date)
            order by report_date
        ) as mtd_spend_usd,

        -- MTD leads
        sum(leads) over (
            partition by campaign_id, date_trunc('month', report_date)
            order by report_date
        ) as mtd_leads,

        -- 7d spend
        sum(spend_usd) over (
            partition by campaign_id
            order by report_date
            rows between 6 preceding and current row
        ) as spend_7d,

        -- day of month for pacing calc
        extract(day from report_date) as day_of_month,
        extract(day from (date_trunc('month', report_date) + interval '1 month' - interval '1 day')) as days_in_month

    from campaign_daily
)

select
    *,
    -- budget pacing: projected month-end spend based on current run rate
    case
        when day_of_month > 0
        then mtd_spend_usd / day_of_month * days_in_month
        else 0
    end as projected_monthly_spend
from with_pacing
order by report_date desc, spend_usd desc
