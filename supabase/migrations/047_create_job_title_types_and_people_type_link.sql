-- 047_create_job_title_types_and_people_type_link.sql
-- Cria tipos permitidos por cargo e vincula people ao tipo selecionado com consistencia de tenant/cargo.

create table if not exists public.job_title_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_title_id uuid not null,
  code text not null,
  name text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, job_title_id, code)
);

alter table if exists public.job_title_types
  drop constraint if exists chk_job_title_types_code_not_blank;

alter table if exists public.job_title_types
  add constraint chk_job_title_types_code_not_blank
  check (btrim(code) <> '');

alter table if exists public.job_title_types
  drop constraint if exists chk_job_title_types_name_not_blank;

alter table if exists public.job_title_types
  add constraint chk_job_title_types_name_not_blank
  check (btrim(name) <> '');

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_titles'
      and tc.constraint_name = 'job_titles_id_tenant_key'
  ) then
    alter table public.job_titles
      add constraint job_titles_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_title_types'
      and tc.constraint_name = 'job_title_types_tenant_id_fk'
  ) then
    alter table public.job_title_types
      add constraint job_title_types_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_title_types'
      and tc.constraint_name = 'job_title_types_job_title_tenant_fk'
  ) then
    alter table public.job_title_types
      add constraint job_title_types_job_title_tenant_fk
      foreign key (job_title_id, tenant_id)
      references public.job_titles(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_job_title_types_tenant_active
  on public.job_title_types (tenant_id, job_title_id, ativo, name);

alter table if exists public.people
  add column if not exists job_title_type_id uuid;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_title_types'
      and tc.constraint_name = 'job_title_types_id_tenant_job_key'
  ) then
    alter table public.job_title_types
      add constraint job_title_types_id_tenant_job_key
      unique (id, tenant_id, job_title_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'people'
      and tc.constraint_name = 'people_job_title_type_tenant_fk'
  ) then
    alter table public.people
      add constraint people_job_title_type_tenant_fk
      foreign key (job_title_type_id, tenant_id, job_title_id)
      references public.job_title_types(id, tenant_id, job_title_id);
  end if;
end;
$$;

create index if not exists idx_people_tenant_job_title_type
  on public.people (tenant_id, job_title_id, job_title_type_id, ativo, nome);

alter table if exists public.job_title_types enable row level security;

drop policy if exists job_title_types_tenant_select on public.job_title_types;
create policy job_title_types_tenant_select on public.job_title_types
for select
to authenticated
using (public.user_can_access_tenant(job_title_types.tenant_id));

drop policy if exists job_title_types_tenant_write on public.job_title_types;
create policy job_title_types_tenant_write on public.job_title_types
for all
to authenticated
using (public.user_can_access_tenant(job_title_types.tenant_id))
with check (public.user_can_access_tenant(job_title_types.tenant_id));

drop trigger if exists trg_job_title_types_audit on public.job_title_types;
create trigger trg_job_title_types_audit before insert or update on public.job_title_types
for each row execute function public.apply_audit_fields();
