-- 134_allow_foreman_change_during_team_activation.sql
-- Permite reativar equipe trocando encarregado no mesmo fluxo de ativacao.
-- Mantem a regra de apenas uma equipe ativa por encarregado no tenant.

drop function if exists public.set_team_record_status(uuid, uuid, uuid, text, text, timestamptz);

create or replace function public.set_team_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null,
  p_foreman_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.teams%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_now timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
  v_target_foreman_person_id uuid;
  v_current_foreman_name text;
  v_target_foreman_name text;
begin
  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TEAM_NOT_FOUND', 'message', 'Equipe nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status da equipe.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name));
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Equipe %s ja esta inativa.', v_current.name));
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Equipe %s ja esta ativa.', v_current.name));
  end if;

  v_target_foreman_person_id := case
    when v_action = 'ACTIVATE' and p_foreman_person_id is not null then p_foreman_person_id
    else v_current.foreman_person_id
  end;

  if v_action = 'ACTIVATE' and p_foreman_person_id is not null then
    select p.nome
    into v_target_foreman_name
    from public.people p
    where p.id = p_foreman_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true
    limit 1;

    if v_target_foreman_name is null then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_FOREMAN',
        'message', 'Encarregado invalido para o tenant atual.'
      );
    end if;
  end if;

  if v_action = 'ACTIVATE' and exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.foreman_person_id = v_target_foreman_person_id
      and t.ativo = true
      and t.id <> p_team_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_FOREMAN',
      'message', 'Ja existe equipe ativa cadastrada para este encarregado. Cancele a equipe ativa antes de reativar esta equipe.'
    );
  end if;

  if v_action = 'ACTIVATE' and v_target_foreman_person_id is distinct from v_current.foreman_person_id then
    select p.nome
    into v_current_foreman_name
    from public.people p
    where p.id = v_current.foreman_person_id
      and p.tenant_id = p_tenant_id
    limit 1;

    if v_target_foreman_name is null then
      select p.nome
      into v_target_foreman_name
      from public.people p
      where p.id = v_target_foreman_person_id
        and p.tenant_id = p_tenant_id
      limit 1;
    end if;
  end if;

  update public.teams
  set
    foreman_person_id = case when v_action = 'ACTIVATE' then v_target_foreman_person_id else foreman_person_id end,
    ativo = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_now end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning updated_at
  into v_updated_at;

  v_changes := case
    when v_action = 'ACTIVATE' then jsonb_strip_nulls(jsonb_build_object(
      'isActive', jsonb_build_object('from', 'false', 'to', 'true'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', null),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', null),
      'activationReason', jsonb_build_object('from', null, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'foremanName', case
        when v_target_foreman_person_id is distinct from v_current.foreman_person_id then jsonb_build_object(
          'from', coalesce(v_current_foreman_name, v_current.foreman_person_id::text),
          'to', coalesce(v_target_foreman_name, v_target_foreman_person_id::text)
        )
        else null
      end
    ))
    else jsonb_build_object(
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', nullif(btrim(coalesce(p_reason, '')), '')),
      'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', v_now)
    )
  end;

  insert into public.app_entity_history (
    tenant_id,
    module_key,
    entity_table,
    entity_id,
    entity_code,
    change_type,
    reason,
    changes,
    metadata,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    'equipes',
    'teams',
    p_team_id,
    v_current.name,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'team_id', p_team_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_COMBINATION',
      'message', 'Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.'
    );
end;
$$;
