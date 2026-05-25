-- 194_measurement_programming_unique_by_context.sql
-- Permite nova Ordem de Medicao quando a mesma Programacao foi reprogramada para outra data,
-- mantendo bloqueio para duplicidade no mesmo Projeto + Equipe + Data execucao.

drop index if exists public.idx_project_measurement_orders_programming_unique;

create unique index if not exists idx_project_measurement_orders_programming_context_unique
  on public.project_measurement_orders (tenant_id, programming_id, project_id, team_id, execution_date)
  where programming_id is not null;

do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    $block$where tenant_id = p_tenant_id and programming_id = v_link_programming_id$block$,
    $block$where tenant_id = p_tenant_id and programming_id = v_link_programming_id
        and project_id = v_project_id
        and team_id = v_team_id
        and execution_date = v_execution_date$block$
  );

  v_definition := replace(
    v_definition,
    $block$where tenant_id = p_tenant_id
        and programming_id = v_link_programming_id
        and id <> v_order_id$block$,
    $block$where tenant_id = p_tenant_id
        and programming_id = v_link_programming_id
        and project_id = v_project_id
        and team_id = v_team_id
        and execution_date = v_execution_date
        and id <> v_order_id$block$
  );

  if v_definition = v_original then
    raise exception 'Nao foi possivel atualizar a regra de duplicidade de save_project_measurement_order.';
  end if;

  execute v_definition;
end;
$$;
