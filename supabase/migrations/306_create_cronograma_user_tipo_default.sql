-- 306_create_cronograma_user_tipo_default.sql
-- Tipo de Solicitacao padrao por usuario (apenas pre-selecao no formulario; usuario pode trocar).
-- Definido manualmente por um administrador. Escopo por tenant, RLS ON.

create table if not exists public.cronograma_user_tipo_default (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.app_users(id) on delete cascade,
  default_tipo text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint cronograma_user_tipo_default_tipo_check
    check (default_tipo in ('INSPECAO', 'AS_BUILT', 'LOCACAO')),
  constraint cronograma_user_tipo_default_tenant_user_key
    unique (tenant_id, user_id)
);

create index if not exists idx_cronograma_user_tipo_default_tenant_user
  on public.cronograma_user_tipo_default (tenant_id, user_id);

alter table if exists public.cronograma_user_tipo_default enable row level security;

drop policy if exists cronograma_user_tipo_default_tenant_select on public.cronograma_user_tipo_default;
create policy cronograma_user_tipo_default_tenant_select on public.cronograma_user_tipo_default
for select
to authenticated
using (public.user_can_access_tenant(cronograma_user_tipo_default.tenant_id));

drop policy if exists cronograma_user_tipo_default_tenant_insert on public.cronograma_user_tipo_default;
create policy cronograma_user_tipo_default_tenant_insert on public.cronograma_user_tipo_default
for insert
to authenticated
with check (public.user_can_access_tenant(cronograma_user_tipo_default.tenant_id));

drop policy if exists cronograma_user_tipo_default_tenant_update on public.cronograma_user_tipo_default;
create policy cronograma_user_tipo_default_tenant_update on public.cronograma_user_tipo_default
for update
to authenticated
using (public.user_can_access_tenant(cronograma_user_tipo_default.tenant_id))
with check (public.user_can_access_tenant(cronograma_user_tipo_default.tenant_id));

drop trigger if exists trg_cronograma_user_tipo_default_audit on public.cronograma_user_tipo_default;
create trigger trg_cronograma_user_tipo_default_audit before insert or update on public.cronograma_user_tipo_default
for each row execute function public.apply_audit_fields();
