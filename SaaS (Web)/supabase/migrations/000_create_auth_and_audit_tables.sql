-- 000_create_auth_and_audit_tables.sql
-- Tabelas base de autenticacao, IMEI, auditoria de login e logs de erro.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  auth_user_id uuid unique,
  matricula text not null,
  email text not null,
  role text not null default 'user',
  ativo boolean not null default true,
  admin_pin_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, matricula),
  unique (tenant_id, email)
);

create table if not exists public.imei_whitelist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  imei text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, imei)
);

create table if not exists public.login_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid references public.app_users(id),
  matricula text,
  device_imei text,
  source text not null default 'APP',
  status text not null,
  reason text,
  logged_in_at timestamptz not null default now(),
  logged_out_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.app_error_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid references public.app_users(id),
  matricula text,
  source text not null default 'APP',
  device_imei text,
  severity text not null default 'ERROR',
  screen text,
  message text not null,
  stacktrace text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_users_tenant_matricula
  on public.app_users (tenant_id, matricula);

create index if not exists idx_app_users_auth_user_id
  on public.app_users (auth_user_id);

create index if not exists idx_imei_whitelist_tenant_imei
  on public.imei_whitelist (tenant_id, imei);

create index if not exists idx_login_audit_tenant_created
  on public.login_audit (tenant_id, created_at desc);

create index if not exists idx_app_error_logs_tenant_created
  on public.app_error_logs (tenant_id, created_at desc);

alter table if exists public.app_users enable row level security;
alter table if exists public.imei_whitelist enable row level security;
alter table if exists public.login_audit enable row level security;
alter table if exists public.app_error_logs enable row level security;

drop policy if exists app_users_select_self on public.app_users;
drop policy if exists imei_whitelist_tenant_select on public.imei_whitelist;
drop policy if exists login_audit_tenant_select on public.login_audit;
drop policy if exists app_error_logs_tenant_select on public.app_error_logs;

create policy app_users_select_self on public.app_users
for select using (auth.uid() = auth_user_id);

create policy imei_whitelist_tenant_select on public.imei_whitelist
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = imei_whitelist.tenant_id
  )
);

create policy login_audit_tenant_select on public.login_audit
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = login_audit.tenant_id
  )
);

create policy app_error_logs_tenant_select on public.app_error_logs
for select using (
  exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.tenant_id = app_error_logs.tenant_id
  )
);

comment on column public.app_users.admin_pin_hash is
'SHA-256 hex do PIN admin. Exemplo: encode(digest(''1234'', ''sha256''), ''hex'')';
