-- 273_define_programming_group_id.sql
-- Define grupo operacional persistido para Programacao.
--
-- Regra:
-- - ETAPA numerica: mesmo tenant + projeto + data + etapa_number.
-- - ETAPA UNICA: mesmo tenant + projeto + data + etapa_unica.
-- - ETAPA FINAL: mesmo tenant + projeto + data + etapa_final.
-- - Sem etapa: grupo proprio por registro.

alter table public.project_programming
  add column if not exists programming_group_id uuid;

with classified as (
  select
    pp.id,
    pp.tenant_id,
    case
      when pp.etapa_number is not null
        and pp.etapa_number >= 1
        and not coalesce(pp.etapa_unica, false)
        and not coalesce(pp.etapa_final, false) then
        'NUMERIC|' || pp.project_id::text || '|' || pp.execution_date::text || '|' || pp.etapa_number::text
      when coalesce(pp.etapa_unica, false) then
        'UNIQUE|' || pp.project_id::text || '|' || pp.execution_date::text
      when coalesce(pp.etapa_final, false) then
        'FINAL|' || pp.project_id::text || '|' || pp.execution_date::text
      else
        'OWN|' || pp.id::text
    end as group_key
  from public.project_programming pp
  where pp.programming_group_id is null
),
group_ids as (
  select
    tenant_id,
    group_key,
    case
      when group_key like 'OWN|%' then split_part(group_key, '|', 2)::uuid
      else gen_random_uuid()
    end as programming_group_id
  from classified
  group by tenant_id, group_key
)
update public.project_programming pp
set programming_group_id = group_ids.programming_group_id
from classified
join group_ids
  on group_ids.tenant_id = classified.tenant_id
 and group_ids.group_key = classified.group_key
where pp.tenant_id = classified.tenant_id
  and pp.id = classified.id
  and pp.programming_group_id is null;

alter table public.project_programming
  alter column programming_group_id set not null;

create index if not exists idx_project_programming_tenant_group
  on public.project_programming (tenant_id, programming_group_id);

create index if not exists idx_project_programming_active_tenant_group
  on public.project_programming (tenant_id, programming_group_id)
  where status in ('PROGRAMADA', 'REPROGRAMADA');

create index if not exists idx_project_programming_group_derivation
  on public.project_programming (tenant_id, project_id, execution_date, etapa_number, etapa_unica, etapa_final);

