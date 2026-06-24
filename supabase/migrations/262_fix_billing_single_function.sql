-- 262_fix_billing_single_function.sql
-- Remove o overload de 9 params (migration 259) para eliminar ambiguidade de resolucao
-- com o overload de 10 params (migration 260/261) quando chamados posicionalmente.
-- Substitui por uma unica funcao de 10 params com toda a logica de negocio incorporada.

-- ============================================================
-- 1. Remove overload 9-params para eliminar ambiguidade
-- ============================================================

drop function if exists public.save_project_billing_order(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz
);

-- ============================================================
-- 2. Funcao unica de 10 params — logica completa sem delegation
-- ============================================================

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

  -- M3: verificacao de duplicatas em O(n)
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

-- ============================================================
-- 3. Batch function — chama a funcao unica com ingresso_date explicito
-- ============================================================

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
  v_ingresso_date date;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_BATCH', 'message', 'Nenhuma linha valida enviada para importacao.');
  end if;

  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'BATCH_TOO_LARGE', 'message', 'Maximo de 500 faturamentos por importacao em lote.');
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);
    v_ingresso_date := nullif(v_row->>'ingressoDate', '')::date;

    -- ingresso_date ausente: erro de linha (nao para o batch inteiro)
    if v_ingresso_date is null then
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', false,
        'reason', 'MISSING_INGRESSO_DATE',
        'message', 'Data Ingresso e obrigatoria para o faturamento.'
      ));
      continue;
    end if;

    -- Chama funcao unica 10-params (sem ambiguidade: so existe uma versao agora)
    v_result := public.save_project_billing_order(
      p_tenant_id,
      p_actor_user_id,
      null,
      nullif(v_row->>'projectId', '')::uuid,
      coalesce(v_row->>'billingKind', 'COM_PRODUCAO'),
      nullif(v_row->>'noProductionReasonId', '')::uuid,
      v_row->>'notes',
      coalesce(v_row->'items', '[]'::jsonb),
      null,
      v_ingresso_date
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
