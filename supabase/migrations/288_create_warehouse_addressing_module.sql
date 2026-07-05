-- 288_create_warehouse_addressing_module.sql
-- Cria a base multi-tenant do enderecamento de almoxarifado.

alter table if exists public.materials
  add column if not exists stock_minimum numeric not null default 0,
  add column if not exists stock_maximum numeric null;

alter table if exists public.materials
  drop constraint if exists materials_stock_limits_check;

alter table if exists public.materials
  add constraint materials_stock_limits_check
  check (
    stock_minimum >= 0
    and (stock_maximum is null or stock_maximum >= stock_minimum)
  );

create index if not exists idx_materials_tenant_stock_limits
  on public.materials (tenant_id, stock_minimum, stock_maximum);

create table if not exists public.warehouse_maps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stock_center_id uuid not null,
  name text not null default 'Mapa do almoxarifado',
  colunas text[] not null default '{}',
  linhas integer[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_maps_center_tenant_fk
    foreign key (stock_center_id, tenant_id)
    references public.stock_centers(id, tenant_id),
  constraint warehouse_maps_id_tenant_key unique (id, tenant_id),
  constraint warehouse_maps_unique_center unique (tenant_id, stock_center_id),
  constraint warehouse_maps_colunas_not_empty check (array_length(colunas, 1) is not null),
  constraint warehouse_maps_linhas_not_empty check (array_length(linhas, 1) is not null)
);

create table if not exists public.warehouse_shelves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  map_id uuid not null,
  coluna text not null,
  linha integer not null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_shelves_map_tenant_fk
    foreign key (map_id, tenant_id)
    references public.warehouse_maps(id, tenant_id)
    on delete cascade,
  constraint warehouse_shelves_id_tenant_key unique (id, tenant_id),
  constraint warehouse_shelves_unique_position unique (tenant_id, map_id, coluna, linha),
  constraint warehouse_shelves_coluna_not_blank check (nullif(btrim(coluna), '') is not null),
  constraint warehouse_shelves_linha_positive check (linha > 0)
);

create table if not exists public.warehouse_shelf_floors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  shelf_id uuid not null,
  numero integer not null,
  qtd_posicoes integer not null default 1,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_shelf_floors_shelf_tenant_fk
    foreign key (shelf_id, tenant_id)
    references public.warehouse_shelves(id, tenant_id)
    on delete cascade,
  constraint warehouse_shelf_floors_unique_number unique (tenant_id, shelf_id, numero),
  constraint warehouse_shelf_floors_numero_positive check (numero > 0),
  constraint warehouse_shelf_floors_positions_positive check (qtd_posicoes > 0)
);

create table if not exists public.warehouse_material_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  map_id uuid not null,
  stock_center_id uuid not null,
  material_id uuid not null,
  coluna text not null,
  linha integer not null,
  andar integer not null,
  posicao integer not null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_material_addresses_map_tenant_fk
    foreign key (map_id, tenant_id)
    references public.warehouse_maps(id, tenant_id)
    on delete cascade,
  constraint warehouse_material_addresses_center_tenant_fk
    foreign key (stock_center_id, tenant_id)
    references public.stock_centers(id, tenant_id),
  constraint warehouse_material_addresses_material_tenant_fk
    foreign key (material_id, tenant_id)
    references public.materials(id, tenant_id),
  constraint warehouse_material_addresses_unique_material unique (tenant_id, map_id, material_id),
  constraint warehouse_material_addresses_unique_position unique (tenant_id, map_id, coluna, linha, andar, posicao),
  constraint warehouse_material_addresses_position_positive check (linha > 0 and andar > 0 and posicao > 0)
);

create table if not exists public.warehouse_address_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  map_id uuid null,
  material_id uuid null,
  action_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_address_history_action_check
    check (action_type in ('CONFIG_SAVE', 'ADDRESS_ASSIGN', 'ADDRESS_CLEAR'))
);

create index if not exists idx_warehouse_maps_tenant_center
  on public.warehouse_maps (tenant_id, stock_center_id);

