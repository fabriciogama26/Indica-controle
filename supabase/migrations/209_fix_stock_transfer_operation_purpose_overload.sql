-- 209_fix_stock_transfer_operation_purpose_overload.sql
-- Remove a ambiguidade interna entre as assinaturas de save_stock_transfer_record
-- apos a criacao da wrapper com operation_purpose na migration 206.

do $$
begin
  if to_regprocedure('public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean)') is null
     and to_regprocedure('public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean)') is not null then
    alter function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean)
      rename to save_stock_transfer_record_direct_purchase_v209;
  end if;
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
  p_direct_purchase boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.save_stock_transfer_record_direct_purchase_v209(
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
  v_operation_purpose text := upper(btrim(coalesce(p_operation_purpose, 'NORMAL')));
  v_balance_correction_reason text := nullif(btrim(coalesce(p_balance_correction_reason, '')), '');
  v_result jsonb;
  v_transfer_id uuid;
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
    return v_result;
  end if;

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

revoke all on function public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from public;
grant execute on function public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to authenticated;
grant execute on function public.save_stock_transfer_record_direct_purchase_v209(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to service_role;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) from public;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean) to service_role;

revoke all on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) from public;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) to authenticated;
grant execute on function public.save_stock_transfer_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb, boolean, text, text) to service_role;

select set_config('app.stock_transfer_internal_update', 'false', true);
