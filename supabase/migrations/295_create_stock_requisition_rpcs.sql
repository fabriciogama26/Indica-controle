-- 295_create_stock_requisition_rpcs.sql
-- RPCs transacionais do fluxo de Requisicao com Atendimento no Almoxarifado.
--   create_stock_requisition_request  -> grava pedido PENDING (nao toca saldo).
--   claim_stock_requisition_request   -> assume o pedido (EM_ATENDIMENTO + expiracao).
--   release_stock_requisition_claim   -> libera a claim (ator ou supervisor).
--   fulfill_stock_requisition_request -> atende item a item, gerando REQUISITION real (atomico).
--   cancel_stock_requisition_request  -> cancela pedido em aberto (solicitante ou almoxarife).
-- Todas SECURITY DEFINER, escopo por tenant, EXECUTE somente para service_role.

-- Helper: valida ator ativo no tenant (mesmo padrao dos estornos em lote).
create or replace function public.stock_requisition_actor_allowed(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users actor
    where actor.id = p_actor_user_id
      and actor.ativo = true
      and (
        actor.tenant_id = p_tenant_id
        or exists (
          select 1
          from public.app_user_tenants tenant_access
          where tenant_access.user_id = actor.id
            and tenant_access.tenant_id = p_tenant_id
            and tenant_access.ativo = true
        )
      )
  );
$$;

-- =============================================================================
-- 1) create_stock_requisition_request
-- =============================================================================
create or replace function public.create_stock_requisition_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_requested_by_name text,
  p_stock_center_id uuid,
  p_team_id uuid,
  p_project_id uuid,
  p_request_date date,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_seen_materials uuid[] := array[]::uuid[];
begin
  if not public.stock_requisition_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado para solicitar requisicao neste tenant.');
  end if;

  if p_stock_center_id is null or p_team_id is null or p_project_id is null or p_request_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUIRED_FIELDS',
      'message', 'Centro de estoque, equipe, projeto e data sao obrigatorios.');
  end if;

  if p_request_date > current_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUEST_DATE_IN_FUTURE',
      'message', 'A data da solicitacao nao pode ser futura.');
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EMPTY_ITEMS',
      'message', 'Informe ao menos um material na solicitacao.');
  end if;

  -- Centro OWN ativo do tenant.
  if not exists (
    select 1 from public.stock_centers sc
    where sc.id = p_stock_center_id and sc.tenant_id = p_tenant_id
      and sc.is_active = true and sc.center_type = 'OWN'
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STOCK_CENTER_NOT_FOUND',
      'message', 'Centro de estoque nao encontrado ou inativo para este tenant.');
  end if;

  if not exists (
    select 1 from public.teams t where t.id = p_team_id and t.tenant_id = p_tenant_id and t.ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.');
  end if;

  if not exists (
    select 1 from public.project p where p.id = p_project_id and p.tenant_id = p_tenant_id and p.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto nao encontrado ou inativo para este tenant.');
  end if;

  insert into public.stock_requisition_requests (
    tenant_id, stock_center_id, team_id, project_id, request_date,
    requested_by, requested_by_name_snapshot, status, notes, created_by, updated_by
  ) values (
    p_tenant_id, p_stock_center_id, p_team_id, p_project_id, p_request_date,
    p_actor_user_id, nullif(btrim(coalesce(p_requested_by_name, '')), ''), 'PENDING',
    nullif(btrim(coalesce(p_notes, '')), ''), p_actor_user_id, p_actor_user_id
  )
  returning id into v_request_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception when others then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_QUANTITY',
        'message', 'Quantidade invalida na solicitacao.');
    end;

    if v_material_id is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MATERIAL',
        'message', 'Material invalido na solicitacao.');
    end if;

    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_QUANTITY',
        'message', 'A quantidade solicitada deve ser maior que zero.');
    end if;

    if v_material_id = any (v_seen_materials) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATE_MATERIAL_IN_REQUEST',
        'message', 'Material repetido na mesma solicitacao.');
    end if;
    v_seen_materials := array_append(v_seen_materials, v_material_id);

    if not exists (
      select 1 from public.materials m
      where m.id = v_material_id and m.tenant_id = p_tenant_id and m.ativo = true
    ) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MATERIAL_NOT_FOUND',
        'message', 'Material nao encontrado ou inativo para este tenant.');
    end if;

    -- Duplicidade nivel item: mesmo material em pedido aberto para equipe+projeto+data.
    if exists (
      select 1
      from public.stock_requisition_request_items i
      join public.stock_requisition_requests r on r.id = i.request_id
      where i.tenant_id = p_tenant_id
        and i.material_id = v_material_id
        and r.team_id = p_team_id
        and r.project_id = p_project_id
        and r.request_date = p_request_date
        and r.status in ('PENDING', 'EM_ATENDIMENTO')
        and r.id <> v_request_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_IN_OPEN_REQUEST',
        'message', 'Ja existe pedido em aberto para esta equipe/projeto/data com este material.');
    end if;

    insert into public.stock_requisition_request_items (
      request_id, tenant_id, material_id, quantity_requested, item_status
    ) values (
      v_request_id, p_tenant_id, v_material_id, v_quantity, 'PENDING'
    );
  end loop;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', v_request_id,
    'message', 'Solicitacao registrada com sucesso.');
