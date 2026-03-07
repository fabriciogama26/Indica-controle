-- 003_create_rpc_submit_requisicao.sql
-- RPC para aplicar requisicao inteira (transacao unica, sem deadlock).
create or replace function public.submit_requisicao(
  p_client_request_id uuid,
  p_requisitor text,
  p_projeto text,
  p_usuario text,
  p_data text,
  p_tipo_operacao text,
  p_observacao text,
  p_origem text,
  p_device_id text,
  p_tenant_id uuid,
  p_itens jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_existing_id uuid;
  v_requisicao_id uuid;
  v_conflict_id uuid;
  v_item jsonb;
  v_material_id uuid;
  v_qty numeric;
  v_codigo text;
  v_sign int := case when upper(coalesce(p_tipo_operacao, '')) like 'DEV%' then 1 else -1 end;
  v_details jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_data_ts timestamptz;
  rec record;
begin
  -- tenta converter data enviada para timestamptz
  begin
    v_data_ts := p_data::timestamptz;
  exception when others then
    v_data_ts := null;
  end;
  if v_data_ts is null then
    begin
      v_data_ts := to_timestamp(p_data || ' ' || to_char(now(), 'HH24:MI:SS'), 'DD/MM/YYYY HH24:MI:SS');
    exception when others then
      v_data_ts := now();
    end;
  end if;

  -- Idempotencia: se ja existe, retorna OK
  select id into v_existing_id
  from public.requisicoes
  where tenant_id = p_tenant_id
    and client_request_id = p_client_request_id;

  if v_existing_id is not null then
    return jsonb_build_object('status', 'ALREADY_APPLIED', 'requisicao_id', v_existing_id);
  end if;

  create temporary table tmp_items(
    material_id uuid,
    codigo text,
    descricao text,
    umb text,
    tipo text,
    lp text,
    serial text,
    quantidade numeric,
    valor_unitario numeric,
    qty_signed numeric
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    select id into v_material_id
    from public.materials
    where tenant_id = p_tenant_id
      and codigo = (v_item->>'codigo')
    limit 1;

    v_qty := (v_item->>'quantidade')::numeric;
    if v_material_id is null then
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('codigo', v_item->>'codigo'));
      insert into tmp_items(material_id, codigo, descricao, umb, tipo, lp, serial, quantidade, valor_unitario, qty_signed)
      values (
        null,
        v_item->>'codigo',
        v_item->>'descricao',
        v_item->>'umb',
        v_item->>'tipo',
        v_item->>'lp',
        v_item->>'serial',
        v_qty,
        nullif(v_item->>'valor_unitario', '')::numeric,
        v_qty * v_sign
      );
    else
      insert into tmp_items(material_id, codigo, descricao, umb, tipo, lp, serial, quantidade, valor_unitario, qty_signed)
      values (
        v_material_id,
        v_item->>'codigo',
        v_item->>'descricao',
        v_item->>'umb',
        v_item->>'tipo',
        v_item->>'lp',
        v_item->>'serial',
        v_qty,
        nullif(v_item->>'valor_unitario', '')::numeric,
        v_qty * v_sign
      );
    end if;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    insert into public.stock_conflicts(
      tenant_id, request_id, data, projeto, requisitor, usuario, tipo_operacao, observacao, reason, details, source, device_id
    ) values (
      p_tenant_id, p_client_request_id, v_data_ts, p_projeto, p_requisitor, p_usuario, p_tipo_operacao, p_observacao,
      'MATERIAL_NOT_FOUND', v_missing, p_origem, p_device_id
    )
    returning id into v_conflict_id;

    insert into public.stock_conflict_items(
      conflict_id, tenant_id, material_id, codigo, descricao, qty_requested, qty_new, status, saldo_at_conflict
    )
    select v_conflict_id, p_tenant_id, material_id, codigo, descricao, quantidade, quantidade,
           case when material_id is null then 'REMOVE' else 'KEEP' end,
           null
    from tmp_items;

    return jsonb_build_object(
      'status', 'REJECTED',
      'reason', 'MATERIAL_NOT_FOUND',
      'details', v_missing
    );
  end if;

  -- Lock deterministico para evitar deadlock
  for v_material_id in
    select material_id from tmp_items where material_id is not null group by material_id order by material_id
  loop
    perform 1 from public.inventory_balance
    where tenant_id = p_tenant_id and material_id = v_material_id
    for update;

    if not found then
      insert into public.inventory_balance(tenant_id, material_id, qty_on_hand)
      values (p_tenant_id, v_material_id, 0);

      perform 1 from public.inventory_balance
      where tenant_id = p_tenant_id and material_id = v_material_id
      for update;
    end if;
  end loop;

  -- Valida saldo para todos
  for rec in
    select material_id, sum(qty_signed) as qty_sum
    from tmp_items
    where material_id is not null
    group by material_id
  loop
    select qty_on_hand into v_qty
    from public.inventory_balance
    where tenant_id = p_tenant_id and material_id = rec.material_id;

    if v_qty + rec.qty_sum < 0 then
      select codigo into v_codigo
      from tmp_items
      where material_id = rec.material_id
      limit 1;

      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'material_id', rec.material_id,
        'codigo', v_codigo,
        'saldo_atual', v_qty,
        'solicitado', rec.qty_sum
      ));
    end if;
  end loop;

  if jsonb_array_length(v_details) > 0 then
    insert into public.stock_conflicts(
      tenant_id, request_id, data, projeto, requisitor, usuario, tipo_operacao, observacao, reason, details, source, device_id
    ) values (
      p_tenant_id, p_client_request_id, v_data_ts, p_projeto, p_requisitor, p_usuario, p_tipo_operacao, p_observacao,
      'INSUFFICIENT_STOCK', v_details, p_origem, p_device_id
    )
    returning id into v_conflict_id;

    insert into public.stock_conflict_items(
      conflict_id, tenant_id, material_id, codigo, descricao, qty_requested, qty_new, status, saldo_at_conflict
    )
    select v_conflict_id, p_tenant_id, t.material_id, t.codigo, t.descricao, t.quantidade, t.quantidade,
           case
             when exists (
               select 1
               from jsonb_array_elements(v_details) d
               where (d->>'material_id')::uuid = t.material_id
             ) then 'REDUCE'
             else 'KEEP'
           end,
           b.qty_on_hand
    from tmp_items t
    left join public.inventory_balance b
      on b.tenant_id = p_tenant_id and b.material_id = t.material_id;

    return jsonb_build_object(
      'status', 'REJECTED',
      'reason', 'INSUFFICIENT_STOCK',
      'details', v_details
    );
  end if;

  insert into public.requisicoes(
    tenant_id, client_request_id, requisitor, projeto, usuario, data,
    tipo_operacao, observacao, origem, device_id
  ) values (
    p_tenant_id, p_client_request_id, p_requisitor, p_projeto, p_usuario, v_data_ts,
    p_tipo_operacao, p_observacao, p_origem, p_device_id
  )
  returning id into v_requisicao_id;

  update public.inventory_balance b
  set qty_on_hand = b.qty_on_hand + s.qty_sum,
      updated_at = now()
  from (
    select material_id, sum(qty_signed) as qty_sum
    from tmp_items
    group by material_id
  ) s
  where b.tenant_id = p_tenant_id
    and b.material_id = s.material_id;

  insert into public.requisicao_itens(
    tenant_id, requisicao_id, material_id, codigo, descricao, umb, tipo, lp, serial, quantidade, valor_unitario
  )
  select p_tenant_id, v_requisicao_id, material_id, codigo, descricao, umb, tipo, lp, serial, quantidade, valor_unitario
  from tmp_items;

  insert into public.stock_movements(
    tenant_id, material_id, qty, source, request_id, requisicao_id, status
  )
  select p_tenant_id, material_id, qty_signed, p_origem, p_client_request_id, v_requisicao_id, 'APPLIED'
  from tmp_items;

  return jsonb_build_object('status', 'APPLIED', 'requisicao_id', v_requisicao_id);
end;
$$;
