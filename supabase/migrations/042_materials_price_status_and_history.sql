-- 042_materials_price_status_and_history.sql
-- Evolui cadastro base de materiais com preco, status ativo e historico.

alter table if exists public.materials
  add column if not exists unit_price numeric(14, 2) not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists cancellation_reason text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.app_users(id);

update public.materials
set tipo = 'NAO INFORMADO'
where nullif(btrim(coalesce(tipo, '')), '') is null;

alter table if exists public.materials
  alter column tipo set not null;

alter table if exists public.materials
  drop column if exists lp,
  drop column if exists serial;

alter table if exists public.materials
  drop constraint if exists materials_unit_price_check;

alter table if exists public.materials
  add constraint materials_unit_price_check check (unit_price >= 0);

alter table if exists public.materials
  drop constraint if exists materials_tipo_not_blank_check;

alter table if exists public.materials
  add constraint materials_tipo_not_blank_check check (nullif(btrim(coalesce(tipo, '')), '') is not null);

alter table if exists public.materials
  drop constraint if exists materials_active_cancellation_consistency_check;

alter table if exists public.materials
  add constraint materials_active_cancellation_consistency_check check (
    (is_active = true and canceled_at is null and canceled_by is null and cancellation_reason is null)
    or (
      is_active = false
      and canceled_at is not null
      and canceled_by is not null
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
    )
  );

create index if not exists idx_materials_tenant_active_codigo
  on public.materials (tenant_id, is_active, codigo);

create index if not exists idx_materials_tenant_tipo
  on public.materials (tenant_id, tipo);

create table if not exists public.material_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  material_id uuid not null references public.materials(id) on delete cascade,
  change_type text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint material_history_change_type_check check (change_type in ('UPDATE', 'CANCEL', 'ACTIVATE'))
);

create index if not exists idx_material_history_tenant_material_created
  on public.material_history (tenant_id, material_id, created_at desc);

alter table if exists public.material_history enable row level security;

drop policy if exists material_history_tenant_select on public.material_history;
create policy material_history_tenant_select on public.material_history
for select
to authenticated
using (public.user_can_access_tenant(material_history.tenant_id));

drop policy if exists material_history_tenant_insert on public.material_history;
create policy material_history_tenant_insert on public.material_history
for insert
to authenticated
with check (public.user_can_access_tenant(material_history.tenant_id));

drop trigger if exists trg_material_history_audit on public.material_history;
create trigger trg_material_history_audit before insert or update on public.material_history
for each row execute function public.apply_audit_fields();

create table if not exists public.material_cancellation_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  material_id uuid not null references public.materials(id) on delete cascade,
  reason text not null,
  action_type text not null default 'CANCEL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint material_cancellation_history_reason_check check (nullif(btrim(coalesce(reason, '')), '') is not null),
  constraint material_cancellation_history_action_type_check check (action_type in ('CANCEL', 'ACTIVATE'))
);

create index if not exists idx_material_cancellation_history_tenant_material_action_created
  on public.material_cancellation_history (tenant_id, material_id, action_type, created_at desc);

alter table if exists public.material_cancellation_history enable row level security;

drop policy if exists material_cancellation_history_tenant_select on public.material_cancellation_history;
create policy material_cancellation_history_tenant_select on public.material_cancellation_history
for select
to authenticated
using (public.user_can_access_tenant(material_cancellation_history.tenant_id));

drop policy if exists material_cancellation_history_tenant_insert on public.material_cancellation_history;
create policy material_cancellation_history_tenant_insert on public.material_cancellation_history
for insert
to authenticated
with check (public.user_can_access_tenant(material_cancellation_history.tenant_id));

drop trigger if exists trg_material_cancellation_history_audit on public.material_cancellation_history;
create trigger trg_material_cancellation_history_audit before insert or update on public.material_cancellation_history
for each row execute function public.apply_audit_fields();
