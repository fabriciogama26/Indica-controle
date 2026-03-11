-- 038_project_lookup_uuid_columns.sql
-- Projeto usa UUID nas colunas de dominio da tabela base.
-- Textos de exibicao sao resolvidos pela view public.project_with_labels.

insert into public.contract (tenant_id, name)
select distinct p.tenant_id, p.tenant_id::text
from public.project p
where not exists (
  select 1
  from public.contract c
  where c.tenant_id = p.tenant_id
)
on conflict (tenant_id) do nothing;

alter table if exists public.project
  add column if not exists partner_id uuid references public.contract(id),
  add column if not exists priority_id uuid references public.project_priorities(id),
  add column if not exists service_center_id uuid references public.project_service_centers(id),
  add column if not exists service_type_id uuid references public.project_service_types(id),
  add column if not exists voltage_level_id uuid references public.project_voltage_levels(id),
  add column if not exists project_size_id uuid references public.project_sizes(id),
  add column if not exists municipality_id uuid references public.project_municipalities(id),
  add column if not exists contractor_responsible_id uuid references public.people(id),
  add column if not exists utility_responsible_id uuid references public.project_utility_responsibles(id),
  add column if not exists utility_field_manager_id uuid references public.project_utility_field_managers(id);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'priority' and data_type = 'uuid'
  ) then
    execute 'update public.project set priority_id = coalesce(priority_id, priority) where priority_id is null and priority is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_center' and data_type = 'uuid'
  ) then
    execute 'update public.project set service_center_id = coalesce(service_center_id, service_center) where service_center_id is null and service_center is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_type' and data_type = 'uuid'
  ) then
    execute 'update public.project set service_type_id = coalesce(service_type_id, service_type) where service_type_id is null and service_type is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level' and data_type = 'uuid'
  ) then
    execute 'update public.project set voltage_level_id = coalesce(voltage_level_id, voltage_level) where voltage_level_id is null and voltage_level is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'project_size' and data_type = 'uuid'
  ) then
    execute 'update public.project set project_size_id = coalesce(project_size_id, project_size) where project_size_id is null and project_size is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'city' and data_type = 'uuid'
  ) then
    execute 'update public.project set municipality_id = coalesce(municipality_id, city) where municipality_id is null and city is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible' and data_type = 'uuid'
  ) then
    execute 'update public.project set contractor_responsible_id = coalesce(contractor_responsible_id, contractor_responsible) where contractor_responsible_id is null and contractor_responsible is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible' and data_type = 'uuid'
  ) then
    execute 'update public.project set utility_responsible_id = coalesce(utility_responsible_id, utility_responsible) where utility_responsible_id is null and utility_responsible is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager' and data_type = 'uuid'
  ) then
    execute 'update public.project set utility_field_manager_id = coalesce(utility_field_manager_id, utility_field_manager) where utility_field_manager_id is null and utility_field_manager is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'partner' and data_type = 'uuid'
  ) then
    execute 'update public.project set partner_id = coalesce(partner_id, partner) where partner_id is null and partner is not null';
  end if;
end $$;

update public.project p
set partner_id = c.id
from public.contract c
where p.partner_id is null
  and p.tenant_id = c.tenant_id;

do $$
declare
  v_source_column text;