end;
$$;

-- =============================================================================
-- 2) claim_stock_requisition_request
-- =============================================================================
create or replace function public.claim_stock_requisition_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_request_id uuid,
  p_claim_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_requisition_requests%rowtype;
  v_minutes integer := greatest(coalesce(p_claim_minutes, 15), 1);
begin
  if not public.stock_requisition_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado para atender requisicoes neste tenant.');
  end if;

  select * into v_request
  from public.stock_requisition_requests
  where id = p_request_id and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND',
      'message', 'Pedido de requisicao nao encontrado para este tenant.');
  end if;

  if v_request.status in ('ENCERRADO', 'CANCELADO') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_NOT_OPEN',
      'message', 'Este pedido ja foi encerrado ou cancelado.');
  end if;

  if v_request.status = 'EM_ATENDIMENTO'
     and v_request.claimed_by is not null
     and v_request.claimed_by <> p_actor_user_id
     and v_request.claim_expires_at is not null
     and v_request.claim_expires_at > now() then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLAIMED_BY_OTHER',
      'message', 'Pedido em atendimento por ' || coalesce(v_request.claimed_by_name_snapshot, 'outro usuario') || '.');
  end if;

  update public.stock_requisition_requests
  set status = 'EM_ATENDIMENTO',
      claimed_by = p_actor_user_id,
      claimed_by_name_snapshot = nullif(btrim(coalesce(p_actor_name, '')), ''),
      claimed_at = now(),
      claim_expires_at = now() + make_interval(mins => v_minutes),
      updated_by = p_actor_user_id,
      updated_at = now()
  where id = p_request_id and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id,
    'claim_expires_at', to_char(now() + make_interval(mins => v_minutes), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'message', 'Pedido assumido para atendimento.');
end;
$$;

-- =============================================================================
-- 3) release_stock_requisition_claim
-- =============================================================================
create or replace function public.release_stock_requisition_claim(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_is_supervisor boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_requisition_requests%rowtype;
begin
  if not public.stock_requisition_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado.');
  end if;

  select * into v_request
  from public.stock_requisition_requests
  where id = p_request_id and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND',
      'message', 'Pedido de requisicao nao encontrado para este tenant.');
  end if;

  if v_request.status <> 'EM_ATENDIMENTO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_NOT_CLAIMED',
      'message', 'Este pedido nao esta em atendimento.');
  end if;

  if not (
    coalesce(p_is_supervisor, false)
    or v_request.claimed_by = p_actor_user_id
    or (v_request.claim_expires_at is not null and v_request.claim_expires_at <= now())
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'RELEASE_NOT_ALLOWED',
      'message', 'Somente quem assumiu o pedido ou um supervisor pode liberar o atendimento.');
  end if;

  update public.stock_requisition_requests
  set status = 'PENDING',
      claimed_by = null,
      claimed_by_name_snapshot = null,
      claimed_at = null,
      claim_expires_at = null,
      updated_by = p_actor_user_id,
      updated_at = now()
  where id = p_request_id and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id,
    'message', 'Atendimento liberado.');
end;
$$;

