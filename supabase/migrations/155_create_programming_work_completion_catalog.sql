-- 155_create_programming_work_completion_catalog.sql
-- Cria catalogo de Estado do Projeto por tenant e vincula em project_programming.

create table if not exists public.programming_work_completion_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label_pt text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_work_completion_catalog_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint programming_work_completion_catalog_label_not_blank_check
    check (nullif(btrim(coalesce(label_pt, '')), '') is not null),
  constraint programming_work_completion_catalog_sort_order_check
    check (sort_order >= 0),
  constraint programming_work_completion_catalog_tenant_code_key
    unique (tenant_id, code)
);

create index if not exists idx_programming_work_completion_catalog_tenant_active_order
  on public.programming_work_completion_catalog (tenant_id, is_active, sort_order, label_pt);

alter table if exists public.programming_work_completion_catalog enable row level security;

drop policy if exists programming_work_completion_catalog_tenant_select on public.programming_work_completion_catalog;
create policy programming_work_completion_catalog_tenant_select on public.programming_work_completion_catalog
for select
to authenticated
using (public.user_can_access_tenant(programming_work_completion_catalog.tenant_id));

drop policy if exists programming_work_completion_catalog_tenant_insert on public.programming_work_completion_catalog;
create policy programming_work_completion_catalog_tenant_insert on public.programming_work_completion_catalog
for insert
to authenticated
with check (public.user_can_access_tenant(programming_work_completion_catalog.tenant_id));

drop policy if exists programming_work_completion_catalog_tenant_update on public.programming_work_completion_catalog;
create policy programming_work_completion_catalog_tenant_update on public.programming_work_completion_catalog
for update
to authenticated
using (public.user_can_access_tenant(programming_work_completion_catalog.tenant_id))
with check (public.user_can_access_tenant(programming_work_completion_catalog.tenant_id));

drop trigger if exists trg_programming_work_completion_catalog_audit on public.programming_work_completion_catalog;
create trigger trg_programming_work_completion_catalog_audit
before insert or update on public.programming_work_completion_catalog
for each row execute function public.apply_audit_fields();

insert into public.programming_work_completion_catalog (
  tenant_id,
  code,
  label_pt,
  is_active,
  sort_order
)
select
  t.id,
  base.code,
  base.label_pt,
  true,
  base.sort_order
from public.tenants t
cross join (
  values
    ('CONCLUIDO', 'CONCLUIDO', 10),
    ('PARCIAL', 'PARCIAL', 20)
) as base(code, label_pt, sort_order)
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.project_programming
set work_completion_status = nullif(upper(btrim(coalesce(work_completion_status, ''))), '')
where work_completion_status is not null;

alter table if exists public.project_programming
  drop constraint if exists project_programming_work_completion_status_check;

alter table if exists public.project_programming
  drop constraint if exists project_programming_work_completion_status_fkey;

alter table if exists public.project_programming
  add constraint project_programming_work_completion_status_fkey
  foreign key (tenant_id, work_completion_status)
  references public.programming_work_completion_catalog(tenant_id, code)
  on update cascade
  on delete restrict;

create index if not exists idx_project_programming_tenant_work_completion_status
  on public.project_programming (tenant_id, work_completion_status);

drop function if exists public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
);

create or replace function public.set_project_programming_execution_result(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_etapa_number integer default null,
  p_work_completion_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programming_id uuid;
  v_updated_at timestamptz;
  v_work_completion_status text := nullif(upper(btrim(coalesce(p_work_completion_status, ''))), '');
  v_catalog_code text;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar ETAPA/Estado Trabalho.'
    );
  end if;

  if p_etapa_number is not null and p_etapa_number <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ETAPA_NUMBER',
      'message', 'ETAPA deve ser um numero inteiro maior que zero.'
    );
  end if;

  if v_work_completion_status is not null then
    select c.code
    into v_catalog_code
    from public.programming_work_completion_catalog c
    where c.tenant_id = p_tenant_id
      and c.code = v_work_completion_status
      and c.is_active = true
    limit 1;

    if v_catalog_code is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_WORK_COMPLETION_STATUS',
        'message', 'Estado do Projeto invalido para o tenant atual.'
      );
    end if;
  end if;

  update public.project_programming
  set
    etapa_number = p_etapa_number,
    work_completion_status = v_work_completion_status,
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
    'message', 'ETAPA/Estado Trabalho salvos com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) from public;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to authenticated;

grant execute on function public.set_project_programming_execution_result(
  uuid,
  uuid,
  uuid,
  integer,
  text
) to service_role;
