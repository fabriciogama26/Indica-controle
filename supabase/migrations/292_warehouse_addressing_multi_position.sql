-- 292_warehouse_addressing_multi_position.sql
-- Permite o mesmo material ocupar mais de uma posicao no mapa do almoxarifado
-- (endereco = marcador de presenca por posicao, sem controle de quantidade).

drop function if exists public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz);
drop function if exists public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz);

alter table public.warehouse_material_addresses
  drop constraint if exists warehouse_material_addresses_unique_material;

create or replace function public.assign_warehouse_material_address(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_map_id uuid,
  p_material_id uuid,
  p_coluna text,
  p_linha integer,
  p_andar integer,
  p_posicao integer,
  p_address_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.warehouse_maps%rowtype;
  v_current public.warehouse_material_addresses%rowtype;
  v_occupied public.warehouse_material_addresses%rowtype;
  v_floor_positions integer;
  v_address_id uuid;
  v_updated_at timestamptz;
  v_coluna text := upper(btrim(coalesce(p_coluna, '')));
begin
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || '|' || p_map_id::text || '|' || coalesce(p_material_id::text, '')));

  select *
  into v_map
  from public.warehouse_maps
  where id = p_map_id
    and tenant_id = p_tenant_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MAP_NOT_FOUND', 'message', 'Mapa do almoxarifado nao encontrado.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, v_map.stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  perform 1
  from public.materials mat
  where mat.id = p_material_id
    and mat.tenant_id = p_tenant_id
    and mat.is_active = true;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado ou inativo.');
  end if;

  select floors.qtd_posicoes
  into v_floor_positions
  from public.warehouse_shelves shelves
  join public.warehouse_shelf_floors floors
    on floors.tenant_id = shelves.tenant_id
   and floors.shelf_id = shelves.id
  where shelves.tenant_id = p_tenant_id
    and shelves.map_id = p_map_id
    and shelves.coluna = v_coluna
    and shelves.linha = p_linha
    and floors.numero = p_andar;

  if v_floor_positions is null or p_posicao < 1 or p_posicao > v_floor_positions then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ADDRESS', 'message', 'Endereco inexistente na configuracao do mapa.');
  end if;

  if p_address_id is not null then
    select *
    into v_current
    from public.warehouse_material_addresses
    where id = p_address_id
      and tenant_id = p_tenant_id
      and map_id = p_map_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'ADDRESS_NOT_FOUND', 'message', 'Endereco nao encontrado para edicao.');
    end if;

    if v_current.material_id <> p_material_id then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'ADDRESS_MATERIAL_MISMATCH', 'message', 'Este endereco pertence a outro material.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize o endereco antes de realocar o material.');
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'O endereco deste material foi alterado por outro usuario.');
    end if;
  end if;

  select *
  into v_occupied
  from public.warehouse_material_addresses
  where tenant_id = p_tenant_id
    and map_id = p_map_id
    and coluna = v_coluna
    and linha = p_linha
    and andar = p_andar
    and posicao = p_posicao
    and id <> coalesce(p_address_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if found then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'Esta posicao ja possui outro material enderecado.');
  end if;

  if p_address_id is not null then
    update public.warehouse_material_addresses
    set
      coluna = v_coluna,
      linha = p_linha,
      andar = p_andar,
      posicao = p_posicao,
      updated_by = p_actor_user_id
    where id = p_address_id
      and tenant_id = p_tenant_id
    returning id, updated_at into v_address_id, v_updated_at;
  else
    insert into public.warehouse_material_addresses (
      tenant_id,
      map_id,
      stock_center_id,
      material_id,
      coluna,
      linha,
      andar,
      posicao,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_map_id,
      v_map.stock_center_id,
      p_material_id,
      v_coluna,
      p_linha,
      p_andar,
      p_posicao,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_address_id, v_updated_at;
  end if;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    material_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_map_id,
    p_material_id,
    'ADDRESS_ASSIGN',
    jsonb_build_object('coluna', v_coluna, 'linha', p_linha, 'andar', p_andar, 'posicao', p_posicao),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'address_id', v_address_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'Esta posicao ja possui outro material enderecado.');
end;
$$;

revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, uuid, timestamptz) from public;
revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, uuid, timestamptz) from anon;
revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, uuid, timestamptz) from authenticated;
grant execute on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, uuid, timestamptz) to service_role;

