-- 041_create_project_material_forecast.sql
-- Cadastro de materiais previstos por projeto (planejamento, sem movimentar estoque).

create table if not exists public.project_material_forecast (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references public.project(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_planned numeric not null,
  observation text,
  source text not null default 'IMPORT_XLSX',
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, project_id, material_id),
  check (qty_planned > 0),
  check (btrim(source) <> '')
);

create index if not exists idx_project_material_forecast_tenant_project
  on public.project_material_forecast (tenant_id, project_id);

create index if not exists idx_project_material_forecast_tenant_material
  on public.project_material_forecast (tenant_id, material_id);

alter table if exists public.project_material_forecast enable row level security;

drop policy if exists project_material_forecast_tenant_select on public.project_material_forecast;
create policy project_material_forecast_tenant_select on public.project_material_forecast
for select
to authenticated
using (public.user_can_access_tenant(project_material_forecast.tenant_id));

drop policy if exists project_material_forecast_tenant_write on public.project_material_forecast;
create policy project_material_forecast_tenant_write on public.project_material_forecast
for all
to authenticated
using (public.user_can_access_tenant(project_material_forecast.tenant_id))
with check (public.user_can_access_tenant(project_material_forecast.tenant_id));

drop trigger if exists trg_project_material_forecast_audit on public.project_material_forecast;
create trigger trg_project_material_forecast_audit before insert or update on public.project_material_forecast
for each row execute function public.apply_audit_fields();

create or replace function public.replace_project_material_forecast(
  p_tenant_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_items jsonb,
  p_source text default 'IMPORT_XLSX'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_project_exists boolean;
  v_item jsonb;
  v_inserted integer := 0;
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('success', false, 'reason', 'INVALID_ITEMS_PAYLOAD');
  end if;

  select exists (
    select 1
    from public.project p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
  )
  into v_project_exists;

  if not v_project_exists then
    return jsonb_build_object('success', false, 'reason', 'PROJECT_NOT_FOUND');
  end if;

  delete from public.project_material_forecast
  where tenant_id = p_tenant_id
    and project_id = p_project_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    insert into public.project_material_forecast (
      tenant_id,
      project_id,
      material_id,
      qty_planned,
      observation,
      source,
      imported_at,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_project_id,
      (v_item ->> 'material_id')::uuid,
      (v_item ->> 'qty_planned')::numeric,
      nullif(btrim(coalesce(v_item ->> 'observation', '')), ''),
      coalesce(v_source, 'IMPORT_XLSX'),
      now(),
      p_actor_user_id,
      p_actor_user_id
    );

    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('success', true, 'inserted', v_inserted);
end;
$$;

revoke all on function public.replace_project_material_forecast(uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.replace_project_material_forecast(uuid, uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.replace_project_material_forecast(uuid, uuid, uuid, jsonb, text) to service_role;
