-- 224_add_team_composition_work_status.sql
-- Registra se a equipe atuou e restringe equipes sem atuacao ao encarregado ausente.

begin;

alter table public.team_compositions
  add column if not exists work_status text not null default 'WORKING';

update public.team_compositions
set work_status = 'WORKING'
where work_status is null
   or work_status not in ('WORKING', 'NOT_WORKING');

alter table public.team_compositions
  drop constraint if exists team_compositions_work_status_check;

alter table public.team_compositions
  add constraint team_compositions_work_status_check
  check (work_status in ('WORKING', 'NOT_WORKING'));

create or replace function public.save_team_composition_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_composition_id uuid,
  p_composition_date date,
  p_project_id uuid,
  p_team_id uuid,
  p_sector text,
  p_start_time time,
  p_notes text,
  p_members jsonb,
  p_work_status text,
  p_expected_updated_at timestamptz default null,
  p_yard text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_status text := upper(btrim(coalesce(p_work_status, '')));
  v_foreman_person_id uuid;
  v_member_person_id uuid;
  v_member_is_present boolean;
  v_result jsonb;
  v_composition_id uuid;
  v_updated_at timestamptz;
begin
  if v_work_status not in ('WORKING', 'NOT_WORKING') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_WORK_STATUS',
      'message', 'Situacao da equipe invalida.'
    );
  end if;

  if v_work_status = 'NOT_WORKING' then
    select t.foreman_person_id
      into v_foreman_person_id
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.id = p_team_id
      and t.ativo = true;

    if v_foreman_person_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_TEAM_FOREMAN',
        'message', 'A equipe precisa possuir encarregado ativo para registrar que nao atuou.'
      );
    end if;

    if p_members is null
      or jsonb_typeof(p_members) <> 'array'
      or jsonb_array_length(p_members) <> 1 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'NOT_WORKING_MEMBER_RULE',
        'message', 'Equipe que nao atuou deve possuir somente o encarregado da equipe, marcado como nao presente.'
      );
    end if;

    if coalesce(p_members -> 0 ->> 'personId', '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_member_person_id := (p_members -> 0 ->> 'personId')::uuid;
    end if;

    v_member_is_present := case
      when jsonb_typeof(p_members -> 0 -> 'isPresent') = 'boolean'
        then (p_members -> 0 ->> 'isPresent')::boolean
      else true
    end;

    if v_member_person_id is distinct from v_foreman_person_id
      or v_member_is_present is distinct from false then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'NOT_WORKING_MEMBER_RULE',
        'message', 'Equipe que nao atuou deve possuir somente o encarregado da equipe, marcado como nao presente.'
      );
    end if;
  end if;

  v_result := public.save_team_composition_record(
    p_tenant_id,
    p_actor_user_id,
    p_composition_id,
    p_composition_date,
    p_project_id,
    p_team_id,
    p_sector,
    p_start_time,
    p_notes,
    p_members,
    p_expected_updated_at,
    p_yard
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_composition_id := (v_result ->> 'composition_id')::uuid;

  update public.team_compositions
  set
    work_status = v_work_status,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_composition_id
  returning updated_at into v_updated_at;

  return v_result || jsonb_build_object(
    'work_status', v_work_status,
    'updated_at', v_updated_at
  );
end;
$$;

revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from public;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from anon;
revoke all on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) from authenticated;
grant execute on function public.save_team_composition_record(
  uuid, uuid, uuid, date, uuid, uuid, text, time, text, jsonb, text, timestamptz, text
) to service_role;

notify pgrst, 'reload schema';

commit;
