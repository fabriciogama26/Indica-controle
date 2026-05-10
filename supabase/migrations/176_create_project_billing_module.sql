-- 176_create_project_billing_module.sql
-- Modulo de Faturamento por projeto com itens pagos, RLS, historico e RPCs transacionais.

create table if not exists public.project_billing_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_number text not null,
  project_id uuid not null references public.project(id) on delete restrict,
  billing_kind text not null default 'COM_PRODUCAO',
  no_production_reason_id uuid null references public.measurement_no_production_reasons(id) on delete restrict,
  no_production_reason_name_snapshot text null,
  status text not null default 'ABERTA',
  notes text null,
  project_code_snapshot text not null,
  is_active boolean not null default true,
  cancellation_reason text null,
  canceled_at timestamptz null,
  canceled_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint project_billing_orders_number_not_blank check (btrim(billing_number) <> ''),
  constraint project_billing_orders_kind_check check (billing_kind in ('COM_PRODUCAO', 'SEM_PRODUCAO')),
  constraint project_billing_orders_status_check check (status in ('ABERTA', 'FECHADA', 'CANCELADA')),
  constraint project_billing_orders_reason_not_blank check (cancellation_reason is null or btrim(cancellation_reason) <> ''),
  constraint project_billing_orders_sem_producao_reason_check check (
    (billing_kind = 'SEM_PRODUCAO' and no_production_reason_id is not null)
    or (billing_kind = 'COM_PRODUCAO' and no_production_reason_id is null)
  ),
  constraint project_billing_orders_unique_number unique (tenant_id, billing_number)
);

create index if not exists idx_project_billing_orders_tenant_status
  on public.project_billing_orders (tenant_id, status, updated_at desc);

create index if not exists idx_project_billing_orders_tenant_project
  on public.project_billing_orders (tenant_id, project_id, updated_at desc);

alter table if exists public.project_billing_orders enable row level security;

drop policy if exists project_billing_orders_tenant_select on public.project_billing_orders;
create policy project_billing_orders_tenant_select on public.project_billing_orders
for select to authenticated
using (public.user_can_access_tenant(project_billing_orders.tenant_id));

drop policy if exists project_billing_orders_tenant_insert on public.project_billing_orders;
create policy project_billing_orders_tenant_insert on public.project_billing_orders
for insert to authenticated
with check (public.user_can_access_tenant(project_billing_orders.tenant_id));

drop policy if exists project_billing_orders_tenant_update on public.project_billing_orders;
create policy project_billing_orders_tenant_update on public.project_billing_orders
for update to authenticated
using (public.user_can_access_tenant(project_billing_orders.tenant_id))
with check (public.user_can_access_tenant(project_billing_orders.tenant_id));

drop trigger if exists trg_project_billing_orders_audit on public.project_billing_orders;
create trigger trg_project_billing_orders_audit before insert or update on public.project_billing_orders
for each row execute function public.apply_audit_fields();

create table if not exists public.project_billing_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_order_id uuid not null references public.project_billing_orders(id) on delete cascade,
  service_activity_id uuid not null references public.service_activities(id) on delete restrict,
  activity_code text not null,
  activity_description text not null,
  activity_unit text not null,
  voice_point numeric not null,
  quantity numeric not null,
  rate numeric not null,
  unit_value numeric not null,
  activity_active_snapshot boolean not null default true,
  total_value numeric generated always as (voice_point * quantity * rate * unit_value) stored,
  observation text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.app_users(id) on delete set null,
  updated_by uuid null references public.app_users(id) on delete set null,
  constraint project_billing_order_items_code_not_blank check (btrim(activity_code) <> ''),
  constraint project_billing_order_items_description_not_blank check (btrim(activity_description) <> ''),
  constraint project_billing_order_items_unit_not_blank check (btrim(activity_unit) <> ''),
  constraint project_billing_order_items_voice_point_check check (voice_point > 0),
  constraint project_billing_order_items_quantity_check check (quantity > 0),
  constraint project_billing_order_items_rate_check check (rate > 0),
  constraint project_billing_order_items_unit_value_check check (unit_value >= 0)
);

create index if not exists idx_project_billing_order_items_tenant_order_active
  on public.project_billing_order_items (tenant_id, billing_order_id, is_active, updated_at desc);

