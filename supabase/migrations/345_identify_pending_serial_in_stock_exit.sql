-- 345_identify_pending_serial_in_stock_exit.sql
-- Permite Saida de CHAVE/RELIGADOR com serial informado ainda nao identificado,
-- consumindo saldo pendente do centro DE antes da gravacao da movimentacao.

create or replace function public.save_stock_transfer_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_movement_type text,
  p_from_stock_center_id uuid,
  p_to_stock_center_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_direct_purchase boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => p_movement_type,
    p_from_stock_center_id => p_from_stock_center_id,
    p_to_stock_center_id => p_to_stock_center_id,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => p_entry_type,
    p_notes => p_notes,
    p_items => p_items,
    p_direct_purchase => p_direct_purchase,
    p_operation_purpose => 'NORMAL',
    p_balance_correction_reason => null
  );
end;
$$;

create or replace function public.save_stock_transfer_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_movement_type text,
  p_from_stock_center_id uuid,
  p_to_stock_center_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_direct_purchase boolean default false,
  p_operation_purpose text default 'NORMAL',
  p_balance_correction_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement_type text := upper(btrim(coalesce(p_movement_type, '')));
  v_operation_purpose text := upper(btrim(coalesce(p_operation_purpose, 'NORMAL')));
  v_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_balance_correction_reason text := nullif(btrim(coalesce(p_balance_correction_reason, '')), '');
  v_result jsonb;
  v_transfer_id uuid;
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_serial_number text;
  v_tracking_type text;
  v_material_code text;
  v_current_stock_center_id uuid;
  v_identify_result jsonb;
begin
  if v_operation_purpose not in ('NORMAL', 'BALANCE_CORRECTION') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_OPERATION_PURPOSE',
      'message', 'Finalidade da operacao deve ser NORMAL ou BALANCE_CORRECTION.'
    );
  end if;

  if v_operation_purpose = 'BALANCE_CORRECTION' and v_balance_correction_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'BALANCE_CORRECTION_REASON_REQUIRED',
      'message', 'Motivo da correcao de saldo e obrigatorio.'
    );
  end if;

  begin
    if v_movement_type = 'EXIT' and v_operation_purpose = 'NORMAL' then
      for v_item in
        select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
      loop
        begin
          v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
        exception
          when others then
            v_material_id := null;
        end;

        begin
          v_quantity := (v_item ->> 'quantity')::numeric;
        exception
          when others then
            v_quantity := null;
        end;

        v_serial_number := nullif(btrim(coalesce(v_item ->> 'serialNumber', '')), '');

        if v_material_id is null or v_serial_number is null then
          continue;
        end if;

        select
          case
            when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
            when coalesce(m.is_transformer, false) then 'TRAFO'
            else 'NONE'
          end,
          m.codigo
        into v_tracking_type, v_material_code
        from public.materials m
        where m.id = v_material_id
          and m.tenant_id = p_tenant_id
          and m.is_active = true;

        if not found or v_tracking_type in ('NONE', 'TRAFO') then
          continue;
        end if;

        if v_quantity <> 1 then
          v_result := jsonb_build_object(
            'success', false,
            'status', 400,
            'reason', 'SERIAL_TRACKED_QUANTITY_MUST_BE_ONE',
            'message', format('Material rastreavel por serial permite somente quantidade 1 por movimentacao: %s.', coalesce(v_material_code, v_material_id::text))
          );
          raise exception 'STOCK_EXIT_PENDING_SERIAL_ROLLBACK';
        end if;

        select ti.current_stock_center_id
        into v_current_stock_center_id
        from public.trafo_instances ti
        where ti.tenant_id = p_tenant_id
          and ti.material_id = v_material_id
          and ti.serial_number = v_serial_number
          and ti.lot_code = '-'
        for update;

        if found and v_current_stock_center_id is not null and v_current_stock_center_id is distinct from p_from_stock_center_id then
          v_result := jsonb_build_object(
            'success', false,
            'status', 409,
            'reason', 'SERIAL_TRACKED_UNIT_NOT_IN_FROM_CENTER',
            'message', format('A unidade por serial informada nao esta disponivel no centro de origem: %s / Serial %s.', coalesce(v_material_code, v_material_id::text), v_serial_number)
          );
          raise exception 'STOCK_EXIT_PENDING_SERIAL_ROLLBACK';
        end if;

        if not found or v_current_stock_center_id is null then
          v_identify_result := public.identify_pending_serial_tracked_unit(
            p_tenant_id,
            p_actor_user_id,
            v_material_id,
            p_from_stock_center_id,
            p_project_id,
            v_entry_type,
            v_serial_number
          );

          if coalesce((v_identify_result ->> 'success')::boolean, false) is not true then
            v_result := v_identify_result;
            raise exception 'STOCK_EXIT_PENDING_SERIAL_ROLLBACK';
          end if;
        end if;
      end loop;
    end if;

    v_result := public.save_stock_transfer_record_direct_purchase_v209(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_movement_type => p_movement_type,
      p_from_stock_center_id => p_from_stock_center_id,
      p_to_stock_center_id => p_to_stock_center_id,
      p_project_id => p_project_id,
      p_entry_date => p_entry_date,
      p_entry_type => p_entry_type,
      p_notes => p_notes,
      p_items => p_items,
      p_direct_purchase => p_direct_purchase
    );

    if coalesce((v_result ->> 'success')::boolean, false) is not true then
      raise exception 'STOCK_EXIT_PENDING_SERIAL_ROLLBACK';
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'STOCK_EXIT_PENDING_SERIAL_ROLLBACK' then
        return coalesce(v_result, jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'STOCK_TRANSFER_ROLLBACK',
          'message', 'Falha ao salvar movimentacao de estoque.'
        ));
      end if;
      raise;
  end;

  begin
    v_transfer_id := nullif(v_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  if v_transfer_id is null then
    return v_result;
  end if;

  perform set_config('app.stock_transfer_internal_update', 'true', true);

  update public.stock_transfers
  set
    operation_purpose = v_operation_purpose,
    balance_correction_reason = case
      when v_operation_purpose = 'BALANCE_CORRECTION' then v_balance_correction_reason
      else null
    end,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_transfer_id;

  if v_operation_purpose = 'BALANCE_CORRECTION' then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    )
    select
      item.tenant_id,
      item.material_id,
      'UPDATE',
      jsonb_build_object(
        '_context', 'STOCK_TRANSFER_BALANCE_CORRECTION',
        '_action', 'BALANCE_CORRECTION',
        'stockTransferId', v_transfer_id::text,
        'operationPurpose', jsonb_build_object('from', 'NORMAL', 'to', v_operation_purpose),
        'balanceCorrectionReason', jsonb_build_object('from', null, 'to', v_balance_correction_reason)
      ),
      p_actor_user_id,
      p_actor_user_id
    from public.stock_transfer_items item
    where item.tenant_id = p_tenant_id
      and item.stock_transfer_id = v_transfer_id;
  end if;

  return v_result
    || jsonb_build_object(
      'operation_purpose', v_operation_purpose,
      'balance_correction_reason', v_balance_correction_reason
    );
end;
$$;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from public;
revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from anon;
revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to service_role;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from public;
revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from anon;
revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) to service_role;