-- =============================================================================
-- 4) fulfill_stock_requisition_request
--    p_decisions: [{ itemId, decision(ACCEPT|REDUCE|REJECT), quantity, reasonCode,
--                    serialNumber, lotCode, entryType, notes }]
-- =============================================================================
create or replace function public.fulfill_stock_requisition_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decisions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_requisition_requests%rowtype;
  v_batch_id uuid := gen_random_uuid();
  v_decision jsonb;
  v_item public.stock_requisition_request_items%rowtype;
  v_item_id uuid;
  v_decision_type text;
  v_quantity numeric;
  v_reason_code text;
  v_serial text;
  v_lot text;
  v_entry_type text;
  v_notes text;
  v_tracking text;
  v_requires_notes boolean;
  v_item_count integer;
  v_decision_count integer;
  v_accepted integer := 0;
  v_reduced integer := 0;
  v_rejected integer := 0;
  v_save_result jsonb;
  v_transfer_id uuid;
  v_transfer_item_id uuid;
  v_resultado text;
  v_error_message text;
  v_error_detail text;
  v_error_payload jsonb := '{}'::jsonb;
begin
  if not public.stock_requisition_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado para atender requisicoes neste tenant.');
  end if;

  select * into v_request
  from public.stock_requisition_requests
  where id = p_request_id and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND',
      'message', 'Pedido de requisicao nao encontrado para este tenant.');
  end if;

  if v_request.status <> 'EM_ATENDIMENTO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_NOT_CLAIMED',
      'message', 'Assuma o pedido antes de atender (status atual: ' || v_request.status || ').');
  end if;

  if v_request.claimed_by is not null and v_request.claimed_by <> p_actor_user_id then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLAIMED_BY_OTHER',
      'message', 'Pedido em atendimento por outro usuario.');
  end if;

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_DECISIONS',
      'message', 'Decisoes de atendimento invalidas.');
  end if;

  select count(*) into v_item_count
  from public.stock_requisition_request_items where request_id = p_request_id and tenant_id = p_tenant_id;

  v_decision_count := jsonb_array_length(p_decisions);
  if v_decision_count <> v_item_count then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'ITEM_DECISION_MISSING',
      'message', 'Todos os itens do pedido precisam de decisao antes de confirmar.');
  end if;

  -- Pre-validacao (fora da transacao de saldo): garante linhas completas e regras por decisao.
  for v_decision in select value from jsonb_array_elements(p_decisions)
  loop
    v_item_id := nullif(btrim(coalesce(v_decision ->> 'itemId', '')), '')::uuid;
    v_decision_type := upper(btrim(coalesce(v_decision ->> 'decision', '')));

    select * into v_item
    from public.stock_requisition_request_items
    where id = v_item_id and request_id = p_request_id and tenant_id = p_tenant_id;

    if not found then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'ITEM_NOT_FOUND',
        'message', 'Item do pedido nao encontrado.');
    end if;

    if v_decision_type not in ('ACCEPT', 'REDUCE', 'REJECT') then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_DECISION',
        'message', 'Decisao invalida para um item do pedido.');
    end if;

    select coalesce(m.serial_tracking_type, 'NONE') into v_tracking
    from public.materials m where m.id = v_item.material_id and m.tenant_id = p_tenant_id;

    if v_decision_type = 'REDUCE' then
      if v_tracking <> 'NONE' then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'SERIAL_REDUCE_NOT_ALLOWED',
          'message', 'Material rastreavel por serial nao pode ter quantidade reduzida (unidade = 1). Use Aceitar ou Recusar.');
      end if;
      begin
        v_quantity := (v_decision ->> 'quantity')::numeric;
      exception when others then v_quantity := null;
      end;
      if v_quantity is null or v_quantity <= 0 or v_quantity >= v_item.quantity_requested then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REDUCED_QUANTITY',
          'message', 'A quantidade reduzida deve ser maior que zero e menor que a solicitada. Para zerar use Recusar.');
      end if;
    end if;

    if v_decision_type in ('REDUCE', 'REJECT') then
      v_reason_code := nullif(btrim(coalesce(v_decision ->> 'reasonCode', '')), '');
      if v_reason_code is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_REQUIRED',
          'message', 'Informe o motivo para reduzir ou recusar o item.');
      end if;
      select requires_notes into v_requires_notes
      from public.stock_requisition_adjustment_reason_catalog
      where code = v_reason_code and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REASON',
          'message', 'Motivo invalido ou inativo.');
      end if;
      if coalesce(v_requires_notes, false) and nullif(btrim(coalesce(v_decision ->> 'notes', '')), '') is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'REASON_NOTES_REQUIRED',
          'message', 'Este motivo exige uma observacao.');
      end if;
    end if;

    if v_decision_type = 'ACCEPT' and v_tracking <> 'NONE' then
      v_serial := nullif(btrim(coalesce(v_decision ->> 'serialNumber', '')), '');
      if v_serial is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'SERIAL_REQUIRED',
          'message', 'Selecione a unidade (Serial) para o material rastreavel.');
      end if;
      if v_tracking = 'TRAFO' and nullif(btrim(coalesce(v_decision ->> 'lotCode', '')), '') is null then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'LOT_REQUIRED',
          'message', 'Informe o LP para o TRAFO.');
      end if;
    end if;
  end loop;

  -- Transacao de saldo (atomica): qualquer falha faz rollback total e mantem o pedido aberto.
  begin
    for v_decision in select value from jsonb_array_elements(p_decisions)
    loop
      v_item_id := nullif(btrim(coalesce(v_decision ->> 'itemId', '')), '')::uuid;
      v_decision_type := upper(btrim(coalesce(v_decision ->> 'decision', '')));
      v_reason_code := nullif(btrim(coalesce(v_decision ->> 'reasonCode', '')), '');
      v_serial := nullif(btrim(coalesce(v_decision ->> 'serialNumber', '')), '');
      v_lot := nullif(btrim(coalesce(v_decision ->> 'lotCode', '')), '');
      v_entry_type := upper(btrim(coalesce(v_decision ->> 'entryType', 'NOVO')));
      v_notes := nullif(btrim(coalesce(v_decision ->> 'notes', '')), '');

      select * into v_item
      from public.stock_requisition_request_items
      where id = v_item_id and request_id = p_request_id and tenant_id = p_tenant_id;

      if v_decision_type = 'REJECT' then
        update public.stock_requisition_request_items
        set quantity_fulfilled = 0,
            item_status = 'REJECTED',
            unfulfilled_reason_code = v_reason_code,
            notes = v_notes,
            updated_at = now()
        where id = v_item_id and tenant_id = p_tenant_id;
        v_rejected := v_rejected + 1;
        continue;
      end if;

      if v_decision_type = 'ACCEPT' then
        v_quantity := v_item.quantity_requested;
      else
        v_quantity := (v_decision ->> 'quantity')::numeric;
      end if;

      v_save_result := public.save_team_stock_operation_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_operation_kind => 'REQUISITION',
        p_stock_center_id => v_request.stock_center_id,
        p_team_id => v_request.team_id,
        p_project_id => v_request.project_id,
        p_entry_date => v_request.request_date,
        p_entry_type => v_entry_type,
        p_notes => v_notes,
        p_items => jsonb_build_array(jsonb_build_object(
          'materialId', v_item.material_id,
          'quantity', v_quantity,
          'serialNumber', v_serial,
          'lotCode', v_lot
        ))
      );

      if coalesce((v_save_result ->> 'success')::boolean, false) is not true then
        raise exception using
          message = coalesce(v_save_result ->> 'message', 'Falha ao atender o item da requisicao.'),
          detail = jsonb_build_object(
            'status', coalesce((v_save_result ->> 'status')::integer, 500),
            'reason', coalesce(v_save_result ->> 'reason', 'FULFILL_FAILED'),
            'details', v_save_result -> 'details'
          )::text;
      end if;

      v_transfer_id := nullif(btrim(coalesce(v_save_result ->> 'transfer_id', '')), '')::uuid;

      -- Carimba o agrupamento do pedido para permitir estorno do atendimento inteiro.
      update public.stock_transfer_team_operations
      set operation_batch_id = v_batch_id
      where transfer_id = v_transfer_id and tenant_id = p_tenant_id;

      -- Vincula o item do ledger ao item do pedido (rastreabilidade do estorno).
      select id into v_transfer_item_id
      from public.stock_transfer_items
      where transfer_id = v_transfer_id and material_id = v_item.material_id
      order by created_at asc
      limit 1;

      update public.stock_requisition_request_items
      set quantity_fulfilled = v_quantity,
          item_status = case when v_decision_type = 'ACCEPT' then 'ACCEPTED' else 'REDUCED' end,
          unfulfilled_reason_code = case when v_decision_type = 'REDUCE' then v_reason_code else null end,
          serial_number = v_serial,
          lot_code = v_lot,
          notes = v_notes,
          resulting_transfer_item_id = v_transfer_item_id,
          updated_at = now()
      where id = v_item_id and tenant_id = p_tenant_id;

      if v_decision_type = 'ACCEPT' then
        v_accepted := v_accepted + 1;
      else
        v_reduced := v_reduced + 1;
      end if;
    end loop;

    if v_rejected = v_item_count then
      v_resultado := 'RECUSADO';
    elsif v_reduced = 0 and v_rejected = 0 then
      v_resultado := 'TOTAL';
    else
      v_resultado := 'PARCIAL';
    end if;

    update public.stock_requisition_requests
    set status = 'ENCERRADO',
        resultado_atendimento = v_resultado,
        atendido_por = p_actor_user_id,
        atendido_em = now(),
        claim_expires_at = null,
        updated_by = p_actor_user_id,
        updated_at = now()
    where id = p_request_id and tenant_id = p_tenant_id;

    return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id,
      'resultado', v_resultado, 'batch_id', v_batch_id,
      'accepted', v_accepted, 'reduced', v_reduced, 'rejected', v_rejected,
      'message', 'Atendimento concluido.');
  exception
    when others then
      get stacked diagnostics v_error_message = message_text, v_error_detail = pg_exception_detail;
      begin
        if coalesce(v_error_detail, '') <> '' then
          v_error_payload := v_error_detail::jsonb;
        end if;
      exception when others then
        v_error_payload := '{}'::jsonb;
      end;
      return jsonb_build_object('success', false,
        'status', coalesce((v_error_payload ->> 'status')::integer, 500),
        'reason', coalesce(v_error_payload ->> 'reason', 'FULFILL_FAILED'),
        'message', coalesce(nullif(v_error_message, ''), 'Falha ao atender a requisicao.'),
        'details', coalesce(v_error_payload -> 'details', to_jsonb(v_error_detail)));
  end;
