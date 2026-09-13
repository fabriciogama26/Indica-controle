-- 438_create_save_project_records_batch_rpc.sql
-- Cria a RPC de insercao em lote para o cadastro em massa de Projetos,
-- substituindo o pior caso encontrado entre os modulos com importacao em massa:
-- resolveProjectLookups (src/app/api/projects/route.ts) roda 10 queries em
-- paralelo POR LINHA do arquivo, sem nenhum cache, para resolver nome -> id em
-- 8 catalogos, o contrato ativo (Parceira) e a pessoa Responsavel Contratada
-- (Supervisor).
--
-- Em vez de replicar esse prefetch em JS, esta RPC recebe os NOMES normalizados
-- (nao UUIDs) e resolve cada lookup dentro do proprio loop em PL/pgSQL --
-- buscas locais por indice dentro do Postgres, sem round-trip de rede por
-- linha. O contrato ativo e os cargos SUPERVISOR sao resolvidos uma vez, antes
-- do loop, porque nao variam por linha.
--
-- Mensagens/codigos replicam exatamente resolveLookupByName e
-- resolveContractorResponsibleSupervisorByName (route.ts): campo obrigatorio
-- vazio -> "Selecione <campo>."; campo preenchido sem match -> "<campo>
-- invalido(a)."; campo opcional vazio -> ok (null).
--
-- Validacao de FORMATO (data ISO, obrigatoriedade, faixa de latitude/longitude)
-- continua em src/server/modules/projects/import.ts, no mesmo lugar de sempre
-- (save_project_record tambem nao revalida formato, so existencia/estado).

