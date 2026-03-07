-- 016_add_login_name_to_auth_tables.sql
-- Adiciona login_name em app_users e tabelas de auditoria para suportar login web.

alter table if exists public.app_users
  add column if not exists login_name text;

update public.app_users
set login_name = lower(trim(matricula))
where login_name is null
  and matricula is not null;

alter table if exists public.app_users
  alter column login_name set not null;

create unique index if not exists idx_app_users_login_name_unique
  on public.app_users (lower(login_name));

alter table if exists public.login_audit
  add column if not exists login_name text;

update public.login_audit
set login_name = lower(trim(matricula))
where login_name is null
  and matricula is not null;

create index if not exists idx_login_audit_login_name_created
  on public.login_audit (login_name, created_at desc);

alter table if exists public.app_error_logs
  add column if not exists login_name text;

update public.app_error_logs
set login_name = lower(trim(matricula))
where login_name is null
  and matricula is not null;

create index if not exists idx_app_error_logs_login_name_created
  on public.app_error_logs (login_name, created_at desc);

comment on column public.app_users.login_name is
'Identificador de login web/mobile. Deve ser unico globalmente enquanto o tenant nao for resolvido antes do login.';
