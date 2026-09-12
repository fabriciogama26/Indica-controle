-- 382_allow_no_project_no_production_measurement.sql
-- Permite Ordem de Medicao SEM_PRODUCAO sem Projeto, mantendo Projeto obrigatorio
-- para COM_PRODUCAO e preservando a escrita transacional pela RPC existente.

alter table if exists public.project_measurement_orders
  alter column project_id drop not null,
  alter column project_code_snapshot drop not null;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_project_required_by_kind_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_project_required_by_kind_check
  check (
    (
      measurement_kind = 'COM_PRODUCAO'
      and project_id is not null
      and btrim(coalesce(project_code_snapshot, '')) <> ''
    )
    or (
      measurement_kind = 'SEM_PRODUCAO'
      and (
        project_id is not null
        or (
          project_id is null
          and programming_id is null
          and project_code_snapshot is null
          and programming_completion_status_snapshot is null
          and programming_completion_status_snapshot_at is null
        )
      )
    )
  );

create or replace function public.enforce_project_measurement_order_context_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_lock_token text;
begin
  if new.tenant_id is null or new.team_id is null or new.execution_date is null then
    return new;
  end if;

  if new.project_id is null and new.measurement_kind <> 'SEM_PRODUCAO' then
    return new;
  end if;

  v_project_lock_token := coalesce(new.project_id::text, 'SEM_PRODUCAO_SEM_PROJETO');
  perform pg_advisory_xact_lock(hashtext(format(
    '%s|%s|%s|%s',
    new.tenant_id::text,
    v_project_lock_token,
    new.team_id::text,
    new.execution_date::text
  ))::bigint);

  if new.project_id is null then
    if exists (
      select 1
      from public.project_measurement_orders mo
      where mo.tenant_id = new.tenant_id
        and mo.project_id is null
        and mo.measurement_kind = 'SEM_PRODUCAO'
        and mo.team_id = new.team_id
        and mo.execution_date = new.execution_date
        and mo.id <> new.id
    ) then
      raise exception using
        errcode = '23505',
        message = 'Ja existe ordem de medicao sem projeto para esta Equipe + Data de execucao.';
    end if;

    return new;
  end if;

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

do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_step text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_project_id is null or v_team_id is null or v_execution_date is null then
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

    if v_link_programming_id is null then$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios.' else 'Equipe e data de execucao sao obrigatorias.' end);
    end if;

    if v_project_id is null then
      perform pg_advisory_xact_lock(hashtext(format('%s|SEM_PRODUCAO_SEM_PROJETO|%s|%s', p_tenant_id::text, v_team_id::text, v_execution_date::text))::bigint);

      if exists (
        select 1
        from public.project_measurement_orders
        where tenant_id = p_tenant_id
          and project_id is null
          and measurement_kind = 'SEM_PRODUCAO'
          and team_id = v_team_id
          and execution_date = v_execution_date
      ) then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS', 'message', 'Ja existe ordem de medicao sem projeto para esta Equipe + Data de execucao.');
      end if;
    else
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
    end if;

    if v_project_id is not null and v_link_programming_id is null then$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '382: bloco de contexto CREATE nao encontrado em save_project_measurement_order.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_project_code is null then
      select sob into v_project_code from public.project where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
      end if;
    end if;$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_project_id is null then
      v_project_code := null;
      v_link_programming_id := null;
      v_programming_completion_status := null;
      v_programming_completion_updated_at := null;
    elsif v_project_code is null then
      select sob into v_project_code from public.project where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
      end if;
    end if;$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '382: bloco de projeto CREATE nao encontrado em save_project_measurement_order.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_project_id is null or v_team_id is null or v_execution_date is null then
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

    select sob into v_project_code
    from public.project
    where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
    end if;$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios na edicao.' else 'Equipe e data de execucao sao obrigatorias na edicao.' end);
    end if;

    if v_project_id is null then
      perform pg_advisory_xact_lock(hashtext(format('%s|SEM_PRODUCAO_SEM_PROJETO|%s|%s', p_tenant_id::text, v_team_id::text, v_execution_date::text))::bigint);

      if exists (
        select 1
        from public.project_measurement_orders
        where tenant_id = p_tenant_id
          and project_id is null
          and measurement_kind = 'SEM_PRODUCAO'
          and team_id = v_team_id
          and execution_date = v_execution_date
          and id <> v_order_id
      ) then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'MEASUREMENT_ORDER_CONTEXT_ALREADY_EXISTS', 'message', 'Ja existe ordem de medicao sem projeto para esta Equipe + Data de execucao.');
      end if;

      v_project_code := null;
      v_link_programming_id := null;
      v_programming_completion_status := null;
      v_programming_completion_updated_at := null;
    else
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

      select sob into v_project_code
      from public.project
      where tenant_id = p_tenant_id and id = v_project_id and is_active = true;
      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto invalido para ordem de medicao.');
      end if;
    end if;$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '382: bloco de contexto EDIT nao encontrado em save_project_measurement_order.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_order.project_id <> v_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id::text, 'to', v_project_id::text));
    end if;$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_order.project_id is distinct from v_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id::text, 'to', v_project_id::text));
    end if;$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '382: bloco de historico de projeto nao encontrado em save_project_measurement_order.';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.enforce_project_measurement_order_context_unique() from public;
revoke all on function public.enforce_project_measurement_order_context_unique() from anon;
revoke all on function public.enforce_project_measurement_order_context_unique() from authenticated;
grant execute on function public.enforce_project_measurement_order_context_unique() to service_role;

revoke all on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) from public;
revoke all on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) from anon;
revoke all on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) from authenticated;
grant execute on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) to service_role;

do $$
declare
  v_fn regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception '382: save_project_measurement_order ainda executavel por anon';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '382: save_project_measurement_order ainda executavel por authenticated';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '382: save_project_measurement_order sem EXECUTE para service_role';
  end if;
end;
$$;
