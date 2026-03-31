-- Suporta Medicao com e sem producao na mesma tela,
-- com catalogo de motivos por tenant e validacao na RPC principal e no lote.

create table if not exists public.measurement_no_production_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint measurement_no_production_reasons_code_not_blank check (btrim(code) <> ''),
  constraint measurement_no_production_reasons_name_not_blank check (btrim(name) <> ''),
  constraint measurement_no_production_reasons_unique_code unique (tenant_id, code)
);

create index if not exists idx_measurement_no_production_reasons_tenant_active
  on public.measurement_no_production_reasons (tenant_id, is_active, sort_order, name);

alter table if exists public.measurement_no_production_reasons enable row level security;

drop policy if exists measurement_no_production_reasons_tenant_select on public.measurement_no_production_reasons;
create policy measurement_no_production_reasons_tenant_select on public.measurement_no_production_reasons
for select to authenticated
using (public.user_can_access_tenant(measurement_no_production_reasons.tenant_id));

drop policy if exists measurement_no_production_reasons_tenant_insert on public.measurement_no_production_reasons;
create policy measurement_no_production_reasons_tenant_insert on public.measurement_no_production_reasons
for insert to authenticated
with check (public.user_can_access_tenant(measurement_no_production_reasons.tenant_id));

drop policy if exists measurement_no_production_reasons_tenant_update on public.measurement_no_production_reasons;
create policy measurement_no_production_reasons_tenant_update on public.measurement_no_production_reasons
for update to authenticated
using (public.user_can_access_tenant(measurement_no_production_reasons.tenant_id))
with check (public.user_can_access_tenant(measurement_no_production_reasons.tenant_id));

drop trigger if exists trg_measurement_no_production_reasons_audit on public.measurement_no_production_reasons;
create trigger trg_measurement_no_production_reasons_audit before insert or update on public.measurement_no_production_reasons
for each row execute function public.apply_audit_fields();

insert into public.measurement_no_production_reasons (tenant_id, code, name, sort_order)
select
  t.id,
  defaults.code,
  defaults.name,
  defaults.sort_order
from public.tenants t
cross join (
  values
    ('APOIO', 'Apoio', 10),
    ('ADIANTAMENTO_PROJETO', 'Adiantamento de projeto', 20),
    ('VEICULO_MANUTENCAO', 'Veiculo em manutencao', 30),
    ('EQUIPE_INCOMPLETA', 'Equipe incompleta', 40)
) as defaults(code, name, sort_order)
where not exists (
  select 1
  from public.measurement_no_production_reasons existing
  where existing.tenant_id = t.id
    and existing.code = defaults.code
);

alter table if exists public.project_measurement_orders
  add column if not exists measurement_kind text not null default 'COM_PRODUCAO',
  add column if not exists no_production_reason_id uuid null references public.measurement_no_production_reasons(id) on delete restrict,
  add column if not exists no_production_reason_name_snapshot text null;

update public.project_measurement_orders
set
  measurement_kind = 'COM_PRODUCAO',
  no_production_reason_id = null,
  no_production_reason_name_snapshot = null
where measurement_kind is distinct from 'COM_PRODUCAO'
   or no_production_reason_id is not null
   or no_production_reason_name_snapshot is not null;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_measurement_kind_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_measurement_kind_check
  check (measurement_kind in ('COM_PRODUCAO', 'SEM_PRODUCAO'));

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_no_production_reason_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_no_production_reason_check
  check (
    (measurement_kind = 'COM_PRODUCAO' and no_production_reason_id is null and no_production_reason_name_snapshot is null)
    or
    (measurement_kind = 'SEM_PRODUCAO' and no_production_reason_id is not null and btrim(coalesce(no_production_reason_name_snapshot, '')) <> '')
  );

drop function if exists public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, jsonb, timestamptz);

