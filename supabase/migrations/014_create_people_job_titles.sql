-- 014_create_people_job_titles.sql
-- Cadastro base de cargos e pessoas usadas como responsavel no app e no SaaS.

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_title_id uuid not null references public.job_titles(id),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_titles_tenant_active
  on public.job_titles (tenant_id, ativo, code);

create index if not exists idx_people_tenant_active
  on public.people (tenant_id, ativo, nome);

alter table if exists public.job_titles enable row level security;
alter table if exists public.people enable row level security;

drop policy if exists job_titles_tenant_select on public.job_titles;
drop policy if exists job_titles_tenant_write on public.job_titles;
drop policy if exists people_tenant_select on public.people;
drop policy if exists people_tenant_write on public.people;

create policy job_titles_tenant_select on public.job_titles
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = job_titles.tenant_id
  )
);

create policy job_titles_tenant_write on public.job_titles
for all using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = job_titles.tenant_id
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = job_titles.tenant_id
  )
);

create policy people_tenant_select on public.people
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = people.tenant_id
  )
);

create policy people_tenant_write on public.people
for all using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = people.tenant_id
  )
)
with check (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = people.tenant_id
  )
);