alter table if exists public.project_billing_order_items
  add column if not exists activity_active_snapshot boolean not null default true;

create unique index if not exists idx_project_billing_order_items_unique_active_activity
  on public.project_billing_order_items (tenant_id, billing_order_id, service_activity_id)
  where is_active = true;

alter table if exists public.project_billing_order_items enable row level security;

drop policy if exists project_billing_order_items_tenant_select on public.project_billing_order_items;
create policy project_billing_order_items_tenant_select on public.project_billing_order_items
for select to authenticated
using (public.user_can_access_tenant(project_billing_order_items.tenant_id));

drop policy if exists project_billing_order_items_tenant_insert on public.project_billing_order_items;
create policy project_billing_order_items_tenant_insert on public.project_billing_order_items
for insert to authenticated
with check (public.user_can_access_tenant(project_billing_order_items.tenant_id));

drop policy if exists project_billing_order_items_tenant_update on public.project_billing_order_items;
create policy project_billing_order_items_tenant_update on public.project_billing_order_items
for update to authenticated
using (public.user_can_access_tenant(project_billing_order_items.tenant_id))
with check (public.user_can_access_tenant(project_billing_order_items.tenant_id));

drop trigger if exists trg_project_billing_order_items_audit on public.project_billing_order_items;
create trigger trg_project_billing_order_items_audit before insert or update on public.project_billing_order_items
for each row execute function public.apply_audit_fields();

create table if not exists public.project_billing_order_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_order_id uuid not null references public.project_billing_orders(id) on delete cascade,
  action_type text not null,
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_billing_order_history_action_not_blank check (btrim(action_type) <> ''),
  constraint project_billing_order_history_reason_not_blank check (reason is null or btrim(reason) <> ''),
  constraint project_billing_order_history_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint project_billing_order_history_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_project_billing_order_history_tenant_order_created
  on public.project_billing_order_history (tenant_id, billing_order_id, created_at desc);

alter table if exists public.project_billing_order_history enable row level security;

drop policy if exists project_billing_order_history_tenant_select on public.project_billing_order_history;
create policy project_billing_order_history_tenant_select on public.project_billing_order_history
for select to authenticated
using (public.user_can_access_tenant(project_billing_order_history.tenant_id));

drop policy if exists project_billing_order_history_tenant_insert on public.project_billing_order_history;
create policy project_billing_order_history_tenant_insert on public.project_billing_order_history
for insert to authenticated
with check (public.user_can_access_tenant(project_billing_order_history.tenant_id));

create or replace function public.append_project_billing_order_history_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_billing_order_id uuid,
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
  if p_tenant_id is null or p_billing_order_id is null or v_action_type is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_HISTORY_PAYLOAD', 'message', 'Payload de historico invalido.');
  end if;

  insert into public.project_billing_order_history (
    tenant_id, billing_order_id, action_type, reason, changes, metadata, created_by
  ) values (
    p_tenant_id, p_billing_order_id, v_action_type, nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_changes, '{}'::jsonb), coalesce(p_metadata, '{}'::jsonb), p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200);
end;
$$;

create or replace function public.save_project_billing_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_billing_order_id uuid default null,
  p_project_id uuid default null,
  p_billing_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
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
  v_order public.project_billing_orders%rowtype;
  v_order_id uuid;
  v_updated_at timestamptz;
  v_project_code text;
  v_reason_name text;
  v_billing_kind text := upper(nullif(btrim(coalesce(p_billing_kind, 'COM_PRODUCAO')), ''));
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_items, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_action text;
  v_item jsonb;
  v_activity public.service_activities%rowtype;
  v_activity_id uuid;
  v_quantity numeric;
  v_rate numeric;
  v_changes jsonb := '{}'::jsonb;
  v_old_item_count integer := 0;
  v_old_total_amount numeric := 0;
  v_new_total_amount numeric := 0;
  v_old_items jsonb := '[]'::jsonb;
  v_new_items jsonb := '[]'::jsonb;
