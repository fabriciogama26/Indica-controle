-- 290_warehouse_map_config_history_snapshot.sql
-- Recria save_warehouse_map_config para gravar snapshot antes/depois no historico CONFIG_SAVE,
-- permitindo exibir "quem alterou, como estava e como ficou" na tela de Configuracao do Mapa.

create or replace function public.save_warehouse_map_config(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_stock_center_id uuid,
  p_colunas text[],
  p_linhas integer[],
  p_prateleiras jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.warehouse_maps%rowtype;
  v_map_id uuid;
  v_updated_at timestamptz;
  v_shelf jsonb;
  v_floor jsonb;
  v_coluna text;
  v_linha integer;
  v_andar integer;
  v_qtd_posicoes integer;
  v_shelf_id uuid;
  v_position integer;
  v_map_exists boolean := false;
  v_storage_type text;
  v_uses_floors boolean;
  v_conflicts jsonb;
  v_before_colunas text[];
  v_before_linhas integer[];
  v_before_prateleiras jsonb;
  v_after_prateleiras jsonb;
begin
  if p_stock_center_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STOCK_CENTER_REQUIRED', 'message', 'Centro de estoque obrigatorio.');
  end if;

  if array_length(p_colunas, 1) is null or array_length(p_linhas, 1) is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'GRID_REQUIRED', 'message', 'Informe colunas e linhas do mapa.');
  end if;

  if array_length(p_colunas, 1) > 15 or array_length(p_linhas, 1) > 20 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'GRID_LIMIT_EXCEEDED', 'message', 'O mapa permite no maximo 15 colunas e 20 linhas.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, p_stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  create temporary table if not exists tmp_warehouse_positions (
    coluna text not null,
    linha integer not null,
    andar integer not null,
    posicao integer not null,
    primary key (coluna, linha, andar, posicao)
  ) on commit drop;

  truncate table tmp_warehouse_positions;

  for v_shelf in select value from jsonb_array_elements(coalesce(p_prateleiras, '[]'::jsonb))
  loop
    v_coluna := upper(btrim(coalesce(v_shelf ->> 'coluna', '')));
    v_linha := nullif(v_shelf ->> 'linha', '')::integer;
    v_storage_type := upper(btrim(coalesce(v_shelf ->> 'tipo', v_shelf ->> 'storageType', 'SHELF')));

    if v_coluna = '' or v_linha is null or not (v_coluna = any(p_colunas)) or not (v_linha = any(p_linhas)) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SHELF_POSITION', 'message', 'Prateleira fora do grid configurado.');
    end if;

    select storage_type_row.uses_floors
    into v_uses_floors
    from public.warehouse_storage_types storage_type_row
    where storage_type_row.code = v_storage_type
      and storage_type_row.is_active = true;

    if not found then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STORAGE_TYPE', 'message', 'Tipo de endereco invalido.');
    end if;

    if not coalesce(v_uses_floors, true) then
      v_qtd_posicoes := coalesce(nullif(v_shelf -> 'andares' -> 0 ->> 'qtdPosicoes', '')::integer, 1);

      if v_qtd_posicoes <= 0 or v_qtd_posicoes > 10 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_POSITIONS', 'message', 'Quantidade de posicoes deve ficar entre 1 e 10.');
      end if;

      for v_position in 1..v_qtd_posicoes
      loop
        insert into tmp_warehouse_positions (coluna, linha, andar, posicao)
        values (v_coluna, v_linha, 1, v_position)
        on conflict do nothing;
      end loop;
      continue;
    end if;

    if jsonb_array_length(coalesce(v_shelf -> 'andares', '[]'::jsonb)) = 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'FLOORS_REQUIRED', 'message', 'Prateleira deve possuir ao menos um andar.');
    end if;

    for v_floor in select value from jsonb_array_elements(coalesce(v_shelf -> 'andares', '[]'::jsonb))
    loop
      v_andar := nullif(v_floor ->> 'numero', '')::integer;
      v_qtd_posicoes := coalesce(nullif(v_floor ->> 'qtdPosicoes', '')::integer, 1);

      if v_andar is null or v_andar <= 0 or v_andar > 10 or v_qtd_posicoes <= 0 or v_qtd_posicoes > 10 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FLOOR', 'message', 'Andar e quantidade de posicoes devem ficar entre 1 e 10.');
      end if;

      for v_position in 1..v_qtd_posicoes
      loop
        insert into tmp_warehouse_positions (coluna, linha, andar, posicao)
        values (v_coluna, v_linha, v_andar, v_position)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  select *
  into v_map
  from public.warehouse_maps
  where tenant_id = p_tenant_id
    and stock_center_id = p_stock_center_id
  for update;

  if found then
    if p_expected_updated_at is not null and v_map.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'A configuracao do mapa foi alterada por outro usuario.');
    end if;

    v_map_id := v_map.id;
    v_map_exists := true;
  end if;

  if v_map_exists then
    select jsonb_agg(
      jsonb_build_object(
        'materialId', addr.material_id,
        'codigo', mat.codigo,
        'coluna', addr.coluna,
        'linha', addr.linha,
        'andar', addr.andar,
        'posicao', addr.posicao
      )
      order by addr.coluna, addr.linha, addr.andar, addr.posicao
    )
    into v_conflicts
    from public.warehouse_material_addresses addr
    join public.materials mat
      on mat.id = addr.material_id
     and mat.tenant_id = p_tenant_id
    where addr.tenant_id = p_tenant_id
      and addr.map_id = v_map_id
      and not exists (
        select 1
        from tmp_warehouse_positions pos
        where pos.coluna = addr.coluna
          and pos.linha = addr.linha
          and pos.andar = addr.andar
          and pos.posicao = addr.posicao
      );

    if v_conflicts is not null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ADDRESSES_OUTSIDE_NEW_LAYOUT',
        'message', 'Existem materiais enderecados em posicoes removidas. Limpe ou realoque esses materiais antes de salvar o novo layout.',
        'conflicts', v_conflicts
      );
    end if;
  end if;

  if v_map_exists then
    v_before_colunas := v_map.colunas;
    v_before_linhas := v_map.linhas;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'coluna', shelves.coluna,
          'linha', shelves.linha,
          'tipo', shelves.storage_type,
          'andares', (
            select coalesce(jsonb_agg(jsonb_build_object('numero', floors.numero, 'qtdPosicoes', floors.qtd_posicoes) order by floors.numero), '[]'::jsonb)
            from public.warehouse_shelf_floors floors
            where floors.tenant_id = p_tenant_id
              and floors.shelf_id = shelves.id
          )
        )
        order by shelves.coluna, shelves.linha
      ),
      '[]'::jsonb
    )
    into v_before_prateleiras
    from public.warehouse_shelves shelves
    where shelves.tenant_id = p_tenant_id
      and shelves.map_id = v_map_id;
  else
    v_before_colunas := '{}'::text[];
    v_before_linhas := '{}'::integer[];
    v_before_prateleiras := '[]'::jsonb;
  end if;

  if v_map_exists then
    update public.warehouse_maps
    set
      colunas = p_colunas,
      linhas = p_linhas,
      updated_by = p_actor_user_id
    where id = v_map_id
      and tenant_id = p_tenant_id
    returning updated_at into v_updated_at;
  else
    insert into public.warehouse_maps (
      tenant_id,
      stock_center_id,
      colunas,
      linhas,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_stock_center_id,
      p_colunas,
      p_linhas,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_map_id, v_updated_at;
  end if;

  delete from public.warehouse_shelf_floors floors
  using public.warehouse_shelves shelves
  where floors.tenant_id = p_tenant_id
    and floors.shelf_id = shelves.id
    and shelves.tenant_id = p_tenant_id
    and shelves.map_id = v_map_id
    and not exists (
      select 1
      from tmp_warehouse_positions pos
      where pos.coluna = shelves.coluna
        and pos.linha = shelves.linha
        and pos.andar = floors.numero
    );

  delete from public.warehouse_shelves shelves
  where shelves.tenant_id = p_tenant_id
    and shelves.map_id = v_map_id
    and not exists (
      select 1
      from tmp_warehouse_positions pos
      where pos.coluna = shelves.coluna
        and pos.linha = shelves.linha
    );

  for v_shelf in select value from jsonb_array_elements(coalesce(p_prateleiras, '[]'::jsonb))
  loop
    v_coluna := upper(btrim(coalesce(v_shelf ->> 'coluna', '')));
    v_linha := nullif(v_shelf ->> 'linha', '')::integer;
    v_storage_type := upper(btrim(coalesce(v_shelf ->> 'tipo', v_shelf ->> 'storageType', 'SHELF')));

    select storage_type_row.uses_floors
    into v_uses_floors
    from public.warehouse_storage_types storage_type_row
    where storage_type_row.code = v_storage_type
      and storage_type_row.is_active = true;

    if not found then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STORAGE_TYPE', 'message', 'Tipo de endereco invalido.');
    end if;

    insert into public.warehouse_shelves (
      tenant_id,
      map_id,
      coluna,
      linha,
      storage_type,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      v_map_id,
      v_coluna,
      v_linha,
      v_storage_type,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (tenant_id, map_id, coluna, linha) do update
    set
      storage_type = excluded.storage_type,
      updated_by = excluded.updated_by
    returning id into v_shelf_id;

    if not coalesce(v_uses_floors, true) then
      v_qtd_posicoes := coalesce(nullif(v_shelf -> 'andares' -> 0 ->> 'qtdPosicoes', '')::integer, 1);

      if v_qtd_posicoes <= 0 or v_qtd_posicoes > 10 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_POSITIONS', 'message', 'Quantidade de posicoes deve ficar entre 1 e 10.');
      end if;

      insert into public.warehouse_shelf_floors (
        tenant_id,
        shelf_id,
        numero,
        qtd_posicoes,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_shelf_id,
        1,
        v_qtd_posicoes,
        p_actor_user_id,
        p_actor_user_id
      )
      on conflict (tenant_id, shelf_id, numero) do update
      set
        qtd_posicoes = excluded.qtd_posicoes,
        updated_by = excluded.updated_by;

      continue;
    end if;

    for v_floor in select value from jsonb_array_elements(coalesce(v_shelf -> 'andares', '[]'::jsonb))
    loop
      v_andar := nullif(v_floor ->> 'numero', '')::integer;
      v_qtd_posicoes := coalesce(nullif(v_floor ->> 'qtdPosicoes', '')::integer, 1);

      if v_andar is null or v_andar <= 0 or v_andar > 10 or v_qtd_posicoes <= 0 or v_qtd_posicoes > 10 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FLOOR', 'message', 'Andar e quantidade de posicoes devem ficar entre 1 e 10.');
      end if;

      insert into public.warehouse_shelf_floors (
        tenant_id,
        shelf_id,
        numero,
        qtd_posicoes,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_shelf_id,
        v_andar,
        v_qtd_posicoes,
        p_actor_user_id,
        p_actor_user_id
      )
      on conflict (tenant_id, shelf_id, numero) do update
      set
        qtd_posicoes = excluded.qtd_posicoes,
        updated_by = excluded.updated_by;
    end loop;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'coluna', shelves.coluna,
        'linha', shelves.linha,
        'tipo', shelves.storage_type,
        'andares', (
          select coalesce(jsonb_agg(jsonb_build_object('numero', floors.numero, 'qtdPosicoes', floors.qtd_posicoes) order by floors.numero), '[]'::jsonb)
          from public.warehouse_shelf_floors floors
          where floors.tenant_id = p_tenant_id
            and floors.shelf_id = shelves.id
        )
      )
      order by shelves.coluna, shelves.linha
    ),
    '[]'::jsonb
  )
  into v_after_prateleiras
  from public.warehouse_shelves shelves
  where shelves.tenant_id = p_tenant_id
    and shelves.map_id = v_map_id;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_map_id,
    'CONFIG_SAVE',
    jsonb_build_object(
      'stockCenterId', p_stock_center_id,
      'colunas', p_colunas,
      'linhas', p_linhas,
      'before', jsonb_build_object('colunas', v_before_colunas, 'linhas', v_before_linhas, 'prateleiras', v_before_prateleiras),
      'after', jsonb_build_object('colunas', p_colunas, 'linhas', p_linhas, 'prateleiras', v_after_prateleiras)
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  select updated_at
  into v_updated_at
  from public.warehouse_maps
  where id = v_map_id
    and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'status', 200, 'map_id', v_map_id, 'updated_at', v_updated_at);
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PAYLOAD', 'message', 'Payload do mapa invalido.');
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_POSITION', 'message', 'Ha posicoes duplicadas no mapa.');
end;
$$;

revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from public;
revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from anon;
revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from authenticated;
grant execute on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) to service_role;
