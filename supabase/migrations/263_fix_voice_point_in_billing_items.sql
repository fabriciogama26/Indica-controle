-- 263_fix_voice_point_in_billing_items.sql
-- Alinha project_billing_order_items ao contrato atual do modulo de Faturamento.
-- Alguns ambientes possuem o schema legado com paid_value e sem quantity/rate/unit_value/voice_point/total_value.
-- Esta migration adiciona as colunas faltantes, preserva paid_value como compatibilidade e recompila a RPC base.
-- Em schemas legados onde paid_value ainda e NOT NULL, a coluna recebe default 0 e deixa de bloquear inserts novos.

alter table if exists public.project_billing_order_items
  add column if not exists voice_point numeric;

alter table if exists public.project_billing_order_items
  add column if not exists quantity numeric;

alter table if exists public.project_billing_order_items
  add column if not exists rate numeric;

alter table if exists public.project_billing_order_items
  add column if not exists unit_value numeric;

alter table if exists public.project_billing_order_items
  add column if not exists activity_active_snapshot boolean not null default true;

update public.project_billing_order_items
set
  voice_point = coalesce(voice_point, 1),
  quantity = coalesce(quantity, 1),
  rate = coalesce(rate, 1),
  unit_value = coalesce(unit_value, 0);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_billing_order_items'
      and column_name = 'paid_value'
  ) then
    execute $sql$
      update public.project_billing_order_items
      set unit_value = coalesce(nullif(paid_value, 0), unit_value, 0)
      where coalesce(unit_value, 0) = 0
    $sql$;

    execute $sql$
      alter table public.project_billing_order_items
        alter column paid_value set default 0,
        alter column paid_value drop not null
    $sql$;

    execute $sql$
      alter table public.project_billing_order_items
        drop constraint if exists project_billing_order_items_paid_value_check
    $sql$;
  end if;
end;
$$;

alter table if exists public.project_billing_order_items
  alter column voice_point set default 1,
  alter column quantity set default 1,
  alter column rate set default 1,
  alter column unit_value set default 0,
  alter column voice_point set not null,
  alter column quantity set not null,
  alter column rate set not null,
  alter column unit_value set not null;

alter table if exists public.project_billing_order_items
  add column if not exists total_value numeric generated always as (voice_point * quantity * rate * unit_value) stored;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_billing_order_items_voice_point_check'
      and conrelid = 'public.project_billing_order_items'::regclass
  ) then
    alter table public.project_billing_order_items
      add constraint project_billing_order_items_voice_point_check check (voice_point > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_billing_order_items_quantity_check'
      and conrelid = 'public.project_billing_order_items'::regclass
  ) then
    alter table public.project_billing_order_items
      add constraint project_billing_order_items_quantity_check check (quantity > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_billing_order_items_rate_check'
      and conrelid = 'public.project_billing_order_items'::regclass
  ) then
    alter table public.project_billing_order_items
      add constraint project_billing_order_items_rate_check check (rate > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_billing_order_items_unit_value_check'
      and conrelid = 'public.project_billing_order_items'::regclass
  ) then
    alter table public.project_billing_order_items
      add constraint project_billing_order_items_unit_value_check check (unit_value >= 0);
  end if;
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
  p_expected_updated_at timestamptz default null,
  p_ingresso_date date default null
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

  if p_ingresso_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_INGRESSO_DATE', 'message', 'Data Ingresso e obrigatoria para o faturamento.');
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

  if (
    select count(*) <> count(distinct nullif(x->>'activityId', '')::uuid)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where nullif(x->>'activityId', '') is not null
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATE_BILLING_ACTIVITY', 'message', 'A mesma atividade nao pode se repetir no faturamento.');
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
  end loop;

  if p_billing_order_id is null then
    v_order_id := gen_random_uuid();
    v_action := 'CREATE';
    v_changes := '{}'::jsonb;

    insert into public.project_billing_orders (
      id, tenant_id, billing_number, project_id, billing_kind, no_production_reason_id,
      no_production_reason_name_snapshot, status, notes, project_code_snapshot,
      ingresso_date, created_by, updated_by
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
      p_ingresso_date,
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
      ingresso_date = p_ingresso_date,
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
    if v_order.ingresso_date is distinct from p_ingresso_date then
      v_changes := v_changes || jsonb_build_object('ingressoDate', jsonb_build_object('from', v_order.ingresso_date, 'to', p_ingresso_date));
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

grant execute on function public.save_project_billing_order(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date
) to authenticated;

notify pgrst, 'reload schema';
