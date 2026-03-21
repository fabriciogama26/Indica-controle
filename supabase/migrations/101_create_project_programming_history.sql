-- 101_create_project_programming_history.sql
-- Cria historico operacional proprio da Programacao e move o fluxo funcional de status para uma base dedicada.

create table if not exists public.project_programming_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  programming_id uuid not null references public.project_programming(id) on delete cascade,
  project_id uuid null references public.project(id) on delete set null,
  team_id uuid null references public.teams(id) on delete set null,
  related_programming_id uuid null references public.project_programming(id) on delete set null,
  source_history_id uuid null,
  action_type text not null,
  from_status text null,
  to_status text null,
  from_execution_date date null,
  to_execution_date date null,
  from_team_id uuid null references public.teams(id) on delete set null,
  to_team_id uuid null references public.teams(id) on delete set null,
  from_start_time time null,
  to_start_time time null,
  from_end_time time null,
  to_end_time time null,
  from_etapa_number integer null,
  to_etapa_number integer null,
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_programming_history_action_not_blank check (btrim(action_type) <> ''),
  constraint project_programming_history_reason_not_blank check (reason is null or btrim(reason) <> '')
);

create index if not exists idx_project_programming_history_tenant_programming_created
  on public.project_programming_history (tenant_id, programming_id, created_at desc);

create index if not exists idx_project_programming_history_tenant_project_team_created
  on public.project_programming_history (tenant_id, project_id, team_id, created_at desc);

create unique index if not exists idx_project_programming_history_source_history
  on public.project_programming_history (source_history_id)
  where source_history_id is not null;

alter table if exists public.project_programming_history enable row level security;

drop policy if exists project_programming_history_tenant_select on public.project_programming_history;
create policy project_programming_history_tenant_select on public.project_programming_history
for select
to authenticated
using (public.user_can_access_tenant(project_programming_history.tenant_id));

drop policy if exists project_programming_history_tenant_insert on public.project_programming_history;
create policy project_programming_history_tenant_insert on public.project_programming_history
for insert
to authenticated
with check (public.user_can_access_tenant(project_programming_history.tenant_id));

drop function if exists public.append_project_programming_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  date,
  date,
  uuid,
  uuid,
  time,
  time,
  time,
  time,
  integer,
  integer
);

create or replace function public.append_project_programming_history_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_project_id uuid default null,
  p_team_id uuid default null,
  p_related_programming_id uuid default null,
  p_action_type text default 'UPDATE',
  p_reason text default null,
  p_changes jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_from_status text default null,
  p_to_status text default null,
  p_from_execution_date date default null,
  p_to_execution_date date default null,
  p_from_team_id uuid default null,
  p_to_team_id uuid default null,
  p_from_start_time time default null,
  p_to_start_time time default null,
  p_from_end_time time default null,
  p_to_end_time time default null,
  p_from_etapa_number integer default null,
  p_to_etapa_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_type text := upper(nullif(btrim(coalesce(p_action_type, '')), ''));
begin
  if p_tenant_id is null or p_programming_id is null or v_action_type is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PROGRAMMING_HISTORY_PAYLOAD',
      'message', 'Informe tenant, programacao e acao para registrar o historico operacional.'
    );
  end if;

  insert into public.project_programming_history (
    tenant_id,
    programming_id,
    project_id,
    team_id,
    related_programming_id,
    action_type,
    from_status,
    to_status,
    from_execution_date,
    to_execution_date,
    from_team_id,
    to_team_id,
    from_start_time,
    to_start_time,
    from_end_time,
    to_end_time,
    from_etapa_number,
    to_etapa_number,
    reason,
    changes,
    metadata,
    created_by
  ) values (
    p_tenant_id,
    p_programming_id,
    p_project_id,
    p_team_id,
    p_related_programming_id,
    v_action_type,
    p_from_status,
    p_to_status,
    p_from_execution_date,
    p_to_execution_date,
    p_from_team_id,
    p_to_team_id,
    p_from_start_time,
    p_to_start_time,
    p_from_end_time,
    p_to_end_time,
    p_from_etapa_number,
    p_to_etapa_number,
    nullif(btrim(coalesce(p_reason, '')), ''),
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Historico operacional da programacao registrado com sucesso.'
  );
