-- 145_create_types_service_activities_and_link_service_activities.sql
-- Cria catalogo de tipos de servico por tenant e vincula em service_activities.

create table if not exists public.types_service_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  ativo boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint types_service_activities_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint types_service_activities_sort_order_check
    check (sort_order >= 0),
  constraint types_service_activities_tenant_name_key
    unique (tenant_id, name),
  constraint types_service_activities_id_tenant_key
    unique (id, tenant_id)
);

create index if not exists idx_types_service_activities_tenant_active_order
  on public.types_service_activities (tenant_id, ativo, sort_order, name);

alter table if exists public.types_service_activities enable row level security;

drop policy if exists types_service_activities_tenant_select on public.types_service_activities;
create policy types_service_activities_tenant_select on public.types_service_activities
for select
to authenticated
using (public.user_can_access_tenant(types_service_activities.tenant_id));

drop policy if exists types_service_activities_tenant_insert on public.types_service_activities;
create policy types_service_activities_tenant_insert on public.types_service_activities
for insert
to authenticated
with check (public.user_can_access_tenant(types_service_activities.tenant_id));

drop policy if exists types_service_activities_tenant_update on public.types_service_activities;
create policy types_service_activities_tenant_update on public.types_service_activities
for update
to authenticated
using (public.user_can_access_tenant(types_service_activities.tenant_id))
with check (public.user_can_access_tenant(types_service_activities.tenant_id));

drop trigger if exists trg_types_service_activities_audit on public.types_service_activities;
create trigger trg_types_service_activities_audit
before insert or update on public.types_service_activities
for each row execute function public.apply_audit_fields();

insert into public.types_service_activities (
  tenant_id,
  name,
  ativo,
  sort_order
)
select
  t.id as tenant_id,
  base.name,
  true as ativo,
  base.sort_order
from public.tenants t
cross join (
  values
    ('POSTE', 10),
    ('ESTRUTURA', 20),
    ('CONDUTOR(REDE)', 30),
    ('EMENDA', 40),
    ('EQUIPAMENTO', 50),
    ('MQS CHAVES/PARA-RAIO', 60),
    (U&'MANUTEN\00C7\00C3O', 70),
    ('RAMAL / CAIXA DAE', 80),
    ('GERADOR', 90),
    ('PODA', 100),
    ('OUTROS', 999)
) as base(name, sort_order)
on conflict (tenant_id, name) do update
set
  ativo = excluded.ativo,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table if exists public.service_activities
  add column if not exists type_service uuid;

update public.service_activities sa
set type_service = tsa.id
from public.types_service_activities tsa
where sa.type_service is null
  and tsa.tenant_id = sa.tenant_id
  and upper(btrim(tsa.name)) = 'OUTROS';

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'service_activities'
      and tc.constraint_name = 'service_activities_type_service_tenant_fk'
  ) then
    alter table public.service_activities
      add constraint service_activities_type_service_tenant_fk
      foreign key (type_service, tenant_id)
      references public.types_service_activities(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_service_activities_tenant_type_service
  on public.service_activities (tenant_id, type_service, ativo, code);