create index if not exists idx_warehouse_shelves_tenant_map
  on public.warehouse_shelves (tenant_id, map_id);

create index if not exists idx_warehouse_shelf_floors_tenant_shelf
  on public.warehouse_shelf_floors (tenant_id, shelf_id);

create index if not exists idx_warehouse_material_addresses_tenant_center
  on public.warehouse_material_addresses (tenant_id, stock_center_id, material_id);

create index if not exists idx_warehouse_address_history_tenant_map_created
  on public.warehouse_address_history (tenant_id, map_id, created_at desc);

alter table if exists public.warehouse_maps enable row level security;
alter table if exists public.warehouse_shelves enable row level security;
alter table if exists public.warehouse_shelf_floors enable row level security;
alter table if exists public.warehouse_material_addresses enable row level security;
alter table if exists public.warehouse_address_history enable row level security;

drop policy if exists warehouse_maps_tenant_select on public.warehouse_maps;
create policy warehouse_maps_tenant_select on public.warehouse_maps
for select to authenticated
using (public.user_can_access_tenant(warehouse_maps.tenant_id));

drop policy if exists warehouse_shelves_tenant_select on public.warehouse_shelves;
create policy warehouse_shelves_tenant_select on public.warehouse_shelves
for select to authenticated
using (public.user_can_access_tenant(warehouse_shelves.tenant_id));

drop policy if exists warehouse_shelf_floors_tenant_select on public.warehouse_shelf_floors;
create policy warehouse_shelf_floors_tenant_select on public.warehouse_shelf_floors
for select to authenticated
using (public.user_can_access_tenant(warehouse_shelf_floors.tenant_id));

drop policy if exists warehouse_material_addresses_tenant_select on public.warehouse_material_addresses;
create policy warehouse_material_addresses_tenant_select on public.warehouse_material_addresses
for select to authenticated
using (public.user_can_access_tenant(warehouse_material_addresses.tenant_id));

drop policy if exists warehouse_address_history_tenant_select on public.warehouse_address_history;
create policy warehouse_address_history_tenant_select on public.warehouse_address_history
for select to authenticated
using (public.user_can_access_tenant(warehouse_address_history.tenant_id));

grant select on public.warehouse_maps to authenticated;
grant select on public.warehouse_shelves to authenticated;
grant select on public.warehouse_shelf_floors to authenticated;
grant select on public.warehouse_material_addresses to authenticated;
grant select on public.warehouse_address_history to authenticated;

drop trigger if exists trg_warehouse_maps_audit on public.warehouse_maps;
create trigger trg_warehouse_maps_audit before insert or update on public.warehouse_maps
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_warehouse_shelves_audit on public.warehouse_shelves;
create trigger trg_warehouse_shelves_audit before insert or update on public.warehouse_shelves
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_warehouse_shelf_floors_audit on public.warehouse_shelf_floors;
create trigger trg_warehouse_shelf_floors_audit before insert or update on public.warehouse_shelf_floors
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_warehouse_material_addresses_audit on public.warehouse_material_addresses;
create trigger trg_warehouse_material_addresses_audit before insert or update on public.warehouse_material_addresses
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_warehouse_address_history_audit on public.warehouse_address_history;
create trigger trg_warehouse_address_history_audit before insert or update on public.warehouse_address_history
for each row execute function public.apply_audit_fields();

create or replace function public.is_physical_warehouse_stock_center(
  p_tenant_id uuid,
  p_stock_center_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.stock_centers sc
    where sc.id = p_stock_center_id
      and sc.tenant_id = p_tenant_id
      and sc.is_active = true
      and sc.center_type = 'OWN'
      and sc.controls_balance = true
      and not exists (
        select 1
        from public.teams t
        where t.tenant_id = sc.tenant_id
          and t.stock_center_id = sc.id
      )
  );
$$;

comment on function public.is_physical_warehouse_stock_center(uuid, uuid) is
'Identifica centros fisicos elegiveis para enderecamento de almoxarifado: centro OWN ativo, controla saldo e nao esta vinculado a uma equipe.';

