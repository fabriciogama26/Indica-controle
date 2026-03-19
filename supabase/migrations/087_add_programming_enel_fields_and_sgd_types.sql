-- 087_add_programming_enel_fields_and_sgd_types.sql
-- Cria catalogo de Tipo de SGD e campos ENEL na Programacao.

create table if not exists public.programming_sgd_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  description text not null,
  export_column text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_sgd_types_description_not_blank
    check (btrim(description) <> ''),
  constraint programming_sgd_types_export_column_check
    check (export_column in ('SGD_AT_MT_VYP', 'SGD_BT', 'SGD_TET')),
  constraint programming_sgd_types_tenant_description_key
    unique (tenant_id, description),
  constraint programming_sgd_types_tenant_export_column_key
    unique (tenant_id, export_column),
  constraint programming_sgd_types_tenant_id_id_key
    unique (tenant_id, id)
);

create index if not exists idx_programming_sgd_types_tenant_active_description
  on public.programming_sgd_types (tenant_id, is_active, description);

alter table if exists public.programming_sgd_types enable row level security;

drop policy if exists programming_sgd_types_tenant_select on public.programming_sgd_types;
create policy programming_sgd_types_tenant_select on public.programming_sgd_types
for select
to authenticated
using (public.user_can_access_tenant(programming_sgd_types.tenant_id));

drop policy if exists programming_sgd_types_tenant_insert on public.programming_sgd_types;
create policy programming_sgd_types_tenant_insert on public.programming_sgd_types
for insert
to authenticated
with check (public.user_can_access_tenant(programming_sgd_types.tenant_id));

drop policy if exists programming_sgd_types_tenant_update on public.programming_sgd_types;
create policy programming_sgd_types_tenant_update on public.programming_sgd_types
for update
to authenticated
using (public.user_can_access_tenant(programming_sgd_types.tenant_id))
with check (public.user_can_access_tenant(programming_sgd_types.tenant_id));

drop trigger if exists trg_programming_sgd_types_audit on public.programming_sgd_types;
create trigger trg_programming_sgd_types_audit
before insert or update on public.programming_sgd_types
for each row execute function public.apply_audit_fields();

insert into public.programming_sgd_types (tenant_id, description, export_column, is_active)
select
  t.id as tenant_id,
  base.description,
  base.export_column,
  true as is_active
from public.tenants t
cross join (
  values
    ('SGD AT/MT/VyP', 'SGD_AT_MT_VYP'),
    ('SGD BT', 'SGD_BT'),
    ('SGD TeT', 'SGD_TET')
) as base(description, export_column)
where not exists (
  select 1
  from public.programming_sgd_types pst
  where pst.tenant_id = t.id
    and pst.export_column = base.export_column
);

alter table if exists public.project_programming
  add column if not exists affected_customers integer not null default 0;

alter table if exists public.project_programming
  add column if not exists sgd_type_id uuid;

create index if not exists idx_project_programming_tenant_sgd_type
  on public.project_programming (tenant_id, sgd_type_id);

alter table if exists public.project_programming
  drop constraint if exists project_programming_affected_customers_check;

alter table if exists public.project_programming
  add constraint project_programming_affected_customers_check
  check (affected_customers >= 0);

alter table if exists public.project_programming
  drop constraint if exists project_programming_sgd_type_id_fkey;

alter table if exists public.project_programming
  drop constraint if exists project_programming_sgd_type_tenant_fkey;

alter table if exists public.project_programming
  add constraint project_programming_sgd_type_tenant_fkey
  foreign key (tenant_id, sgd_type_id) references public.programming_sgd_types(tenant_id, id);

drop function if exists public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
);

create or replace function public.set_project_programming_enel_fields(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar campos ENEL.'
    );
  end if;

  if coalesce(p_affected_customers, 0) < 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_AFFECTED_CUSTOMERS',
      'message', 'Nº Clientes Afetados deve ser maior ou igual a zero.'
    );
  end if;

  if p_sgd_type_id is not null and not exists (
    select 1
    from public.programming_sgd_types pst
    where pst.tenant_id = p_tenant_id
      and pst.id = p_sgd_type_id
      and pst.is_active = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SGD_TYPE',
      'message', 'Tipo de SGD invalido para o tenant atual.'
    );
  end if;

  update public.project_programming
  set
    affected_customers = coalesce(p_affected_customers, 0),
    sgd_type_id = p_sgd_type_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning id, updated_at
  into v_programming_id, v_updated_at;

  if v_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', v_programming_id,
    'updated_at', v_updated_at,
    'message', 'Campos ENEL salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
) from public;

grant execute on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
) to authenticated;

grant execute on function public.set_project_programming_enel_fields(
  uuid,
  uuid,
  uuid,
  integer,
  uuid
) to service_role;
