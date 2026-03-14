-- 070_add_programming_status_and_project_guard.sql
-- Separa status operacional da programacao e bloqueia inativacao de projeto com agenda pendente.

alter table if exists public.project_programming
  add column if not exists status text;

update public.project_programming
set status = case
  when is_active = true then 'PROGRAMADA'
  else 'CANCELADA'
end
where status is null;

alter table if exists public.project_programming
  alter column status set default 'PROGRAMADA';

alter table if exists public.project_programming
  alter column status set not null;

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_check;

alter table if exists public.project_programming
  add constraint project_programming_status_check
  check (status in ('PROGRAMADA', 'ADIADA', 'CANCELADA'));

alter table if exists public.project_programming
  drop constraint if exists project_programming_cancellation_fields_check;

alter table if exists public.project_programming
  add constraint project_programming_status_fields_check
  check (
    (
      status = 'PROGRAMADA'
      and is_active = true
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
    or (
      status in ('ADIADA', 'CANCELADA')
      and is_active = false
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
      and canceled_at is not null
      and canceled_by is not null
    )
  );

create or replace function public.guard_project_inactivation_with_programming()
returns trigger
language plpgsql
as $$
begin
  if old.is_active = true and new.is_active = false then
    if exists (
      select 1
      from public.project_programming pp
      where pp.tenant_id = new.tenant_id
        and pp.project_id = new.id
        and pp.status in ('PROGRAMADA', 'ADIADA')
    ) then
      raise exception 'Nao e permitido inativar projeto com programacao programada ou adiada.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_project_inactivation_with_programming on public.project;
create trigger trg_guard_project_inactivation_with_programming
before update on public.project
for each row
execute function public.guard_project_inactivation_with_programming();

create or replace function public.set_project_programming_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_status text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_current record;
  v_updated_at timestamptz;
  v_message text;
begin
  if p_programming_id is null or v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_STATUS_PAYLOAD',
      'message', 'Informe a programacao e o motivo da alteracao.'
    );
  end if;

  if v_target_status not in ('ADIADA', 'CANCELADA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROGRAMMING_STATUS',
      'message', 'Status invalido para a programacao.'
    );
  end if;

  select
    pp.id,
    pp.project_id,
    pp.team_id,
    pp.execution_date,
    pp.updated_at,
    pp.status,
    p.sob
  into v_current
  from public.project_programming pp
  join public.project p
    on p.id = pp.project_id
   and p.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
    and pp.status = 'PROGRAMADA'
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada ou nao esta mais ativa na grade.'
    );
  end if;

  if p_expected_updated_at is not null
    and date_trunc('milliseconds', v_current.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'PROGRAMMING_CONFLICT',
      'message', 'Esta programacao foi alterada por outro usuario. Atualize a grade antes de continuar.'
    );
  end if;

  update public.project_programming
  set
    status = v_target_status,
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  v_message := case
    when v_target_status = 'ADIADA' then format('Programacao do projeto %s adiada com sucesso.', v_current.sob)
    else format('Programacao do projeto %s cancelada com sucesso.', v_current.sob)
  end;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'project_code', v_current.sob,
    'updated_at', v_updated_at,
    'programming_status', v_target_status,
    'message', v_message
  );
end;
$$;

revoke all on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to authenticated;

grant execute on function public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;
