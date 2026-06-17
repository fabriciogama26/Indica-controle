-- 243_block_material_serial_tracking_downgrade.sql
-- Bloqueia alteracao/remocao acidental de rastreio por serial quando o material ja possui uso serializado.

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_umb text default null,
  p_tipo text default null,
  p_is_transformer boolean default false,
  p_unit_price numeric default null,
  p_serial_tracking_type text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_umb text := btrim(coalesce(p_umb, ''));
  v_unit_price numeric := coalesce(p_unit_price, 0);
  v_serial_tracking_type text := upper(btrim(coalesce(
    p_serial_tracking_type,
    case when coalesce(p_is_transformer, false) then 'TRAFO' else 'NONE' end
  )));
  v_current_serial_tracking_type text;
  v_is_transformer boolean;
  v_has_serial_tracking_usage boolean := false;
begin
  if v_umb = '' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'UMB_REQUIRED',
      'message', 'UMB obrigatorio para cadastro de material.'
    );
  end if;

  if v_tipo not in ('NOVO', 'SUCATA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TYPE',
      'message', 'Tipo invalido. Selecione NOVO ou SUCATA.'
    );
  end if;

  if v_unit_price < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_UNIT_PRICE',
      'message', 'Preco invalido. Informe valor maior ou igual a zero.'
    );
  end if;

  if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SERIAL_TRACKING_TYPE',
      'message', 'Tipo de rastreio por serial invalido.'
    );
  end if;

  v_is_transformer := v_serial_tracking_type = 'TRAFO';

  if p_material_id is null then
    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      umb,
      tipo,
      is_transformer,
      serial_tracking_type,
      unit_price,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      v_umb,
      v_tipo,
      v_is_transformer,
      v_serial_tracking_type,
      v_unit_price,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo)
    );
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  v_current_serial_tracking_type := upper(btrim(coalesce(
    v_current.serial_tracking_type,
    case when coalesce(v_current.is_transformer, false) then 'TRAFO' else 'NONE' end
  )));

  if v_current_serial_tracking_type in ('TRAFO', 'RELIGADOR', 'CHAVE')
    and v_current_serial_tracking_type <> v_serial_tracking_type
  then
    select (
      exists (
        select 1
        from public.trafo_instances ti
        where ti.tenant_id = p_tenant_id
          and ti.material_id = p_material_id
        limit 1
      )
      or exists (
        select 1
        from public.stock_transfer_items sti
        where sti.tenant_id = p_tenant_id
          and sti.material_id = p_material_id
          and nullif(btrim(coalesce(sti.serial_number, '')), '') is not null
        limit 1
      )
    )
    into v_has_serial_tracking_usage;

    if coalesce(v_has_serial_tracking_usage, false) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'SERIAL_TRACKING_IN_USE',
        'message', 'Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.'
      );
    end if;
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    umb = v_umb,
    tipo = v_tipo,
    is_transformer = v_is_transformer,
    serial_tracking_type = v_serial_tracking_type,
    unit_price = v_unit_price,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) from public;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) to authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz) to service_role;
