-- 405_allow_not_working_composition_with_optional_project.sql
-- Permite informar Projeto em composicao NOT_WORKING, mantendo Projeto opcional.

begin;

do $$
declare
  v_signature regprocedure := 'public.save_team_composition_record(uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid)'::regprocedure;
  v_definition text;
  v_step text;
begin
  select pg_get_functiondef(v_signature::oid)
    into v_definition;

  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$  if v_work_status = 'NOT_WORKING' then
    if p_project_id is not null
      or (
        p_project_ids is not null
        and (
          jsonb_typeof(p_project_ids) <> 'array'
          or jsonb_array_length(p_project_ids) > 0
        )
      ) then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'PROJECT_NOT_ALLOWED',
        'message', 'Projeto nao deve ser informado quando a equipe nao atuou.'
      );
    end if;

    if p_members is null$old$, chr(13) || chr(10), chr(10)),
    replace($new$  if v_work_status = 'NOT_WORKING' then
    v_project_payload := case
      when p_project_ids is not null and jsonb_typeof(p_project_ids) = 'array' then p_project_ids
      when p_project_id is not null then jsonb_build_array(p_project_id::text)
      else '[]'::jsonb
    end;

    if p_project_ids is not null and jsonb_typeof(p_project_ids) <> 'array' then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_PROJECT_LIST',
        'message', 'Lista de projetos invalida.'
      );
    end if;

    select count(*)
      into v_project_count
    from jsonb_array_elements(v_project_payload);

    if v_project_count > 0 then
      with input_projects as (
        select
          row_number() over () as sort_order,
          case
            when item.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (item.value #>> '{}')::uuid
            else null
          end as project_id
        from jsonb_array_elements(v_project_payload) as item(value)
      )
      select
        count(project_id),
        count(distinct project_id)
        into v_valid_project_count, v_distinct_project_count
      from input_projects;

      if v_valid_project_count <> v_project_count then
        return jsonb_build_object(
          'success', false,
          'status', 400,
          'reason', 'INVALID_PROJECT',
          'message', 'Um ou mais projetos da composicao sao invalidos.'
        );
      end if;

      if v_distinct_project_count <> v_project_count then
        return jsonb_build_object(
          'success', false,
          'status', 400,
          'reason', 'DUPLICATE_PROJECT',
          'message', 'O mesmo projeto nao pode aparecer duas vezes na composicao.'
        );
      end if;

      with input_projects as (
        select
          row_number() over () as sort_order,
          (item.value #>> '{}')::uuid as project_id
        from jsonb_array_elements(v_project_payload) as item(value)
      ),
      project_data as (
        select
          ip.sort_order,
          p.id,
          btrim(p.sob::text) as sob,
          nullif(btrim(coalesce(p.service_center_text::text, '')), '') as service_center_text
        from input_projects ip
        join public.project_with_labels p
          on p.tenant_id = p_tenant_id
         and p.id = ip.project_id
         and p.is_active = true
      )
      select
        count(*),
        (array_agg(id order by sort_order))[1],
        string_agg(sob, ', ' order by sort_order),
        string_agg(service_center_text, ', ' order by sort_order)
        into v_valid_project_count, v_primary_project_id, v_project_codes, v_project_centers
      from project_data;

      if v_valid_project_count <> v_project_count then
        return jsonb_build_object(
          'success', false,
          'status', 422,
          'reason', 'INVALID_PROJECT_TENANT',
          'message', 'Um ou mais projetos sao invalidos ou inativos para o tenant atual.'
        );
      end if;
    end if;

    if p_members is null$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '405: bloco de proibicao de Projeto em NOT_WORKING nao encontrado.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$        p_composition_date,
        null,
        p_team_id,
        null,
        null,
        btrim(v_team.name::text),$old$, chr(13) || chr(10), chr(10)),
    replace($new$        p_composition_date,
        v_primary_project_id,
        p_team_id,
        v_project_codes,
        v_project_centers,
        btrim(v_team.name::text),$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '405: bloco de insert NOT_WORKING da composicao nao encontrado.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$        project_id = null,
        team_id = p_team_id,
        project_code_snapshot = null,
        project_service_center_snapshot = null,$old$, chr(13) || chr(10), chr(10)),
    replace($new$        project_id = v_primary_project_id,
        team_id = p_team_id,
        project_code_snapshot = v_project_codes,
        project_service_center_snapshot = v_project_centers,$new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '405: bloco de update NOT_WORKING da composicao nao encontrado.';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    insert into public.team_composition_members (
      tenant_id,
      composition_id,
      person_id,
      person_name_snapshot,
      matriculation_snapshot,
      cpf_snapshot,
      phone_snapshot,
      job_title_snapshot,
      is_present,
      sort_order,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_composition_id,
      v_foreman.id,
      btrim(v_foreman.nome::text),
      nullif(btrim(coalesce(v_foreman.matriculation::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.cpf::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.phone::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.job_title_name::text, '')), ''),
      false,
      1,
      p_actor_user_id,
      p_actor_user_id
    );

    return jsonb_build_object($old$, chr(13) || chr(10), chr(10)),
    replace($new$    insert into public.team_composition_members (
      tenant_id,
      composition_id,
      person_id,
      person_name_snapshot,
      matriculation_snapshot,
      cpf_snapshot,
      phone_snapshot,
      job_title_snapshot,
      is_present,
      sort_order,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_composition_id,
      v_foreman.id,
      btrim(v_foreman.nome::text),
      nullif(btrim(coalesce(v_foreman.matriculation::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.cpf::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.phone::text, '')), ''),
      nullif(btrim(coalesce(v_foreman.job_title_name::text, '')), ''),
      false,
      1,
      p_actor_user_id,
      p_actor_user_id
    );

    insert into public.team_composition_projects (
      tenant_id,
      composition_id,
      project_id,
      project_code_snapshot,
      project_service_center_snapshot,
      sort_order,
      created_by,
      updated_by
    )
    with input_projects as (
      select
        row_number() over () as sort_order,
        (item.value #>> '{}')::uuid as project_id
      from jsonb_array_elements(v_project_payload) as item(value)
    )
    select
      p_tenant_id,
      v_composition_id,
      p.id,
      btrim(p.sob::text),
      nullif(btrim(coalesce(p.service_center_text::text, '')), ''),
      ip.sort_order,
      p_actor_user_id,
      p_actor_user_id
    from input_projects ip
    join public.project_with_labels p
      on p.tenant_id = p_tenant_id
     and p.id = ip.project_id
     and p.is_active = true
    order by ip.sort_order;

    return jsonb_build_object($new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '405: bloco de projetos vinculados em NOT_WORKING nao encontrado.';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid
) from public;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid
) from anon;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid
) from authenticated;
grant execute on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid
) to service_role;

do $$
declare
  v_fn regprocedure := 'public.save_team_composition_record(uuid, uuid, uuid, date, uuid, jsonb, uuid, text, time, text, jsonb, text, timestamptz, text, uuid)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_fn::oid)
    into v_definition;

  if v_definition like '%PROJECT_NOT_ALLOWED%' then
    raise exception '405: save_team_composition_record ainda bloqueia Projeto em NOT_WORKING.';
  end if;
  if v_definition not like '%v_work_status = ''NOT_WORKING''%' or v_definition not like '%v_project_count > 0%' then
    raise exception '405: save_team_composition_record nao recebeu a validacao de Projeto opcional em NOT_WORKING.';
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception '405: save_team_composition_record ainda executavel por anon.';
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '405: save_team_composition_record ainda executavel por authenticated.';
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception '405: save_team_composition_record sem EXECUTE para service_role.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
