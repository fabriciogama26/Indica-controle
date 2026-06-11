-- 226_create_apr_control_module.sql
-- Cria o Controle de APR com ID globalmente unico, conferencia, historico,
-- vinculo automatico com a Programacao e permissao de pagina.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'project_programming'
      and constraint_name = 'project_programming_id_tenant_key'
  ) then
    alter table public.project_programming
      add constraint project_programming_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

create table if not exists public.project_apr_controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  apr_id text not null,
  project_id uuid not null,
  team_id uuid not null,
  programming_id uuid,
  service_date date not null,
  status text not null default 'ATIVO',
  observation text,
  project_code_snapshot text not null,
  team_name_snapshot text not null,
  foreman_name_snapshot text,
  programming_status_snapshot text,
  validated_at timestamptz,
  validated_by uuid references public.app_users(id),
  canceled_at timestamptz,
  canceled_by uuid references public.app_users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_apr_controls_apr_id_not_blank check (btrim(apr_id) <> ''),
  constraint project_apr_controls_project_code_not_blank check (btrim(project_code_snapshot) <> ''),
  constraint project_apr_controls_team_name_not_blank check (btrim(team_name_snapshot) <> ''),
  constraint project_apr_controls_status_check
    check (status in ('ATIVO', 'CANCELADO', 'DIVERGENTE', 'CONFERIDO')),
  constraint project_apr_controls_project_tenant_fk
    foreign key (project_id, tenant_id) references public.project(id, tenant_id),
  constraint project_apr_controls_team_tenant_fk
    foreign key (team_id, tenant_id) references public.teams(id, tenant_id),
  constraint project_apr_controls_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.project_programming(id, tenant_id)
);

create unique index if not exists ux_project_apr_controls_apr_id_global
  on public.project_apr_controls (upper(btrim(apr_id)));

create index if not exists idx_project_apr_controls_tenant_date
  on public.project_apr_controls (tenant_id, service_date desc, project_id, team_id);

create index if not exists idx_project_apr_controls_tenant_status
  on public.project_apr_controls (tenant_id, status, service_date desc);

create index if not exists idx_project_apr_controls_programming
  on public.project_apr_controls (tenant_id, programming_id)
  where programming_id is not null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'project_apr_controls'
      and constraint_name = 'project_apr_controls_id_tenant_key'
  ) then
    alter table public.project_apr_controls
      add constraint project_apr_controls_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

create table if not exists public.project_apr_control_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  apr_control_id uuid not null,
  action_type text not null,
  reason text,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  constraint project_apr_control_history_action_not_blank check (btrim(action_type) <> ''),
  constraint project_apr_control_history_apr_tenant_fk
    foreign key (apr_control_id, tenant_id)
    references public.project_apr_controls(id, tenant_id)
);

create index if not exists idx_project_apr_control_history_apr
  on public.project_apr_control_history (tenant_id, apr_control_id, created_at desc);

alter table public.project_apr_controls enable row level security;
alter table public.project_apr_control_history enable row level security;

drop policy if exists project_apr_controls_tenant_select on public.project_apr_controls;
create policy project_apr_controls_tenant_select on public.project_apr_controls
for select to authenticated
using (public.user_can_access_tenant(tenant_id));

drop policy if exists project_apr_control_history_tenant_select on public.project_apr_control_history;
create policy project_apr_control_history_tenant_select on public.project_apr_control_history
for select to authenticated
using (public.user_can_access_tenant(tenant_id));

drop trigger if exists trg_project_apr_controls_audit on public.project_apr_controls;
create trigger trg_project_apr_controls_audit
before insert or update on public.project_apr_controls
for each row execute function public.apply_audit_fields();

