-- 221_preserve_programming_wrapper_error_details.sql
-- Preserva reason/detail das wrappers da Programacao sem alterar tenant scope, RLS ou dados.

do $migration$
declare
  v_function record;
  v_definition text;
  v_next_definition text;
  v_old_exception text;
  v_new_exception text;
  v_single_updated_count integer := 0;
  v_batch_updated_count integer := 0;
begin
  for v_function in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'save_project_programming_full_with_electrical_and_eq',
        'save_project_programming_batch_full_with_electrical_and_eq'
      )
      and coalesce(p.proargnames, array[]::text[]) @> array[
        'p_etapa_unica',
        'p_etapa_final'
      ]::text[]
  loop
    select pg_get_functiondef(v_function.signature)
    into v_definition;

    if v_function.proname = 'save_project_programming_batch_full_with_electrical_and_eq' then
      v_old_exception := $old$
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.'
        );
    end;
end;
$old$;
      v_new_exception := $new$
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$new$;
    else
      v_old_exception := $old$
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_PROGRAMMING_FULL_FAILED',
          'message', 'Falha ao salvar programacao em transacao unica.'
        );
    end;
end;
$old$;
      v_new_exception := $new$
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$new$;
    end if;

    v_next_definition := replace(v_definition, v_old_exception, v_new_exception);
    if v_next_definition = v_definition then
      raise exception 'Bloco de erro esperado nao encontrado em %.', v_function.signature;
    end if;

    execute v_next_definition;
    if v_function.proname = 'save_project_programming_batch_full_with_electrical_and_eq' then
      v_batch_updated_count := v_batch_updated_count + 1;
    else
      v_single_updated_count := v_single_updated_count + 1;
    end if;
  end loop;

  if v_single_updated_count <> 1 or v_batch_updated_count <> 1 then
    raise exception
      'Esperada 1 wrapper individual e 1 wrapper em lote com flags de etapa; encontradas individual=% e lote=%.',
      v_single_updated_count,
      v_batch_updated_count;
  end if;
end;
$migration$;