end;
$$;

revoke all on function public.append_project_programming_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  date,
  date,
  uuid,
  uuid,
  time,
  time,
  time,
  time,
  integer,
  integer
) from public;

grant execute on function public.append_project_programming_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  date,
  date,
  uuid,
  uuid,
  time,
  time,
  time,
  time,
  integer,
  integer
) to authenticated;

grant execute on function public.append_project_programming_history_record(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  text,
  text,
  date,
  date,
  uuid,
  uuid,
  time,
  time,
  time,
  time,
  integer,
  integer
) to service_role;

insert into public.project_programming_history (
  tenant_id,
  programming_id,
  project_id,
  team_id,
  related_programming_id,
  source_history_id,
  action_type,
  from_status,
  to_status,
  from_execution_date,
  to_execution_date,
  reason,
  changes,
  metadata,
  created_by,
  created_at
)
select
  h.tenant_id,
  pp.id as programming_id,
  case
    when coalesce(h.metadata ->> 'projectId', '') ~* '^[0-9a-f-]{36}$' then (h.metadata ->> 'projectId')::uuid
    else null
  end as project_id,
  case
    when coalesce(h.metadata ->> 'teamId', '') ~* '^[0-9a-f-]{36}$' then (h.metadata ->> 'teamId')::uuid
    else null
  end as team_id,
  case
    when related_pp.id is not null then related_pp.id
    else null
  end as related_programming_id,
  h.id as source_history_id,
  case
    when upper(coalesce(h.metadata ->> 'action', '')) in ('CREATE', 'UPDATE', 'RESCHEDULE', 'ADIADA', 'CANCELADA', 'COPY', 'BATCH_CREATE') then upper(h.metadata ->> 'action')
    when h.change_type = 'CANCEL' then 'CANCELADA'
    else 'UPDATE'
  end as action_type,
  nullif(h.changes -> 'status' ->> 'from', '') as from_status,
  nullif(h.changes -> 'status' ->> 'to', '') as to_status,
  case
    when coalesce(h.changes -> 'executionDate' ->> 'from', h.metadata ->> 'executionDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then coalesce(h.changes -> 'executionDate' ->> 'from', h.metadata ->> 'executionDate')::date
    else null
  end as from_execution_date,
  case
    when coalesce(h.changes -> 'executionDate' ->> 'to', h.metadata ->> 'newExecutionDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then coalesce(h.changes -> 'executionDate' ->> 'to', h.metadata ->> 'newExecutionDate')::date
    else null
  end as to_execution_date,
  h.reason,
  coalesce(h.changes, '{}'::jsonb),
  coalesce(h.metadata, '{}'::jsonb),
  h.created_by,
  h.created_at
from public.app_entity_history h
join public.project_programming pp
  on pp.id = h.entity_id
 and pp.tenant_id = h.tenant_id
left join public.project_programming related_pp
  on related_pp.tenant_id = h.tenant_id
 and related_pp.id = case
   when coalesce(h.metadata ->> 'newProgrammingId', '') ~* '^[0-9a-f-]{36}$' then (h.metadata ->> 'newProgrammingId')::uuid
   when coalesce(h.metadata ->> 'sourceProgrammingId', '') ~* '^[0-9a-f-]{36}$' then (h.metadata ->> 'sourceProgrammingId')::uuid
   else null
 end
where h.module_key = 'programacao'
  and h.entity_table = 'project_programming'
  and not exists (
    select 1
    from public.project_programming_history ph
    where ph.source_history_id = h.id
  );

drop function if exists public.set_project_programming_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
);

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
    pp.start_time,
    pp.end_time,
    pp.etapa_number,
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
    'programacao',
    'project_programming',
    p_programming_id,
    coalesce(v_current.sob, p_programming_id::text),
    case when v_target_status = 'CANCELADA' then 'CANCEL' else 'UPDATE' end,
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', v_target_status),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', v_target_status,
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_programming_id,
    v_current.project_id,
    v_current.team_id,
    null,
    v_target_status,
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', v_target_status),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', v_target_status,
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date
    ),
    v_current.status,
    v_target_status,
    v_current.execution_date,
    v_current.execution_date,
    v_current.team_id,
    v_current.team_id,
    v_current.start_time,
    v_current.start_time,
    v_current.end_time,
    v_current.end_time,
    v_current.etapa_number,
    v_current.etapa_number
  );

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