begin
  if v_billing_kind not in ('COM_PRODUCAO', 'SEM_PRODUCAO') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_KIND', 'message', 'Tipo de faturamento invalido.');
  end if;

  if p_project_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_PROJECT', 'message', 'Projeto e obrigatorio para o faturamento.');
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or v_item_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_ITEMS', 'message', 'Informe itens validos do faturamento.');
  end if;

  select p.sob
  into v_project_code
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  if v_billing_kind = 'SEM_PRODUCAO' then
    select r.name
    into v_reason_name
    from public.measurement_no_production_reasons r
    where r.tenant_id = p_tenant_id
      and r.id = p_no_production_reason_id
      and r.is_active = true;

    if not found then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'NO_PRODUCTION_REASON_NOT_FOUND', 'message', 'Motivo de sem producao nao encontrado.');
    end if;
  else
    p_no_production_reason_id := null;
    v_reason_name := null;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_activity_id := nullif(v_item->>'activityId', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;

    if v_activity_id is null
      or coalesce(v_quantity, 0) <= 0
      or coalesce(v_rate, 0) <= 0
    then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_ITEM', 'message', 'Item de faturamento invalido.');
    end if;

    if (
      select count(*)
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) repeated
      where nullif(repeated->>'activityId', '')::uuid = v_activity_id
    ) > 1 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATE_BILLING_ACTIVITY', 'message', 'A mesma atividade nao pode se repetir no faturamento.');
    end if;
  end loop;

  if p_billing_order_id is null then
    v_order_id := gen_random_uuid();
    v_action := 'CREATE';
    v_changes := '{}'::jsonb;

    insert into public.project_billing_orders (
      id, tenant_id, billing_number, project_id, billing_kind, no_production_reason_id,
      no_production_reason_name_snapshot, status, notes, project_code_snapshot, created_by, updated_by
    ) values (
      v_order_id,
      p_tenant_id,
      'FAT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      p_project_id,
      v_billing_kind,
      p_no_production_reason_id,
      v_reason_name,
      'ABERTA',
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_order_id, v_updated_at;
  else
    select *
    into v_order
    from public.project_billing_orders
    where tenant_id = p_tenant_id
      and id = p_billing_order_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'BILLING_ORDER_NOT_FOUND', 'message', 'Faturamento nao encontrado.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MISSING_EXPECTED_UPDATED_AT', 'message', 'Atualize a lista antes de editar o faturamento.', 'currentUpdatedAt', v_order.updated_at);
    end if;

    if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STALE_BILLING_ORDER', 'message', 'Faturamento alterado por outro usuario. Recarregue os dados antes de salvar.', 'currentUpdatedAt', v_order.updated_at);
    end if;

    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'BILLING_ORDER_NOT_EDITABLE', 'message', 'Somente faturamento aberto pode ser editado.');
    end if;

    v_order_id := p_billing_order_id;
    v_action := 'UPDATE';

    select
      count(*)::integer,
      coalesce(sum(total_value), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'activityId', service_activity_id,
        'quantity', quantity,
        'rate', rate,
        'activityActiveSnapshot', activity_active_snapshot,
        'observation', observation
      ) order by service_activity_id), '[]'::jsonb)
    into v_old_item_count, v_old_total_amount, v_old_items
    from public.project_billing_order_items
    where tenant_id = p_tenant_id
      and billing_order_id = v_order_id
      and is_active = true;

    update public.project_billing_orders
    set
      project_id = p_project_id,
      billing_kind = v_billing_kind,
      no_production_reason_id = p_no_production_reason_id,
      no_production_reason_name_snapshot = v_reason_name,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      project_code_snapshot = coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
      updated_by = p_actor_user_id,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_order_id
    returning updated_at into v_updated_at;

    update public.project_billing_order_items
    set
      is_active = false,
      updated_by = p_actor_user_id,
      updated_at = now()
    where tenant_id = p_tenant_id
      and billing_order_id = v_order_id
      and is_active = true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_activity_id := nullif(v_item->>'activityId', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;

    select *
    into v_activity
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = v_activity_id;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'BILLING_ACTIVITY_NOT_FOUND', 'message', 'Atividade do faturamento nao encontrada.');
    end if;

    insert into public.project_billing_order_items (
      tenant_id, billing_order_id, service_activity_id, activity_code, activity_description,
      activity_unit, voice_point, quantity, rate, unit_value, activity_active_snapshot, observation, created_by, updated_by
    ) values (
      p_tenant_id,
      v_order_id,
      v_activity.id,
      v_activity.code,
      v_activity.description,
      v_activity.unit,
      coalesce(v_activity.voice_point, 1),
      v_quantity,
      v_rate,
      coalesce(v_activity.unit_value, 0),
      coalesce(v_activity.ativo, false),
      nullif(btrim(coalesce(v_item->>'observation', '')), ''),
      p_actor_user_id,
      p_actor_user_id
    );

    v_inserted_count := v_inserted_count + 1;
  end loop;

  select
    coalesce(sum(total_value), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'activityId', service_activity_id,
      'quantity', quantity,
      'rate', rate,
      'activityActiveSnapshot', activity_active_snapshot,
      'observation', observation
    ) order by service_activity_id), '[]'::jsonb)
  into v_new_total_amount, v_new_items
  from public.project_billing_order_items
  where tenant_id = p_tenant_id
    and billing_order_id = v_order_id
    and is_active = true;

  if v_action = 'UPDATE' then
    if v_order.project_id is distinct from p_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id, 'to', p_project_id));
    end if;
    if v_order.billing_kind is distinct from v_billing_kind then
      v_changes := v_changes || jsonb_build_object('billingKind', jsonb_build_object('from', v_order.billing_kind, 'to', v_billing_kind));
    end if;
    if v_order.no_production_reason_id is distinct from p_no_production_reason_id then
      v_changes := v_changes || jsonb_build_object('noProductionReasonId', jsonb_build_object('from', v_order.no_production_reason_id, 'to', p_no_production_reason_id));
    end if;
    if v_order.notes is distinct from nullif(btrim(coalesce(p_notes, '')), '') then
      v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('from', v_order.notes, 'to', nullif(btrim(coalesce(p_notes, '')), '')));
    end if;
    if v_old_item_count is distinct from v_inserted_count then
      v_changes := v_changes || jsonb_build_object('itemCount', jsonb_build_object('from', v_old_item_count, 'to', v_inserted_count));
    end if;
    if v_old_total_amount is distinct from v_new_total_amount then
      v_changes := v_changes || jsonb_build_object('totalAmount', jsonb_build_object('from', v_old_total_amount, 'to', v_new_total_amount));
    end if;
    if v_old_items is distinct from v_new_items then
      v_changes := v_changes || jsonb_build_object('items', jsonb_build_object('from', v_old_items, 'to', v_new_items));
    end if;
  end if;

  if v_action = 'CREATE' or v_changes <> '{}'::jsonb then
    perform public.append_project_billing_order_history_record(
      p_tenant_id,
      p_actor_user_id,
      v_order_id,
      v_action,
      null,
      v_changes,
      jsonb_build_object(
        'source', 'faturamento',
        'itemCount', v_inserted_count,
        'totalAmount', v_new_total_amount
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Faturamento salvo com sucesso.',
    'billing_order_id', v_order_id,
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function public.set_project_billing_order_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_billing_order_id uuid,
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
  v_order public.project_billing_orders%rowtype;
  v_action text := upper(nullif(btrim(coalesce(p_action, '')), ''));
  v_next_status text;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_billing_order_id is null or v_action not in ('FECHAR', 'CANCELAR', 'ABRIR') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_STATUS_PAYLOAD', 'message', 'Payload de status invalido.');
  end if;

  select *
  into v_order
  from public.project_billing_orders
  where tenant_id = p_tenant_id
    and id = p_billing_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'BILLING_ORDER_NOT_FOUND', 'message', 'Faturamento nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'MISSING_EXPECTED_UPDATED_AT', 'message', 'Atualize a lista antes de alterar o status.', 'currentUpdatedAt', v_order.updated_at);
  end if;

  if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STALE_BILLING_ORDER', 'message', 'Faturamento alterado por outro usuario. Recarregue os dados antes de alterar o status.', 'currentUpdatedAt', v_order.updated_at);
  end if;

  if v_action = 'FECHAR' then
    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Somente faturamento aberto pode ser fechado.');
    end if;
    v_next_status := 'FECHADA';
  elsif v_action = 'CANCELAR' then
    if v_order.status = 'CANCELADA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Faturamento ja esta cancelado.');
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_CANCEL_REASON', 'message', 'Informe motivo do cancelamento.');
    end if;
    v_next_status := 'CANCELADA';
  else
    if v_order.status <> 'FECHADA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Somente faturamento fechado pode ser reaberto.');
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_REOPEN_REASON', 'message', 'Informe motivo da reabertura.');
    end if;
    v_next_status := 'ABERTA';
  end if;

  update public.project_billing_orders
  set
    status = v_next_status,
    cancellation_reason = case when v_action = 'CANCELAR' then nullif(btrim(coalesce(p_reason, '')), '') when v_action = 'ABRIR' then null else cancellation_reason end,
    canceled_at = case when v_action = 'CANCELAR' then now() when v_action = 'ABRIR' then null else canceled_at end,
    canceled_by = case when v_action = 'CANCELAR' then p_actor_user_id when v_action = 'ABRIR' then null else canceled_by end,
    updated_by = p_actor_user_id,
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_billing_order_id
  returning updated_at into v_updated_at;

  perform public.append_project_billing_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_billing_order_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('fromStatus', v_order.status, 'toStatus', v_next_status),
    jsonb_build_object('source', 'faturamento_status')
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Status do faturamento atualizado com sucesso.',
    'billing_order_id', p_billing_order_id,
    'updated_at', v_updated_at,
    'billing_status', v_next_status
  );
