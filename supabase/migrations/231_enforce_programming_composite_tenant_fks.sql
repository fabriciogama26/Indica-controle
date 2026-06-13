-- Etapa 5: impede referencias cruzadas entre tenants nas relacoes da Programacao.
-- A migration falha antes de alterar constraints quando encontra dado legado invalido.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project'::regclass
      and conname = 'project_id_tenant_key'
  ) then
    alter table public.project
      add constraint project_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.teams'::regclass
      and conname = 'teams_id_tenant_key'
  ) then
    alter table public.teams
      add constraint teams_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.service_activities'::regclass
      and conname = 'service_activities_id_tenant_key'
  ) then
    alter table public.service_activities
      add constraint service_activities_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.programming_support_items'::regclass
      and conname = 'programming_support_items_id_tenant_key'
  ) then
    alter table public.programming_support_items
      add constraint programming_support_items_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.programming_eq_catalog'::regclass
      and conname = 'programming_eq_catalog_id_tenant_key'
  ) then
    alter table public.programming_eq_catalog
      add constraint programming_eq_catalog_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_programming'::regclass
      and conname = 'project_programming_id_tenant_key'
  ) then
    alter table public.project_programming
      add constraint project_programming_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.project_programming_copy_batches'::regclass
      and conname = 'pp_copy_batches_id_tenant_key'
  ) then
    alter table public.project_programming_copy_batches
      add constraint pp_copy_batches_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

do $$
declare
  v_issues text;
begin
  select string_agg(format('%s=%s', relation_name, invalid_count), ', ')
  into v_issues
  from (
    select 'project_programming.project_id' relation_name, count(*) invalid_count
    from public.project_programming child
    join public.project parent on parent.id = child.project_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming.team_id', count(*)
    from public.project_programming child
    join public.teams parent on parent.id = child.team_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming.support_item_id', count(*)
    from public.project_programming child
    join public.programming_support_items parent on parent.id = child.support_item_id
    where child.support_item_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming.electrical_eq_catalog_id', count(*)
    from public.project_programming child
    join public.programming_eq_catalog parent on parent.id = child.electrical_eq_catalog_id
    where child.electrical_eq_catalog_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming.copied_from_programming_id', count(*)
    from public.project_programming child
    join public.project_programming parent on parent.id = child.copied_from_programming_id
    where child.copied_from_programming_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming.copy_batch_id', count(*)
    from public.project_programming child
    join public.project_programming_copy_batches parent on parent.id = child.copy_batch_id
    where child.copy_batch_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_activities.programming_id', count(*)
    from public.project_programming_activities child
    join public.project_programming parent on parent.id = child.programming_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_activities.service_activity_id', count(*)
    from public.project_programming_activities child
    join public.service_activities parent on parent.id = child.service_activity_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batches.project_id', count(*)
    from public.project_programming_copy_batches child
    join public.project parent on parent.id = child.project_id
    where child.project_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batches.source_programming_id', count(*)
    from public.project_programming_copy_batches child
    join public.project_programming parent on parent.id = child.source_programming_id
    where child.source_programming_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batches.source_team_id', count(*)
    from public.project_programming_copy_batches child
    join public.teams parent on parent.id = child.source_team_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batch_items.copy_batch_id', count(*)
    from public.project_programming_copy_batch_items child
    join public.project_programming_copy_batches parent on parent.id = child.copy_batch_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batch_items.source_programming_id', count(*)
    from public.project_programming_copy_batch_items child
    join public.project_programming parent on parent.id = child.source_programming_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batch_items.target_programming_id', count(*)
    from public.project_programming_copy_batch_items child
    join public.project_programming parent on parent.id = child.target_programming_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_copy_batch_items.target_team_id', count(*)
    from public.project_programming_copy_batch_items child
    join public.teams parent on parent.id = child.target_team_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.programming_id', count(*)
    from public.project_programming_history child
    join public.project_programming parent on parent.id = child.programming_id
    where parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.project_id', count(*)
    from public.project_programming_history child
    join public.project parent on parent.id = child.project_id
    where child.project_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.team_id', count(*)
    from public.project_programming_history child
    join public.teams parent on parent.id = child.team_id
    where child.team_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.related_programming_id', count(*)
    from public.project_programming_history child
    join public.project_programming parent on parent.id = child.related_programming_id
    where child.related_programming_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.from_team_id', count(*)
    from public.project_programming_history child
    join public.teams parent on parent.id = child.from_team_id
    where child.from_team_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_programming_history.to_team_id', count(*)
    from public.project_programming_history child
    join public.teams parent on parent.id = child.to_team_id
    where child.to_team_id is not null
      and parent.tenant_id <> child.tenant_id

    union all
    select 'project_measurement_orders.programming_id', count(*)
    from public.project_measurement_orders child
    join public.project_programming parent on parent.id = child.programming_id
    where child.programming_id is not null
      and parent.tenant_id <> child.tenant_id
  ) validation
  where invalid_count > 0;

  if v_issues is not null then
    raise exception
      'programming_cross_tenant_data: corrija os vinculos antes da migration 231: %',
      v_issues;
  end if;
