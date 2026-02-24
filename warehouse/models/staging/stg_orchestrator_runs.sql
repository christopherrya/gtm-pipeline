with source as (
    select * from {{ ref('raw_orchestrator_runs') }}
)

select
    run_id::varchar                         as run_id,
    node_report_file::varchar               as node_id,
    -- extract node name from filename (e.g., "N01_ClayUploadIngest.json" → "N01_ClayUploadIngest")
    regexp_replace(node_report_file, '\.json$', '')  as node_name,
    try_cast(status as varchar)             as node_status,
    try_cast(started_at as timestamp)       as started_at,
    try_cast(finished_at as timestamp)      as finished_at,
    try_cast(records_in as int)             as records_in,
    try_cast(records_out as int)            as records_out,
    try_cast(error as varchar)              as error_message,
    _loaded_at
from source
where run_id is not null