begin
  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'priority_text'
  ) then
    v_source_column := 'priority_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'priority' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'priority';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set priority_id = l.id
       from public.project_priorities l
       where p.priority_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_center_text'
  ) then
    v_source_column := 'service_center_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_center' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'service_center';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set service_center_id = l.id
       from public.project_service_centers l
       where p.service_center_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_type_text'
  ) then
    v_source_column := 'service_type_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_type' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'service_type';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set service_type_id = l.id
       from public.project_service_types l
       where p.service_type_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level_text'
  ) then
    v_source_column := 'voltage_level_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'voltage_level';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set voltage_level_id = l.id
       from public.project_voltage_levels l
       where p.voltage_level_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'project_size_text'
  ) then
    v_source_column := 'project_size_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'project_size' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'project_size';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set project_size_id = l.id
       from public.project_sizes l
       where p.project_size_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'city_text'
  ) then
    v_source_column := 'city_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'city' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'city';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set municipality_id = l.id
       from public.project_municipalities l
       where p.municipality_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible_text'
  ) then
    v_source_column := 'utility_responsible_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'utility_responsible';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set utility_responsible_id = l.id
       from public.project_utility_responsibles l
       where p.utility_responsible_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager_text'
  ) then
    v_source_column := 'utility_field_manager_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'utility_field_manager';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set utility_field_manager_id = l.id
       from public.project_utility_field_managers l
       where p.utility_field_manager_id is null
         and p.tenant_id = l.tenant_id
         and upper(btrim(coalesce(p.%1$I, ''''))) = l.name_normalized',
      v_source_column
    );
  end if;

  v_source_column := null;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible_text'
  ) then
    v_source_column := 'contractor_responsible_text';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible' and data_type in ('text', 'character varying')
  ) then
    v_source_column := 'contractor_responsible';
  end if;

  if v_source_column is not null then
    execute format(
      'update public.project p
       set contractor_responsible_id = pe.id
       from public.people pe
       join public.job_titles jt
         on jt.id = pe.job_title_id
        and jt.tenant_id = pe.tenant_id
       where p.contractor_responsible_id is null
         and p.tenant_id = pe.tenant_id
         and pe.ativo = true
         and jt.ativo = true
         and upper(btrim(jt.code)) = ''SUPERVISOR''
         and upper(btrim(coalesce(p.%1$I, ''''))) = upper(btrim(pe.nome))',
      v_source_column
    );
  end if;
end $$;

do $$
declare
  v_type text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'priority'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'priority';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'priority_text'
    ) then
      execute 'alter table public.project rename column priority to priority_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_center'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_center';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'service_center_text'
    ) then
      execute 'alter table public.project rename column service_center to service_center_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_type'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'service_type';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'service_type_text'
    ) then
      execute 'alter table public.project rename column service_type to service_type_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'voltage_level_text'
    ) then
      execute 'alter table public.project rename column voltage_level to voltage_level_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'project_size'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'project_size';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'project_size_text'
    ) then
      execute 'alter table public.project rename column project_size to project_size_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'contractor_responsible_text'
    ) then
      execute 'alter table public.project rename column contractor_responsible to contractor_responsible_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'utility_responsible_text'
    ) then
      execute 'alter table public.project rename column utility_responsible to utility_responsible_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'utility_field_manager_text'
    ) then
      execute 'alter table public.project rename column utility_field_manager to utility_field_manager_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'city'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'city';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'city_text'
    ) then
      execute 'alter table public.project rename column city to city_text';
    end if;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'partner'
  ) then
    select data_type into v_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = 'partner';
    if v_type in ('text', 'character varying') and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = 'partner_text'
    ) then
      execute 'alter table public.project rename column partner to partner_text';
    end if;
  end if;
end $$;

do $$
declare
  rec record;
  v_target_type text;
  v_target_text text;
begin
  for rec in
    select *
    from (values
      ('priority_id', 'priority'),
      ('service_center_id', 'service_center'),
      ('service_type_id', 'service_type'),
      ('voltage_level_id', 'voltage_level'),
      ('project_size_id', 'project_size'),
      ('municipality_id', 'city'),
      ('contractor_responsible_id', 'contractor_responsible'),
      ('utility_responsible_id', 'utility_responsible'),
      ('utility_field_manager_id', 'utility_field_manager'),
      ('partner_id', 'partner')
    ) as t(id_column, target_column)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = rec.id_column
    ) then
      continue;
    end if;

    v_target_type := null;
    select data_type
    into v_target_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'project' and column_name = rec.target_column;

    if v_target_type = 'uuid' then
      execute format(
        'update public.project
         set %1$I = coalesce(%1$I, %2$I)
         where %1$I is null and %2$I is not null',
        rec.target_column,
        rec.id_column
      );
      execute format('alter table public.project drop column %I', rec.id_column);
      continue;
    end if;

    if v_target_type is not null then
      v_target_text := rec.target_column || '_text';

      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'project' and column_name = v_target_text
      ) then
        execute format('alter table public.project rename column %I to %I', rec.target_column, v_target_text);
      else
        execute format('alter table public.project drop column %I', rec.target_column);
      end if;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = rec.target_column
    ) then
      execute format('alter table public.project rename column %I to %I', rec.id_column, rec.target_column);
    end if;
  end loop;
end $$;

do $$
declare
  v_column text;
  v_has_null boolean;