create or replace function public.save_project_records_batch(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_project_id uuid;
  v_results jsonb := '[]'::jsonb;

  v_partner_id uuid;
  v_supervisor_job_title_ids uuid[];

  v_name text;
  v_priority_id uuid;
  v_service_center_id uuid;
  v_service_type_id uuid;
  v_voltage_level_id uuid;
  v_project_size_id uuid;
  v_municipality_id uuid;
  v_contractor_responsible_id uuid;
  v_utility_responsible_id uuid;
  v_utility_field_manager_id uuid;

  v_row_failed boolean;
  v_fail_reason text;
  v_fail_message text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Tenant e usuario ator sao obrigatorios para importacao em lote.'
    );
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ROWS_PAYLOAD',
      'message', 'Lista de linhas invalida para importacao em lote.'
    );
  end if;

  select id into v_partner_id
  from public.contract
  where tenant_id = p_tenant_id
    and ativo = true
  limit 1;

  if v_partner_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NO_ACTIVE_CONTRACT',
      'message', 'Nao foi encontrado contrato ativo com campo name para preencher Parceira automaticamente.'
    );
  end if;

  select array_agg(id)
  into v_supervisor_job_title_ids
  from public.job_titles
  where tenant_id = p_tenant_id
    and ativo = true
    and upper(code) = 'SUPERVISOR';

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_number := coalesce((v_row ->> 'rowNumber')::integer, 0);
    v_row_failed := false;

    begin
      -- Prioridade (obrigatorio)
      v_name := upper(btrim(coalesce(v_row ->> 'priority', '')));
      if v_name = '' then
        v_row_failed := true; v_fail_reason := 'INVALID_PRIORITY'; v_fail_message := 'Selecione a Prioridade.';
      else
        select id into v_priority_id from public.project_priorities
        where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
        if v_priority_id is null then
          v_row_failed := true; v_fail_reason := 'INVALID_PRIORITY'; v_fail_message := 'a Prioridade invalido(a).';
        end if;
      end if;

      -- Centro de Servico (obrigatorio)
      if not v_row_failed then
        v_name := upper(btrim(coalesce(v_row ->> 'serviceCenter', '')));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_SERVICE_CENTER'; v_fail_message := 'Selecione o Centro de Servico.';
        else
          select id into v_service_center_id from public.project_service_centers
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_service_center_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_SERVICE_CENTER'; v_fail_message := 'o Centro de Servico invalido(a).';
          end if;
        end if;
      end if;

      -- Tipo de Servico (obrigatorio)
      if not v_row_failed then
        v_name := upper(btrim(coalesce(v_row ->> 'serviceType', '')));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_SERVICE_TYPE'; v_fail_message := 'Selecione o Tipo de Servico.';
        else
          select id into v_service_type_id from public.project_service_types
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_service_type_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_SERVICE_TYPE'; v_fail_message := 'o Tipo de Servico invalido(a).';
          end if;
        end if;
      end if;

      -- Nivel de Tensao (opcional)
      if not v_row_failed then
        v_voltage_level_id := null;
        v_name := upper(btrim(coalesce(v_row ->> 'voltageLevel', '')));
        if v_name <> '' then
          select id into v_voltage_level_id from public.project_voltage_levels
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_voltage_level_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_VOLTAGE_LEVEL'; v_fail_message := 'o Nivel de Tensao invalido(a).';
          end if;
        end if;
      end if;

      -- Porte (opcional)
      if not v_row_failed then
        v_project_size_id := null;
        v_name := upper(btrim(coalesce(v_row ->> 'projectSize', '')));
        if v_name <> '' then
          select id into v_project_size_id from public.project_sizes
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_project_size_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_PROJECT_SIZE'; v_fail_message := 'o Porte invalido(a).';
          end if;
        end if;
      end if;

      -- Municipio (obrigatorio)
      if not v_row_failed then
        v_name := upper(btrim(coalesce(v_row ->> 'city', '')));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_MUNICIPALITY'; v_fail_message := 'Selecione o Municipio.';
        else
          select id into v_municipality_id from public.project_municipalities
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_municipality_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_MUNICIPALITY'; v_fail_message := 'o Municipio invalido(a).';
          end if;
        end if;
      end if;

      -- Responsavel Contratada / Supervisor (obrigatorio, pessoa com cargo SUPERVISOR)
      if not v_row_failed then
        v_name := btrim(coalesce(v_row ->> 'contractorResponsible', ''));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_CONTRACTOR_RESPONSIBLE'; v_fail_message := 'Selecione o Responsavel Contratada (Supervisor).';
        elsif coalesce(array_length(v_supervisor_job_title_ids, 1), 0) = 0 then
          v_row_failed := true; v_fail_reason := 'INVALID_CONTRACTOR_RESPONSIBLE'; v_fail_message := 'o Responsavel Contratada (Supervisor) invalido(a).';
        else
          select id into v_contractor_responsible_id from public.people
          where tenant_id = p_tenant_id
            and ativo = true
            and job_title_id = any(v_supervisor_job_title_ids)
            and upper(btrim(nome)) = upper(v_name);
          if v_contractor_responsible_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_CONTRACTOR_RESPONSIBLE'; v_fail_message := 'o Responsavel Contratada (Supervisor) invalido(a).';
          end if;
        end if;
      end if;

      -- Responsavel Distribuidora (obrigatorio)
      if not v_row_failed then
        v_name := upper(btrim(coalesce(v_row ->> 'utilityResponsible', '')));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_UTILITY_RESPONSIBLE'; v_fail_message := 'Selecione o Responsavel Distribuidora.';
        else
          select id into v_utility_responsible_id from public.project_utility_responsibles
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_utility_responsible_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_UTILITY_RESPONSIBLE'; v_fail_message := 'o Responsavel Distribuidora invalido(a).';
          end if;
        end if;
      end if;

      -- Gestor de campo Distribuidora (obrigatorio)
      if not v_row_failed then
        v_name := upper(btrim(coalesce(v_row ->> 'utilityFieldManager', '')));
        if v_name = '' then
          v_row_failed := true; v_fail_reason := 'INVALID_UTILITY_FIELD_MANAGER'; v_fail_message := 'Selecione o Gestor de campo Distribuidora.';
        else
          select id into v_utility_field_manager_id from public.project_utility_field_managers
          where tenant_id = p_tenant_id and name_normalized = v_name and ativo = true;
          if v_utility_field_manager_id is null then
            v_row_failed := true; v_fail_reason := 'INVALID_UTILITY_FIELD_MANAGER'; v_fail_message := 'o Gestor de campo Distribuidora invalido(a).';
          end if;
        end if;
      end if;

      if v_row_failed then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', v_fail_reason, 'message', v_fail_message
        ));
        continue;
      end if;

      insert into public.project (
        tenant_id,
        sob,
        fob,
        service_center,
        partner,
        service_type,
        execution_deadline,
        priority,
        estimated_value,
        voltage_level,
        project_size,
        contractor_responsible,
        utility_responsible,
        utility_field_manager,
        street,
        neighborhood,
        city,
        latitude,
        longitude,
        service_description,
        observation,
        is_active,
        is_test,
        is_withdrawn,
        is_third_party,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_row ->> 'sob',
        null,
        v_service_center_id,
        v_partner_id,
        v_service_type_id,
        (v_row ->> 'executionDeadline')::date,
        v_priority_id,
        (v_row ->> 'estimatedValue')::numeric,
        v_voltage_level_id,
        v_project_size_id,
        v_contractor_responsible_id,
        v_utility_responsible_id,
        v_utility_field_manager_id,
        v_row ->> 'street',
        v_row ->> 'neighborhood',
        v_municipality_id,
        nullif(v_row ->> 'latitude', '')::numeric,
        nullif(v_row ->> 'longitude', '')::numeric,
        nullif(btrim(coalesce(v_row ->> 'serviceDescription', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'observation', '')), ''),
        true,
        coalesce((v_row ->> 'isTest')::boolean, false),
        coalesce((v_row ->> 'isWithdrawn')::boolean, false),
        coalesce((v_row ->> 'isThirdParty')::boolean, false),
        p_actor_user_id,
        p_actor_user_id
      )
      returning id into v_project_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumber', v_row_number, 'success', true, 'projectId', v_project_id,
        'message', format('Projeto %s cadastrado com sucesso.', v_row ->> 'sob')
      ));
    exception
      when unique_violation then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'DUPLICATE_PROJECT_SOB',
          'message', 'Ja existe projeto com este SOB no tenant atual.'
        ));
      when others then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number, 'success', false,
          'reason', 'UNEXPECTED_ERROR',
          'message', 'Falha inesperada ao salvar projeto.'
        ));
    end;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'results', v_results
  );
end;
$$;

-- Mesma trava de save_project_record (210/251/309): so service_role executa,
-- nunca authenticated/anon/public.
revoke all on function public.save_project_records_batch(uuid, uuid, jsonb) from public;
revoke all on function public.save_project_records_batch(uuid, uuid, jsonb) from anon;
revoke all on function public.save_project_records_batch(uuid, uuid, jsonb) from authenticated;
grant execute on function public.save_project_records_batch(uuid, uuid, jsonb) to service_role;
