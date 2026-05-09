-- 175_add_team_supervisor_link.sql
-- Vincula supervisor opcional ao cadastro de equipes por tenant.

alter table if exists public.teams
  add column if not exists supervisor_person_id uuid null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_supervisor_person_tenant_fk'
  ) then
    alter table public.teams
      add constraint teams_supervisor_person_tenant_fk
      foreign key (supervisor_person_id, tenant_id)
      references public.people(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_teams_tenant_supervisor
  on public.teams (tenant_id, supervisor_person_id, ativo, name);

drop function if exists public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid);
drop function if exists public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz);

create or replace function public.save_team_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid default null,
  p_name text default null,
  p_vehicle_plate text default null,
  p_service_center_id uuid default null,
  p_team_type_id uuid default null,
  p_foreman_person_id uuid default null,
  p_stock_center_id uuid default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_supervisor_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.teams%rowtype;
  v_team_id uuid;
  v_updated_at timestamptz;
  v_effective_stock_center_id uuid;
begin
  if p_supervisor_person_id is not null then
    perform 1
    from public.people p
    join public.job_titles jt
      on jt.id = p.job_title_id
     and jt.tenant_id = p.tenant_id
    where p.id = p_supervisor_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true
      and jt.ativo = true
      and (
        jt.code ilike '%SUPERVISOR%'
        or jt.name ilike '%SUPERVISOR%'
      );

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_SUPERVISOR',
        'message', 'Supervisor invalido para o tenant atual.'
      );
    end if;
  end if;

  if p_stock_center_id is not null then
    perform 1
    from public.stock_centers sc
    where sc.id = p_stock_center_id
      and sc.tenant_id = p_tenant_id
      and sc.is_active = true
      and sc.center_type = 'OWN';

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_STOCK_CENTER',
        'message', 'Centro de estoque proprio invalido para a equipe.'
      );
    end if;

    if exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.stock_center_id = p_stock_center_id
        and (p_team_id is null or t.id <> p_team_id)
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;
  end if;

  if p_team_id is null then
    if exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.foreman_person_id = p_foreman_person_id
        and t.ativo = true
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_TEAM_FOREMAN',
        'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
      );
    end if;

    insert into public.teams (
      tenant_id,
      name,
      vehicle_plate,
      service_center_id,
      team_type_id,
      foreman_person_id,
      supervisor_person_id,
      stock_center_id,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      p_vehicle_plate,
      p_service_center_id,
      p_team_type_id,
      p_foreman_person_id,
      p_supervisor_person_id,
      null,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_id, v_updated_at;

    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => v_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => p_stock_center_id
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = v_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'team_id', v_team_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a equipe.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a equipe antes de editar.'
    );
  end if;

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.foreman_person_id = p_foreman_person_id
      and t.ativo = true
      and t.id <> p_team_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_FOREMAN',
      'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
    );
  end if;

  v_effective_stock_center_id := coalesce(p_stock_center_id, v_current.stock_center_id);

  update public.teams
  set
    name = p_name,
    vehicle_plate = p_vehicle_plate,
    service_center_id = p_service_center_id,
    team_type_id = p_team_type_id,
    foreman_person_id = p_foreman_person_id,
    supervisor_person_id = p_supervisor_person_id,
    stock_center_id = v_effective_stock_center_id,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_team_id, v_updated_at;

  if v_effective_stock_center_id is null then
    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => p_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => null
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = p_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;
  end if;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
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
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_id', v_team_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    if p_stock_center_id is not null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_COMBINATION',
      'message', 'Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.'
    );
end;
$$;

revoke all on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid) from public;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid) to service_role;
