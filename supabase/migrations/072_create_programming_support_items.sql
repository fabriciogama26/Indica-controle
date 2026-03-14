-- 072_create_programming_support_items.sql
-- Cria o catalogo proprio de apoio da Programacao e o vincula ao catalogo da Locacao.

create table if not exists public.programming_support_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  description text not null,
  location_support_item_id uuid null references public.location_execution_support_items(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_support_items_description_not_blank
    check (btrim(description) <> ''),
  constraint programming_support_items_tenant_description_key
    unique (tenant_id, description)
);

create index if not exists idx_programming_support_items_tenant_active_description
  on public.programming_support_items (tenant_id, is_active, description);

create unique index if not exists uq_programming_support_items_tenant_location_item
  on public.programming_support_items (tenant_id, location_support_item_id)
  where location_support_item_id is not null;

alter table if exists public.programming_support_items enable row level security;

drop policy if exists programming_support_items_tenant_select on public.programming_support_items;
create policy programming_support_items_tenant_select on public.programming_support_items
for select
to authenticated
using (public.user_can_access_tenant(programming_support_items.tenant_id));

drop policy if exists programming_support_items_tenant_insert on public.programming_support_items;
create policy programming_support_items_tenant_insert on public.programming_support_items
for insert
to authenticated
with check (public.user_can_access_tenant(programming_support_items.tenant_id));

drop policy if exists programming_support_items_tenant_update on public.programming_support_items;
create policy programming_support_items_tenant_update on public.programming_support_items
for update
to authenticated
using (public.user_can_access_tenant(programming_support_items.tenant_id))
with check (public.user_can_access_tenant(programming_support_items.tenant_id));

drop trigger if exists trg_programming_support_items_audit on public.programming_support_items;
create trigger trg_programming_support_items_audit before insert or update on public.programming_support_items
for each row execute function public.apply_audit_fields();

insert into public.programming_support_items (
  id,
  tenant_id,
  description,
  location_support_item_id,
  is_active
)
select
  lesi.id,
  lesi.tenant_id,
  lesi.description,
  lesi.id,
  lesi.is_active
from public.location_execution_support_items lesi
where not exists (
  select 1
  from public.programming_support_items psi
  where psi.tenant_id = lesi.tenant_id
    and (
      psi.location_support_item_id = lesi.id
      or upper(btrim(psi.description)) = upper(btrim(lesi.description))
    )
);

update public.project_programming pp
set support_item_id = psi.id
from public.location_execution_support_items lesi
join public.programming_support_items psi
  on psi.tenant_id = lesi.tenant_id
 and (
   psi.location_support_item_id = lesi.id
   or upper(btrim(psi.description)) = upper(btrim(lesi.description))
 )
where pp.tenant_id = lesi.tenant_id
  and pp.support_item_id = lesi.id;

alter table if exists public.project_programming
  drop constraint if exists project_programming_support_item_id_fkey;

alter table if exists public.project_programming
  add constraint project_programming_support_item_id_fkey
  foreign key (support_item_id) references public.programming_support_items(id);

drop function if exists public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
);