end;
$$;

create or replace function public.save_project_billing_order_batch_partial(
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
  v_row jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_saved_count integer := 0;
  v_error_count integer := 0;
  v_row_numbers jsonb;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_BATCH', 'message', 'Nenhuma linha valida enviada para importacao.');
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);

    v_result := public.save_project_billing_order(
      p_tenant_id,
      p_actor_user_id,
      null,
      nullif(v_row->>'projectId', '')::uuid,
      coalesce(v_row->>'billingKind', 'COM_PRODUCAO'),
      nullif(v_row->>'noProductionReasonId', '')::uuid,
      v_row->>'notes',
      coalesce(v_row->'items', '[]'::jsonb),
      null
    );

    if coalesce((v_result->>'success')::boolean, false) then
      v_saved_count := v_saved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', true,
        'message', v_result->>'message',
        'billingOrderId', v_result->>'billing_order_id'
      ));
    else
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', false,
        'reason', v_result->>'reason',
        'message', v_result->>'message'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Importacao parcial de faturamento concluida.',
    'savedCount', v_saved_count,
    'errorCount', v_error_count,
    'results', v_results
  );
end;
$$;

grant execute on function public.append_project_billing_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz) to authenticated;
grant execute on function public.set_project_billing_order_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.save_project_billing_order_batch_partial(uuid, uuid, jsonb) to authenticated;

