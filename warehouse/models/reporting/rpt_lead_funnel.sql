/*
    Lead funnel reporting view.
    Pivots the lead pipeline into a funnel format suitable for
    dashboards and executive reporting.
*/

with journey as (
    select * from {{ ref('anl_lead_journey') }}
),

-- overall funnel counts
funnel_stages as (
    select
        'Total Leads' as stage,
        1 as stage_order,
        count(*) as lead_count,
        null::decimal as conversion_rate
    from journey

    union all

    select
        'Emailed' as stage,
        2 as stage_order,
        count(*) filter (where lead_stage != 'ENRICHED_ONLY'),
        count(*) filter (where lead_stage != 'ENRICHED_ONLY')::decimal / nullif(count(*), 0)
    from journey

    union all

    select
        'Opened' as stage,
        3 as stage_order,
        count(*) filter (where has_opened),
        count(*) filter (where has_opened)::decimal
            / nullif(count(*) filter (where lead_stage != 'ENRICHED_ONLY'), 0)
    from journey

    union all

    select
        'Clicked' as stage,
        4 as stage_order,
        count(*) filter (where has_clicked),
        count(*) filter (where has_clicked)::decimal
            / nullif(count(*) filter (where has_opened), 0)
    from journey

    union all

    select
        'Replied' as stage,
        5 as stage_order,
        count(*) filter (where has_replied),
        count(*) filter (where has_replied)::decimal
            / nullif(count(*) filter (where has_clicked or has_opened), 0)
    from journey

    union all

    select
        'Interested' as stage,
        6 as stage_order,
        count(*) filter (where is_interested),
        count(*) filter (where is_interested)::decimal
            / nullif(count(*) filter (where has_replied), 0)
    from journey
)

select
    f.stage,
    f.stage_order,
    f.lead_count,
    f.conversion_rate,
    -- running total drop-off
    f.lead_count::decimal / first_value(f.lead_count) over (order by f.stage_order) as pct_of_total
from funnel_stages f
order by f.stage_order
