-- 437_create_save_material_records_batch_rpc.sql
-- Cria a RPC de insercao em lote para o cadastro em massa de Materiais,
-- substituindo N chamadas RPC (uma por linha, mais checagem de categoria e
-- precheck de codigo em queries separadas por linha) por uma unica chamada
-- para o arquivo inteiro.
--
-- Replica, linha a linha dentro do loop, exatamente a validacao do branch de
-- insercao de save_material_record (414_material_pending_serial_flag_in_save_rpc.sql,
-- p_material_id is null): categoria/subcategoria ativas e vinculadas, UMB
-- obrigatorio e ativo, tipo em NOVO/SUCATA, preco >= 0, limites de estoque,
-- tipo de rastreio por serial valido e a regra de pendencia de identificacao
-- (so permitida para RELIGADOR/CHAVE). Como a validacao roda dentro do
-- Postgres, cada checagem e uma busca local por indice, sem round-trip de
-- rede por linha.

create or replace function public.save_material_records_batch(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_material_id uuid;
  v_constraint_name text;
  v_results jsonb := '[]'::jsonb;

  v_codigo text;
  v_descricao text;
  v_category_id uuid;
  v_subcategory_id uuid;
  v_umb text;
  v_tipo text;
  v_unit_price numeric;
  v_stock_minimum numeric;
  v_stock_maximum numeric;
  v_serial_tracking_type text;
  v_is_transformer boolean;
  v_allow_pending boolean;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Tenant e usuario ator sao obrigatorios para importacao em lote.'
    );
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ROWS_PAYLOAD',
      'message', 'Lista de linhas invalida para importacao em lote.'
    );
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_number := coalesce((v_row ->> 'rowNumber')::integer, 0);

    begin
      v_codigo := v_row ->> 'codigo';
      v_descricao := v_row ->> 'descricao';
      v_category_id := nullif(v_row ->> 'categoryId', '')::uuid;
      v_subcategory_id := nullif(v_row ->> 'subcategoryId', '')::uuid;
      v_umb := upper(btrim(coalesce(v_row ->> 'umb', '')));
      v_tipo := upper(btrim(coalesce(v_row ->> 'tipo', '')));
      v_unit_price := coalesce((v_row ->> 'unitPrice')::numeric, 0);
      v_stock_minimum := coalesce((v_row ->> 'stockMinimum')::numeric, 0);
      v_stock_maximum := nullif(v_row ->> 'stockMaximum', '')::numeric;
      v_serial_tracking_type := upper(btrim(coalesce(
        v_row ->> 'serialTrackingType',
        case when coalesce((v_row ->> 'isTransformer')::boolean, false) then 'TRAFO' else 'NONE' end
      )));
      v_allow_pending := coalesce((v_row ->> 'allowPendingSerialIdentification')::boolean, false);

      if v_category_id is null or v_subcategory_id is null then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'CATEGORY_REQUIRED',
          'message', 'Categoria e subcategoria sao obrigatorias para cadastro de material.'
        ));
        continue;
      end if;

      if not exists (
        select 1
        from public.material_subcategories subcategories
        join public.material_categories categories
          on categories.id = subcategories.category_id
         and categories.tenant_id = subcategories.tenant_id
        where categories.tenant_id = p_tenant_id
          and categories.id = v_category_id
          and categories.is_active = true
          and subcategories.id = v_subcategory_id
          and subcategories.is_active = true
      ) then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_CATEGORY',
          'message', 'Categoria ou subcategoria invalida para o tenant atual.'
        ));
        continue;
      end if;

      if v_umb = '' then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'UMB_REQUIRED',
          'message', 'UMB obrigatorio para cadastro de material.'
        ));
        continue;
      end if;

      if not exists (
        select 1
        from public.material_umb_options options
        where options.tenant_id = p_tenant_id
          and options.code = v_umb
          and options.is_active = true
      ) then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_UMB',
          'message', 'UMB invalida. Selecione M, KG ou UN.'
        ));
        continue;
      end if;

      if v_tipo not in ('NOVO', 'SUCATA') then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_TYPE',
          'message', 'Tipo invalido. Selecione NOVO ou SUCATA.'
        ));
        continue;
      end if;

      if v_unit_price < 0 then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_UNIT_PRICE',
          'message', 'Preco invalido. Informe valor maior ou igual a zero.'
        ));
        continue;
      end if;

      if v_stock_minimum < 0 or (v_stock_maximum is not null and v_stock_maximum < v_stock_minimum) then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_STOCK_LIMITS',
          'message', 'Limites de estoque invalidos. O maximo deve ser vazio ou maior/igual ao minimo.'
        ));
        continue;
      end if;

      if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'INVALID_SERIAL_TRACKING_TYPE',
          'message', 'Tipo de rastreio por serial invalido.'
        ));
        continue;
      end if;

      v_is_transformer := v_serial_tracking_type = 'TRAFO';

      if v_allow_pending and v_serial_tracking_type not in ('RELIGADOR', 'CHAVE') then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'PENDING_SERIAL_NOT_ALLOWED_FOR_TYPE',
          'message', case
            when v_serial_tracking_type = 'TRAFO'
              then 'Material TRAFO exige Serial e LP em qualquer movimentacao e nao aceita pendencia de identificacao.'
            else 'Pendencia de identificacao de serial so se aplica a material rastreado por serial (RELIGADOR ou CHAVE).'
          end
        ));
        continue;
      end if;

      insert into public.materials (
        tenant_id,
        codigo,
        descricao,
        category_id,
        subcategory_id,
        umb,
        tipo,
        is_transformer,
        serial_tracking_type,
        allow_pending_serial_identification,
        unit_price,
        stock_minimum,
        stock_maximum,
        is_active,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_codigo,
        v_descricao,
        v_category_id,
        v_subcategory_id,
        v_umb,
        v_tipo,
        v_is_transformer,
        v_serial_tracking_type,
        v_allow_pending,
        v_unit_price,
        v_stock_minimum,
        v_stock_maximum,
        true,
        p_actor_user_id,
        p_actor_user_id
      )
      returning id into v_material_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumber', v_row_number, 'success', true, 'materialId', v_material_id,
        'message', format('Material %s registrado com sucesso.', v_codigo)
      ));
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'DUPLICATE_MATERIAL_CODE',
          'message', 'Ja existe material com este codigo no tenant atual.'
        ));
      when others then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'UNEXPECTED_ERROR',
          'message', 'Falha inesperada ao salvar material.'
        ));
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'results', v_results
  );
end;
$$;

-- Mesma trava de save_material_record (393/414): so service_role executa,
-- nunca authenticated/anon/public.
revoke all on function public.save_material_records_batch(uuid, uuid, jsonb) from public;
revoke all on function public.save_material_records_batch(uuid, uuid, jsonb) from anon;
revoke all on function public.save_material_records_batch(uuid, uuid, jsonb) from authenticated;
grant execute on function public.save_material_records_batch(uuid, uuid, jsonb) to service_role;
