{% macro read_landing_csv(source_name, file_pattern='*.csv') %}
{#
    Reads CSV files from the landing zone for a given source.
    DuckDB's read_csv_auto handles schema inference.

    Args:
        source_name: Subdirectory under data/landing/ (e.g., 'facebook_ads')
        file_pattern: Glob pattern for files (default: '*.csv')
#}
    select
        *,
        filename as _source_file,
        current_timestamp as _loaded_at
    from read_csv_auto(
        '{{ var("landing_path") }}/{{ source_name }}/{{ file_pattern }}',
        union_by_name=true,
        filename=true
    )
{% endmacro %}


{% macro read_landing_json(source_name, file_pattern='*.json') %}
{#
    Reads JSON files from the landing zone for a given source.
    DuckDB's read_json_auto handles schema inference.

    Args:
        source_name: Subdirectory under data/landing/ (e.g., 'instantly')
        file_pattern: Glob pattern for files (default: '*.json')
#}
    select
        *,
        filename as _source_file,
        current_timestamp as _loaded_at
    from read_json_auto(
        '{{ var("landing_path") }}/{{ source_name }}/{{ file_pattern }}',
        union_by_name=true,
        filename=true
    )
{% endmacro %}
