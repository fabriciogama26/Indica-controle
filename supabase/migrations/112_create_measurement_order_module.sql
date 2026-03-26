-- 112_create_measurement_order_module.sql
-- Modulo de Ordem de Medicao com tabelas, RLS e RPCs transacionais.

create table if not exists public.project_measurement_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_number text not null,
  programming_id uuid null references public.project_programming(id) on delete set null,
  project_id uuid not null references public.project(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  execution_date date not null,
  measurement_date date not null,
  voice_point numeric not null,
  manual_rate numeric not null,
  status text not null default 'ABERTA',
  notes text null,
  project_code_snapshot text not null,
  team_name_snapshot text not null,
  foreman_name_snapshot text null,
  is_active boolean not null default true,
  cancellation_reason text null,
  canceled_at timestamptz null,
  canceled_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint project_measurement_orders_order_number_not_blank check (btrim(order_number) <> ''),
  constraint project_measurement_orders_status_check check (status in ('ABERTA', 'FECHADA', 'CANCELADA')),
  constraint project_measurement_orders_voice_point_check check (voice_point > 0),
  constraint project_measurement_orders_manual_rate_check check (manual_rate > 0),
  constraint project_measurement_orders_reason_not_blank check (cancellation_reason is null or btrim(cancellation_reason) <> ''),
  constraint project_measurement_orders_unique_order_number unique (tenant_id, order_number)
);

create unique index if not exists idx_project_measurement_orders_programming_unique
  on public.project_measurement_orders (tenant_id, programming_id)
  where programming_id is not null;

create index if not exists idx_project_measurement_orders_tenant_exec_status
  on public.project_measurement_orders (tenant_id, execution_date, status, updated_at desc);

create index if not exists idx_project_measurement_orders_tenant_project_team
  on public.project_measurement_orders (tenant_id, project_id, team_id, updated_at desc);

alter table if exists public.project_measurement_orders enable row level security;

drop policy if exists project_measurement_orders_tenant_select on public.project_measurement_orders;
create policy project_measurement_orders_tenant_select on public.project_measurement_orders
for select to authenticated
using (public.user_can_access_tenant(project_measurement_orders.tenant_id));

drop policy if exists project_measurement_orders_tenant_insert on public.project_measurement_orders;
create policy project_measurement_orders_tenant_insert on public.project_measurement_orders
for insert to authenticated
with check (public.user_can_access_tenant(project_measurement_orders.tenant_id));

drop policy if exists project_measurement_orders_tenant_update on public.project_measurement_orders;
create policy project_measurement_orders_tenant_update on public.project_measurement_orders
for update to authenticated
using (public.user_can_access_tenant(project_measurement_orders.tenant_id))
with check (public.user_can_access_tenant(project_measurement_orders.tenant_id));

drop trigger if exists trg_project_measurement_orders_audit on public.project_measurement_orders;
create trigger trg_project_measurement_orders_audit before insert or update on public.project_measurement_orders
for each row execute function public.apply_audit_fields();

create table if not exists public.project_measurement_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  measurement_order_id uuid not null references public.project_measurement_orders(id) on delete cascade,
  service_activity_id uuid not null references public.service_activities(id) on delete restrict,
  programming_activity_id uuid null references public.project_programming_activities(id) on delete set null,
  project_activity_forecast_id uuid null references public.project_activity_forecast(id) on delete set null,
  activity_code text not null,
  activity_description text not null,
  activity_unit text not null,
  quantity numeric not null,
  voice_point numeric not null,
  manual_rate numeric not null,
  unit_value numeric not null,
  total_value numeric generated always as (voice_point * quantity * manual_rate * unit_value) stored,
  observation text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint project_measurement_order_items_code_not_blank check (btrim(activity_code) <> ''),
  constraint project_measurement_order_items_description_not_blank check (btrim(activity_description) <> ''),
  constraint project_measurement_order_items_unit_not_blank check (btrim(activity_unit) <> ''),
  constraint project_measurement_order_items_qty_check check (quantity > 0),
  constraint project_measurement_order_items_voice_point_check check (voice_point > 0),
  constraint project_measurement_order_items_manual_rate_check check (manual_rate > 0),
  constraint project_measurement_order_items_unit_value_check check (unit_value >= 0)
);

create index if not exists idx_project_measurement_order_items_tenant_order_active
  on public.project_measurement_order_items (tenant_id, measurement_order_id, is_active, updated_at desc);

