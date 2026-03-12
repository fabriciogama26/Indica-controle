-- 051_create_app_entity_history_and_activity_status.sql
-- Cria historico generico para entidades da aplicacao e habilita cancelamento/ativacao com motivo em atividades.

alter table if exists public.service_activities
  add column if not exists cancellation_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.app_users(id);

update public.service_activities
set
  canceled_at = coalesce(canceled_at, now()),
  cancellation_reason = case
    when nullif(btrim(coalesce(cancellation_reason, '')), '') is null
      then 'STATUS INATIVO (BACKFILL MIGRATION 051)'
    else cancellation_reason
  end
where ativo = false;

alter table if exists public.service_activities
  drop constraint if exists service_activities_active_cancellation_consistency_check;

alter table if exists public.service_activities
  add constraint service_activities_active_cancellation_consistency_check
  check (
    (ativo = true and canceled_at is null and cancellation_reason is null)
    or (
      ativo = false
      and canceled_at is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );

create table if not exists public.app_entity_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  module_key text not null,
  entity_table text not null,
  entity_id uuid not null,
  entity_code text,
  change_type text not null,
  reason text,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint app_entity_history_module_key_not_blank check (btrim(module_key) <> ''),
  constraint app_entity_history_entity_table_not_blank check (btrim(entity_table) <> ''),
  constraint app_entity_history_reason_not_blank check (reason is null or btrim(reason) <> ''),
  constraint app_entity_history_change_type_check check (change_type in ('UPDATE', 'CANCEL', 'ACTIVATE'))
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'app_entity_history'
      and tc.constraint_name = 'app_entity_history_tenant_id_fk'
  ) then
    alter table public.app_entity_history
      add constraint app_entity_history_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

create index if not exists idx_app_entity_history_tenant_entity_created
  on public.app_entity_history (tenant_id, module_key, entity_table, entity_id, created_at desc);

create index if not exists idx_app_entity_history_tenant_code_created
  on public.app_entity_history (tenant_id, module_key, entity_code, created_at desc);

alter table if exists public.app_entity_history enable row level security;

drop policy if exists app_entity_history_tenant_select on public.app_entity_history;
create policy app_entity_history_tenant_select on public.app_entity_history
for select
to authenticated
using (public.user_can_access_tenant(app_entity_history.tenant_id));

drop policy if exists app_entity_history_tenant_insert on public.app_entity_history;
create policy app_entity_history_tenant_insert on public.app_entity_history
for insert
to authenticated
with check (public.user_can_access_tenant(app_entity_history.tenant_id));

drop trigger if exists trg_app_entity_history_audit on public.app_entity_history;
create trigger trg_app_entity_history_audit before insert or update on public.app_entity_history
for each row execute function public.apply_audit_fields();
