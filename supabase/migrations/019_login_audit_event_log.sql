-- 019_login_audit_event_log.sql
-- Converte login_audit para modelo de eventos imutaveis com session_ref.

alter table if exists public.login_audit
  alter column logged_in_at drop not null;

alter table if exists public.login_audit
  add column if not exists event_type text not null default 'LOGIN',
  add column if not exists event_at timestamptz not null default now(),
  add column if not exists session_ref uuid;

update public.login_audit
set event_type = 'LOGIN',
    event_at = coalesce(logged_in_at, created_at, event_at),
    session_ref = coalesce(session_ref, id)
where event_type = 'LOGIN';

insert into public.login_audit (
  tenant_id,
  user_id,
  matricula,
  device_imei,
  source,
  status,
  reason,
  logged_in_at,
  logged_out_at,
  created_at,
  updated_at,
  created_by,
  updated_by,
  login_name,
  event_type,
  event_at,
  session_ref
)
select
  tenant_id,
  user_id,
  matricula,
  device_imei,
  source,
  status,
  coalesce(reason, 'LEGACY_LOGOUT'),
  null,
  logged_out_at,
  coalesce(logged_out_at, created_at, now()),
  coalesce(logged_out_at, updated_at, created_at, now()),
  created_by,
  updated_by,
  login_name,
  'LOGOUT',
  logged_out_at,
  coalesce(session_ref, id)
from public.login_audit legacy_login
where legacy_login.logged_out_at is not null
  and legacy_login.event_type = 'LOGIN'
  and not exists (
    select 1
    from public.login_audit logout_event
    where logout_event.event_type = 'LOGOUT'
      and logout_event.session_ref = coalesce(legacy_login.session_ref, legacy_login.id)
  );

update public.login_audit
set logged_out_at = null
where event_type = 'LOGIN'
  and logged_out_at is not null;

create index if not exists idx_login_audit_session_ref
  on public.login_audit (session_ref);

create index if not exists idx_login_audit_user_event_at
  on public.login_audit (user_id, event_at desc);

create index if not exists idx_login_audit_event_type_event_at
  on public.login_audit (event_type, event_at desc);

comment on column public.login_audit.event_type is
'Tipo do evento de auditoria. Ex.: LOGIN, LOGOUT.';

comment on column public.login_audit.event_at is
'Timestamp principal do evento imutavel em login_audit.';

comment on column public.login_audit.session_ref is
'Identificador de correlacao entre eventos LOGIN e LOGOUT da mesma sessao.';