revoke all on function public.is_physical_warehouse_stock_center(uuid, uuid) from public;
revoke all on function public.is_physical_warehouse_stock_center(uuid, uuid) from anon;
revoke all on function public.is_physical_warehouse_stock_center(uuid, uuid) from authenticated;
grant execute on function public.is_physical_warehouse_stock_center(uuid, uuid) to service_role;

create or replace function public.validate_warehouse_map_stock_center()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_physical_warehouse_stock_center(new.tenant_id, new.stock_center_id) then
    raise exception 'Centro de estoque do mapa deve ser fisico de almoxarifado, sem vinculo com equipe.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_warehouse_map_stock_center() from public;
revoke all on function public.validate_warehouse_map_stock_center() from anon;
revoke all on function public.validate_warehouse_map_stock_center() from authenticated;

drop trigger if exists trg_warehouse_maps_validate_stock_center on public.warehouse_maps;
create trigger trg_warehouse_maps_validate_stock_center before insert or update of stock_center_id, tenant_id on public.warehouse_maps
for each row execute function public.validate_warehouse_map_stock_center();

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values
  (
    'configuracao-mapa-almoxarifado',
    '/configuracao-mapa-almoxarifado',
    'Configuracao do Mapa do Almoxarifado',
    'Cadastro Base',
    'Cadastro do layout fisico de prateleiras, andares e posicoes por centro de estoque.',
    false
  ),
  (
    'mapa-almoxarifado',
    '/mapa-almoxarifado',
    'Mapa do Almoxarifado',
    'Almoxarifado',
    'Consulta operacional do enderecamento e ocupacao dos materiais no almoxarifado.',
    false
  )
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  default_user_access = false,
  ativo = true,
  updated_at = now();

alter table if exists public.role_page_permissions
  add column if not exists can_create boolean,
  add column if not exists can_update boolean,
  add column if not exists can_cancel boolean,
  add column if not exists can_reverse boolean,
  add column if not exists can_import boolean,
  add column if not exists can_export boolean;

update public.role_page_permissions
set
  can_create = coalesce(can_create, can_access, false),
  can_update = coalesce(can_update, can_access, false),
  can_cancel = coalesce(can_cancel, can_access, false),
  can_reverse = coalesce(can_reverse, can_access, false),
  can_import = coalesce(can_import, can_access, false),
  can_export = coalesce(can_export, can_access, false)
where can_create is null
   or can_update is null
   or can_cancel is null
   or can_reverse is null
   or can_import is null
   or can_export is null;

alter table if exists public.role_page_permissions
  alter column can_create set default false,
  alter column can_update set default false,
  alter column can_cancel set default false,
  alter column can_reverse set default false,
  alter column can_import set default false,
  alter column can_export set default false,
  alter column can_create set not null,
  alter column can_update set not null,
  alter column can_cancel set not null,
  alter column can_reverse set not null,
  alter column can_import set not null,
  alter column can_export set not null;

alter table if exists public.app_user_page_permissions
  add column if not exists can_create boolean,
  add column if not exists can_update boolean,
  add column if not exists can_cancel boolean,
  add column if not exists can_reverse boolean,
  add column if not exists can_import boolean,
  add column if not exists can_export boolean;

update public.app_user_page_permissions
set
  can_create = coalesce(can_create, can_access, false),
  can_update = coalesce(can_update, can_access, false),
  can_cancel = coalesce(can_cancel, can_access, false),
  can_reverse = coalesce(can_reverse, can_access, false),
  can_import = coalesce(can_import, can_access, false),
  can_export = coalesce(can_export, can_access, false)
where can_create is null
   or can_update is null
   or can_cancel is null
   or can_reverse is null
   or can_import is null
   or can_export is null;

alter table if exists public.app_user_page_permissions
  alter column can_create set default false,
  alter column can_update set default false,
  alter column can_cancel set default false,
  alter column can_reverse set default false,
  alter column can_import set default false,
  alter column can_export set default false,
  alter column can_create set not null,
  alter column can_update set not null,
  alter column can_cancel set not null,
  alter column can_reverse set not null,
  alter column can_import set not null,
  alter column can_export set not null;