insert into public.app_pages (page_key, path, name, section, description)
values
  ('faturamento', '/faturamento', 'Faturamento', 'Operacao', 'Controle de atividades pagas por projeto e aprovacao de faturamento.')
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  pages.page_key,
  case
    when roles.role_key = 'viewer' then false
    else true
  end as can_access
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) as tenants
join public.app_roles as roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
join public.app_pages as pages
  on pages.ativo = true
 and pages.page_key = 'faturamento'
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  updated_at = now();

with target_pages as (
  select page_key
  from public.app_pages
  where ativo = true
    and page_key = 'faturamento'
),
target_users as (
  select
    au.id as user_id,
    au.tenant_id,
    au.role_id,
    coalesce(ar.role_key, 'user') as role_key
  from public.app_users au
  left join public.app_roles ar
    on ar.id = au.role_id
  where au.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions upp
      where upp.tenant_id = au.tenant_id
        and upp.user_id = au.id
    )
)
insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  tu.tenant_id,
  tu.user_id,
  tp.page_key,
  coalesce(
    rpp.can_access,
    case
      when tu.role_key = 'viewer' then false
      else true
    end
  ) as can_access,
  null,
  null
from target_users tu
cross join target_pages tp
left join public.app_user_page_permissions existing
  on existing.tenant_id = tu.tenant_id
 and existing.user_id = tu.user_id
 and existing.page_key = tp.page_key
left join public.role_page_permissions rpp
  on rpp.tenant_id = tu.tenant_id
 and rpp.role_id = tu.role_id
 and rpp.page_key = tp.page_key
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;
