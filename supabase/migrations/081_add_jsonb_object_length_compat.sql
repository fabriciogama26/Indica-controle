-- 081_add_jsonb_object_length_compat.sql
-- Compatibilidade para ambientes Postgres sem jsonb_object_length(jsonb).

create or replace function public.jsonb_object_length(p_value jsonb)
returns integer
language sql
immutable
as $$
  select
    case
      when p_value is null then 0
      when jsonb_typeof(p_value) <> 'object' then 0
      else (select count(*)::integer from jsonb_object_keys(p_value))
    end;
$$;

grant execute on function public.jsonb_object_length(jsonb) to authenticated;
grant execute on function public.jsonb_object_length(jsonb) to service_role;
