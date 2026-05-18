-- 185_programming_rede_decimal_qty.sql
-- Permite quantidade decimal em REDE na Programacao e preserva escopo por tenant.

alter table if exists public.project_programming
  alter column rede_qty type numeric using rede_qty::numeric,
  alter column rede_qty set default 0;

create or replace function public.set_project_programming_rede_qty_decimal(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_rede_qty numeric default 0,
  p_history_action text default 'UPDATE',
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.project_programming%rowtype;
  v_next public.project_programming%rowtype;
  v_rede_qty numeric := coalesce(p_rede_qty, 0);
  v_history_result jsonb;
  v_action text := upper(nullif(btrim(coalesce(p_history_action, '')), ''));
begin
  if p_tenant_id is null or p_actor_user_id is null or p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REDE_QTY_PAYLOAD',
      'message', 'Payload invalido para salvar REDE decimal da programacao.'
    );
  end if;

  if v_rede_qty < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REDE_QTY',
      'message', 'REDE deve ser maior ou igual a zero.'
    );
  end if;

  if v_action is null then
    v_action := 'UPDATE';
  end if;

  select *
  into v_previous
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para salvar REDE decimal.'
    );
  end if;

  if v_previous.rede_qty is not distinct from v_rede_qty then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'updated_at', v_previous.updated_at,
      'skipped', true
    );
  end if;

  update public.project_programming
  set
    rede_qty = v_rede_qty,
    updated_by = p_actor_user_id,
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning *
  into v_next;

  v_history_result := public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_programming_id,
    v_next.project_id,
    v_next.team_id,
    null,
    v_action,
    nullif(btrim(coalesce(p_history_reason, '')), ''),
    jsonb_build_object(
      'redeQty',
      jsonb_build_object(
        'from', case when v_previous.rede_qty is null then null else v_previous.rede_qty::text end,
        'to', v_next.rede_qty::text
      )
    ),
    coalesce(p_history_metadata, '{}'::jsonb) || jsonb_build_object('field', 'redeQty'),
    v_previous.status,
    v_next.status,
    v_previous.execution_date,
    v_next.execution_date,
    v_previous.team_id,
    v_next.team_id,
    v_previous.start_time,
    v_next.start_time,
    v_previous.end_time,
    v_next.end_time,
    v_previous.etapa_number,
    v_next.etapa_number
  );

  if coalesce((v_history_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_history_result ->> 'status')::integer, 500),
        'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
        'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da REDE decimal.')
      )::text;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'updated_at', v_next.updated_at,
    'skipped', false
  );
end;
$$;

revoke all on function public.set_project_programming_rede_qty_decimal(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  jsonb
) from public;

grant execute on function public.set_project_programming_rede_qty_decimal(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.set_project_programming_rede_qty_decimal(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  jsonb
) to service_role;
