/*
    Email campaign health scorecard.
    Flags campaigns with deliverability issues, low engagement,
    or high unsubscribe/bounce rates.
*/

with latest_snapshot as (
    select * from (
        select
            *,
            row_number() over (
                partition by campaign_id
                order by report_date desc
            ) as _rn
        from {{ ref('anl_instantly_email_performance') }}
    )
    where _rn = 1
),

flagged as (
    select
        campaign_id,
        campaign_name,
        campaign_status,
        report_date as snapshot_date,

        -- volume
        emails_sent,
        cumulative_sent,
        cumulative_replied,

        -- rates
        open_rate,
        click_rate,
        reply_rate,
        bounce_rate,
        unsubscribe_rate,
        click_to_open_rate,

        -- 7d totals
        sent_7d,
        replied_7d,
        bounced_7d,

        -- derived: deliverability health
        case
            when bounce_rate > 0.05 then 'CRITICAL'
            when bounce_rate > 0.03 then 'WARNING'
            else 'HEALTHY'
        end as deliverability_status,

        -- derived: engagement tier
        case
            when reply_rate > 0.05 then 'EXCELLENT'
            when reply_rate > 0.02 then 'GOOD'
            when reply_rate > 0.01 then 'AVERAGE'
            else 'LOW'
        end as engagement_tier,

        -- health score (0-10, higher = healthier)
        (case when bounce_rate < 0.03 then 3 when bounce_rate < 0.05 then 1 else 0 end
         + case when open_rate > 0.30 then 2 when open_rate > 0.15 then 1 else 0 end
         + case when reply_rate > 0.02 then 3 when reply_rate > 0.01 then 2 else 0 end
         + case when unsubscribe_rate < 0.01 then 2 when unsubscribe_rate < 0.02 then 1 else 0 end
        ) as health_score,

        -- recommended action
        case
            when bounce_rate > 0.05
                then 'PAUSE — bounce rate critical, clean list immediately'
            when unsubscribe_rate > 0.03
                then 'PAUSE — high unsubscribe rate, review messaging'
            when open_rate < 0.10 and cumulative_sent > 100
                then 'REVIEW — low open rate, test subject lines'
            when reply_rate < 0.005 and cumulative_sent > 200
                then 'REVIEW — low reply rate, revisit copy + targeting'
            else 'CONTINUE'
        end as recommended_action

    from latest_snapshot
)

select *
from flagged
order by health_score asc, cumulative_sent desc
