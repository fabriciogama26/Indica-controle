-- 202_enforce_measurement_unique_project_team_date.sql
-- Bloqueia novas Ordens de Medicao repetidas por Projeto + Equipe + Data execucao,
-- preservando escopo por tenant e sem depender do vinculo de Programacao.

create index if not exists idx_project_measurement_orders_context_lookup
  on public.project_measurement_orders (tenant_id, project_id, team_id, execution_date);

create or replace function public.enforce_project_measurement_order_context_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null or new.project_id is null or new.team_id is null or new.execution_date is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(format(
    '%s|%s|%s|%s',
    new.tenant_id::text,
    new.project_id::text,
    new.team_id::text,
    new.execution_date::text
  ))::bigint);

  if exists (
    select 1
    from public.project_measurement_orders mo
    where mo.tenant_id = new.tenant_id
      and mo.project_id = new.project_id
      and mo.team_id = new.team_id
      and mo.execution_date = new.execution_date
      and mo.id <> new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'Ja existe ordem de medicao para este Projeto + Equipe + Data de execucao.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_measurement_orders_context_unique on public.project_measurement_orders;
create trigger trg_project_measurement_orders_context_unique
  before insert or update of project_id, team_id, execution_date
  on public.project_measurement_orders
  for each row
  execute function public.enforce_project_measurement_order_context_unique();

do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_original := v_definition;

  if position('MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      $block$    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios.');
    end if;

    if v_link_programming_id is null then$block$,
      $block$    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios.');
    end if;

    perform pg_advisory_xact_lock(hashtext(format('%s|%s|%s|%s', p_tenant_id::text, v_project_id::text, v_team_id::text, v_execution_date::text))::bigint);

    if exists (
      select 1
      from public.project_measurement_orders
      where tenant_id = p_tenant_id
        and project_id = v_project_id
        and team_id = v_team_id
        and execution_date = v_execution_date
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS', 'message', 'Ja existe ordem de medicao para este Projeto + Equipe + Data de execucao.');
    end if;

    if v_link_programming_id is null then$block$
    );

    v_definition := replace(
      v_definition,
      $block$    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios na edicao.');
    end if;

    select sob into v_project_code$block$,
      $block$    if v_project_id is null or v_team_id is null or v_execution_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', 'Projeto, equipe e data de execucao sao obrigatorios na edicao.');
    end if;

    perform pg_advisory_xact_lock(hashtext(format('%s|%s|%s|%s', p_tenant_id::text, v_project_id::text, v_team_id::text, v_execution_date::text))::bigint);

    if exists (
      select 1
      from public.project_measurement_orders
      where tenant_id = p_tenant_id
        and project_id = v_project_id
        and team_id = v_team_id
        and execution_date = v_execution_date
        and id <> v_order_id
    ) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS', 'message', 'Ja existe ordem de medicao para este Projeto + Equipe + Data de execucao.');
    end if;

    select sob into v_project_code$block$
    );

    if v_definition = v_original then
      raise exception 'Nao foi possivel aplicar a regra de duplicidade por Projeto + Equipe + Data na RPC de Medicao.';
    end if;

    v_definition := replace(
      v_definition,
      $block$return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_ALREADY_EXISTS', 'message', 'Ja existe ordem para esta programacao.')$block$,
      $block$return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS', 'message', 'Ja existe ordem de medicao para este Projeto + Equipe + Data de execucao.')$block$
    );

    execute v_definition;
  end if;
end;
$$;