end;
$$;

-- =============================================================================
-- 5) cancel_stock_requisition_request
-- =============================================================================
create or replace function public.cancel_stock_requisition_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_requisition_requests%rowtype;
begin
  if not public.stock_requisition_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED',
      'message', 'Usuario nao autorizado.');
  end if;

  select * into v_request
  from public.stock_requisition_requests
  where id = p_request_id and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND',
      'message', 'Pedido de requisicao nao encontrado para este tenant.');
  end if;

  if v_request.status in ('ENCERRADO', 'CANCELADO') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_NOT_OPEN',
      'message', 'Somente pedidos em aberto podem ser cancelados.');
  end if;

  update public.stock_requisition_requests
  set status = 'CANCELADO',
      cancelado_por = p_actor_user_id,
      cancelado_em = now(),
      claimed_by = null,
      claimed_by_name_snapshot = null,
      claimed_at = null,
      claim_expires_at = null,
      updated_by = p_actor_user_id,
      updated_at = now()
  where id = p_request_id and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id,
    'message', 'Pedido cancelado.');
end;
$$;

-- Permissoes: EXECUTE somente para service_role (a API chama via client service_role).
revoke all on function public.stock_requisition_actor_allowed(uuid, uuid) from public;
revoke all on function public.create_stock_requisition_request(uuid, uuid, text, uuid, uuid, uuid, date, text, jsonb) from public;
revoke all on function public.claim_stock_requisition_request(uuid, uuid, text, uuid, integer) from public;
revoke all on function public.release_stock_requisition_claim(uuid, uuid, uuid, boolean) from public;
revoke all on function public.fulfill_stock_requisition_request(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.cancel_stock_requisition_request(uuid, uuid, uuid) from public;

grant execute on function public.create_stock_requisition_request(uuid, uuid, text, uuid, uuid, uuid, date, text, jsonb) to service_role;
grant execute on function public.claim_stock_requisition_request(uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.release_stock_requisition_claim(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.fulfill_stock_requisition_request(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.cancel_stock_requisition_request(uuid, uuid, uuid) to service_role;
