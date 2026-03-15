-- 074_create_programming_copy_batches.sql
-- Formaliza lotes de copia da Programacao entre equipes e vincula cada programacao copiada a sua origem.

alter table if exists public.project_programming
  add column if not exists copied_from_programming_id uuid,
  add column if not exists copy_batch_id uuid;

create table if not exists public.project_programming_copy_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.project(id),
  source_programming_id uuid not null references public.project_programming(id),
  source_team_id uuid not null references public.teams(id),
  copy_mode text not null,
  visible_start_date date,
  visible_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_programming_copy_batches_mode_check
    check (copy_mode in ('single', 'project_period')),
  constraint project_programming_copy_batches_period_check
    check (
      (copy_mode = 'single' and visible_start_date is null and visible_end_date is null)
      or (
        copy_mode = 'project_period'
        and visible_start_date is not null
        and visible_end_date is not null
        and visible_start_date <= visible_end_date
      )
    )
);

create table if not exists public.project_programming_copy_batch_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  copy_batch_id uuid not null references public.project_programming_copy_batches(id) on delete cascade,
  source_programming_id uuid not null references public.project_programming(id),
  target_programming_id uuid not null references public.project_programming(id),
  target_team_id uuid not null references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_programming_copy_batch_items_unique_target unique (target_programming_id),
  constraint project_programming_copy_batch_items_unique_batch_target unique (copy_batch_id, source_programming_id, target_team_id)
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_programming'
      and tc.constraint_name = 'project_programming_copied_from_programming_id_fk'
  ) then
    alter table public.project_programming
      add constraint project_programming_copied_from_programming_id_fk
      foreign key (copied_from_programming_id) references public.project_programming(id);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_programming'
      and tc.constraint_name = 'project_programming_copy_batch_id_fk'
  ) then
    alter table public.project_programming
      add constraint project_programming_copy_batch_id_fk
      foreign key (copy_batch_id) references public.project_programming_copy_batches(id);
  end if;
end;
$$;

create index if not exists idx_project_programming_copy_batches_tenant_project
  on public.project_programming_copy_batches (tenant_id, project_id, created_at desc);

create index if not exists idx_project_programming_copy_batches_tenant_source
  on public.project_programming_copy_batches (tenant_id, source_programming_id, created_at desc);

create index if not exists idx_project_programming_copy_batch_items_tenant_batch
  on public.project_programming_copy_batch_items (tenant_id, copy_batch_id, created_at desc);

create index if not exists idx_project_programming_copy_batch_items_tenant_target
  on public.project_programming_copy_batch_items (tenant_id, target_programming_id);

create index if not exists idx_project_programming_tenant_copied_from
  on public.project_programming (tenant_id, copied_from_programming_id);

create index if not exists idx_project_programming_tenant_copy_batch
  on public.project_programming (tenant_id, copy_batch_id);

alter table if exists public.project_programming_copy_batches enable row level security;
alter table if exists public.project_programming_copy_batch_items enable row level security;

drop policy if exists project_programming_copy_batches_tenant_select on public.project_programming_copy_batches;
create policy project_programming_copy_batches_tenant_select on public.project_programming_copy_batches
for select
to authenticated
using (public.user_can_access_tenant(project_programming_copy_batches.tenant_id));

drop policy if exists project_programming_copy_batches_tenant_insert on public.project_programming_copy_batches;
create policy project_programming_copy_batches_tenant_insert on public.project_programming_copy_batches
for insert
to authenticated
with check (public.user_can_access_tenant(project_programming_copy_batches.tenant_id));

drop policy if exists project_programming_copy_batch_items_tenant_select on public.project_programming_copy_batch_items;
create policy project_programming_copy_batch_items_tenant_select on public.project_programming_copy_batch_items
for select
to authenticated
using (public.user_can_access_tenant(project_programming_copy_batch_items.tenant_id));

drop policy if exists project_programming_copy_batch_items_tenant_insert on public.project_programming_copy_batch_items;
create policy project_programming_copy_batch_items_tenant_insert on public.project_programming_copy_batch_items
for insert
to authenticated
with check (public.user_can_access_tenant(project_programming_copy_batch_items.tenant_id));

drop trigger if exists trg_project_programming_copy_batches_audit on public.project_programming_copy_batches;
create trigger trg_project_programming_copy_batches_audit
before insert or update on public.project_programming_copy_batches
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_project_programming_copy_batch_items_audit on public.project_programming_copy_batch_items;
create trigger trg_project_programming_copy_batch_items_audit
before insert or update on public.project_programming_copy_batch_items
for each row execute function public.apply_audit_fields();
