/*
    SEO content health dashboard view.
    One row per page with current state, trends, and action items.
    Designed to be the "top posts" view that feeds content refresh decisions.
*/

with page_perf as (
    select * from {{ ref('anl_gsc_content_performance') }}
),

refresh_candidates as (
    select * from {{ ref('opr_content_refresh_candidates') }}
),

-- latest snapshot per page
latest as (
    select * from (
        select
            *,
            row_number() over (partition by page_url order by report_date desc) as _rn
        from page_perf
    )
    where _rn = 1
),

-- total traffic per page over the entire period (for ranking)
page_totals as (
    select
        page_url,
        sum(clicks) as total_clicks,
        sum(impressions) as total_impressions,
        min(report_date) as first_seen,
        max(report_date) as last_seen,
        count(distinct report_date) as days_with_data
    from page_perf
    group by page_url
)

select
    l.page_url,
    l.page_path,
    l.report_date as snapshot_date,

    -- current daily metrics
    l.clicks as daily_clicks,
    l.impressions as daily_impressions,
    l.weighted_avg_position as current_position,
    l.page_ctr as current_ctr,
    l.unique_queries,

    -- rolling windows
    l.clicks_7d,
    l.impressions_7d,
    l.clicks_28d,
    l.impressions_28d,
    l.position_7d_avg,

    -- trends
    l.clicks_7d_trend,
    l.position_drift,
    l.is_declining,

    -- lifetime totals
    t.total_clicks,
    t.total_impressions,
    t.first_seen,
    t.last_seen,
    t.days_with_data,

    -- refresh status (from operational layer)
    r.refresh_priority,
    r.recommended_action,
    r.is_ctr_below_expected,
    r.expected_ctr_for_position,

    -- traffic rank
    rank() over (order by l.clicks_28d desc) as traffic_rank_28d

from latest l
left join page_totals t on l.page_url = t.page_url
left join refresh_candidates r on l.page_url = r.page_url
order by l.clicks_28d desc
