-- 298_harden_security_definer_execute_grants.sql
-- Fecha alertas do Supabase Advisor para RPCs SECURITY DEFINER expostas a anon/authenticated.
--
-- O SaaS chama estas RPCs somente pelos Route Handlers com service_role, depois de validar
-- bearer token, tenant ativo e permissao de pagina no backend. Portanto anon/authenticated
-- nao devem executar diretamente via PostgREST /rpc.

revoke all on function public.cancel_stock_requisition_request(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_stock_requisition_request(uuid, uuid, uuid)
to service_role;

revoke all on function public.claim_stock_requisition_request(uuid, uuid, text, uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_stock_requisition_request(uuid, uuid, text, uuid, integer)
to service_role;

revoke all on function public.create_stock_requisition_request(uuid, uuid, text, uuid, uuid, uuid, date, text, jsonb)
from public, anon, authenticated;
grant execute on function public.create_stock_requisition_request(uuid, uuid, text, uuid, uuid, uuid, date, text, jsonb)
to service_role;

revoke all on function public.fulfill_stock_requisition_request(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.fulfill_stock_requisition_request(uuid, uuid, uuid, jsonb)
to service_role;

revoke all on function public.release_stock_requisition_claim(uuid, uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.release_stock_requisition_claim(uuid, uuid, uuid, boolean)
to service_role;

revoke all on function public.stock_requisition_actor_allowed(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.stock_requisition_actor_allowed(uuid, uuid)
to service_role;

revoke all on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb)
to service_role;

revoke all on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)
from public, anon, authenticated;
grant execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)
to service_role;

revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz)
to service_role;

revoke all on function public.user_has_page_action(text, text)
from public, anon, authenticated;
grant execute on function public.user_has_page_action(text, text)
to service_role;

do $$
declare
  v_function text;
  v_functions text[] := array[
    'public.cancel_stock_requisition_request(uuid, uuid, uuid)',
    'public.claim_stock_requisition_request(uuid, uuid, text, uuid, integer)',
    'public.create_stock_requisition_request(uuid, uuid, text, uuid, uuid, uuid, date, text, jsonb)',
    'public.fulfill_stock_requisition_request(uuid, uuid, uuid, jsonb)',
    'public.release_stock_requisition_claim(uuid, uuid, uuid, boolean)',
    'public.stock_requisition_actor_allowed(uuid, uuid)',
    'public.save_project_asbuilt_measurement_order_batch_partial(uuid, uuid, jsonb)',
    'public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)',
    'public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz)',
    'public.user_has_page_action(text, text)'
  ];
begin
  foreach v_function in array v_functions loop
    if has_function_privilege('anon', v_function, 'execute') then
      raise exception '298: funcao % ainda executavel por anon', v_function;
    end if;

    if has_function_privilege('authenticated', v_function, 'execute') then
      raise exception '298: funcao % ainda executavel por authenticated', v_function;
    end if;

    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '298: funcao % sem EXECUTE para service_role', v_function;
    end if;
  end loop;
end;
$$;