alter table if exists public.project_measurement_order_items enable row level security;

drop policy if exists project_measurement_order_items_tenant_select on public.project_measurement_order_items;
create policy project_measurement_order_items_tenant_select on public.project_measurement_order_items
for select to authenticated
using (public.user_can_access_tenant(project_measurement_order_items.tenant_id));

drop policy if exists project_measurement_order_items_tenant_insert on public.project_measurement_order_items;
create policy project_measurement_order_items_tenant_insert on public.project_measurement_order_items
for insert to authenticated
with check (public.user_can_access_tenant(project_measurement_order_items.tenant_id));

drop policy if exists project_measurement_order_items_tenant_update on public.project_measurement_order_items;
create policy project_measurement_order_items_tenant_update on public.project_measurement_order_items
for update to authenticated
using (public.user_can_access_tenant(project_measurement_order_items.tenant_id))
with check (public.user_can_access_tenant(project_measurement_order_items.tenant_id));

drop trigger if exists trg_project_measurement_order_items_audit on public.project_measurement_order_items;
create trigger trg_project_measurement_order_items_audit before insert or update on public.project_measurement_order_items
for each row execute function public.apply_audit_fields();

create table if not exists public.project_measurement_order_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  measurement_order_id uuid not null references public.project_measurement_orders(id) on delete cascade,
  action_type text not null,
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_measurement_order_history_action_not_blank check (btrim(action_type) <> ''),
  constraint project_measurement_order_history_reason_not_blank check (reason is null or btrim(reason) <> ''),
  constraint project_measurement_order_history_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint project_measurement_order_history_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_project_measurement_order_history_tenant_order_created
  on public.project_measurement_order_history (tenant_id, measurement_order_id, created_at desc);

alter table if exists public.project_measurement_order_history enable row level security;

drop policy if exists project_measurement_order_history_tenant_select on public.project_measurement_order_history;
create policy project_measurement_order_history_tenant_select on public.project_measurement_order_history
for select to authenticated
using (public.user_can_access_tenant(project_measurement_order_history.tenant_id));

drop policy if exists project_measurement_order_history_tenant_insert on public.project_measurement_order_history;
create policy project_measurement_order_history_tenant_insert on public.project_measurement_order_history
for insert to authenticated
with check (public.user_can_access_tenant(project_measurement_order_history.tenant_id));

create or replace function public.append_project_measurement_order_history_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid,
  p_action_type text default 'UPDATE',
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_type text := upper(nullif(btrim(coalesce(p_action_type, '')), ''));
begin
  if p_tenant_id is null or p_measurement_order_id is null or v_action_type is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_HISTORY_PAYLOAD', 'message', 'Payload de historico invalido.');
  end if;

  insert into public.project_measurement_order_history (
    tenant_id, measurement_order_id, action_type, reason, changes, metadata, created_by
  ) values (
    p_tenant_id, p_measurement_order_id, v_action_type, nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb), p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200);
