/*
    Daily email outreach dashboard.
    Combines campaign analytics with lead-level engagement
    for a complete picture of email channel performance.
*/

with campaign_perf as (
    select * from {{ ref('anl_instantly_email_performance') }}
),

campaign_health as (
    select * from {{ ref('opr_email_campaign_health') }}
),

-- aggregate across all campaigns per day
daily_totals as (
    select
        report_date,

        -- volume
        sum(emails_sent) as total_sent,
        sum(emails_opened) as total_opened,
        sum(emails_unique_opened) as total_unique_opened,
        sum(emails_clicked) as total_clicked,
        sum(emails_replied) as total_replied,
        sum(emails_bounced) as total_bounced,
        sum(emails_unsubscribed) as total_unsubscribed,

        -- rates (weighted by volume)
        case
            when sum(emails_sent) > 0
            then sum(emails_unique_opened)::decimal / sum(emails_sent)
            else 0
        end as overall_open_rate,

        case
            when sum(emails_sent) > 0
            then sum(emails_replied)::decimal / sum(emails_sent)
            else 0
        end as overall_reply_rate,

        case
            when sum(emails_sent) > 0
            then sum(emails_bounced)::decimal / sum(emails_sent)
            else 0
        end as overall_bounce_rate,

        count(distinct campaign_id) as active_campaigns

    from campaign_perf
    group by report_date
),

with_running as (
    select
        *,

        -- 7d rolling
        sum(total_sent) over (
            order by report_date
            rows between 6 preceding and current row
        ) as sent_7d,

        sum(total_replied) over (
            order by report_date
            rows between 6 preceding and current row
        ) as replied_7d,

        -- MTD
        sum(total_sent) over (
            partition by date_trunc('month', report_date)
            order by report_date
        ) as mtd_sent,

        sum(total_replied) over (
            partition by date_trunc('month', report_date)
            order by report_date
        ) as mtd_replied

    from daily_totals
)

select *
from with_running
order by report_date desc