insert into public.role_page_permissions (
  tenant_id,
  role_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export
)
select
  tenants.tenant_id,
  roles.id,
  pages.page_key,
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  false,
  false,
  false,
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
cross join (
  values ('configuracao-mapa-almoxarifado'), ('mapa-almoxarifado')
) pages(page_key)
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = pages.page_key
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export,
  created_by,
  updated_by
)
select
  users.tenant_id,
  users.id,
  pages.page_key,
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  false,
  false,
  false,
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
cross join (
  values ('configuracao-mapa-almoxarifado'), ('mapa-almoxarifado')
) pages(page_key)
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = pages.page_key
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

drop function if exists public.save_material_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  numeric,
  text,
  jsonb,
  timestamptz
);

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_umb text default null,
  p_tipo text default null,
  p_is_transformer boolean default false,
  p_unit_price numeric default null,
  p_serial_tracking_type text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_stock_minimum numeric default 0,
  p_stock_maximum numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_umb text := btrim(coalesce(p_umb, ''));
  v_unit_price numeric := coalesce(p_unit_price, 0);
  v_stock_minimum numeric := coalesce(p_stock_minimum, 0);
  v_stock_maximum numeric := p_stock_maximum;
  v_serial_tracking_type text := upper(btrim(coalesce(
    p_serial_tracking_type,
    case when coalesce(p_is_transformer, false) then 'TRAFO' else 'NONE' end
  )));
  v_current_serial_tracking_type text;
  v_is_transformer boolean;
  v_has_serial_tracking_usage boolean := false;
begin
  if v_umb = '' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'UMB_REQUIRED', 'message', 'UMB obrigatorio para cadastro de material.');
  end if;

  if v_tipo not in ('NOVO', 'SUCATA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TYPE', 'message', 'Tipo invalido. Selecione NOVO ou SUCATA.');
  end if;

  if v_unit_price < 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UNIT_PRICE', 'message', 'Preco invalido. Informe valor maior ou igual a zero.');
  end if;

  if v_stock_minimum < 0 or (v_stock_maximum is not null and v_stock_maximum < v_stock_minimum) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STOCK_LIMITS', 'message', 'Limites de estoque invalidos. O maximo deve ser vazio ou maior/igual ao minimo.');
  end if;

  if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SERIAL_TRACKING_TYPE', 'message', 'Tipo de rastreio por serial invalido.');
  end if;

  v_is_transformer := v_serial_tracking_type = 'TRAFO';

  if p_material_id is null then
    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      umb,
      tipo,
      is_transformer,
      serial_tracking_type,
      unit_price,
      stock_minimum,
      stock_maximum,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      v_umb,
      v_tipo,
      v_is_transformer,
      v_serial_tracking_type,
      v_unit_price,
      v_stock_minimum,
      v_stock_maximum,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo));
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  v_current_serial_tracking_type := upper(btrim(coalesce(
    v_current.serial_tracking_type,
    case when coalesce(v_current.is_transformer, false) then 'TRAFO' else 'NONE' end
  )));

  if v_current_serial_tracking_type in ('TRAFO', 'RELIGADOR', 'CHAVE')
    and v_current_serial_tracking_type <> v_serial_tracking_type
  then
    select (
      exists (
        select 1
        from public.trafo_instances ti
        where ti.tenant_id = p_tenant_id
          and ti.material_id = p_material_id
        limit 1
      )
      or exists (
        select 1
        from public.stock_transfer_items sti
        where sti.tenant_id = p_tenant_id
          and sti.material_id = p_material_id
          and nullif(btrim(coalesce(sti.serial_number, '')), '') is not null
        limit 1
      )
    )
    into v_has_serial_tracking_usage;

    if coalesce(v_has_serial_tracking_usage, false) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'SERIAL_TRACKING_IN_USE', 'message', 'Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.');
    end if;
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    umb = v_umb,
    tipo = v_tipo,
    is_transformer = v_is_transformer,
    serial_tracking_type = v_serial_tracking_type,
    unit_price = v_unit_price,
    stock_minimum = v_stock_minimum,
    stock_maximum = v_stock_maximum,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from public;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from anon;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) from authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric) to service_role;