create or replace function public.assign_warehouse_material_addresses_batch(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_map_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.warehouse_maps%rowtype;
  v_assignment jsonb;
  v_material_id uuid;
  v_coluna text;
  v_linha integer;
  v_andar integer;
  v_posicao integer;
  v_count integer;
begin
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BATCH_PAYLOAD', 'message', 'Lista de enderecamento em massa invalida.');
  end if;

  v_count := jsonb_array_length(coalesce(p_assignments, '[]'::jsonb));
  if v_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EMPTY_BATCH', 'message', 'Informe ao menos um material para enderecar.');
  end if;

  if v_count > 100 then
    return jsonb_build_object('success', false, 'status', 413, 'reason', 'BATCH_TOO_LARGE', 'message', 'Enderecamento em massa limitado a 100 materiais por lote.');
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || '|' || p_map_id::text || '|BATCH_ADDRESSING'));

  select *
  into v_map
  from public.warehouse_maps
  where id = p_map_id
    and tenant_id = p_tenant_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MAP_NOT_FOUND', 'message', 'Mapa do almoxarifado nao encontrado.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, v_map.stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  create temporary table if not exists tmp_warehouse_batch_assignments (
    material_id uuid not null,
    coluna text not null,
    linha integer not null,
    andar integer not null,
    posicao integer not null,
    unique (coluna, linha, andar, posicao)
  ) on commit drop;

  truncate table tmp_warehouse_batch_assignments;

  for v_assignment in select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_material_id := nullif(v_assignment ->> 'materialId', '')::uuid;
    v_coluna := upper(btrim(coalesce(v_assignment ->> 'coluna', '')));
    v_linha := nullif(v_assignment ->> 'linha', '')::integer;
    v_andar := nullif(v_assignment ->> 'andar', '')::integer;
    v_posicao := nullif(v_assignment ->> 'posicao', '')::integer;

    if v_material_id is null or v_coluna = '' or v_linha is null or v_andar is null or v_posicao is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BATCH_ITEM', 'message', 'Todos os itens do lote precisam de material e endereco completo.');
    end if;

    if exists (
      select 1
      from tmp_warehouse_batch_assignments
      where coluna = v_coluna
        and linha = v_linha
        and andar = v_andar
        and posicao = v_posicao
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_BATCH_POSITION', 'message', 'O lote possui posicao repetida.');
    end if;

    insert into tmp_warehouse_batch_assignments (material_id, coluna, linha, andar, posicao)
    values (v_material_id, v_coluna, v_linha, v_andar, v_posicao);
  end loop;

  if exists (
    select 1
    from tmp_warehouse_batch_assignments batch
    left join public.materials mat
      on mat.id = batch.material_id
     and mat.tenant_id = p_tenant_id
     and mat.is_active = true
    where mat.id is null
  ) then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'O lote possui material inexistente ou inativo.');
  end if;

  if exists (
    select 1
    from tmp_warehouse_batch_assignments batch
    left join public.stock_center_balances balance
      on balance.tenant_id = p_tenant_id
     and balance.stock_center_id = v_map.stock_center_id
     and balance.material_id = batch.material_id
     and balance.quantity > 0
    where balance.material_id is null
  ) then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'MATERIAL_WITHOUT_STOCK', 'message', 'O lote possui material sem saldo no centro selecionado.');
  end if;

  if exists (
    select 1
    from tmp_warehouse_batch_assignments batch
    left join public.warehouse_shelves shelves
      on shelves.tenant_id = p_tenant_id
     and shelves.map_id = p_map_id
     and shelves.coluna = batch.coluna
     and shelves.linha = batch.linha
    left join public.warehouse_shelf_floors floors
      on floors.tenant_id = p_tenant_id
     and floors.shelf_id = shelves.id
     and floors.numero = batch.andar
     and batch.posicao between 1 and floors.qtd_posicoes
    where floors.shelf_id is null
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ADDRESS', 'message', 'O lote possui endereco inexistente na configuracao do mapa.');
  end if;

  if exists (
    select 1
    from tmp_warehouse_batch_assignments batch
    join public.warehouse_material_addresses occupied
      on occupied.tenant_id = p_tenant_id
     and occupied.map_id = p_map_id
     and occupied.coluna = batch.coluna
     and occupied.linha = batch.linha
     and occupied.andar = batch.andar
     and occupied.posicao = batch.posicao
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'O lote possui posicao ja ocupada.');
  end if;

  insert into public.warehouse_material_addresses (
    tenant_id,
    map_id,
    stock_center_id,
    material_id,
    coluna,
    linha,
    andar,
    posicao,
    created_by,
    updated_by
  )
  select
    p_tenant_id,
    p_map_id,
    v_map.stock_center_id,
    batch.material_id,
    batch.coluna,
    batch.linha,
    batch.andar,
    batch.posicao,
    p_actor_user_id,
    p_actor_user_id
  from tmp_warehouse_batch_assignments batch;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    material_id,
    action_type,
    details,
    created_by,
    updated_by
  )
  select
    p_tenant_id,
    p_map_id,
    batch.material_id,
    'ADDRESS_ASSIGN',
    jsonb_build_object('batch', true, 'coluna', batch.coluna, 'linha', batch.linha, 'andar', batch.andar, 'posicao', batch.posicao),
    p_actor_user_id,
    p_actor_user_id
  from tmp_warehouse_batch_assignments batch;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'assigned_count', v_count,
    'message', format('%s material(is) enderecado(s) com sucesso.', v_count)
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BATCH_PAYLOAD', 'message', 'Payload do lote invalido.');
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'O lote possui posicao ocupada.');
end;
$$;

revoke all on function public.assign_warehouse_material_addresses_batch(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.assign_warehouse_material_addresses_batch(uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.assign_warehouse_material_addresses_batch(uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.assign_warehouse_material_addresses_batch(uuid, uuid, uuid, jsonb) to service_role;

create or replace function public.clear_warehouse_material_address(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_map_id uuid,
  p_address_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.warehouse_material_addresses%rowtype;
begin
  select *
  into v_current
  from public.warehouse_material_addresses
  where id = p_address_id
    and tenant_id = p_tenant_id
    and map_id = p_map_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'ADDRESS_NOT_FOUND', 'message', 'Endereco do material nao encontrado.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, v_current.stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'O endereco deste material foi alterado por outro usuario.');
  end if;

  delete from public.warehouse_material_addresses
  where id = v_current.id
    and tenant_id = p_tenant_id;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    material_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_map_id,
    v_current.material_id,
    'ADDRESS_CLEAR',
    jsonb_build_object('previous', jsonb_build_object('coluna', v_current.coluna, 'linha', v_current.linha, 'andar', v_current.andar, 'posicao', v_current.posicao)),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200);
end;
$$;

revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from anon;
revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from authenticated;
grant execute on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) to service_role;
