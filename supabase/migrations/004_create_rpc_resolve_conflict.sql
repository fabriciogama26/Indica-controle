-- 004_create_rpc_resolve_conflict.sql
-- RPC para resolver conflito por item e reaplicar a requisicao corrigida.
create or replace function public.resolve_conflict(
  p_conflict_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_conflict record;
  v_requisicao_id uuid;
  v_material_id uuid;
  v_qty numeric;
  v_codigo text;
  v_sign int;
  v_details jsonb := '[]'::jsonb;
  rec record;
begin
  select * into v_conflict
  from public.stock_conflicts
  where id = p_conflict_id
  for update;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  if v_conflict.status <> 'OPEN' then
    return jsonb_build_object('status', 'ALREADY_RESOLVED');
  end if;

  v_sign := case when upper(coalesce(v_conflict.tipo_operacao, '')) like 'DEV%' then 1 else -1 end;

  create temporary table tmp_items(
    material_id uuid,
    codigo text,
    descricao text,
    quantidade numeric,
    qty_signed numeric
  ) on commit drop;

  insert into tmp_items(material_id, codigo, descricao, quantidade, qty_signed)
  select
    material_id,
    codigo,
    descricao,
    coalesce(nullif(qty_new, 0), qty_requested),
    coalesce(nullif(qty_new, 0), qty_requested) * v_sign
  from public.stock_conflict_items
  where conflict_id = p_conflict_id
    and status <> 'REMOVE';

  if not exists (select 1 from tmp_items) then
    update public.stock_conflicts
    set status = 'CANCELED',
        resolved_at = now()
    where id = p_conflict_id;

    return jsonb_build_object('status', 'CANCELED');
  end if;

  -- Lock deterministico
  for v_material_id in
    select material_id from tmp_items where material_id is not null group by material_id order by material_id
  loop
    perform 1 from public.inventory_balance
    where tenant_id = v_conflict.tenant_id and material_id = v_material_id
    for update;

    if not found then
      insert into public.inventory_balance(tenant_id, material_id, qty_on_hand)
      values (v_conflict.tenant_id, v_material_id, 0);

      perform 1 from public.inventory_balance
      where tenant_id = v_conflict.tenant_id and material_id = v_material_id
      for update;
    end if;
  end loop;

  -- Valida saldo
  for rec in
    select material_id, sum(qty_signed) as qty_sum
    from tmp_items
    where material_id is not null
    group by material_id
  loop
    select qty_on_hand into v_qty
    from public.inventory_balance
    where tenant_id = v_conflict.tenant_id and material_id = rec.material_id;

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
    update public.stock_conflicts
    set reason = 'INSUFFICIENT_STOCK',
        details = v_details
    where id = p_conflict_id;

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
    v_conflict.tenant_id, v_conflict.request_id, v_conflict.requisitor, v_conflict.projeto,
    v_conflict.usuario, v_conflict.data,
    v_conflict.tipo_operacao, v_conflict.observacao, v_conflict.source, v_conflict.device_id
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
  where b.tenant_id = v_conflict.tenant_id
    and b.material_id = s.material_id;

  insert into public.requisicao_itens(
    tenant_id, requisicao_id, material_id, codigo, descricao, quantidade
  )
  select v_conflict.tenant_id, v_requisicao_id, material_id, codigo, descricao, quantidade
  from tmp_items;

  insert into public.stock_movements(
    tenant_id, material_id, qty, source, request_id, requisicao_id, status
  )
  select v_conflict.tenant_id, material_id, qty_signed, v_conflict.source, v_conflict.request_id, v_requisicao_id, 'APPLIED'
  from tmp_items;

  update public.stock_conflicts
  set status = 'RESOLVED',
      resolved_at = now(),
      resolved_requisicao_id = v_requisicao_id
  where id = p_conflict_id;

  return jsonb_build_object('status', 'RESOLVED', 'requisicao_id', v_requisicao_id);
end;
$$;