create or replace function public.save_project_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_id uuid,
  p_execution_date date,
  p_period text,
  p_start_time time,
  p_end_time time,
  p_expected_minutes integer,
  p_feeder text default null,
  p_support text default null,
  p_note text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_support_item_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project record;
  v_team record;
  v_current public.project_programming%rowtype;
  v_programming_id uuid;
  v_action text;
  v_current_updated_at timestamptz;
  v_today date := current_date;
  v_feeder text := nullif(btrim(coalesce(p_feeder, '')), '');
  v_support text := nullif(btrim(coalesce(p_support, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_support_item record;
  v_support_item_id uuid := p_support_item_id;
  v_sgd jsonb := coalesce(p_documents -> 'sgd', '{}'::jsonb);
  v_pi jsonb := coalesce(p_documents -> 'pi', '{}'::jsonb);
  v_pep jsonb := coalesce(p_documents -> 'pep', '{}'::jsonb);
  v_sgd_number text;
  v_sgd_included_at date;
  v_sgd_delivered_at date;
  v_pi_number text;
  v_pi_included_at date;
  v_pi_delivered_at date;
  v_pep_number text;
  v_pep_included_at date;
  v_pep_delivered_at date;
  v_activity jsonb;
  v_activity_id uuid;
  v_activity_id_text text;
  v_activity_qty numeric;
  v_activity_row record;
  v_activity_ids uuid[] := array[]::uuid[];
  v_conflict_id uuid;
  v_conflict_project_code text;
begin
  if p_project_id is null
    or p_team_id is null
    or p_execution_date is null
    or p_period is null
    or p_start_time is null
    or p_end_time is null
    or p_expected_minutes is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Preencha os campos obrigatorios da programacao.'
    );
  end if;

  if upper(btrim(p_period)) not in ('INTEGRAL', 'PARCIAL') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_PERIOD',
      'message', 'Periodo invalido para a programacao.'
    );
  end if;

  if p_expected_minutes <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_EXPECTED_MINUTES',
      'message', 'Tempo previsto deve ser maior que zero.'
    );
  end if;

  if p_end_time <= p_start_time then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TIME_RANGE',
      'message', 'Hora termino deve ser maior que hora inicio.'
    );
  end if;

  if jsonb_typeof(coalesce(p_documents, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_DOCUMENTS_PAYLOAD',
      'message', 'O bloco de documentos da programacao e invalido.'
    );
  end if;

  if jsonb_typeof(coalesce(p_activities, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ACTIVITIES_PAYLOAD',
      'message', 'A lista de atividades da programacao e invalida.'
    );
  end if;

  select
    p.id,
    p.sob,
    p.service_center
  into v_project
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
    and p.is_active = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROJECT_NOT_FOUND',
      'message', 'Projeto invalido para o tenant atual.'
    );
  end if;

  select
    t.id,
    t.name,
    t.service_center_id,
    sc.name as service_center_name
  into v_team
  from public.teams t
  left join public.project_service_centers sc
    on sc.id = t.service_center_id
   and sc.tenant_id = t.tenant_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe invalida para o tenant atual.'
    );
  end if;

  if v_team.service_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_SERVICE_CENTER_REQUIRED',
      'message', 'A equipe precisa ter uma base vinculada antes de salvar a programacao.'
    );
  end if;

  if v_team.service_center_id <> v_project.service_center then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_SERVICE_CENTER_MISMATCH',
      'message', format(
        'A base da equipe %s nao corresponde a base da obra %s.',
        coalesce(v_team.service_center_name, 'Nao identificada'),
        v_project.sob
      )
    );
  end if;

  if v_support_item_id is not null then
    select
      id,
      description
    into v_support_item
    from public.programming_support_items
    where tenant_id = p_tenant_id
      and id = v_support_item_id
      and is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'SUPPORT_ITEM_NOT_FOUND',
        'message', 'Apoio invalido para o tenant atual.'
      );
    end if;

    v_support := nullif(btrim(coalesce(v_support_item.description, '')), '');
  else
    v_support := nullif(btrim(coalesce(p_support, '')), '');
  end if;

  if exists (
    select 1
    from (
      select nullif(btrim(coalesce(item ->> 'catalogId', '')), '') as catalog_id_text
      from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb)) as item
    ) duplicated
    where duplicated.catalog_id_text is not null
    group by duplicated.catalog_id_text
    having count(*) > 1
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATED_ACTIVITY',
      'message', 'Nao repita a mesma atividade na mesma programacao.'
    );
  end if;

  if p_programming_id is not null then
    select *
    into v_current
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_programming_id
      and pp.status = 'PROGRAMADA'
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'PROGRAMMING_NOT_FOUND',
        'message', 'Programacao nao encontrada para edicao.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a tela antes de salvar esta programacao.'
      );
    end if;

    v_current_updated_at := date_trunc('milliseconds', v_current.updated_at);
    if v_current_updated_at <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PROGRAMMING_CONFLICT',
        'message', 'A programacao foi alterada por outro usuario. Recarregue a tela e tente novamente.'
      );
    end if;
  end if;

  select
    pp.id,
    proj.sob
  into v_conflict_id, v_conflict_project_code
  from public.project_programming pp
  join public.project proj
    on proj.id = pp.project_id
   and proj.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.team_id = p_team_id
    and pp.execution_date = p_execution_date
    and pp.status = 'PROGRAMADA'
    and (p_programming_id is null or pp.id <> p_programming_id)
    and p_start_time < pp.end_time
    and p_end_time > pp.start_time
  limit 1;

  if v_conflict_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_TIME_CONFLICT',
      'message', format(
        'A equipe ja possui uma programacao em conflito com a obra %s neste horario.',
        coalesce(v_conflict_project_code, 'informada')
      )
    );
  end if;

  v_sgd_number := nullif(btrim(coalesce(v_sgd ->> 'number', '')), '');
  v_pi_number := nullif(btrim(coalesce(v_pi ->> 'number', '')), '');
  v_pep_number := nullif(btrim(coalesce(v_pep ->> 'number', '')), '');

  v_sgd_delivered_at := nullif(v_sgd ->> 'deliveredAt', '')::date;
  v_pi_delivered_at := nullif(v_pi ->> 'deliveredAt', '')::date;
  v_pep_delivered_at := nullif(v_pep ->> 'deliveredAt', '')::date;

  if v_current.id is not null then
    v_sgd_included_at := case
      when v_sgd_number is null then null
      when v_current.sgd_number is distinct from v_sgd_number then v_today
      else coalesce(v_current.sgd_included_at, v_today)
    end;
    v_pi_included_at := case
      when v_pi_number is null then null
      when v_current.pi_number is distinct from v_pi_number then v_today
      else coalesce(v_current.pi_included_at, v_today)
    end;
    v_pep_included_at := case
      when v_pep_number is null then null
      when v_current.pep_number is distinct from v_pep_number then v_today
      else coalesce(v_current.pep_included_at, v_today)
    end;
  else
    v_sgd_included_at := case when v_sgd_number is null then null else v_today end;
    v_pi_included_at := case when v_pi_number is null then null else v_today end;
    v_pep_included_at := case when v_pep_number is null then null else v_today end;
  end if;

  if v_current.id is null then
    v_action := 'INSERT';
    insert into public.project_programming (
      tenant_id,
      project_id,
      team_id,
      execution_date,
      period,
      start_time,
      end_time,
      expected_minutes,
      feeder,
      support,
      support_item_id,
      note,
      sgd_number,
      sgd_included_at,
      sgd_delivered_at,
      pi_number,
      pi_included_at,
      pi_delivered_at,
      pep_number,
      pep_included_at,
      pep_delivered_at,
      status,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_project_id,
      p_team_id,
      p_execution_date,
      upper(btrim(p_period)),
      p_start_time,
      p_end_time,
      p_expected_minutes,
      v_feeder,
      v_support,
      v_support_item_id,
      v_note,
      v_sgd_number,
      v_sgd_included_at,
      v_sgd_delivered_at,
      v_pi_number,
      v_pi_included_at,
      v_pi_delivered_at,
      v_pep_number,
      v_pep_included_at,
      v_pep_delivered_at,
      'PROGRAMADA',
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_programming_id;
  else
    v_action := 'UPDATE';
    update public.project_programming
    set
      team_id = p_team_id,
      execution_date = p_execution_date,
      period = upper(btrim(p_period)),
      start_time = p_start_time,
      end_time = p_end_time,
      expected_minutes = p_expected_minutes,
      feeder = v_feeder,
      support = v_support,
      support_item_id = v_support_item_id,
      note = v_note,
      sgd_number = v_sgd_number,
      sgd_included_at = v_sgd_included_at,
      sgd_delivered_at = v_sgd_delivered_at,
      pi_number = v_pi_number,
      pi_included_at = v_pi_included_at,
      pi_delivered_at = v_pi_delivered_at,
      pep_number = v_pep_number,
      pep_included_at = v_pep_included_at,
      pep_delivered_at = v_pep_delivered_at,
      status = 'PROGRAMADA',
      is_active = true,
      cancellation_reason = null,
      canceled_at = null,
      canceled_by = null,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_current.id;

    v_programming_id := v_current.id;
  end if;

  for v_activity in
    select value
    from jsonb_array_elements(coalesce(p_activities, '[]'::jsonb))
  loop
    v_activity_id_text := nullif(btrim(coalesce(v_activity ->> 'catalogId', '')), '');
    v_activity_qty := nullif(btrim(coalesce(v_activity ->> 'quantity', '')), '')::numeric;

    if v_activity_id_text is null or v_activity_qty is null or v_activity_qty <= 0 then
      continue;
    end if;

    v_activity_id := v_activity_id_text::uuid;

    select
      sa.id,
      sa.code,
      sa.description,
      sa.unit
    into v_activity_row
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = v_activity_id
      and sa.is_active = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_NOT_FOUND',
        'message', 'Atividade invalida para o tenant atual.'
      );
    end if;

    v_activity_ids := array_append(v_activity_ids, v_activity_id);

    if exists (
      select 1
      from public.project_programming_activities ppa
      where ppa.tenant_id = p_tenant_id
        and ppa.programming_id = v_programming_id
        and ppa.service_activity_id = v_activity_id
    ) then
      update public.project_programming_activities
      set
        quantity = v_activity_qty,
        activity_code = v_activity_row.code,
        activity_description = v_activity_row.description,
        activity_unit = v_activity_row.unit,
        is_active = true,
        updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and programming_id = v_programming_id
        and service_activity_id = v_activity_id;
    else
      insert into public.project_programming_activities (
        tenant_id,
        programming_id,
        service_activity_id,
        activity_code,
        activity_description,
        activity_unit,
        quantity,
        is_active,
        created_by,
        updated_by
      )
      values (
        p_tenant_id,
        v_programming_id,
        v_activity_id,
        v_activity_row.code,
        v_activity_row.description,
        v_activity_row.unit,
        v_activity_qty,
        true,
        p_actor_user_id,
        p_actor_user_id
      );
    end if;
  end loop;

  update public.project_programming_activities
  set
    is_active = false,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and programming_id = v_programming_id
    and (
      cardinality(v_activity_ids) = 0
      or service_activity_id <> all(v_activity_ids)
    );

  return (
    select jsonb_build_object(
      'success', true,
      'status', 200,
      'action', v_action,
      'programming_id', pp.id,
      'project_code', proj.sob,
      'updated_at', pp.updated_at,
      'message', case
        when v_action = 'INSERT' then format('Programacao do projeto %s registrada com sucesso.', proj.sob)
        else format('Programacao do projeto %s atualizada com sucesso.', proj.sob)
      end
    )
    from public.project_programming pp
    join public.project proj
      on proj.id = pp.project_id
     and proj.tenant_id = pp.tenant_id
    where pp.tenant_id = p_tenant_id
      and pp.id = v_programming_id
  );
end;
$$;

revoke all on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) from public;

grant execute on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) to authenticated;

grant execute on function public.save_project_programming(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid
) to service_role;
