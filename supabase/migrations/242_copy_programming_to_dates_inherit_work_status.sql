-- 242_copy_programming_to_dates_inherit_work_status.sql
-- Corrige a copia de Programacao para datas para herdar o ultimo Estado Trabalho valido da obra.
-- A definicao atual da RPC e reaplicada com uma troca pontual para preservar as
-- validacoes e o comportamento transacional ja versionados.

do $$
declare
  v_function_signature text := 'public.copy_project_programming_to_dates(uuid,uuid,uuid,timestamp with time zone,jsonb)';
  v_function_definition text;
  v_changed boolean := false;
  v_declaration_anchor text := '  v_structured_error jsonb;
begin';
  v_declaration_patch text := '  v_structured_error jsonb;
  v_inherited_work_completion_status text;
begin';
  v_inheritance_anchor text := '  for v_target in select value from jsonb_array_elements(p_targets) loop';
  v_inheritance_patch text := '  select c.code
  into v_inherited_work_completion_status
  from public.project_programming pp
  join public.programming_work_completion_catalog c
    on c.tenant_id = pp.tenant_id
   and c.code = public.normalize_programming_work_completion_code(pp.work_completion_status)
   and c.is_active = true
  where pp.tenant_id = p_tenant_id
    and pp.project_id = v_source_item.project_id
    and pp.status <> ''CANCELADA''
    and pp.work_completion_status is not null
  order by pp.execution_date desc, pp.updated_at desc
  limit 1;

  if v_inherited_work_completion_status is null then
    select c.code
    into v_inherited_work_completion_status
    from public.programming_work_completion_catalog c
    where c.tenant_id = p_tenant_id
      and c.code = ''PARCIAL''
      and c.is_active = true
    limit 1;
  end if;

  if v_inherited_work_completion_status is null then
    return jsonb_build_object(
      ''success'', false,
      ''status'', 409,
      ''reason'', ''WORK_COMPLETION_STATUS_REQUIRED'',
      ''message'', ''Estado Trabalho PARCIAL nao esta ativo no catalogo do tenant atual.''
    );
  end if;

  for v_target in select value from jsonb_array_elements(p_targets) loop';
  v_old_fragment text := 'p_work_completion_status => null';
  v_new_fragment text := 'p_work_completion_status => v_inherited_work_completion_status';
begin
  select pg_get_functiondef(v_function_signature::regprocedure)
  into v_function_definition;

  if v_function_definition is null then
    raise exception 'copy_project_programming_to_dates nao encontrada. Aplique a migration 217 antes da 242.';
  end if;

  if position('v_inherited_work_completion_status text' in v_function_definition) = 0 then
    if position(v_declaration_anchor in v_function_definition) = 0 then
      raise exception
        'Nao foi possivel localizar a declaracao para heranca do Estado Trabalho em copy_project_programming_to_dates.';
    end if;

    v_function_definition := replace(v_function_definition, v_declaration_anchor, v_declaration_patch);
    v_changed := true;
  end if;

  if position('WORK_COMPLETION_STATUS_REQUIRED' in v_function_definition) = 0 then
    if position(v_inheritance_anchor in v_function_definition) = 0 then
      raise exception
        'Nao foi possivel localizar o ponto de resolucao do Estado Trabalho em copy_project_programming_to_dates.';
    end if;

    v_function_definition := replace(v_function_definition, v_inheritance_anchor, v_inheritance_patch);
    v_changed := true;
  end if;

  if position(v_old_fragment in v_function_definition) > 0 then
    v_function_definition := replace(v_function_definition, v_old_fragment, v_new_fragment);
    v_changed := true;
  elsif position('p_work_completion_status => v_source_item.work_completion_status' in v_function_definition) > 0 then
    v_function_definition := replace(
      v_function_definition,
      'p_work_completion_status => v_source_item.work_completion_status',
      v_new_fragment
    );
    v_changed := true;
  elsif position(v_new_fragment in v_function_definition) = 0 then
    raise exception
      'Nao foi possivel localizar o ponto de heranca do Estado Trabalho em copy_project_programming_to_dates.';
  end if;

  if v_changed then
    execute v_function_definition;
  end if;
end;
$$;

alter function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
)
set search_path = public, pg_temp;

revoke all on function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function public.copy_project_programming_to_dates(
  uuid,
  uuid,
  uuid,
  timestamptz,
  jsonb
) to service_role;

do $$
declare
  v_function_oid oid :=
    'public.copy_project_programming_to_dates(uuid,uuid,uuid,timestamp with time zone,jsonb)'
      ::regprocedure::oid;
begin
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
    or has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
    raise exception
      'copy_project_programming_to_dates nao pode ser executada por anon/authenticated';
  end if;

  if not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
    raise exception
      'copy_project_programming_to_dates deve permanecer executavel por service_role';
  end if;
end;
$$;