begin
  foreach v_column in array array[
    'priority',
    'service_center',
    'service_type',
    'city',
    'contractor_responsible',
    'utility_responsible',
    'utility_field_manager',
    'partner'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'project' and column_name = v_column
    ) then
      execute format('select exists(select 1 from public.project where %I is null)', v_column)
      into v_has_null;

      if not v_has_null then
        execute format('alter table public.project alter column %I set not null', v_column);
      end if;
    end if;
  end loop;
end $$;

alter table if exists public.project
  drop column if exists priority_text cascade,
  drop column if exists service_center_text cascade,
  drop column if exists service_type_text cascade,
  drop column if exists voltage_level_text cascade,
  drop column if exists project_size_text cascade,
  drop column if exists contractor_responsible_text cascade,
  drop column if exists utility_responsible_text cascade,
  drop column if exists utility_field_manager_text cascade,
  drop column if exists city_text cascade,
  drop column if exists partner_text cascade;

create index if not exists idx_project_tenant_priority_uuid
  on public.project (tenant_id, priority);

create index if not exists idx_project_tenant_city_uuid
  on public.project (tenant_id, city);

alter table if exists public.project
  drop constraint if exists chk_project_sob_priority_format;

create or replace function public.project_sob_matches_priority(p_priority_id uuid, p_sob text)
returns boolean
language plpgsql
stable
as $$
declare
  v_priority_name text;
begin
  if p_priority_id is null then
    return true;
  end if;

  select upper(btrim(name))
  into v_priority_name
  from public.project_priorities
  where id = p_priority_id
  limit 1;

  if v_priority_name is null then
    return true;
  end if;

  if v_priority_name in ('GRUPO B - FLUXO', 'DRP / DRC', 'GRUPO A - FLUXO') then
    return upper(btrim(coalesce(p_sob, ''))) ~ '^A[0-9]{9}$';
  end if;

  if v_priority_name = 'FUSESAVER' then
    return upper(btrim(coalesce(p_sob, ''))) ~ '^(ZX|FS)[0-9]{8}$';
  end if;

  return true;
end;
$$;

alter table if exists public.project
  add constraint chk_project_sob_priority_format
  check (public.project_sob_matches_priority(priority, sob));

drop view if exists public.project_with_labels;
create view public.project_with_labels with (security_invoker = true) as
select
  p.id,
  p.tenant_id,
  p.sob,
  p.service_center,
  sc.name as service_center_text,
  p.partner,
  ct.name as partner_text,
  p.service_type,
  st.name as service_type_text,
  p.execution_deadline,
  p.priority,
  pr.name as priority_text,
  p.estimated_value,
  p.voltage_level,
  vl.name as voltage_level_text,
  p.project_size,
  ps.name as project_size_text,
  p.contractor_responsible,
  pe.nome as contractor_responsible_text,
  p.utility_responsible,
  ur.name as utility_responsible_text,
  p.utility_field_manager,
  ufm.name as utility_field_manager_text,
  p.street,
  p.neighborhood,
  p.city,
  m.name as city_text,
  p.service_description,
  p.observation,
  p.is_active,
  p.cancellation_reason,
  p.canceled_at,
  p.canceled_by,
  p.created_by,
  p.updated_by,
  p.created_at,
  p.updated_at
from public.project p
left join public.project_service_centers sc
  on sc.id = p.service_center
 and sc.tenant_id = p.tenant_id
left join public.contract ct
  on ct.id = p.partner
 and ct.tenant_id = p.tenant_id
left join public.project_service_types st
  on st.id = p.service_type
 and st.tenant_id = p.tenant_id
left join public.project_priorities pr
  on pr.id = p.priority
 and pr.tenant_id = p.tenant_id
left join public.project_voltage_levels vl
  on vl.id = p.voltage_level
 and vl.tenant_id = p.tenant_id
left join public.project_sizes ps
  on ps.id = p.project_size
 and ps.tenant_id = p.tenant_id
left join public.people pe
  on pe.id = p.contractor_responsible
 and pe.tenant_id = p.tenant_id
left join public.project_utility_responsibles ur
  on ur.id = p.utility_responsible
 and ur.tenant_id = p.tenant_id
left join public.project_utility_field_managers ufm
  on ufm.id = p.utility_field_manager
 and ufm.tenant_id = p.tenant_id
left join public.project_municipalities m
  on m.id = p.city
 and m.tenant_id = p.tenant_id;

grant select on public.project_with_labels to authenticated;