create or replace function public.save_warehouse_map_config(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_stock_center_id uuid,
  p_colunas text[],
  p_linhas integer[],
  p_prateleiras jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.warehouse_maps%rowtype;
  v_map_id uuid;
  v_updated_at timestamptz;
  v_shelf jsonb;
  v_floor jsonb;
  v_coluna text;
  v_linha integer;
  v_andar integer;
  v_qtd_posicoes integer;
  v_shelf_id uuid;
  v_position integer;
  v_map_exists boolean := false;
begin
  if p_stock_center_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'STOCK_CENTER_REQUIRED', 'message', 'Centro de estoque obrigatorio.');
  end if;

  if array_length(p_colunas, 1) is null or array_length(p_linhas, 1) is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'GRID_REQUIRED', 'message', 'Informe colunas e linhas do mapa.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, p_stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  create temporary table if not exists tmp_warehouse_positions (
    coluna text not null,
    linha integer not null,
    andar integer not null,
    posicao integer not null,
    primary key (coluna, linha, andar, posicao)
  ) on commit drop;

  truncate table tmp_warehouse_positions;

  for v_shelf in select value from jsonb_array_elements(coalesce(p_prateleiras, '[]'::jsonb))
  loop
    v_coluna := upper(btrim(coalesce(v_shelf ->> 'coluna', '')));
    v_linha := nullif(v_shelf ->> 'linha', '')::integer;

    if v_coluna = '' or v_linha is null or not (v_coluna = any(p_colunas)) or not (v_linha = any(p_linhas)) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SHELF_POSITION', 'message', 'Prateleira fora do grid configurado.');
    end if;

    for v_floor in select value from jsonb_array_elements(coalesce(v_shelf -> 'andares', '[]'::jsonb))
    loop
      v_andar := nullif(v_floor ->> 'numero', '')::integer;
      v_qtd_posicoes := coalesce(nullif(v_floor ->> 'qtdPosicoes', '')::integer, 1);

      if v_andar is null or v_andar <= 0 or v_qtd_posicoes <= 0 then
        return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FLOOR', 'message', 'Andar ou quantidade de posicoes invalida.');
      end if;

      for v_position in 1..v_qtd_posicoes
      loop
        insert into tmp_warehouse_positions (coluna, linha, andar, posicao)
        values (v_coluna, v_linha, v_andar, v_position)
        on conflict do nothing;
      end loop;
    end loop;
  end loop;

  select *
  into v_map
  from public.warehouse_maps
  where tenant_id = p_tenant_id
    and stock_center_id = p_stock_center_id
  for update;

  if found then
    if p_expected_updated_at is not null and v_map.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'A configuracao do mapa foi alterada por outro usuario.');
    end if;

    v_map_id := v_map.id;
    v_map_exists := true;
  end if;

  if v_map_exists and exists (
    select 1
    from public.warehouse_material_addresses addr
    where addr.tenant_id = p_tenant_id
      and addr.map_id = v_map_id
      and not exists (
        select 1
        from tmp_warehouse_positions pos
        where pos.coluna = addr.coluna
          and pos.linha = addr.linha
          and pos.andar = addr.andar
          and pos.posicao = addr.posicao
      )
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ADDRESSES_OUTSIDE_NEW_LAYOUT',
      'message', 'Existem materiais enderecados em posicoes removidas. Remova ou realoque esses materiais antes de salvar o novo layout.'
    );
  end if;

  if v_map_exists then
    update public.warehouse_maps
    set
      colunas = p_colunas,
      linhas = p_linhas,
      updated_by = p_actor_user_id
    where id = v_map_id
      and tenant_id = p_tenant_id
    returning updated_at into v_updated_at;
  else
    insert into public.warehouse_maps (
      tenant_id,
      stock_center_id,
      colunas,
      linhas,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_stock_center_id,
      p_colunas,
      p_linhas,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_map_id, v_updated_at;
  end if;

  delete from public.warehouse_shelf_floors floors
  using public.warehouse_shelves shelves
  where floors.tenant_id = p_tenant_id
    and floors.shelf_id = shelves.id
    and shelves.tenant_id = p_tenant_id
    and shelves.map_id = v_map_id
    and not exists (
      select 1
      from tmp_warehouse_positions pos
      where pos.coluna = shelves.coluna
        and pos.linha = shelves.linha
        and pos.andar = floors.numero
    );

  delete from public.warehouse_shelves shelves
  where shelves.tenant_id = p_tenant_id
    and shelves.map_id = v_map_id
    and not exists (
      select 1
      from tmp_warehouse_positions pos
      where pos.coluna = shelves.coluna
        and pos.linha = shelves.linha
    );

  for v_shelf in select value from jsonb_array_elements(coalesce(p_prateleiras, '[]'::jsonb))
  loop
    v_coluna := upper(btrim(coalesce(v_shelf ->> 'coluna', '')));
    v_linha := nullif(v_shelf ->> 'linha', '')::integer;

    insert into public.warehouse_shelves (
      tenant_id,
      map_id,
      coluna,
      linha,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      v_map_id,
      v_coluna,
      v_linha,
      p_actor_user_id,
      p_actor_user_id
    )
    on conflict (tenant_id, map_id, coluna, linha) do update
    set updated_by = excluded.updated_by
    returning id into v_shelf_id;

    for v_floor in select value from jsonb_array_elements(coalesce(v_shelf -> 'andares', '[]'::jsonb))
    loop
      v_andar := nullif(v_floor ->> 'numero', '')::integer;
      v_qtd_posicoes := coalesce(nullif(v_floor ->> 'qtdPosicoes', '')::integer, 1);

      insert into public.warehouse_shelf_floors (
        tenant_id,
        shelf_id,
        numero,
        qtd_posicoes,
        created_by,
        updated_by
      ) values (
        p_tenant_id,
        v_shelf_id,
        v_andar,
        v_qtd_posicoes,
        p_actor_user_id,
        p_actor_user_id
      )
      on conflict (tenant_id, shelf_id, numero) do update
      set
        qtd_posicoes = excluded.qtd_posicoes,
        updated_by = excluded.updated_by;
    end loop;
  end loop;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    v_map_id,
    'CONFIG_SAVE',
    jsonb_build_object('stockCenterId', p_stock_center_id, 'colunas', p_colunas, 'linhas', p_linhas),
    p_actor_user_id,
    p_actor_user_id
  );

  select updated_at
  into v_updated_at
  from public.warehouse_maps
  where id = v_map_id
    and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'status', 200, 'map_id', v_map_id, 'updated_at', v_updated_at);
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PAYLOAD', 'message', 'Payload do mapa invalido.');
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_POSITION', 'message', 'Ha posicoes duplicadas no mapa.');
end;
$$;

revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from public;
revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from anon;
revoke all on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) from authenticated;
grant execute on function public.save_warehouse_map_config(uuid, uuid, uuid, text[], integer[], jsonb, timestamptz) to service_role;

create or replace function public.assign_warehouse_material_address(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_map_id uuid,
  p_material_id uuid,
  p_coluna text,
  p_linha integer,
  p_andar integer,
  p_posicao integer,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_map public.warehouse_maps%rowtype;
  v_current public.warehouse_material_addresses%rowtype;
  v_occupied public.warehouse_material_addresses%rowtype;
  v_floor_positions integer;
  v_address_id uuid;
  v_updated_at timestamptz;
  v_coluna text := upper(btrim(coalesce(p_coluna, '')));
begin
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || '|' || p_map_id::text || '|' || coalesce(p_material_id::text, '')));

  select *
  into v_map
  from public.warehouse_maps
  where id = p_map_id
    and tenant_id = p_tenant_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MAP_NOT_FOUND', 'message', 'Mapa do almoxarifado nao encontrado.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, v_map.stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  perform 1
  from public.materials mat
  where mat.id = p_material_id
    and mat.tenant_id = p_tenant_id
    and mat.is_active = true;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado ou inativo.');
  end if;

  select floors.qtd_posicoes
  into v_floor_positions
  from public.warehouse_shelves shelves
  join public.warehouse_shelf_floors floors
    on floors.tenant_id = shelves.tenant_id
   and floors.shelf_id = shelves.id
  where shelves.tenant_id = p_tenant_id
    and shelves.map_id = p_map_id
    and shelves.coluna = v_coluna
    and shelves.linha = p_linha
    and floors.numero = p_andar;

  if v_floor_positions is null or p_posicao < 1 or p_posicao > v_floor_positions then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ADDRESS', 'message', 'Endereco inexistente na configuracao do mapa.');
  end if;

  select *
  into v_current
  from public.warehouse_material_addresses
  where tenant_id = p_tenant_id
    and map_id = p_map_id
    and material_id = p_material_id
  for update;

  if found and p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize o endereco antes de realocar o material.');
  end if;

  if found and v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'O endereco deste material foi alterado por outro usuario.');
  end if;

  select *
  into v_occupied
  from public.warehouse_material_addresses
  where tenant_id = p_tenant_id
    and map_id = p_map_id
    and coluna = v_coluna
    and linha = p_linha
    and andar = p_andar
    and posicao = p_posicao
    and material_id <> p_material_id
  for update;

  if found then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'Esta posicao ja possui outro material enderecado.');
  end if;

  insert into public.warehouse_material_addresses (
    tenant_id,
    map_id,
    stock_center_id,
    material_id,
    coluna,
    linha,
    andar,
    posicao,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_map_id,
    v_map.stock_center_id,
    p_material_id,
    v_coluna,
    p_linha,
    p_andar,
    p_posicao,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, map_id, material_id) do update
  set
    coluna = excluded.coluna,
    linha = excluded.linha,
    andar = excluded.andar,
    posicao = excluded.posicao,
    updated_by = excluded.updated_by
  returning id, updated_at into v_address_id, v_updated_at;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    material_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_map_id,
    p_material_id,
    'ADDRESS_ASSIGN',
    jsonb_build_object('coluna', v_coluna, 'linha', p_linha, 'andar', p_andar, 'posicao', p_posicao),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'address_id', v_address_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'POSITION_OCCUPIED', 'message', 'Esta posicao ja possui outro material enderecado.');
