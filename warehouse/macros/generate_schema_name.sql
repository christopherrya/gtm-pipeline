{% macro generate_schema_name(custom_schema_name, node) -%}
    {#
        Override default dbt schema generation.
        Uses the custom_schema_name directly (ingress, raw, staging, etc.)
        instead of prepending the target schema.
    #}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