end;
$$;

alter table public.project_programming
  drop constraint if exists project_programming_project_id_fkey,
  drop constraint if exists project_programming_team_id_fkey,
  drop constraint if exists project_programming_support_item_id_fkey,
  drop constraint if exists project_programming_electrical_eq_catalog_id_fkey,
  drop constraint if exists project_programming_copied_from_programming_id_fk,
  drop constraint if exists project_programming_copy_batch_id_fk,
  drop constraint if exists pp_project_tenant_fk,
  drop constraint if exists pp_team_tenant_fk,
  drop constraint if exists pp_support_item_tenant_fk,
  drop constraint if exists pp_eq_catalog_tenant_fk,
  drop constraint if exists pp_copied_from_tenant_fk,
  drop constraint if exists pp_copy_batch_tenant_fk;

alter table public.project_programming
  add constraint pp_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id) not valid,
  add constraint pp_team_tenant_fk
    foreign key (team_id, tenant_id)
    references public.teams(id, tenant_id) not valid,
  add constraint pp_support_item_tenant_fk
    foreign key (support_item_id, tenant_id)
    references public.programming_support_items(id, tenant_id) not valid,
  add constraint pp_eq_catalog_tenant_fk
    foreign key (electrical_eq_catalog_id, tenant_id)
    references public.programming_eq_catalog(id, tenant_id)
    on delete set null (electrical_eq_catalog_id) not valid,
  add constraint pp_copied_from_tenant_fk
    foreign key (copied_from_programming_id, tenant_id)
    references public.project_programming(id, tenant_id) not valid,
  add constraint pp_copy_batch_tenant_fk
    foreign key (copy_batch_id, tenant_id)
    references public.project_programming_copy_batches(id, tenant_id) not valid;

alter table public.project_programming_activities
  drop constraint if exists project_programming_activities_programming_id_fkey,
  drop constraint if exists project_programming_activities_service_activity_id_fkey,
  drop constraint if exists ppa_programming_tenant_fk,
  drop constraint if exists ppa_service_activity_tenant_fk;

alter table public.project_programming_activities
  add constraint ppa_programming_tenant_fk
    foreign key (programming_id, tenant_id)
    references public.project_programming(id, tenant_id)
    on delete cascade not valid,
  add constraint ppa_service_activity_tenant_fk
    foreign key (service_activity_id, tenant_id)
    references public.service_activities(id, tenant_id) not valid;

alter table public.project_programming_copy_batches
  drop constraint if exists project_programming_copy_batches_project_id_fkey,
  drop constraint if exists project_programming_copy_batches_source_programming_id_fkey,
  drop constraint if exists project_programming_copy_batches_source_team_id_fkey,
  drop constraint if exists ppcb_project_tenant_fk,
  drop constraint if exists ppcb_source_programming_tenant_fk,
  drop constraint if exists ppcb_source_team_tenant_fk;

alter table public.project_programming_copy_batches
  add constraint ppcb_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id) not valid,
  add constraint ppcb_source_programming_tenant_fk
    foreign key (source_programming_id, tenant_id)
    references public.project_programming(id, tenant_id) not valid,
  add constraint ppcb_source_team_tenant_fk
    foreign key (source_team_id, tenant_id)
    references public.teams(id, tenant_id) not valid;

