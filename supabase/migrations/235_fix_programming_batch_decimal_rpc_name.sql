-- 235_fix_programming_batch_decimal_rpc_name.sql
-- Corrige o nome da wrapper decimal em lote, truncado pelo limite de 63 caracteres do PostgreSQL.

do $$
begin
  if to_regprocedure(
    'public.save_project_programming_batch_full_decimal(uuid,uuid,uuid,uuid[],date,text,time,time,integer,text,text,text,jsonb,jsonb,uuid,integer,integer,integer,numeric,integer,uuid,time,time,text,integer,text,text,uuid,boolean,boolean)'
  ) is null then
    if to_regprocedure(
      'public.save_project_programming_batch_full_decimal_with_electrical_and(uuid,uuid,uuid,uuid[],date,text,time,time,integer,text,text,text,jsonb,jsonb,uuid,integer,integer,integer,numeric,integer,uuid,time,time,text,integer,text,text,uuid,boolean,boolean)'
    ) is null then
      raise exception
        'RPC decimal em lote da Programacao nao encontrada. Aplique primeiro a migration 228.';
    end if;

    alter function public.save_project_programming_batch_full_decimal_with_electrical_and(
      uuid, uuid, uuid, uuid[], date, text, time, time, integer, text, text, text,
      jsonb, jsonb, uuid, integer, integer, integer, numeric, integer, uuid, time,
      time, text, integer, text, text, uuid, boolean, boolean
    ) rename to save_project_programming_batch_full_decimal;
  end if;
end;
$$;

alter function public.save_project_programming_batch_full_decimal(
  uuid, uuid, uuid, uuid[], date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, integer, integer, integer, numeric, integer, uuid, time,
  time, text, integer, text, text, uuid, boolean, boolean
) set search_path = public, pg_temp;

revoke all on function public.save_project_programming_batch_full_decimal(
  uuid, uuid, uuid, uuid[], date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, integer, integer, integer, numeric, integer, uuid, time,
  time, text, integer, text, text, uuid, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.save_project_programming_batch_full_decimal(
  uuid, uuid, uuid, uuid[], date, text, time, time, integer, text, text, text,
  jsonb, jsonb, uuid, integer, integer, integer, numeric, integer, uuid, time,
  time, text, integer, text, text, uuid, boolean, boolean
) to service_role;

do $$
declare
  v_signature regprocedure := to_regprocedure(
    'public.save_project_programming_batch_full_decimal(uuid,uuid,uuid,uuid[],date,text,time,time,integer,text,text,text,jsonb,jsonb,uuid,integer,integer,integer,numeric,integer,uuid,time,time,text,integer,text,text,uuid,boolean,boolean)'
  );
begin
  if v_signature is null then
    raise exception 'Falha ao publicar a RPC decimal em lote com nome compativel com PostgREST.';
  end if;

  if has_function_privilege('anon', v_signature, 'EXECUTE')
    or has_function_privilege('authenticated', v_signature, 'EXECUTE')
    or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'Privilegios invalidos na RPC decimal em lote da Programacao.';
  end if;
end;
$$;
