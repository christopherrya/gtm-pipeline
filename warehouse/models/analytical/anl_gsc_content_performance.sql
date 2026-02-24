/*
    Page-level content performance from GSC.
    Aggregates query-level data up to page, computes derived metrics,
    and calculates period-over-period trends for content refresh decisions.
*/

with daily_page as (
    select
        report_date,
        page_url,
        page_path,
        sum(clicks) as clicks,
        sum(impressions) as impressions,
        -- weighted average position (weighted by impressions)
        case
            when sum(impressions) > 0
            then sum(avg_position * impressions) / sum(impressions)
            else 0
        end as weighted_avg_position,
        case
            when sum(impressions) > 0
            then sum(clicks)::decimal / sum(impressions)
            else 0
        end as page_ctr,
        count(distinct query) as unique_queries
    from {{ ref('stg_gsc_search_analytics') }}
    group by report_date, page_url, page_path
),

with_rolling as (
    select
        *,

        -- 7d rolling sums
        sum(clicks) over (
            partition by page_url
            order by report_date
            rows between 6 preceding and current row
        ) as clicks_7d,

        sum(impressions) over (
            partition by page_url
            order by report_date
            rows between 6 preceding and current row
        ) as impressions_7d,

        -- 28d rolling sums for trend comparison
        sum(clicks) over (
            partition by page_url
            order by report_date
            rows between 27 preceding and current row
        ) as clicks_28d,

        sum(impressions) over (
            partition by page_url
            order by report_date
            rows between 27 preceding and current row
        ) as impressions_28d,

        -- position trend (7d avg)
        avg(weighted_avg_position) over (
            partition by page_url
            order by report_date
            rows between 6 preceding and current row
        ) as position_7d_avg,

        -- position 28 days ago for trend
        avg(weighted_avg_position) over (
            partition by page_url
            order by report_date
            rows between 27 preceding and 21 preceding
        ) as position_28d_ago_avg

    from daily_page
),

with_trends as (
    select
        *,

        -- click trend: compare last 7d vs prior 7d
        clicks_7d - lag(clicks_7d, 7, clicks_7d) over (
            partition by page_url
            order by report_date
        ) as clicks_7d_trend,

        -- position movement (negative = improving)
        position_7d_avg - coalesce(position_28d_ago_avg, position_7d_avg) as position_drift,

        -- content staleness signal: declining clicks + rising position
        case
            when clicks_7d < lag(clicks_7d, 7, clicks_7d) over (
                    partition by page_url order by report_date
                 )
                 and position_7d_avg > coalesce(position_28d_ago_avg, position_7d_avg)
            then true
            else false
        end as is_declining

    from with_rolling
)

select * from with_trends