create or replace function public.save_project_measurement_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid default null,
  p_programming_id uuid default null,
  p_project_id uuid default null,
  p_team_id uuid default null,
  p_execution_date date default null,
  p_measurement_date date default null,
  p_voice_point numeric default null,
  p_manual_rate numeric default null,
  p_notes text default null,
  p_measurement_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.project_measurement_orders%rowtype;
  v_order_id uuid;
  v_updated_at timestamptz;
  v_project_id uuid;
  v_team_id uuid;
  v_execution_date date;
  v_project_code text;
  v_team_name text;
  v_foreman_name text;
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_items, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_action text;
  v_link_programming_id uuid := p_programming_id;
  v_programming_completion_status text;
  v_programming_completion_updated_at timestamptz;
  v_previous_item_count integer := 0;
  v_changes jsonb := '{}'::jsonb;
  v_valid_activity_count integer := 0;
  v_distinct_activity_count integer := 0;
  v_measurement_kind text := upper(nullif(btrim(coalesce(p_measurement_kind, '')), ''));
  v_no_production_reason_id uuid := p_no_production_reason_id;
  v_no_production_reason_name text;
  v_effective_voice_point numeric;
  v_effective_manual_rate numeric;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Informe itens validos da ordem de medicao.');
  end if;

  if v_measurement_kind not in ('COM_PRODUCAO', 'SEM_PRODUCAO') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_KIND', 'message', 'Tipo da medicao invalido.');
  end if;

  if p_measurement_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_HEADER', 'message', 'Cabecalho da ordem de medicao invalido.');
  end if;

  if v_measurement_kind = 'SEM_PRODUCAO' then
    if v_item_count <> 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'NO_PRODUCTION_ORDER_WITH_ITEMS', 'message', 'Ordem sem producao nao pode conter atividades.');
    end if;

    if v_no_production_reason_id is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'NO_PRODUCTION_REASON_REQUIRED', 'message', 'Motivo de sem producao e obrigatorio.');
    end if;

    select name
    into v_no_production_reason_name
    from public.measurement_no_production_reasons
    where tenant_id = p_tenant_id
      and id = v_no_production_reason_id
      and is_active = true;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NO_PRODUCTION_REASON_NOT_FOUND', 'message', 'Motivo de sem producao invalido.');
    end if;

    v_effective_voice_point := case when coalesce(p_voice_point, 0) > 0 then p_voice_point else 1 end;
    v_effective_manual_rate := case when coalesce(p_manual_rate, 0) > 0 then p_manual_rate else 1 end;
  else
    if v_item_count = 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Informe itens validos da ordem de medicao.');
    end if;

    if coalesce(p_voice_point, 0) <= 0 or coalesce(p_manual_rate, 0) <= 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_HEADER', 'message', 'Cabecalho da ordem de medicao invalido.');
    end if;

    v_effective_voice_point := p_voice_point;
    v_effective_manual_rate := p_manual_rate;
    v_no_production_reason_id := null;
    v_no_production_reason_name := null;

    select
      count(*),
      count(distinct source.activity_id)
    into
      v_valid_activity_count,
      v_distinct_activity_count
    from (
      select sa.id as activity_id
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as raw(item)
      join public.service_activities sa
        on sa.tenant_id = p_tenant_id
       and sa.id = case when coalesce(nullif(btrim(raw.item ->> 'activityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'activityId')::uuid else null end
       and sa.ativo = true
    ) as source;

    if v_valid_activity_count > v_distinct_activity_count then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'DUPLICATE_MEASUREMENT_ACTIVITY',
        'message', 'A mesma atividade nao pode ser repetida na ordem de medicao.'
      );
    end if;
  end if;

  if p_measurement_order_id is null then
    v_project_id := p_project_id;
    v_team_id := p_team_id;
    v_execution_date := p_execution_date;

    if p_programming_id is not null then
      select
        pp.id,
        pp.project_id,
        pp.team_id,
        pp.execution_date,
        p.sob,
        t.name,
        pe.nome,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_project_id,
        v_team_id,
        v_execution_date,
        v_project_code,
        v_team_name,
        v_foreman_name,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      join public.project p on p.id = pp.project_id and p.tenant_id = pp.tenant_id
      join public.teams t on t.id = pp.team_id and t.tenant_id = pp.tenant_id
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para gerar a ordem.');
      end if;
    end if;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios.');
    end if;

    if v_link_programming_id is null then
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_project_id
        and pp.team_id = v_team_id
        and pp.execution_date = v_execution_date
      order by
        case pp.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        pp.updated_at desc
      limit 1;
    end if;

    if v_link_programming_id is not null and exists (
      select 1 from public.project_measurement_orders
      where tenant_id = p_tenant_id and programming_id = v_link_programming_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
    end if;

    if v_project_code is null then
      select sob into v_project_code from public.project where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
      end if;
    end if;

    if v_team_name is null then
      select t.name, pe.nome
      into v_team_name, v_foreman_name
      from public.teams t
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where t.tenant_id = p_tenant_id and t.id = v_team_id and t.ativo = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe invalida para ordem de medicao.');
      end if;
    end if;

    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));
    if v_programming_completion_status not in ('CONCLUIDO', 'PARCIAL') then
      v_programming_completion_status := null;
    end if;

    insert into public.project_measurement_orders (
      tenant_id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, status,
      notes, measurement_kind, no_production_reason_id, no_production_reason_name_snapshot,
      project_code_snapshot, team_name_snapshot, foreman_name_snapshot, programming_completion_status_snapshot, programming_completion_status_snapshot_at, created_by, updated_by
    ) values (
      p_tenant_id,
      format('OM-%s-%s', to_char(p_measurement_date, 'YYYYMMDD'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
      v_link_programming_id, v_project_id, v_team_id, v_execution_date, p_measurement_date, v_effective_voice_point, v_effective_manual_rate, 'ABERTA',
      nullif(btrim(coalesce(p_notes, '')), ''), v_measurement_kind, v_no_production_reason_id, v_no_production_reason_name,
      v_project_code, v_team_name, nullif(btrim(coalesce(v_foreman_name, '')), ''), v_programming_completion_status, case when v_programming_completion_status is null then null else coalesce(v_programming_completion_updated_at, now()) end, p_actor_user_id, p_actor_user_id
    ) returning id, updated_at into v_order_id, v_updated_at;

    v_action := 'CREATE';
  else
    select * into v_order
    from public.project_measurement_orders
    where tenant_id = p_tenant_id and id = p_measurement_order_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'MEASUREMENT_ORDER_NOT_FOUND', 'message', 'Ordem de medicao nao encontrada.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar.');
    end if;

    if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'Ordem alterada por outro usuario.');
    end if;

    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_LOCKED', 'message', 'Somente ordem ABERTA pode ser editada.');
    end if;

    v_project_id := p_project_id;
    v_team_id := p_team_id;
    v_execution_date := p_execution_date;
    v_order_id := v_order.id;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios na edicao.');
    end if;

    select sob into v_project_code
    from public.project
    where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
    end if;

    select t.name, pe.nome
    into v_team_name, v_foreman_name
    from public.teams t
    left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
    where t.tenant_id = p_tenant_id and t.id = v_team_id and t.ativo = true;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe invalida para ordem de medicao.');
    end if;

    if p_programming_id is not null then
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para vinculo da ordem.');
      end if;
    else
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_project_id
        and pp.team_id = v_team_id
        and pp.execution_date = v_execution_date
      order by
        case pp.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        pp.updated_at desc
      limit 1;
    end if;

    if v_link_programming_id is not null and exists (
      select 1
      from public.project_measurement_orders
      where tenant_id = p_tenant_id
        and programming_id = v_link_programming_id
        and id <> v_order_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
    end if;

    v_programming_completion_status := upper(nullif(btrim(coalesce(v_programming_completion_status, '')), ''));
    if v_programming_completion_status not in ('CONCLUIDO', 'PARCIAL') then
      v_programming_completion_status := null;
    end if;

    select count(*)
    into v_previous_item_count
    from public.project_measurement_order_items
    where tenant_id = p_tenant_id
      and measurement_order_id = v_order_id
      and is_active = true;

    if v_order.project_id <> v_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id::text, 'to', v_project_id::text));
    end if;

    if v_order.team_id <> v_team_id then
      v_changes := v_changes || jsonb_build_object('teamId', jsonb_build_object('from', v_order.team_id::text, 'to', v_team_id::text));
    end if;

    if v_order.execution_date <> v_execution_date then
      v_changes := v_changes || jsonb_build_object('executionDate', jsonb_build_object('from', v_order.execution_date::text, 'to', v_execution_date::text));
    end if;

    if v_order.measurement_kind <> v_measurement_kind then
      v_changes := v_changes || jsonb_build_object('measurementKind', jsonb_build_object('from', v_order.measurement_kind, 'to', v_measurement_kind));
    end if;

    if coalesce(v_order.no_production_reason_name_snapshot, '') <> coalesce(v_no_production_reason_name, '') then
      v_changes := v_changes || jsonb_build_object('noProductionReason', jsonb_build_object('from', nullif(v_order.no_production_reason_name_snapshot, ''), 'to', nullif(v_no_production_reason_name, '')));
    end if;

    if v_order.manual_rate <> v_effective_manual_rate then
      v_changes := v_changes || jsonb_build_object('manualRate', jsonb_build_object('from', v_order.manual_rate::text, 'to', v_effective_manual_rate::text));
    end if;

    update public.project_measurement_orders
    set
      programming_id = v_link_programming_id,
      project_id = v_project_id,
      team_id = v_team_id,
      execution_date = v_execution_date,
      measurement_date = p_measurement_date,
      voice_point = v_effective_voice_point,
      manual_rate = v_effective_manual_rate,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      measurement_kind = v_measurement_kind,
      no_production_reason_id = v_no_production_reason_id,
      no_production_reason_name_snapshot = v_no_production_reason_name,
      project_code_snapshot = v_project_code,
      team_name_snapshot = v_team_name,
      foreman_name_snapshot = nullif(btrim(coalesce(v_foreman_name, '')), ''),
      programming_completion_status_snapshot = v_programming_completion_status,
      programming_completion_status_snapshot_at = case when v_programming_completion_status is null then null else coalesce(v_programming_completion_updated_at, now()) end,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = v_order_id
    returning updated_at into v_updated_at;

    update public.project_measurement_order_items
    set is_active = false, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and measurement_order_id = v_order_id and is_active = true;

    v_action := 'UPDATE';
  end if;

  if v_measurement_kind = 'COM_PRODUCAO' then
    insert into public.project_measurement_order_items (
      tenant_id, measurement_order_id, service_activity_id, programming_activity_id, project_activity_forecast_id,
      activity_code, activity_description, activity_unit, quantity, voice_point, manual_rate, unit_value, observation, is_active, created_by, updated_by
    )
    select
      p_tenant_id,
      v_order_id,
      sa.id,
      case when coalesce(nullif(btrim(raw.item ->> 'programmingActivityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'programmingActivityId')::uuid else null end,
      case when coalesce(nullif(btrim(raw.item ->> 'projectActivityForecastId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'projectActivityForecastId')::uuid else null end,
      sa.code,
      sa.description,
      sa.unit,
      replace(raw.item ->> 'quantity', ',', '.')::numeric,
      coalesce(case when nullif(btrim(raw.item ->> 'voicePoint'), '') is not null then replace(raw.item ->> 'voicePoint', ',', '.')::numeric else null end, sa.voice_point, v_effective_voice_point),
      v_effective_manual_rate,
      coalesce(case when nullif(btrim(raw.item ->> 'unitValue'), '') is not null then replace(raw.item ->> 'unitValue', ',', '.')::numeric else null end, sa.unit_value),
      nullif(btrim(coalesce(raw.item ->> 'observation', '')), ''),
      true,
      p_actor_user_id,
      p_actor_user_id
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as raw(item)
    join public.service_activities sa
      on sa.tenant_id = p_tenant_id
     and sa.id = case when coalesce(nullif(btrim(raw.item ->> 'activityId'), ''), '') ~* '^[0-9a-f-]{36}$' then (raw.item ->> 'activityId')::uuid else null end
     and sa.ativo = true
    where replace(raw.item ->> 'quantity', ',', '.')::numeric > 0;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count <> v_item_count then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Ha atividades invalidas na ordem de medicao.');
    end if;
  end if;

  perform public.append_project_measurement_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_order_id,
    v_action,
    null,
    case
      when v_action = 'UPDATE' then
        v_changes || jsonb_build_object('itemCount', jsonb_build_object('from', v_previous_item_count::text, 'to', v_item_count::text))
      else
        jsonb_build_object('itemCount', jsonb_build_object('from', null, 'to', v_item_count::text))
    end,
    jsonb_build_object('source', 'measurement-api')
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'measurement_order_id', v_order_id,
    'updated_at', v_updated_at,
    'message', case when v_action = 'CREATE' then 'Ordem de medicao criada com sucesso.' else 'Ordem de medicao atualizada com sucesso.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
  when others then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'SAVE_MEASUREMENT_ORDER_FAILED', 'message', format('Falha ao salvar ordem de medicao: %s', sqlerrm));
end;
$$;

create or replace function public.save_project_measurement_order_batch_partial(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_row_json jsonb;
  v_row_index integer;
  v_row_numbers jsonb;
  v_row_count integer;
  v_programming_id uuid;
  v_project_id uuid;
  v_team_id uuid;
  v_execution_date date;
  v_measurement_date date;
  v_manual_rate numeric;
  v_voice_point numeric;
  v_notes text;
  v_measurement_kind text;
  v_no_production_reason_id uuid;
  v_items jsonb;
  v_context_key text;
  v_save_result jsonb;
  v_save_success boolean;
  v_save_reason text;
  v_save_message text;
  v_saved_count integer := 0;
  v_error_count integer := 0;
  v_already_registered_count integer := 0;
  v_already_registered_rows integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_BATCH_CONTEXT',
      'message', 'Contexto invalido para importacao em lote.'
    );
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_BATCH_ROWS',
      'message', 'Nenhuma linha valida enviada para importacao.'
    );
  end if;

  for v_row in
    select row_item.item, row_item.ordinality
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as row_item(item, ordinality)
  loop
    v_row_json := coalesce(v_row.item, '{}'::jsonb);
    v_row_index := v_row.ordinality;
    v_row_numbers := case
      when jsonb_typeof(v_row_json -> 'rowNumbers') = 'array' then coalesce(v_row_json -> 'rowNumbers', '[]'::jsonb)
      else '[]'::jsonb
    end;
    v_row_count := case
      when jsonb_typeof(v_row_numbers) = 'array' then jsonb_array_length(v_row_numbers)
      else 0
    end;

    if v_row_count = 0 then
      v_row_numbers := jsonb_build_array(v_row_index);
      v_row_count := 1;
    end if;

    v_programming_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'programmingId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'programmingId')::uuid
      else null
    end;
    v_project_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'projectId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'projectId')::uuid
      else null
    end;
    v_team_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'teamId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'teamId')::uuid
      else null
    end;
    v_execution_date := case
      when coalesce(nullif(btrim(v_row_json ->> 'executionDate'), ''), '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row_json ->> 'executionDate')::date
      else null
    end;
    v_measurement_date := case
      when coalesce(nullif(btrim(v_row_json ->> 'measurementDate'), ''), '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_row_json ->> 'measurementDate')::date
      else null
    end;
    v_manual_rate := case
      when nullif(btrim(coalesce(v_row_json ->> 'manualRate', '')), '') is not null then replace(v_row_json ->> 'manualRate', ',', '.')::numeric
      else null
    end;
    v_voice_point := case
      when nullif(btrim(coalesce(v_row_json ->> 'voicePoint', '')), '') is not null then replace(v_row_json ->> 'voicePoint', ',', '.')::numeric
      else 1
    end;
    v_notes := nullif(btrim(coalesce(v_row_json ->> 'notes', '')), '');
    v_measurement_kind := upper(coalesce(nullif(btrim(v_row_json ->> 'measurementKind'), ''), 'COM_PRODUCAO'));
    v_no_production_reason_id := case
      when coalesce(nullif(btrim(v_row_json ->> 'noProductionReasonId'), ''), '') ~* '^[0-9a-f-]{36}$' then (v_row_json ->> 'noProductionReasonId')::uuid
      else null
    end;
    v_items := case
      when jsonb_typeof(v_row_json -> 'items') = 'array' then coalesce(v_row_json -> 'items', '[]'::jsonb)
      else '[]'::jsonb
    end;

    if v_programming_id is not null then
      select pp.project_id, pp.team_id, pp.execution_date
      into v_project_id, v_team_id, v_execution_date
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = v_programming_id;

      if not found then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Programacao nao encontrada para a linha importada.'
        ));
        continue;
      end if;
    end if;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', false,
        'reason', 'MISSING_MEASUREMENT_CONTEXT',
        'message', 'Projeto, equipe e data de execucao sao obrigatorios para importar a linha.'
      ));
      continue;
    end if;

    if v_measurement_date is null then
      v_measurement_date := v_execution_date;
    end if;

    if v_measurement_kind = 'SEM_PRODUCAO' then
      if v_manual_rate is null or v_manual_rate <= 0 then
        v_manual_rate := 1;
      end if;
      if v_voice_point is null or v_voice_point <= 0 then
        v_voice_point := 1;
      end if;
    else
      if coalesce(v_manual_rate, 0) <= 0 then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'INVALID_MANUAL_RATE',
          'message', 'Taxa manual invalida na linha importada.'
        ));
        continue;
      end if;

      if coalesce(v_voice_point, 0) <= 0 then
        v_voice_point := 1;
      end if;
    end if;

    v_context_key := format('%s|%s|%s|%s', p_tenant_id::text, v_project_id::text, v_team_id::text, v_execution_date::text);
    perform pg_advisory_xact_lock(hashtext(v_context_key)::bigint);

    if exists (
      select 1
      from public.project_measurement_orders mo
      where mo.tenant_id = p_tenant_id
        and mo.project_id = v_project_id
        and mo.team_id = v_team_id
        and mo.execution_date = v_execution_date
    ) then
      v_already_registered_count := v_already_registered_count + 1;
      v_already_registered_rows := v_already_registered_rows + v_row_count;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', true,
        'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS',
        'message', 'Linha ignorada: medicao ja cadastrada para Projeto + Equipe + Data.'
      ));
      continue;
    end if;

    begin
      v_save_result := public.save_project_measurement_order(
        p_tenant_id,
        p_actor_user_id,
        null,
        v_programming_id,
        v_project_id,
        v_team_id,
        v_execution_date,
        v_measurement_date,
        v_voice_point,
        v_manual_rate,
        v_notes,
        v_measurement_kind,
        v_no_production_reason_id,
        v_items,
        null
      );
    exception
      when others then
        v_save_result := jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_MEASUREMENT_ORDER_FAILED',
          'message', format('Falha ao salvar ordem no lote: %s', sqlerrm)
        );
    end;

    v_save_success := lower(coalesce(v_save_result ->> 'success', 'false')) = 'true';
    v_save_reason := upper(coalesce(v_save_result ->> 'reason', ''));
    v_save_message := coalesce(v_save_result ->> 'message', 'Falha ao salvar ordem de medicao no lote.');

    if v_save_success then
      v_saved_count := v_saved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', true,
        'alreadyRegistered', false,
        'reason', null,
        'message', v_save_message,
        'measurementOrderId', v_save_result ->> 'measurement_order_id'
      ));
      continue;
    end if;

    if v_save_reason = 'MEASUREMENT_ORDER_ALREADY_EXISTS' then
      v_already_registered_count := v_already_registered_count + 1;
      v_already_registered_rows := v_already_registered_rows + v_row_count;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowIndex', v_row_index,
        'rowNumbers', v_row_numbers,
        'success', false,
        'alreadyRegistered', true,
        'reason', v_save_reason,
        'message', v_save_message
      ));
      continue;
    end if;

    v_error_count := v_error_count + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'rowIndex', v_row_index,
      'rowNumbers', v_row_numbers,
      'success', false,
      'alreadyRegistered', false,
      'reason', nullif(v_save_reason, ''),
      'message', v_save_message
    ));
  end loop;

  return jsonb_build_object(
    'success', v_saved_count > 0 and v_error_count = 0,
    'status', case
      when v_saved_count > 0 and v_error_count = 0 then 200
      when v_saved_count > 0 then 207
      else 400
    end,
    'reason', case
      when v_saved_count > 0 and v_error_count = 0 then null
      when v_saved_count > 0 then 'BATCH_PARTIAL_SUCCESS'
      else 'BATCH_IMPORT_FAILED'
    end,
    'message', case
      when v_saved_count > 0 and v_error_count = 0 then 'Importacao concluida com sucesso.'
      when v_saved_count > 0 then 'Importacao concluida parcialmente.'
      else 'Importacao sem sucesso.'
    end,
    'savedCount', v_saved_count,
    'errorCount', v_error_count,
    'alreadyRegisteredCount', v_already_registered_count,
    'alreadyRegisteredRows', v_already_registered_rows,
    'results', v_results
  );
end;
$$;

revoke all on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz) from public;
grant execute on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz) to service_role;

revoke all on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) from public;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to service_role;