create or replace function public.save_project_apr_control(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_apr_control_id uuid,
  p_apr_id text,
  p_project_id uuid,
  p_team_id uuid,
  p_service_date date,
  p_observation text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project_apr_controls%rowtype;
  v_project record;
  v_team record;
  v_programming record;
  v_apr_control_id uuid;
  v_apr_id text := upper(btrim(coalesce(p_apr_id, '')));
  v_observation text := nullif(btrim(coalesce(p_observation, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1
    from public.app_users
    where id = p_actor_user_id
      and tenant_id = p_tenant_id
      and ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'INVALID_ACTOR', 'message', 'Usuario sem acesso ao tenant informado.');
  end if;

  if v_apr_id = '' or p_project_id is null or p_team_id is null or p_service_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Projeto, ID APR, Data do servico e Equipe sao obrigatorios.'
    );
  end if;

  if p_service_date > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'FUTURE_SERVICE_DATE',
      'message', 'A Data do servico nao pode ser futura.'
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(v_apr_id)::bigint);

  if exists (
    select 1
    from public.project_apr_controls
    where upper(btrim(apr_id)) = v_apr_id
      and id is distinct from p_apr_control_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_APR_ID',
      'message', 'Este ID APR ja esta cadastrado no sistema.'
    );
  end if;

  select p.id, p.sob
    into v_project
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
    and p.is_active = true
  limit 1;

  if v_project.id is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_PROJECT', 'message', 'Projeto invalido ou inativo para o tenant atual.');
  end if;

  select
    t.id,
    t.name,
    coalesce(person.nome, '') as foreman_name
    into v_team
  from public.teams t
  left join public.people person
    on person.tenant_id = t.tenant_id
   and person.id = t.foreman_person_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
    and t.ativo = true
  limit 1;

  if v_team.id is null then
    return jsonb_build_object('success', false, 'status', 422, 'reason', 'INVALID_TEAM', 'message', 'Equipe invalida ou inativa para o tenant atual.');
  end if;

  select pp.id, pp.status
    into v_programming
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.project_id = p_project_id
    and pp.team_id = p_team_id
    and pp.execution_date = p_service_date
    and pp.status <> 'CANCELADA'
  order by
    case pp.status
      when 'PROGRAMADA' then 0
      when 'REPROGRAMADA' then 1
      when 'ADIADA' then 2
      else 3
    end,
    pp.updated_at desc
  limit 1;

  if p_apr_control_id is not null then
    select *
      into v_current
    from public.project_apr_controls
    where tenant_id = p_tenant_id
      and id = p_apr_control_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NOT_FOUND', 'message', 'APR nao encontrada.');
    end if;

    if v_current.status = 'CANCELADO' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'APR_CANCELED', 'message', 'APR cancelada nao pode ser editada.');
    end if;

    if p_expected_updated_at is null or v_current.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', 'A APR foi alterada por outro usuario. Atualize a lista antes de salvar novamente.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'aprId', case when v_current.apr_id is distinct from v_apr_id then jsonb_build_object('from', v_current.apr_id, 'to', v_apr_id) end,
      'projectId', case when v_current.project_id is distinct from p_project_id then jsonb_build_object('from', v_current.project_id, 'to', p_project_id) end,
      'teamId', case when v_current.team_id is distinct from p_team_id then jsonb_build_object('from', v_current.team_id, 'to', p_team_id) end,
      'serviceDate', case when v_current.service_date is distinct from p_service_date then jsonb_build_object('from', v_current.service_date, 'to', p_service_date) end,
      'observation', case when v_current.observation is distinct from v_observation then jsonb_build_object('from', v_current.observation, 'to', v_observation) end,
      'status', case when v_current.status <> 'ATIVO' then jsonb_build_object('from', v_current.status, 'to', 'ATIVO') end
    ));

    update public.project_apr_controls
    set
      apr_id = v_apr_id,
      project_id = p_project_id,
      team_id = p_team_id,
      programming_id = v_programming.id,
      service_date = p_service_date,
      status = 'ATIVO',
      observation = v_observation,
      project_code_snapshot = v_project.sob,
      team_name_snapshot = v_team.name,
      foreman_name_snapshot = nullif(v_team.foreman_name, ''),
      programming_status_snapshot = v_programming.status,
      validated_at = null,
      validated_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = p_apr_control_id
    returning id, updated_at into v_apr_control_id, v_updated_at;

    insert into public.project_apr_control_history (
      tenant_id, apr_control_id, action_type, reason, changes, metadata, created_by
    )
    values (
      p_tenant_id,
      v_apr_control_id,
      'UPDATE',
      v_observation,
      v_changes,
      jsonb_build_object('programmingId', v_programming.id),
      p_actor_user_id
    );
  else
    insert into public.project_apr_controls (
      tenant_id,
      apr_id,
      project_id,
      team_id,
      programming_id,
      service_date,
      observation,
      project_code_snapshot,
      team_name_snapshot,
      foreman_name_snapshot,
      programming_status_snapshot,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_apr_id,
      p_project_id,
      p_team_id,
      v_programming.id,
      p_service_date,
      v_observation,
      v_project.sob,
      v_team.name,
      nullif(v_team.foreman_name, ''),
      v_programming.status,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_apr_control_id, v_updated_at;

    insert into public.project_apr_control_history (
      tenant_id, apr_control_id, action_type, reason, changes, metadata, created_by
    )
    values (
      p_tenant_id,
      v_apr_control_id,
      'CREATE',
      v_observation,
      jsonb_build_object(
        'aprId', jsonb_build_object('to', v_apr_id),
        'projectId', jsonb_build_object('to', p_project_id),
        'teamId', jsonb_build_object('to', p_team_id),
        'serviceDate', jsonb_build_object('to', p_service_date),
        'status', jsonb_build_object('to', 'ATIVO')
      ),
      jsonb_build_object('programmingId', v_programming.id),
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'apr_control_id', v_apr_control_id,
    'updated_at', v_updated_at,
    'programming_id', v_programming.id,
    'message', case when p_apr_control_id is null then 'APR cadastrada com sucesso.' else 'APR atualizada com sucesso e devolvida para conferencia.' end
  );
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_APR_ID', 'message', 'Este ID APR ja esta cadastrado no sistema.');
end;
$$;

create or replace function public.set_project_apr_control_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_apr_control_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.project_apr_controls%rowtype;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target_status text;
  v_updated_at timestamptz;
begin
  if not exists (
    select 1
    from public.app_users
    where id = p_actor_user_id
      and tenant_id = p_tenant_id
      and ativo = true
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'INVALID_ACTOR', 'message', 'Usuario sem acesso ao tenant informado.');
  end if;

  if v_action not in ('CONFERIR', 'DIVERGIR', 'CANCELAR') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTION', 'message', 'Acao invalida para a APR.');
  end if;

  if (v_action in ('DIVERGIR', 'CANCELAR')) and (v_reason is null or length(v_reason) < 10) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'REASON_REQUIRED',
      'message', 'Informe uma observacao com no minimo 10 caracteres.'
    );
  end if;

  select *
    into v_current
  from public.project_apr_controls
  where tenant_id = p_tenant_id
    and id = p_apr_control_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'NOT_FOUND', 'message', 'APR nao encontrada.');
  end if;

  if p_expected_updated_at is null or v_current.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', 'A APR foi alterada por outro usuario. Atualize a lista antes de continuar.'
    );
  end if;

  if v_current.status = 'CANCELADO' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'APR_CANCELED', 'message', 'APR cancelada nao pode ter o status alterado.');
  end if;

  v_target_status := case v_action
    when 'CONFERIR' then 'CONFERIDO'
    when 'DIVERGIR' then 'DIVERGENTE'
    else 'CANCELADO'
  end;

  update public.project_apr_controls
  set
    status = v_target_status,
    observation = case when v_reason is not null then v_reason else observation end,
    validated_at = case when v_target_status in ('CONFERIDO', 'DIVERGENTE') then now() else validated_at end,
    validated_by = case when v_target_status in ('CONFERIDO', 'DIVERGENTE') then p_actor_user_id else validated_by end,
    canceled_at = case when v_target_status = 'CANCELADO' then now() else canceled_at end,
    canceled_by = case when v_target_status = 'CANCELADO' then p_actor_user_id else canceled_by end,
    cancellation_reason = case when v_target_status = 'CANCELADO' then v_reason else cancellation_reason end,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_apr_control_id
  returning updated_at into v_updated_at;

  insert into public.project_apr_control_history (
    tenant_id, apr_control_id, action_type, reason, changes, metadata, created_by
  )
  values (
    p_tenant_id,
    p_apr_control_id,
    v_action,
    v_reason,
    jsonb_build_object('status', jsonb_build_object('from', v_current.status, 'to', v_target_status)),
    '{}'::jsonb,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'apr_control_id', p_apr_control_id,
    'apr_status', v_target_status,
    'updated_at', v_updated_at,
    'message', case v_target_status
      when 'CONFERIDO' then 'APR conferida com sucesso.'
      when 'DIVERGENTE' then 'APR marcada como divergente.'
      else 'APR cancelada com sucesso.'
    end
  );
