/*
    Identifies pages that are candidates for content refresh.

    A page is flagged when:
    1. Position is drifting upward (getting worse) over 28d
    2. Click volume is declining week-over-week
    3. Page had meaningful traffic (>10 clicks/week) but is losing it
    4. CTR is below expected for its position bracket

    Maps directly to the "check GSC data vs CMS content, refresh posts" use case.
*/

with latest_snapshot as (
    -- most recent day per page
    select * from (
        select
            *,
            row_number() over (
                partition by page_url
                order by report_date desc
            ) as _rn
        from {{ ref('anl_gsc_content_performance') }}
    )
    where _rn = 1
),

flagged as (
    select
        page_url,
        page_path,
        report_date as snapshot_date,

        -- current metrics
        clicks,
        impressions,
        weighted_avg_position,
        page_ctr,
        unique_queries,

        -- rolling metrics
        clicks_7d,
        impressions_7d,
        clicks_28d,
        impressions_28d,
        position_7d_avg,

        -- trend signals
        clicks_7d_trend,
        position_drift,
        is_declining,

        -- derived: expected CTR by position bracket
        -- (industry benchmarks for organic search)
        case
            when position_7d_avg <= 1.5 then 0.30
            when position_7d_avg <= 2.5 then 0.15
            when position_7d_avg <= 3.5 then 0.10
            when position_7d_avg <= 5.0 then 0.05
            when position_7d_avg <= 10.0 then 0.02
            else 0.01
        end as expected_ctr_for_position,

        -- is CTR underperforming for position?
        page_ctr < (
            case
                when position_7d_avg <= 1.5 then 0.20
                when position_7d_avg <= 2.5 then 0.10
                when position_7d_avg <= 3.5 then 0.06
                when position_7d_avg <= 5.0 then 0.03
                else 0.01
            end
        ) as is_ctr_below_expected,

        -- priority score (higher = refresh sooner)
        (case when is_declining then 2 else 0 end
         + case when position_drift > 2 then 2 else 0 end
         + case when clicks_7d_trend < -5 then 1 else 0 end
         + case when clicks_28d > 50 then 1 else 0 end  -- was significant
        ) as refresh_priority,

        -- recommended action
        case
            when is_declining and position_drift > 3
                then 'URGENT REFRESH — rapid position loss + traffic decline'
            when is_declining and clicks_28d > 100
                then 'REFRESH — high-value page losing traffic'
            when position_drift > 2
                then 'REFRESH — position slipping, update content'
            when clicks_7d_trend < -5
                then 'INVESTIGATE — traffic drop, check SERP changes'
            else 'MONITOR'
        end as recommended_action

    from latest_snapshot
    where clicks_28d > 10  -- only pages with meaningful traffic
)

select *
from flagged
where refresh_priority > 0
order by refresh_priority desc, clicks_28d desc
