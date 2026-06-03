-- 216_fix_reversal_operation_purpose_rpc_calls.sql
-- Garante que RPCs de estorno chamem save_stock_transfer_record com assinatura completa
-- apos a inclusao de operation_purpose e a remocao da ambiguidade de overload.

do $$
declare
  v_signature regprocedure;
  v_definition text;
  v_original text;
begin
  foreach v_signature in array array[
    'public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date)'::regprocedure,
    'public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature::oid)
    into v_definition;

    v_original := v_definition;

    v_definition := replace(
      v_definition,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => coalesce(v_original.direct_purchase, false)
  );$block$,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => coalesce(v_original.direct_purchase, false),
    p_operation_purpose => 'NORMAL',
    p_balance_correction_reason => null
  );$block$
    );

    v_definition := replace(
      v_definition,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => false
  );$block$,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => false,
    p_operation_purpose => 'NORMAL',
    p_balance_correction_reason => null
  );$block$
    );

    v_definition := replace(
      v_definition,
      $block$    p_items => v_reversal_items
  );$block$,
      $block$    p_items => v_reversal_items,
    p_direct_purchase => false,
    p_operation_purpose => 'NORMAL',
    p_balance_correction_reason => null
  );$block$
    );

    if v_definition = v_original and v_definition not like '%p_operation_purpose => ''NORMAL''%' then
      raise exception 'Nao foi possivel atualizar chamada de save_stock_transfer_record em %.', v_signature::text;
    end if;

    if v_definition <> v_original then
      execute v_definition;
    end if;
  end loop;
end;
$$;

revoke all on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_stock_transfer_item_record_v1(uuid, uuid, uuid, text, text, date) to service_role;

revoke all on function public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_stock_transfer_record_v2(uuid, uuid, uuid, text, text, date) to service_role;

revoke all on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_team_stock_operation_item_record_v1(uuid, uuid, uuid, text, text, date) to service_role;
