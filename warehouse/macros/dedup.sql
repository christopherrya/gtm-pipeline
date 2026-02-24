{% macro dedup(source_relation, primary_key, order_by, order_direction='desc') %}
{#
    Deduplicates a source relation by primary key, keeping the most recent record.

    Args:
        source_relation: The source table/CTE reference
        primary_key: Column(s) to partition by. Pass a list for composite keys.
        order_by: Column to determine recency (e.g., _loaded_at, updated_at)
        order_direction: 'desc' (default, keeps latest) or 'asc' (keeps earliest)

    Usage:
        {{ dedup(ref('ingress_facebook_ads'), 'ad_id', '_loaded_at') }}
        {{ dedup(ref('ingress_gsc_queries'), ['date', 'query', 'page'], '_loaded_at') }}
#}

{% set pk_columns = primary_key if primary_key is iterable and primary_key is not string else [primary_key] %}

select * exclude (_rn)
from (
    select
        *,
        row_number() over (
            partition by {{ pk_columns | join(', ') }}
            order by {{ order_by }} {{ order_direction }}
        ) as _rn
    from {{ source_relation }}
)
where _rn = 1

{% endmacro %}