alter table public.project_programming_copy_batch_items
  drop constraint if exists project_programming_copy_batch_items_copy_batch_id_fkey,
  drop constraint if exists project_programming_copy_batch_items_source_programming_id_fkey,
  drop constraint if exists project_programming_copy_batch_items_target_programming_id_fkey,
  drop constraint if exists project_programming_copy_batch_items_target_team_id_fkey,
  drop constraint if exists ppcbi_batch_tenant_fk,
  drop constraint if exists ppcbi_source_programming_tenant_fk,
  drop constraint if exists ppcbi_target_programming_tenant_fk,
  drop constraint if exists ppcbi_target_team_tenant_fk;

alter table public.project_programming_copy_batch_items
  add constraint ppcbi_batch_tenant_fk
    foreign key (copy_batch_id, tenant_id)
    references public.project_programming_copy_batches(id, tenant_id)
    on delete cascade not valid,
  add constraint ppcbi_source_programming_tenant_fk
    foreign key (source_programming_id, tenant_id)
    references public.project_programming(id, tenant_id) not valid,
  add constraint ppcbi_target_programming_tenant_fk
    foreign key (target_programming_id, tenant_id)
    references public.project_programming(id, tenant_id) not valid,
  add constraint ppcbi_target_team_tenant_fk
    foreign key (target_team_id, tenant_id)
    references public.teams(id, tenant_id) not valid;

alter table public.project_programming_history
  drop constraint if exists project_programming_history_programming_id_fkey,
  drop constraint if exists project_programming_history_project_id_fkey,
  drop constraint if exists project_programming_history_team_id_fkey,
  drop constraint if exists project_programming_history_related_programming_id_fkey,
  drop constraint if exists project_programming_history_from_team_id_fkey,
  drop constraint if exists project_programming_history_to_team_id_fkey,
  drop constraint if exists pph_programming_tenant_fk,
  drop constraint if exists pph_project_tenant_fk,
  drop constraint if exists pph_team_tenant_fk,
  drop constraint if exists pph_related_programming_tenant_fk,
  drop constraint if exists pph_from_team_tenant_fk,
  drop constraint if exists pph_to_team_tenant_fk;

alter table public.project_programming_history
  add constraint pph_programming_tenant_fk
    foreign key (programming_id, tenant_id)
    references public.project_programming(id, tenant_id)
    on delete cascade not valid,
  add constraint pph_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project(id, tenant_id)
    on delete set null (project_id) not valid,
  add constraint pph_team_tenant_fk
    foreign key (team_id, tenant_id)
    references public.teams(id, tenant_id)
    on delete set null (team_id) not valid,
  add constraint pph_related_programming_tenant_fk
    foreign key (related_programming_id, tenant_id)
    references public.project_programming(id, tenant_id)
    on delete set null (related_programming_id) not valid,
  add constraint pph_from_team_tenant_fk
    foreign key (from_team_id, tenant_id)
    references public.teams(id, tenant_id)
    on delete set null (from_team_id) not valid,
  add constraint pph_to_team_tenant_fk
    foreign key (to_team_id, tenant_id)
    references public.teams(id, tenant_id)
    on delete set null (to_team_id) not valid;

alter table public.project_measurement_orders
  drop constraint if exists project_measurement_orders_programming_id_fkey,
  drop constraint if exists pmo_programming_tenant_fk;

alter table public.project_measurement_orders
  add constraint pmo_programming_tenant_fk
    foreign key (programming_id, tenant_id)
    references public.project_programming(id, tenant_id)
    on delete set null (programming_id) not valid;