end;
$$;

revoke all on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_project_apr_control(
  uuid, uuid, uuid, text, uuid, uuid, date, text, timestamptz
) to service_role;

revoke all on function public.set_project_apr_control_status(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_project_apr_control_status(
  uuid, uuid, uuid, text, text, timestamptz
) to service_role;

insert into public.app_pages (page_key, path, name, section, description)
values (
  'controle-apr',
  '/controle-apr',
  'Controle de APR',
  'Operacao',
  'Cadastro, conferencia e cancelamento de APR por projeto, equipe e data.'
)
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'controle-apr',
  roles.role_key <> 'viewer'
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
 and roles.role_key in ('master', 'admin', 'supervisor', 'user', 'viewer')
on conflict (tenant_id, role_id, page_key) do update
set can_access = excluded.can_access, updated_at = now();

with target_users as (
  select
    au.id as user_id,
    au.tenant_id,
    au.role_id,
    coalesce(ar.role_key, 'user') as role_key
  from public.app_users au
  left join public.app_roles ar on ar.id = au.role_id
  where au.tenant_id is not null
    and exists (
      select 1
      from public.app_user_page_permissions upp
      where upp.tenant_id = au.tenant_id
        and upp.user_id = au.id
    )
)
insert into public.app_user_page_permissions (
  tenant_id, user_id, page_key, can_access, created_by, updated_by
)
select
  tu.tenant_id,
  tu.user_id,
  'controle-apr',
  coalesce(rpp.can_access, tu.role_key <> 'viewer'),
  null,
  null
from target_users tu
left join public.app_user_page_permissions existing
  on existing.tenant_id = tu.tenant_id
 and existing.user_id = tu.user_id
 and existing.page_key = 'controle-apr'
left join public.role_page_permissions rpp
  on rpp.tenant_id = tu.tenant_id
 and rpp.role_id = tu.role_id
 and rpp.page_key = 'controle-apr'
where existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

notify pgrst, 'reload schema';

commit;
