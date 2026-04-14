-- 153_fix_programming_eq_catalog_for_update_lock.sql
-- Corrige lock em outer join na funcao de N EQ (FOR UPDATE OF pp).

create or replace function public.set_project_programming_electrical_eq_catalog(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_electrical_eq_catalog_id uuid default null,
  p_history_action text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := coalesce(upper(nullif(btrim(coalesce(p_history_action, '')), '')), 'UPDATE');
  v_history_metadata jsonb := case
    when jsonb_typeof(coalesce(p_history_metadata, '{}'::jsonb)) = 'object' then coalesce(p_history_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_previous_catalog_id uuid;
  v_previous_code text;
  v_next_code text;
  v_project_id uuid;
  v_team_id uuid;
  v_updated_at timestamptz;
  v_history_id uuid;
  v_changes jsonb;
  v_history_result jsonb;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar N EQ.'
    );
  end if;

  if p_electrical_eq_catalog_id is not null then
    select c.code
    into v_next_code
    from public.programming_eq_catalog c
    where c.tenant_id = p_tenant_id
      and c.id = p_electrical_eq_catalog_id
      and c.is_active = true;

    if v_next_code is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_EQ_CATALOG',
        'message', 'Selecione um N EQ valido para o tenant atual.'
      );
    end if;
  end if;

  select
    pp.electrical_eq_catalog_id,
    prev.code,
    pp.project_id,
    pp.team_id
  into
    v_previous_catalog_id,
    v_previous_code,
    v_project_id,
    v_team_id
  from public.project_programming pp
  left join public.programming_eq_catalog prev
    on prev.id = pp.electrical_eq_catalog_id
   and prev.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
  for update of pp;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  update public.project_programming
  set
    electrical_eq_catalog_id = p_electrical_eq_catalog_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning updated_at
  into v_updated_at;

  if v_previous_catalog_id is distinct from p_electrical_eq_catalog_id then
    v_changes := jsonb_build_object(
      'electricalEq',
      jsonb_build_object(
        'from', v_previous_code,
        'to', v_next_code
      )
    );

    select ph.id
    into v_history_id
    from public.project_programming_history ph
    where ph.tenant_id = p_tenant_id
      and ph.programming_id = p_programming_id
    order by ph.created_at desc
    limit 1;

    if v_history_id is not null then
      update public.project_programming_history
      set
        changes = coalesce(changes, '{}'::jsonb) || v_changes,
        metadata = coalesce(metadata, '{}'::jsonb) || v_history_metadata
      where id = v_history_id;
    else
      v_history_result := public.append_project_programming_history_record(
        p_tenant_id,
        p_actor_user_id,
        p_programming_id,
        v_project_id,
        v_team_id,
        null,
        v_action,
        nullif(btrim(coalesce(p_history_reason, '')), ''),
        v_changes,
        v_history_metadata,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      );

      if coalesce((v_history_result ->> 'success')::boolean, false) = false then
        return jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 400),
          'reason', coalesce(v_history_result ->> 'reason', 'PROGRAMMING_HISTORY_SAVE_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do N EQ.')
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'electrical_eq_catalog_id', p_electrical_eq_catalog_id,
    'electrical_eq_code', coalesce(v_next_code, ''),
    'updated_at', v_updated_at,
    'message', 'N EQ salvo com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public;

grant execute on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) to service_role;

