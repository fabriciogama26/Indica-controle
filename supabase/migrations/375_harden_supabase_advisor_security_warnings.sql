-- 375_harden_supabase_advisor_security_warnings.sql
-- Fecha warnings de seguranca do Supabase Advisor, exceto Auth/Leaked Password
-- Protection, que e configuracao manual do Dashboard e nao entra em migration.

begin;

-- btree_gist foi criado em public na 373 para constraints EXCLUDE de
-- team_compositions. O Advisor recomenda manter extensoes fora do schema public.
create schema if not exists extensions;

do $$
declare
  v_current_schema text;
begin
  select n.nspname
    into v_current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_current_schema is null then
    execute 'create extension btree_gist with schema extensions';
  elsif v_current_schema = 'public' then
    execute 'alter extension btree_gist set schema extensions';
  end if;
end;
$$;

-- Trigger functions apontadas como function_search_path_mutable.
alter function public.tg_programming_capture_anticipated_snapshot()
  set search_path = public;
alter function public.tg_programming_clear_snapshot_source()
  set search_path = public;
alter function public.tg_programming_set_updated_at()
  set search_path = public;

revoke all on function public.tg_programming_capture_anticipated_snapshot()
  from public, anon, authenticated;
revoke all on function public.tg_programming_clear_snapshot_source()
  from public, anon, authenticated;
revoke all on function public.tg_programming_set_updated_at()
  from public, anon, authenticated;

grant execute on function public.tg_programming_capture_anticipated_snapshot()
  to service_role;
grant execute on function public.tg_programming_clear_snapshot_source()
  to service_role;
grant execute on function public.tg_programming_set_updated_at()
  to service_role;

-- RPCs SECURITY DEFINER apontadas como executaveis diretamente por anon/authenticated.
-- O codigo atual chama estas funcoes pelos Route Handlers com service_role, apos validar
-- bearer token, tenant ativo e permissoes no backend.
revoke all on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;

revoke all on function public.save_project_measurement_order(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  date,
  numeric,
  numeric,
  text,
  text,
  uuid,
  jsonb,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.save_project_measurement_order(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  date,
  numeric,
  numeric,
  text,
  text,
  uuid,
  jsonb,
  timestamptz
) to service_role;

revoke all on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb)
  to service_role;

-- Validacao pos-aplicacao: deixa a migration falhar se algum warning coberto aqui
-- continuar materialmente aberto.
do $$
declare
  v_function text;
  v_function_oid oid;
  v_has_fixed_search_path boolean;
  v_search_path_functions text[] := array[
    'public.tg_programming_capture_anticipated_snapshot()',
    'public.tg_programming_clear_snapshot_source()',
    'public.tg_programming_set_updated_at()'
  ];
  v_hardened_functions text[] := array[
    'public.tg_programming_capture_anticipated_snapshot()',
    'public.tg_programming_clear_snapshot_source()',
    'public.tg_programming_set_updated_at()',
    'public.save_service_activity_record(uuid, uuid, uuid, text, text, text, uuid, uuid, text, numeric, numeric, text, text, jsonb, timestamptz)',
    'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)',
    'public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb)'
  ];
  v_extension_schema text;
begin
  foreach v_function in array v_search_path_functions loop
    v_function_oid := to_regprocedure(v_function);
    if v_function_oid is null then
      raise exception '375: funcao % nao encontrada para validar search_path', v_function;
    end if;

    select coalesce(p.proconfig @> array['search_path=public'], false)
      into v_has_fixed_search_path
    from pg_proc p
    where p.oid = v_function_oid;

    if not v_has_fixed_search_path then
      raise exception '375: funcao % continua sem search_path fixo', v_function;
    end if;
  end loop;

  foreach v_function in array v_hardened_functions loop
    if has_function_privilege('anon', v_function, 'execute') then
      raise exception '375: funcao % ainda executavel por anon', v_function;
    end if;

    if has_function_privilege('authenticated', v_function, 'execute') then
      raise exception '375: funcao % ainda executavel por authenticated', v_function;
    end if;

    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '375: funcao % sem EXECUTE para service_role', v_function;
    end if;
  end loop;

  select n.nspname
    into v_extension_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_extension_schema is distinct from 'extensions' then
    raise exception '375: btree_gist continua no schema %, esperado extensions', coalesce(v_extension_schema, '<ausente>');
  end if;
end;
$$;

commit;
