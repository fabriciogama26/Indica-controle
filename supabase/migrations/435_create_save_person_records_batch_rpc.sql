-- 435_create_save_person_records_batch_rpc.sql
-- Cria RPC de insercao em lote para o cadastro em massa de Pessoas, substituindo
-- N chamadas RPC (uma por linha) por uma unica chamada para o arquivo inteiro.

create or replace function public.save_person_records_batch(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_row_number integer;
  v_person_id uuid;
  v_constraint_name text;
  v_results jsonb := '[]'::jsonb;
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

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_number := coalesce((v_row ->> 'rowNumber')::integer, 0);

    begin
      insert into public.people (
        tenant_id,
        nome,
        matriculation,
        job_title_id,
        job_title_type_id,
        job_level,
        cpf,
        phone,
        ativo,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_row ->> 'name',
        nullif(btrim(coalesce(v_row ->> 'matriculation', '')), ''),
        nullif(v_row ->> 'jobTitleId', '')::uuid,
        nullif(v_row ->> 'jobTitleTypeId', '')::uuid,
        nullif(btrim(coalesce(v_row ->> 'jobLevel', '')), ''),
        nullif(regexp_replace(coalesce(v_row ->> 'cpf', ''), '[^0-9]', '', 'g'), ''),
        nullif(btrim(coalesce(v_row ->> 'phone', '')), ''),
        true,
        p_actor_user_id,
        p_actor_user_id
      )
      returning id into v_person_id;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumber', v_row_number,
        'success', true,
        'personId', v_person_id
      ));
    exception
      when check_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        if v_constraint_name = 'chk_people_cpf_format' then
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', 'INVALID_PERSON_CPF',
            'message', 'CPF invalido. Informe 11 digitos ou deixe em branco.'
          ));
        else
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', coalesce(v_constraint_name, 'VALIDATION_FAILED'),
            'message', 'Falha de validacao ao salvar pessoa.'
          ));
        end if;
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        if v_constraint_name in ('people_unique_tenant_cpf_key', 'idx_people_unique_tenant_cpf') then
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', 'DUPLICATE_PERSON_CPF',
            'message', 'Ja existe pessoa com este CPF no tenant atual.'
          ));
        elsif v_constraint_name in ('people_unique_tenant_cpf_matriculation_key', 'idx_people_unique_tenant_cpf_matriculation') then
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', 'DUPLICATE_PERSON_CPF_MATRICULATION',
            'message', 'Ja existe pessoa com este CPF e esta matricula no tenant atual.'
          ));
        elsif v_constraint_name in ('people_unique_tenant_matriculation_key', 'idx_people_unique_tenant_matriculation')
          or sqlerrm ilike '%Pessoa duplicada para matricula%' then
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', 'DUPLICATE_PERSON_MATRICULATION',
            'message', 'Ja existe pessoa com esta matricula no tenant atual.'
          ));
        else
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'rowNumber', v_row_number,
            'success', false,
            'reason', 'DUPLICATE_PERSON_IDENTITY',
            'message', 'Ja existe pessoa com o mesmo nome, matricula, cargo, tipo e nivel no tenant atual.'
          ));
        end if;
      when others then
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowNumber', v_row_number,
          'success', false,
          'reason', 'UNEXPECTED_ERROR',
          'message', 'Falha inesperada ao salvar pessoa.'
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

revoke all on function public.save_person_records_batch(uuid, uuid, jsonb) from public;
grant execute on function public.save_person_records_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_person_records_batch(uuid, uuid, jsonb) to service_role;
