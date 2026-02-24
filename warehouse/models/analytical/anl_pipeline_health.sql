/*
    Orchestrator pipeline health metrics.
    Tracks run success rates, node-level performance,
    throughput, and failure patterns.
*/

with runs as (
    select * from {{ ref('stg_orchestrator_runs') }}
),

run_level as (
    select
        run_id,
        min(started_at) as run_started_at,
        max(finished_at) as run_finished_at,
        count(*) as total_nodes,
        count(*) filter (where node_status = 'success') as succeeded_nodes,
        count(*) filter (where node_status = 'error') as failed_nodes,
        count(*) filter (where node_status = 'skipped') as skipped_nodes,
        sum(records_in) as total_records_in,
        sum(records_out) as total_records_out,
        -- run duration in seconds
        extract(epoch from max(finished_at) - min(started_at)) as run_duration_seconds,
        -- did all nodes succeed?
        count(*) filter (where node_status = 'error') = 0 as is_success,
        -- first error message if any
        first(error_message) filter (where error_message is not null) as first_error
    from runs
    group by run_id
),

with_derived as (
    select
        *,
        -- throughput
        case
            when run_duration_seconds > 0
            then total_records_out::decimal / run_duration_seconds
            else 0
        end as records_per_second,
        -- completion rate
        case
            when total_nodes > 0
            then succeeded_nodes::decimal / total_nodes
            else 0
        end as node_success_rate,
        -- record yield (output / input)
        case
            when total_records_in > 0
            then total_records_out::decimal / total_records_in
            else 0
        end as record_yield_rate
    from run_level
)

select * from with_derived