alter table public.project_programming validate constraint pp_project_tenant_fk;
alter table public.project_programming validate constraint pp_team_tenant_fk;
alter table public.project_programming validate constraint pp_support_item_tenant_fk;
alter table public.project_programming validate constraint pp_eq_catalog_tenant_fk;
alter table public.project_programming validate constraint pp_copied_from_tenant_fk;
alter table public.project_programming validate constraint pp_copy_batch_tenant_fk;
alter table public.project_programming_activities validate constraint ppa_programming_tenant_fk;
alter table public.project_programming_activities validate constraint ppa_service_activity_tenant_fk;
alter table public.project_programming_copy_batches validate constraint ppcb_project_tenant_fk;
alter table public.project_programming_copy_batches validate constraint ppcb_source_programming_tenant_fk;
alter table public.project_programming_copy_batches validate constraint ppcb_source_team_tenant_fk;
alter table public.project_programming_copy_batch_items validate constraint ppcbi_batch_tenant_fk;
alter table public.project_programming_copy_batch_items validate constraint ppcbi_source_programming_tenant_fk;
alter table public.project_programming_copy_batch_items validate constraint ppcbi_target_programming_tenant_fk;
alter table public.project_programming_copy_batch_items validate constraint ppcbi_target_team_tenant_fk;
alter table public.project_programming_history validate constraint pph_programming_tenant_fk;
alter table public.project_programming_history validate constraint pph_project_tenant_fk;
alter table public.project_programming_history validate constraint pph_team_tenant_fk;
alter table public.project_programming_history validate constraint pph_related_programming_tenant_fk;
alter table public.project_programming_history validate constraint pph_from_team_tenant_fk;
alter table public.project_programming_history validate constraint pph_to_team_tenant_fk;
alter table public.project_measurement_orders validate constraint pmo_programming_tenant_fk;

do $$
declare
  v_programming_id uuid;
  v_other_project_id uuid;
  v_activity public.project_programming_activities%rowtype;
  v_other_programming_id uuid;
  v_constraint_count integer;
begin
  select pp.id, other_project.id
  into v_programming_id, v_other_project_id
  from public.project_programming pp
  join lateral (
    select p.id
    from public.project p
    where p.tenant_id <> pp.tenant_id
    order by p.id
    limit 1
  ) other_project on true
  order by pp.id
  limit 1;

  if v_programming_id is not null then
    begin
      update public.project_programming
      set project_id = v_other_project_id
      where id = v_programming_id;

      raise exception
        'programming_cross_tenant_update_test_failed: UPDATE cruzado foi aceito';
    exception
      when foreign_key_violation then
        null;
    end;
  end if;

  select activity.*
  into v_activity
  from public.project_programming_activities activity
  where exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id <> activity.tenant_id
  )
  order by activity.id
  limit 1;

  if v_activity.id is not null then
    select pp.id
    into v_other_programming_id
    from public.project_programming pp
    where pp.tenant_id <> v_activity.tenant_id
    order by pp.id
    limit 1;

    begin
      insert into public.project_programming_activities (
        id,
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
        gen_random_uuid(),
        v_activity.tenant_id,
        v_other_programming_id,
        v_activity.service_activity_id,
        v_activity.activity_code,
        v_activity.activity_description,
        v_activity.activity_unit,
        v_activity.quantity,
        v_activity.is_active,
        v_activity.created_by,
        v_activity.updated_by
      );

      raise exception
        'programming_cross_tenant_insert_test_failed: INSERT cruzado foi aceito';
    exception
      when foreign_key_violation then
        null;
    end;
  end if;

  select count(*)
  into v_constraint_count
  from pg_constraint
  where conname = any (array[
    'pp_project_tenant_fk',
    'pp_team_tenant_fk',
    'pp_support_item_tenant_fk',
    'pp_eq_catalog_tenant_fk',
    'pp_copied_from_tenant_fk',
    'pp_copy_batch_tenant_fk',
    'ppa_programming_tenant_fk',
    'ppa_service_activity_tenant_fk',
    'ppcb_project_tenant_fk',
    'ppcb_source_programming_tenant_fk',
    'ppcb_source_team_tenant_fk',
    'ppcbi_batch_tenant_fk',
    'ppcbi_source_programming_tenant_fk',
    'ppcbi_target_programming_tenant_fk',
    'ppcbi_target_team_tenant_fk',
    'pph_programming_tenant_fk',
    'pph_project_tenant_fk',
    'pph_team_tenant_fk',
    'pph_related_programming_tenant_fk',
    'pph_from_team_tenant_fk',
    'pph_to_team_tenant_fk',
    'pmo_programming_tenant_fk'
  ])
    and connamespace = 'public'::regnamespace
    and contype = 'f'
    and convalidated = true;

  if v_constraint_count <> 22 then
    raise exception
      'programming_composite_fk_validation_failed: esperadas 22 FKs validadas, encontradas %',
      v_constraint_count;
  end if;
end;
$$;

commit;
