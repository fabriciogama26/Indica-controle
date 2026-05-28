-- 205_swap_active_team_foremen.sql
-- Permite permutar encarregados entre duas equipes ativas do mesmo tenant.
-- A troca ocorre em uma unica transacao para preservar a regra de encarregado unico por equipe ativa.

create or replace function public.swap_active_team_foremen(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_team_id uuid,
  p_target_team_id uuid,
  p_reason text,
  p_source_expected_updated_at timestamptz,
  p_target_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.teams%rowtype;
  v_target public.teams%rowtype;
  v_source_foreman_name text;
  v_target_foreman_name text;
  v_source_updated_at timestamptz;
  v_target_updated_at timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_source_team_id is null or p_target_team_id is null or p_source_team_id = p_target_team_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TEAM_PAIR',
      'message', 'Selecione duas equipes diferentes para permutar o encarregado.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REASON_REQUIRED',
      'message', 'Informe o motivo da permuta de encarregado.'
    );
  end if;

  if p_source_expected_updated_at is null or p_target_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de permutar encarregados.'
    );
  end if;

  perform 1
  from public.teams t
  where t.tenant_id = p_tenant_id
    and t.id in (p_source_team_id, p_target_team_id)
  order by t.id
  for update;

  select *
  into v_source
  from public.teams
  where tenant_id = p_tenant_id
    and id = p_source_team_id;

  select *
  into v_target
  from public.teams
  where tenant_id = p_tenant_id
    and id = p_target_team_id;

  if v_source.id is null or v_target.id is null then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe de origem ou destino nao encontrada.'
    );
  end if;

  if not v_source.ativo or not v_target.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'A permuta exige duas equipes ativas.'
    );
  end if;

  if v_source.updated_at <> p_source_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de permutar.', v_source.name)
    );
  end if;

  if v_target.updated_at <> p_target_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de permutar.', v_target.name)
    );
  end if;

  if v_source.foreman_person_id is null or v_target.foreman_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_FOREMAN',
      'message', 'As duas equipes precisam possuir encarregado para permutar.'
    );
  end if;

  if v_source.foreman_person_id = v_target.foreman_person_id then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SAME_FOREMAN',
      'message', 'As equipes selecionadas ja possuem o mesmo encarregado.'
    );
  end if;

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.ativo = true
      and t.id not in (p_source_team_id, p_target_team_id)
      and t.foreman_person_id in (v_source.foreman_person_id, v_target.foreman_person_id)
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_FOREMAN',
      'message', 'Existe outra equipe ativa vinculada a um dos encarregados da permuta.'
    );
  end if;

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_source_foreman_name
  from public.people p
  where p.tenant_id = p_tenant_id
    and p.id = v_source.foreman_person_id;

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_target_foreman_name
  from public.people p
  where p.tenant_id = p_tenant_id
    and p.id = v_target.foreman_person_id;

  v_source_foreman_name := coalesce(v_source_foreman_name, v_source.foreman_person_id::text);
  v_target_foreman_name := coalesce(v_target_foreman_name, v_target.foreman_person_id::text);

  update public.teams t
  set
    foreman_person_id = case
      when t.id = p_source_team_id then v_target.foreman_person_id
      when t.id = p_target_team_id then v_source.foreman_person_id
      else t.foreman_person_id
    end,
    updated_by = p_actor_user_id,
    updated_at = now()
  where t.tenant_id = p_tenant_id
    and t.id in (p_source_team_id, p_target_team_id);

  select updated_at
  into v_source_updated_at
  from public.teams
  where tenant_id = p_tenant_id
    and id = p_source_team_id;

  select updated_at
  into v_target_updated_at
  from public.teams
  where tenant_id = p_tenant_id
    and id = p_target_team_id;

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
  ) values
  (
    p_tenant_id,
    'equipes',
    'teams',
    p_source_team_id,
    v_source.name,
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'foremanName', jsonb_build_object('from', v_source_foreman_name, 'to', v_target_foreman_name)
    ),
    jsonb_build_object('action', 'FOREMAN_SWAP', 'pairedTeamId', p_target_team_id, 'pairedTeamName', v_target.name),
    p_actor_user_id,
    p_actor_user_id
  ),
  (
    p_tenant_id,
    'equipes',
    'teams',
    p_target_team_id,
    v_target.name,
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'foremanName', jsonb_build_object('from', v_target_foreman_name, 'to', v_source_foreman_name)
    ),
    jsonb_build_object('action', 'FOREMAN_SWAP', 'pairedTeamId', p_source_team_id, 'pairedTeamName', v_source.name),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'source_team_id', p_source_team_id,
    'target_team_id', p_target_team_id,
    'source_updated_at', v_source_updated_at,
    'target_updated_at', v_target_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_COMBINATION',
      'message', 'A permuta geraria equipe com o mesmo nome, encarregado e placa no tenant atual.'
    );
end;
$$;

revoke all on function public.swap_active_team_foremen(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.swap_active_team_foremen(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.swap_active_team_foremen(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz) to service_role;