end;
$$;

revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz) from public;
revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz) from anon;
revoke all on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz) from authenticated;
grant execute on function public.assign_warehouse_material_address(uuid, uuid, uuid, uuid, text, integer, integer, integer, timestamptz) to service_role;

create or replace function public.clear_warehouse_material_address(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_map_id uuid,
  p_material_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.warehouse_material_addresses%rowtype;
begin
  select *
  into v_current
  from public.warehouse_material_addresses
  where tenant_id = p_tenant_id
    and map_id = p_map_id
    and material_id = p_material_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'ADDRESS_NOT_FOUND', 'message', 'Endereco do material nao encontrado.');
  end if;

  if not public.is_physical_warehouse_stock_center(p_tenant_id, v_current.stock_center_id) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'STOCK_CENTER_NOT_PHYSICAL_WAREHOUSE',
      'message', 'Use somente centro fisico de almoxarifado. Centros vinculados a equipes nao podem receber enderecamento.'
    );
  end if;

  if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', 'O endereco deste material foi alterado por outro usuario.');
  end if;

  delete from public.warehouse_material_addresses
  where id = v_current.id
    and tenant_id = p_tenant_id;

  insert into public.warehouse_address_history (
    tenant_id,
    map_id,
    material_id,
    action_type,
    details,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_map_id,
    p_material_id,
    'ADDRESS_CLEAR',
    jsonb_build_object('previous', jsonb_build_object('coluna', v_current.coluna, 'linha', v_current.linha, 'andar', v_current.andar, 'posicao', v_current.posicao)),
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200);
end;
$$;

revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from public;
revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from anon;
revoke all on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) from authenticated;
grant execute on function public.clear_warehouse_material_address(uuid, uuid, uuid, uuid, timestamptz) to service_role;