create or replace function public.resolve_project_programming_group_id(
  p_tenant_id uuid,
  p_project_id uuid,
  p_execution_date date,
  p_etapa_number integer,
  p_etapa_unica boolean,
  p_etapa_final boolean,
  p_current_programming_id uuid default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
begin
  if p_tenant_id is null or p_project_id is null or p_execution_date is null then
    return coalesce(p_current_programming_id, gen_random_uuid());
  end if;

  if p_etapa_number is not null
    and p_etapa_number >= 1
    and not coalesce(p_etapa_unica, false)
    and not coalesce(p_etapa_final, false) then
    select pp.programming_group_id
    into v_group_id
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = p_project_id
      and pp.execution_date = p_execution_date
      and pp.etapa_number = p_etapa_number
      and not coalesce(pp.etapa_unica, false)
      and not coalesce(pp.etapa_final, false)
      and (p_current_programming_id is null or pp.id <> p_current_programming_id)
      and pp.programming_group_id is not null
    order by
      case when pp.status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end,
      pp.created_at asc,
      pp.id asc
    limit 1;

    return coalesce(v_group_id, p_current_programming_id, gen_random_uuid());
  end if;

  if coalesce(p_etapa_unica, false) then
    select pp.programming_group_id
    into v_group_id
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = p_project_id
      and pp.execution_date = p_execution_date
      and coalesce(pp.etapa_unica, false)
      and (p_current_programming_id is null or pp.id <> p_current_programming_id)
      and pp.programming_group_id is not null
    order by
      case when pp.status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end,
      pp.created_at asc,
      pp.id asc
    limit 1;

    return coalesce(v_group_id, p_current_programming_id, gen_random_uuid());
  end if;

  if coalesce(p_etapa_final, false) then
    select pp.programming_group_id
    into v_group_id
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = p_project_id
      and pp.execution_date = p_execution_date
      and coalesce(pp.etapa_final, false)
      and (p_current_programming_id is null or pp.id <> p_current_programming_id)
      and pp.programming_group_id is not null
    order by
      case when pp.status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end,
      pp.created_at asc,
      pp.id asc
    limit 1;

    return coalesce(v_group_id, p_current_programming_id, gen_random_uuid());
  end if;

  return coalesce(p_current_programming_id, gen_random_uuid());
end;
$$;

create or replace function public.assign_project_programming_group_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.programming_group_id := public.resolve_project_programming_group_id(
      new.tenant_id,
      new.project_id,
      new.execution_date,
      new.etapa_number,
      coalesce(new.etapa_unica, false),
      coalesce(new.etapa_final, false),
      new.id
    );
    return new;
  end if;

  if new.programming_group_id is null
    or old.tenant_id is distinct from new.tenant_id
    or old.project_id is distinct from new.project_id
    or old.execution_date is distinct from new.execution_date
    or old.etapa_number is distinct from new.etapa_number
    or coalesce(old.etapa_unica, false) is distinct from coalesce(new.etapa_unica, false)
    or coalesce(old.etapa_final, false) is distinct from coalesce(new.etapa_final, false) then
    new.programming_group_id := public.resolve_project_programming_group_id(
      new.tenant_id,
      new.project_id,
      new.execution_date,
      new.etapa_number,
      coalesce(new.etapa_unica, false),
      coalesce(new.etapa_final, false),
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_programming_assign_group_id on public.project_programming;
create trigger trg_project_programming_assign_group_id
before insert or update of
  tenant_id,
  project_id,
  execution_date,
  etapa_number,
  etapa_unica,
  etapa_final,
  programming_group_id
on public.project_programming
for each row
execute function public.assign_project_programming_group_id();

create or replace function public.cancel_project_programming_group(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_source record;
  v_item record;
  v_result jsonb;
  v_cancelled_programming_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CANCEL_GROUP_PAYLOAD', 'message', 'Informe a programacao e o motivo do cancelamento.');
  end if;

  select pp.id, pp.project_id, pp.team_id, pp.execution_date, pp.updated_at, pp.status, pp.programming_group_id, p.sob
  into v_source
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada ou nao esta mais ativa para cancelamento.');
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_source.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROGRAMMING_CONFLICT', 'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.', 'programming_id', p_programming_id);
  end if;

  for v_item in
    select id, team_id
    from public.project_programming
    where tenant_id = p_tenant_id
      and programming_group_id = v_source.programming_group_id
      and status in ('PROGRAMADA', 'REPROGRAMADA')
    order by team_id, id
    for update
  loop
    v_result := public.set_project_programming_status(
      p_tenant_id,
      p_actor_user_id,
      v_item.id,
      'CANCELADA',
      v_reason,
      case when v_item.id = v_source.id then p_expected_updated_at else null end
    );

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%', jsonb_build_object(
        'success', false,
        'status', coalesce((v_result ->> 'status')::integer, 400),
        'reason', coalesce(v_result ->> 'reason', 'CANCEL_GROUP_ITEM_FAILED'),
        'message', coalesce(v_result ->> 'message', 'Falha ao cancelar uma das programacoes do grupo operacional.'),
        'detail', v_result ->> 'detail',
        'programming_id', v_item.id
      )::text;
    end if;

    v_cancelled_programming_ids := array_append(v_cancelled_programming_ids, coalesce(nullif(v_result ->> 'programming_id', '')::uuid, v_item.id));
    v_affected_count := v_affected_count + 1;
  end loop;

  if v_affected_count = 0 then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_GROUP_NOT_FOUND', 'message', 'Nenhuma programacao ativa encontrada para este grupo operacional.');
  end if;

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', coalesce(v_source.sob, ''),
    'updated_at', v_updated_at,
    'programming_status', 'CANCELADA',
    'affected_count', v_affected_count,
    'cancelled_programming_ids', to_jsonb(v_cancelled_programming_ids),
    'programming_group_id', v_source.programming_group_id,
    'message', format('%s programacao(oes) do grupo operacional do projeto %s em %s cancelada(s) com sucesso.', v_affected_count, coalesce(v_source.sob, v_source.project_id::text), to_char(v_source.execution_date, 'DD/MM/YYYY'))
  );
exception
  when others then
    begin
      v_structured_error := sqlerrm::jsonb;
    exception
      when others then
        v_structured_error := jsonb_build_object('success', false, 'status', 500, 'reason', 'CANCEL_GROUP_FAILED', 'message', 'Falha ao cancelar programacoes do grupo operacional.', 'detail', sqlerrm);
    end;

    return v_structured_error;
end;
$$;

create or replace function public.postpone_project_programming_group(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_execution_date date default null,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_source record;
  v_item record;
  v_result jsonb;
  v_updated_programming_ids uuid[] := array[]::uuid[];
  v_new_programming_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_updated_at timestamptz;
  v_structured_error jsonb;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_POSTPONE_GROUP_PAYLOAD', 'message', 'Informe a programacao e o motivo do adiamento.');
  end if;

  select pp.id, pp.project_id, pp.team_id, pp.execution_date, pp.updated_at, pp.status, pp.programming_group_id, p.sob
  into v_source
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada ou nao esta mais ativa para adiamento.');
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_source.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROGRAMMING_CONFLICT', 'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.');
  end if;

  if p_new_execution_date is not null and p_new_execution_date <= v_source.execution_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'NON_FORWARD_EXECUTION_DATE', 'message', 'Informe uma nova data posterior a data atual da programacao.');
  end if;

  for v_item in
    select id, team_id
    from public.project_programming
    where tenant_id = p_tenant_id
      and programming_group_id = v_source.programming_group_id
      and status in ('PROGRAMADA', 'REPROGRAMADA')
    order by team_id, id
    for update
  loop
    if p_new_execution_date is null then
      v_result := public.set_project_programming_status(
        p_tenant_id,
        p_actor_user_id,
        v_item.id,
        'ADIADA',
        v_reason,
        case when v_item.id = v_source.id then p_expected_updated_at else null end
      );
    else
      v_result := public.postpone_project_programming(
        p_tenant_id,
        p_actor_user_id,
        v_item.id,
        p_new_execution_date,
        v_reason,
        case when v_item.id = v_source.id then p_expected_updated_at else null end
      );
    end if;

    if coalesce((v_result ->> 'success')::boolean, false) = false then
      raise exception '%', jsonb_build_object(
        'success', false,
        'status', coalesce((v_result ->> 'status')::integer, 400),
        'reason', coalesce(v_result ->> 'reason', 'POSTPONE_GROUP_ITEM_FAILED'),
        'message', coalesce(v_result ->> 'message', 'Falha ao adiar uma das programacoes do grupo operacional.'),
        'detail', v_result ->> 'detail',
        'programming_id', v_item.id
      )::text;
    end if;

    v_updated_programming_ids := array_append(v_updated_programming_ids, coalesce(nullif(v_result ->> 'programming_id', '')::uuid, v_item.id));
    if p_new_execution_date is not null and nullif(v_result ->> 'new_programming_id', '') is not null then
      v_new_programming_ids := array_append(v_new_programming_ids, (v_result ->> 'new_programming_id')::uuid);
    end if;
    v_affected_count := v_affected_count + 1;
  end loop;

  if v_affected_count = 0 then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_GROUP_NOT_FOUND', 'message', 'Nenhuma programacao ativa encontrada para este grupo operacional.');
  end if;

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', coalesce(v_source.sob, ''),
    'updated_at', v_updated_at,
    'affected_count', v_affected_count,
    'updated_programming_ids', to_jsonb(v_updated_programming_ids),
    'new_programming_ids', to_jsonb(v_new_programming_ids),
    'programming_group_id', v_source.programming_group_id,
    'message',
      case
        when p_new_execution_date is null then
          format('%s programacao(oes) do grupo operacional do projeto %s em %s adiada(s) com sucesso.', v_affected_count, coalesce(v_source.sob, v_source.project_id::text), to_char(v_source.execution_date, 'DD/MM/YYYY'))
        else
          format('%s programacao(oes) do grupo operacional do projeto %s em %s adiada(s) com sucesso. Nova data: %s.', v_affected_count, coalesce(v_source.sob, v_source.project_id::text), to_char(v_source.execution_date, 'DD/MM/YYYY'), to_char(p_new_execution_date, 'DD/MM/YYYY'))
      end
  );
