/*
    Campaign-level email performance with derived engagement metrics.
    Computes open rates, click rates, reply rates, bounce rates,
    and rolling trends.
*/

with analytics as (
    select * from {{ ref('stg_instantly_campaign_analytics') }}
),

campaigns as (
    select * from {{ ref('stg_instantly_campaigns') }}
),

enriched as (
    select
        a.campaign_id,
        a.report_date,
        c.campaign_name,
        c.campaign_status,

        -- volume metrics
        a.emails_sent,
        a.emails_opened,
        a.emails_unique_opened,
        a.emails_clicked,
        a.emails_unique_clicked,
        a.emails_replied,
        a.emails_bounced,
        a.emails_unsubscribed,

        -- derived: rates
        case
            when a.emails_sent > 0
            then a.emails_unique_opened::decimal / a.emails_sent
            else 0
        end as open_rate,

        case
            when a.emails_sent > 0
            then a.emails_unique_clicked::decimal / a.emails_sent
            else 0
        end as click_rate,

        case
            when a.emails_sent > 0
            then a.emails_replied::decimal / a.emails_sent
            else 0
        end as reply_rate,

        case
            when a.emails_sent > 0
            then a.emails_bounced::decimal / a.emails_sent
            else 0
        end as bounce_rate,

        case
            when a.emails_sent > 0
            then a.emails_unsubscribed::decimal / a.emails_sent
            else 0
        end as unsubscribe_rate,

        -- derived: click-to-open rate (CTOR)
        case
            when a.emails_unique_opened > 0
            then a.emails_unique_clicked::decimal / a.emails_unique_opened
            else 0
        end as click_to_open_rate,

        -- rolling 7d totals
        sum(a.emails_sent) over (
            partition by a.campaign_id
            order by a.report_date
            rows between 6 preceding and current row
        ) as sent_7d,

        sum(a.emails_replied) over (
            partition by a.campaign_id
            order by a.report_date
            rows between 6 preceding and current row
        ) as replied_7d,

        sum(a.emails_bounced) over (
            partition by a.campaign_id
            order by a.report_date
            rows between 6 preceding and current row
        ) as bounced_7d,

        -- cumulative totals
        sum(a.emails_sent) over (
            partition by a.campaign_id
            order by a.report_date
        ) as cumulative_sent,

        sum(a.emails_replied) over (
            partition by a.campaign_id
            order by a.report_date
        ) as cumulative_replied

    from analytics a
    left join campaigns c on a.campaign_id = c.campaign_id
)

select * from enriched
