-- 032_create_contrato_table.sql
-- Cria a tabela de contrato por tenant, usando o tenant_id como valor do contrato.

create table if not exists public.contrato (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  name text,
  valor text generated always as (tenant_id::text) stored,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

alter table if exists public.contrato
  add column if not exists name text;

update public.contrato
set name = tenant_id::text
where nullif(btrim(name), '') is null;

alter table if exists public.contrato
  alter column name set not null;

alter table if exists public.contrato
  drop constraint if exists chk_contrato_name_not_blank;

alter table if exists public.contrato
  add constraint chk_contrato_name_not_blank
  check (btrim(name) <> '');

create index if not exists idx_contrato_tenant_active
  on public.contrato (tenant_id, ativo);

insert into public.contrato (tenant_id, name)
select distinct au.tenant_id, au.tenant_id::text
from public.app_users au
where au.tenant_id is not null
on conflict (tenant_id) do nothing;

alter table if exists public.contrato enable row level security;

drop policy if exists contrato_tenant_select on public.contrato;
create policy contrato_tenant_select on public.contrato
for select
to authenticated
using (public.user_can_access_tenant(contrato.tenant_id));

drop policy if exists contrato_tenant_write on public.contrato;
create policy contrato_tenant_write on public.contrato
for all
to authenticated
using (public.user_can_access_tenant(contrato.tenant_id))
with check (public.user_can_access_tenant(contrato.tenant_id));

drop trigger if exists trg_contrato_audit on public.contrato;
create trigger trg_contrato_audit before insert or update on public.contrato
for each row execute function public.apply_audit_fields();