exception
  when others then
    begin
      v_structured_error := sqlerrm::jsonb;
    exception
      when others then
        v_structured_error := jsonb_build_object('success', false, 'status', 500, 'reason', 'POSTPONE_GROUP_FAILED', 'message', 'Falha ao adiar programacoes do grupo operacional.', 'detail', sqlerrm);
    end;

    return v_structured_error;
end;
$$;

create or replace function public.sync_project_programming_group_operational_fields(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_row public.project_programming%rowtype;
  v_next public.project_programming%rowtype;
  v_changes jsonb;
  v_history_result jsonb;
  v_updated_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_structured_error jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_source_programming_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_OPERATIONAL_SYNC_PAYLOAD', 'message', 'Informe tenant, usuario e programacao origem para sincronizar campos operacionais.');
  end if;

  select *
  into v_source
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_source_programming_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'SOURCE_PROGRAMMING_NOT_FOUND', 'message', 'Programacao origem nao encontrada para sincronizacao operacional.');
  end if;

  if coalesce(v_source.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object('success', true, 'status', 200, 'affected_count', 0, 'updated_programming_ids', array[]::uuid[], 'message', 'Programacao origem nao esta ativa; nenhuma sincronizacao operacional foi aplicada.');
  end if;

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.programming_group_id = v_source.programming_group_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> v_source.id
      and (
        pp.feeder is distinct from v_source.feeder
        or pp.campo_eletrico is distinct from v_source.campo_eletrico
        or pp.electrical_eq_catalog_id is distinct from v_source.electrical_eq_catalog_id
        or pp.sgd_type_id is distinct from v_source.sgd_type_id
        or pp.affected_customers is distinct from v_source.affected_customers
        or pp.outage_start_time is distinct from v_source.outage_start_time
        or pp.outage_end_time is distinct from v_source.outage_end_time
        or pp.support is distinct from v_source.support
        or pp.support_item_id is distinct from v_source.support_item_id
        or pp.poste_qty is distinct from v_source.poste_qty
        or pp.estrutura_qty is distinct from v_source.estrutura_qty
        or pp.trafo_qty is distinct from v_source.trafo_qty
        or pp.rede_qty is distinct from v_source.rede_qty
      )
    order by pp.created_at asc, pp.id asc
    for update
  loop
    v_changes := jsonb_build_object(
      'operationalGroupSync',
      jsonb_build_object(
        'fromProgrammingId', v_row.id,
        'toProgrammingId', v_source.id,
        'programmingGroupId', v_source.programming_group_id
      )
    );

    update public.project_programming
    set
      feeder = v_source.feeder,
      campo_eletrico = v_source.campo_eletrico,
      electrical_eq_catalog_id = v_source.electrical_eq_catalog_id,
      sgd_type_id = v_source.sgd_type_id,
      affected_customers = coalesce(v_source.affected_customers, 0),
      outage_start_time = v_source.outage_start_time,
      outage_end_time = v_source.outage_end_time,
      support = v_source.support,
      support_item_id = v_source.support_item_id,
      poste_qty = coalesce(v_source.poste_qty, 0),
      estrutura_qty = coalesce(v_source.estrutura_qty, 0),
      trafo_qty = coalesce(v_source.trafo_qty, 0),
      rede_qty = coalesce(v_source.rede_qty, 0),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_row.id
    returning *
    into v_next;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_programming_id => v_next.id,
      p_project_id => v_next.project_id,
      p_team_id => v_next.team_id,
      p_related_programming_id => v_source.id,
      p_action_type => 'UPDATE',
      p_reason => 'Sincronizacao automatica de campos operacionais por grupo operacional.',
      p_changes => v_changes,
      p_metadata => jsonb_build_object(
        'source', 'programming-operational-fields-group-sync',
        'syncSourceProgrammingId', v_source.id,
        'programmingGroupId', v_source.programming_group_id,
        'scope', 'programming_group_id'
      ),
      p_from_status => v_row.status,
      p_to_status => v_next.status,
      p_from_execution_date => v_row.execution_date,
      p_to_execution_date => v_next.execution_date,
      p_from_team_id => v_row.team_id,
      p_to_team_id => v_next.team_id,
      p_from_start_time => v_row.start_time,
      p_to_start_time => v_next.start_time,
      p_from_end_time => v_row.end_time,
      p_to_end_time => v_next.end_time,
      p_from_etapa_number => v_row.etapa_number,
      p_to_etapa_number => v_next.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%', jsonb_build_object('success', false, 'status', coalesce((v_history_result ->> 'status')::integer, 500), 'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'), 'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da sincronizacao operacional.'))::text;
    end if;

    v_affected_count := v_affected_count + 1;
    v_updated_ids := array_append(v_updated_ids, v_next.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'affected_count', v_affected_count,
    'updated_programming_ids', v_updated_ids,
    'programming_group_id', v_source.programming_group_id,
    'message', case when v_affected_count = 0 then 'Nenhuma programacao do grupo operacional precisava sincronizar campos operacionais.' else 'Campos operacionais sincronizados por grupo operacional.' end
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'SYNC_OPERATIONAL_FIELDS_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao sincronizar campos operacionais da programacao.'),
      'detail', case when v_structured_error is null then sqlerrm else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message') end
    );
end;
$$;

revoke all on function public.cancel_project_programming_group(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.postpone_project_programming_group(uuid, uuid, uuid, date, text, timestamptz) from public, anon, authenticated;
revoke all on function public.sync_project_programming_group_operational_fields(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.cancel_project_programming_group(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.postpone_project_programming_group(uuid, uuid, uuid, date, text, timestamptz) to service_role;
grant execute on function public.sync_project_programming_group_operational_fields(uuid, uuid, uuid) to service_role;

do $$
declare
  v_missing_count integer;
begin
  select count(*)
  into v_missing_count
  from public.project_programming
  where programming_group_id is null;

  if v_missing_count > 0 then
    raise exception 'programming_group_id nao foi preenchido para % programacoes.', v_missing_count;
  end if;
end;
$$;