drop function if exists public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
);

create or replace function public.postpone_project_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_new_execution_date date,
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
  v_current record;
  v_documents jsonb;
  v_activities jsonb;
  v_save_result jsonb;
  v_new_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null or v_reason is null or p_new_execution_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_POSTPONE_PAYLOAD',
      'message', 'Informe programacao, motivo e nova data para o adiamento.'
    );
  end if;

  select
    pp.*,
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
      'message', 'Programacao nao encontrada ou nao esta mais ativa para adiamento.'
    );
  end if;

  if p_new_execution_date <= v_current.execution_date then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'NON_FORWARD_EXECUTION_DATE',
      'message', 'Informe uma nova data posterior a data atual da programacao.'
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

  v_documents := jsonb_build_object(
    'sgd', jsonb_build_object(
      'number', coalesce(v_current.sgd_number, ''),
      'includedAt', coalesce(v_current.sgd_included_at, null),
      'deliveredAt', coalesce(v_current.sgd_delivered_at, null)
    ),
    'pi', jsonb_build_object(
      'number', coalesce(v_current.pi_number, ''),
      'includedAt', coalesce(v_current.pi_included_at, null),
      'deliveredAt', coalesce(v_current.pi_delivered_at, null)
    ),
    'pep', jsonb_build_object(
      'number', coalesce(v_current.pep_number, ''),
      'includedAt', coalesce(v_current.pep_included_at, null),
      'deliveredAt', coalesce(v_current.pep_delivered_at, null)
    )
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'catalogId', service_activity_id,
        'quantity', quantity
      )
    ) filter (where is_active = true),
    '[]'::jsonb
  )
  into v_activities
  from public.project_programming_activities
  where tenant_id = p_tenant_id
    and programming_id = p_programming_id;

  v_save_result := public.save_project_programming(
    p_tenant_id,
    p_actor_user_id,
    v_current.project_id,
    v_current.team_id,
    p_new_execution_date,
    v_current.period,
    v_current.start_time,
    v_current.end_time,
    v_current.expected_minutes,
    v_current.feeder,
    v_current.support,
    v_current.note,
    v_documents,
    v_activities,
    null,
    null,
    v_current.support_item_id
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_save_result ->> 'status')::integer, 400),
      'reason', coalesce(v_save_result ->> 'reason', 'POSTPONE_CREATE_FAILED'),
      'message', coalesce(v_save_result ->> 'message', 'Falha ao criar a nova programacao adiada.')
    );
  end if;

  v_new_programming_id := nullif(v_save_result ->> 'programming_id', '')::uuid;

  if v_new_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'POSTPONE_INVALID_RESULT',
        'message', 'Falha ao recuperar a nova programacao adiada.'
      )::text;
  end if;

  update public.project_programming
  set
    service_description = v_current.service_description,
    poste_qty = coalesce(v_current.poste_qty, 0),
    estrutura_qty = coalesce(v_current.estrutura_qty, 0),
    trafo_qty = coalesce(v_current.trafo_qty, 0),
    rede_qty = coalesce(v_current.rede_qty, 0),
    etapa_number = v_current.etapa_number,
    work_completion_status = null,
    affected_customers = coalesce(v_current.affected_customers, 0),
    sgd_type_id = v_current.sgd_type_id,
    outage_start_time = v_current.outage_start_time,
    outage_end_time = v_current.outage_end_time,
    sgd_included_at = v_current.sgd_included_at,
    sgd_delivered_at = v_current.sgd_delivered_at,
    pi_included_at = v_current.pi_included_at,
    pi_delivered_at = v_current.pi_delivered_at,
    pep_included_at = v_current.pep_included_at,
    pep_delivered_at = v_current.pep_delivered_at,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_new_programming_id;

  update public.project_programming
  set
    status = 'ADIADA',
    is_active = false,
    cancellation_reason = v_reason,
    canceled_at = now(),
    canceled_by = p_actor_user_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id;

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
    'programacao',
    'project_programming',
    p_programming_id,
    coalesce(v_current.sob, p_programming_id::text),
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', 'ADIADA'),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', 'ADIADA',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date,
      'newExecutionDate', p_new_execution_date,
      'newProgrammingId', v_new_programming_id
    ),
    p_actor_user_id,
    p_actor_user_id
  ),
  (
    p_tenant_id,
    'programacao',
    'project_programming',
    v_new_programming_id,
    coalesce(v_current.sob, v_new_programming_id::text),
    'UPDATE',
    v_reason,
    jsonb_build_object(
      'project', jsonb_build_object('from', null, 'to', coalesce(v_current.sob, v_current.project_id::text)),
      'executionDate', jsonb_build_object('from', null, 'to', p_new_execution_date)
    ),
    jsonb_build_object(
      'action', 'CREATE',
      'source', 'programacao-postpone',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', p_new_execution_date,
      'sourceProgrammingId', p_programming_id
    ),
    p_actor_user_id,
    p_actor_user_id
  );

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_programming_id,
    v_current.project_id,
    v_current.team_id,
    v_new_programming_id,
    'ADIADA',
    v_reason,
    jsonb_build_object(
      'status', jsonb_build_object('from', v_current.status, 'to', 'ADIADA'),
      'executionDate', jsonb_build_object('from', v_current.execution_date, 'to', p_new_execution_date),
      'isActive', jsonb_build_object('from', 'true', 'to', 'false'),
      'cancellationReason', jsonb_build_object('from', null, 'to', v_reason)
    ),
    jsonb_build_object(
      'action', 'ADIADA',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', v_current.execution_date,
      'newExecutionDate', p_new_execution_date,
      'newProgrammingId', v_new_programming_id
    ),
    v_current.status,
    'ADIADA',
    v_current.execution_date,
    p_new_execution_date,
    v_current.team_id,
    v_current.team_id,
    v_current.start_time,
    v_current.start_time,
    v_current.end_time,
    v_current.end_time,
    v_current.etapa_number,
    v_current.etapa_number
  );

  perform public.append_project_programming_history_record(
    p_tenant_id,
    p_actor_user_id,
    v_new_programming_id,
    v_current.project_id,
    v_current.team_id,
    p_programming_id,
    'CREATE',
    v_reason,
    jsonb_build_object(
      'project', jsonb_build_object('from', null, 'to', coalesce(v_current.sob, v_current.project_id::text)),
      'executionDate', jsonb_build_object('from', null, 'to', p_new_execution_date)
    ),
    jsonb_build_object(
      'action', 'CREATE',
      'source', 'programacao-postpone',
      'projectId', v_current.project_id,
      'teamId', v_current.team_id,
      'executionDate', p_new_execution_date,
      'sourceProgrammingId', p_programming_id
    ),
    null,
    'PROGRAMADA',
    null,
    p_new_execution_date,
    null,
    v_current.team_id,
    null,
    v_current.start_time,
    null,
    v_current.end_time,
    null,
    v_current.etapa_number,
    v_current.etapa_number
  );

  select updated_at
  into v_updated_at
  from public.project_programming
  where tenant_id = p_tenant_id
    and id = p_programming_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'new_programming_id', v_new_programming_id,
    'project_code', coalesce(v_current.sob, ''),
    'updated_at', v_updated_at,
    'message', format('Programacao do projeto %s adiada com sucesso. Nova programacao criada para %s.', v_current.sob, to_char(p_new_execution_date, 'DD/MM/YYYY'))
  );
exception
  when others then
    begin
      return nullif(sqlerrm, '')::jsonb;
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'POSTPONE_PROGRAMMING_FAILED',
          'message', 'Falha ao adiar programacao.'
        );
    end;
end;
$$;

revoke all on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) from public;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to authenticated;

grant execute on function public.postpone_project_programming(
  uuid,
  uuid,
  uuid,
  date,
  text,
  timestamptz
) to service_role;