end;
$$;

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
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or v_item_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_ITEMS', 'message', 'Informe itens validos da ordem de medicao.');
  end if;

  if coalesce(p_measurement_date, null) is null or coalesce(p_voice_point, 0) <= 0 or coalesce(p_manual_rate, 0) <= 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MEASUREMENT_HEADER', 'message', 'Cabecalho da ordem de medicao invalido.');
  end if;

  if p_measurement_order_id is null then
    v_project_id := p_project_id;
    v_team_id := p_team_id;
    v_execution_date := p_execution_date;

    if p_programming_id is not null then
      select pp.project_id, pp.team_id, pp.execution_date, p.sob, t.name, pe.nome
      into v_project_id, v_team_id, v_execution_date, v_project_code, v_team_name, v_foreman_name
      from public.project_programming pp
      join public.project p on p.id = pp.project_id and p.tenant_id = pp.tenant_id
      join public.teams t on t.id = pp.team_id and t.tenant_id = pp.tenant_id
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
        and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para gerar a ordem.');
      end if;

      if exists (
        select 1 from public.project_measurement_orders
        where tenant_id = p_tenant_id and programming_id = p_programming_id
      ) then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.');
      end if;
    end if;

    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios.');
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

    insert into public.project_measurement_orders (
      tenant_id, order_number, programming_id, project_id, team_id, execution_date, measurement_date, voice_point, manual_rate, status,
      notes, project_code_snapshot, team_name_snapshot, foreman_name_snapshot, created_by, updated_by
    ) values (
      p_tenant_id,
      format('OM-%s-%s', to_char(p_measurement_date, 'YYYYMMDD'), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
      p_programming_id, v_project_id, v_team_id, v_execution_date, p_measurement_date, p_voice_point, p_manual_rate, 'ABERTA',
      nullif(btrim(coalesce(p_notes, '')), ''), v_project_code, v_team_name, nullif(btrim(coalesce(v_foreman_name, '')), ''), p_actor_user_id, p_actor_user_id
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

    v_order_id := v_order.id;
    update public.project_measurement_orders
    set
      measurement_date = p_measurement_date,
      voice_point = p_voice_point,
      manual_rate = p_manual_rate,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = v_order_id
    returning updated_at into v_updated_at;

    update public.project_measurement_order_items
    set is_active = false, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and measurement_order_id = v_order_id and is_active = true;

    v_action := 'UPDATE';
  end if;

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
    coalesce(case when nullif(btrim(raw.item ->> 'voicePoint'), '') is not null then replace(raw.item ->> 'voicePoint', ',', '.')::numeric else null end, p_voice_point),
    coalesce(case when nullif(btrim(raw.item ->> 'manualRate'), '') is not null then replace(raw.item ->> 'manualRate', ',', '.')::numeric else null end, p_manual_rate),
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

  perform public.append_project_measurement_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_order_id,
    v_action,
    null,
    jsonb_build_object('itemCount', jsonb_build_object('from', null, 'to', v_item_count::text)),
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

create or replace function public.set_project_measurement_order_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid,
  p_action text,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.project_measurement_orders%rowtype;
  v_target_status text := case when upper(coalesce(p_action, '')) = 'FECHAR' then 'FECHADA' when upper(coalesce(p_action, '')) = 'CANCELAR' then 'CANCELADA' else null end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
begin
  if p_measurement_order_id is null or v_target_status is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STATUS_PAYLOAD', 'message', 'Acao de status invalida.');
  end if;

  select * into v_order
  from public.project_measurement_orders
  where tenant_id = p_tenant_id and id = p_measurement_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MEASUREMENT_ORDER_NOT_FOUND', 'message', 'Ordem nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar status.');
  end if;

  if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'Ordem alterada por outro usuario.');
  end if;

  if v_target_status = 'FECHADA' then
    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Somente ordem ABERTA pode ser fechada.');
    end if;

    update public.project_measurement_orders
    set status = 'FECHADA', is_active = true, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_measurement_order_id
    returning updated_at into v_updated_at;

    perform public.append_project_measurement_order_history_record(
      p_tenant_id, p_actor_user_id, p_measurement_order_id, 'CLOSE', null,
      jsonb_build_object('status', jsonb_build_object('from', v_order.status, 'to', 'FECHADA')),
      jsonb_build_object('source', 'measurement-api')
    );

    return jsonb_build_object('success', true, 'status', 200, 'measurement_order_id', p_measurement_order_id, 'updated_at', v_updated_at, 'measurement_status', 'FECHADA', 'message', 'Ordem fechada com sucesso.');
  end if;

  if v_reason is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'CANCELLATION_REASON_REQUIRED', 'message', 'Motivo do cancelamento e obrigatorio.');
  end if;

  if v_order.status = 'CANCELADA' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', 'Ordem ja esta cancelada.');
  end if;

  update public.project_measurement_orders
  set
    status = 'CANCELADA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_measurement_order_id
  returning updated_at into v_updated_at;

  perform public.append_project_measurement_order_history_record(
    p_tenant_id, p_actor_user_id, p_measurement_order_id, 'CANCEL', v_reason,
    jsonb_build_object('status', jsonb_build_object('from', v_order.status, 'to', 'CANCELADA')),
    jsonb_build_object('source', 'measurement-api')
  );

  return jsonb_build_object('success', true, 'status', 200, 'measurement_order_id', p_measurement_order_id, 'updated_at', v_updated_at, 'measurement_status', 'CANCELADA', 'message', 'Ordem cancelada com sucesso.');
end;
$$;

revoke all on function public.append_project_measurement_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.append_project_measurement_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.append_project_measurement_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb) to service_role;

revoke all on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, jsonb, timestamptz) from public;
grant execute on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, jsonb, timestamptz) to service_role;

revoke all on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_project_measurement_order_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;
