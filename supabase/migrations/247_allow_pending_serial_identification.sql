-- 247_allow_pending_serial_identification.sql
-- Permite pendencia de identificacao de serial para materiais rastreaveis sem LP
-- obrigatorio, mantendo TRAFO sempre com Serial + LP obrigatorios.

alter table if exists public.materials
  add column if not exists allow_pending_serial_identification boolean not null default false;

update public.materials
set allow_pending_serial_identification = case
  when upper(btrim(coalesce(serial_tracking_type, case when coalesce(is_transformer, false) then 'TRAFO' else 'NONE' end))) in ('RELIGADOR', 'CHAVE')
    then true
  else false
end
where allow_pending_serial_identification is distinct from case
  when upper(btrim(coalesce(serial_tracking_type, case when coalesce(is_transformer, false) then 'TRAFO' else 'NONE' end))) in ('RELIGADOR', 'CHAVE')
    then true
  else false
end;

alter table if exists public.materials
  drop constraint if exists materials_pending_serial_not_trafo_check;

alter table if exists public.materials
  add constraint materials_pending_serial_not_trafo_check
  check (
    allow_pending_serial_identification is not true
    or upper(btrim(coalesce(serial_tracking_type, case when coalesce(is_transformer, false) then 'TRAFO' else 'NONE' end))) in ('RELIGADOR', 'CHAVE')
  );

create index if not exists idx_materials_tenant_pending_serial
  on public.materials (tenant_id, allow_pending_serial_identification, serial_tracking_type, is_active);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'materials_id_tenant_key'
      and conrelid = 'public.materials'::regclass
  ) then
    alter table public.materials
      add constraint materials_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'project_id_tenant_key'
      and conrelid = 'public.project'::regclass
  ) then
    alter table public.project
      add constraint project_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'stock_centers_id_tenant_key'
      and conrelid = 'public.stock_centers'::regclass
  ) then
    alter table public.stock_centers
      add constraint stock_centers_id_tenant_key unique (id, tenant_id);
  end if;
end $$;

create table if not exists public.stock_serial_pending_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  material_id uuid not null,
  stock_center_id uuid not null,
  project_id uuid,
  project_key uuid generated always as (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  entry_type text not null,
  quantity numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint stock_serial_pending_entry_type_check check (entry_type in ('NOVO', 'SUCATA')),
  constraint stock_serial_pending_quantity_check check (quantity >= 0 and quantity = trunc(quantity)),
  constraint stock_serial_pending_material_tenant_fk foreign key (material_id, tenant_id) references public.materials(id, tenant_id),
  constraint stock_serial_pending_center_tenant_fk foreign key (stock_center_id, tenant_id) references public.stock_centers(id, tenant_id),
  constraint stock_serial_pending_project_tenant_fk foreign key (project_id, tenant_id) references public.project(id, tenant_id),
  constraint stock_serial_pending_unique unique (tenant_id, material_id, stock_center_id, project_key, entry_type)
);

create index if not exists idx_stock_serial_pending_lookup
  on public.stock_serial_pending_balances (tenant_id, material_id, stock_center_id, project_id, entry_type);

alter table if exists public.stock_serial_pending_balances enable row level security;

drop policy if exists stock_serial_pending_balances_tenant_select on public.stock_serial_pending_balances;
create policy stock_serial_pending_balances_tenant_select on public.stock_serial_pending_balances
for select
to authenticated
using (public.user_can_access_tenant(stock_serial_pending_balances.tenant_id));

drop trigger if exists trg_stock_serial_pending_balances_audit on public.stock_serial_pending_balances;
create trigger trg_stock_serial_pending_balances_audit
before insert or update on public.stock_serial_pending_balances
for each row execute function public.apply_audit_fields();

create or replace function public.adjust_stock_serial_pending_balance(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid,
  p_stock_center_id uuid,
  p_project_id uuid,
  p_entry_type text,
  p_quantity_delta numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_current_quantity numeric := 0;
  v_next_quantity numeric := 0;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_material_id is null or p_stock_center_id is null then
    raise exception 'PENDING_SERIAL_REQUIRED_FIELDS';
  end if;

  if v_entry_type not in ('NOVO', 'SUCATA') then
    raise exception 'PENDING_SERIAL_INVALID_ENTRY_TYPE';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 or p_quantity_delta <> trunc(p_quantity_delta) then
    raise exception 'PENDING_SERIAL_QUANTITY_MUST_BE_INTEGER';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_material_id::text || '|' || p_stock_center_id::text || '|' || coalesce(p_project_id::text, '-') || '|' || v_entry_type)
  );

  select quantity
  into v_current_quantity
  from public.stock_serial_pending_balances
  where tenant_id = p_tenant_id
    and material_id = p_material_id
    and stock_center_id = p_stock_center_id
    and project_id is not distinct from p_project_id
    and entry_type = v_entry_type
  for update;

  if not found then
    if p_quantity_delta < 0 then
      raise exception 'PENDING_SERIAL_INSUFFICIENT_BALANCE';
    end if;

    insert into public.stock_serial_pending_balances (
      tenant_id,
      material_id,
      stock_center_id,
      project_id,
      entry_type,
      quantity,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      p_stock_center_id,
      p_project_id,
      v_entry_type,
      p_quantity_delta,
      p_actor_user_id,
      p_actor_user_id
    );

    return p_quantity_delta;
  end if;

  v_next_quantity := v_current_quantity + p_quantity_delta;
  if v_next_quantity < 0 then
    raise exception 'PENDING_SERIAL_INSUFFICIENT_BALANCE';
  end if;

  update public.stock_serial_pending_balances
  set quantity = v_next_quantity,
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and material_id = p_material_id
    and stock_center_id = p_stock_center_id
    and project_id is not distinct from p_project_id
    and entry_type = v_entry_type;

  return v_next_quantity;
end;
$$;

revoke all on function public.adjust_stock_serial_pending_balance(uuid, uuid, uuid, uuid, uuid, text, numeric) from public;
revoke all on function public.adjust_stock_serial_pending_balance(uuid, uuid, uuid, uuid, uuid, text, numeric) from anon;
revoke all on function public.adjust_stock_serial_pending_balance(uuid, uuid, uuid, uuid, uuid, text, numeric) from authenticated;
grant execute on function public.adjust_stock_serial_pending_balance(uuid, uuid, uuid, uuid, uuid, text, numeric) to service_role;

create or replace function public.normalize_serial_tracked_stock_transfer_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracking_type text;
  v_material_code text;
  v_allow_pending_serial boolean := false;
begin
  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo,
    coalesce(m.allow_pending_serial_identification, false)
  into v_tracking_type, v_material_code, v_allow_pending_serial
  from public.materials m
  where m.id = new.material_id
    and m.tenant_id = new.tenant_id;

  if not found or v_tracking_type in ('NONE', 'TRAFO') then
    return new;
  end if;

  new.serial_number := nullif(btrim(coalesce(new.serial_number, '')), '');

  if new.serial_number is null then
    if v_allow_pending_serial is not true then
      raise exception 'SERIAL_TRACKED_SERIAL_REQUIRED: material %', coalesce(v_material_code, new.material_id::text);
    end if;

    if new.quantity <= 0 or new.quantity <> trunc(new.quantity) then
      raise exception 'PENDING_SERIAL_QUANTITY_MUST_BE_INTEGER: material %', coalesce(v_material_code, new.material_id::text);
    end if;

    new.lot_code := '-';
    return new;
  end if;

  if new.quantity <> 1 then
    raise exception 'SERIAL_TRACKED_QUANTITY_MUST_BE_ONE: material %', coalesce(v_material_code, new.material_id::text);
  end if;

  new.lot_code := '-';
  return new;
end;
$$;

create or replace function public.apply_serial_tracked_stock_transfer_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tracking_type text;
  v_material_code text;
  v_allow_pending_serial boolean := false;
  v_transfer public.stock_transfers%rowtype;
  v_team_operation_kind text;
  v_is_field_return_transfer boolean := false;
  v_instance_id uuid;
  v_current_stock_center_id uuid;
begin
  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo,
    coalesce(m.allow_pending_serial_identification, false)
  into v_tracking_type, v_material_code, v_allow_pending_serial
  from public.materials m
  where m.id = new.material_id
    and m.tenant_id = new.tenant_id;

  if not found or v_tracking_type in ('NONE', 'TRAFO') then
    return null;
  end if;

  select *
  into v_transfer
  from public.stock_transfers st
  where st.id = new.stock_transfer_id
    and st.tenant_id = new.tenant_id;

  if not found then
    raise exception 'SERIAL_TRACKED_TRANSFER_NOT_FOUND: transferencia %', new.stock_transfer_id;
  end if;

  if new.serial_number is null then
    if v_allow_pending_serial is not true then
      raise exception 'SERIAL_TRACKED_SERIAL_REQUIRED: material %', coalesce(v_material_code, new.material_id::text);
    end if;

    if v_transfer.movement_type = 'ENTRY' then
      perform public.adjust_stock_serial_pending_balance(
        new.tenant_id,
        coalesce(new.updated_by, new.created_by),
        new.material_id,
        v_transfer.to_stock_center_id,
        v_transfer.project_id,
        v_transfer.entry_type,
        new.quantity
      );
    elsif v_transfer.movement_type = 'TRANSFER' then
      perform public.adjust_stock_serial_pending_balance(
        new.tenant_id,
        coalesce(new.updated_by, new.created_by),
        new.material_id,
        v_transfer.from_stock_center_id,
        v_transfer.project_id,
        v_transfer.entry_type,
        new.quantity * -1
      );
      perform public.adjust_stock_serial_pending_balance(
        new.tenant_id,
        coalesce(new.updated_by, new.created_by),
        new.material_id,
        v_transfer.to_stock_center_id,
        v_transfer.project_id,
        v_transfer.entry_type,
        new.quantity
      );
    elsif v_transfer.movement_type = 'EXIT' then
      perform public.adjust_stock_serial_pending_balance(
        new.tenant_id,
        coalesce(new.updated_by, new.created_by),
        new.material_id,
        v_transfer.from_stock_center_id,
        v_transfer.project_id,
        v_transfer.entry_type,
        new.quantity * -1
      );
    else
      raise exception 'PENDING_SERIAL_INVALID_MOVEMENT_TYPE';
    end if;

    return null;
  end if;

  select sto.operation_kind
  into v_team_operation_kind
  from public.stock_transfer_team_operations sto
  where sto.transfer_id = new.stock_transfer_id
    and sto.tenant_id = new.tenant_id
  limit 1;

  select exists (
    select 1
    from public.stock_centers sc
    where sc.id = v_transfer.from_stock_center_id
      and sc.tenant_id = new.tenant_id
      and sc.center_type = 'THIRD_PARTY'
      and upper(btrim(coalesce(sc.name, ''))) = 'CAMPO / INSTALADO'
  )
  into v_is_field_return_transfer;

  perform pg_advisory_xact_lock(
    hashtext(new.tenant_id::text),
    hashtext(new.material_id::text || '|' || coalesce(new.serial_number, '') || '|-')
  );

  select id, current_stock_center_id
  into v_instance_id, v_current_stock_center_id
  from public.trafo_instances
  where tenant_id = new.tenant_id
    and material_id = new.material_id
    and serial_number = new.serial_number
    and lot_code = '-'
  for update;

  if not found then
    v_instance_id := null;
    v_current_stock_center_id := null;
  end if;

  if v_transfer.movement_type = 'ENTRY' and v_current_stock_center_id is not null then
    raise exception 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
  end if;

  if v_team_operation_kind = 'FIELD_RETURN' or v_is_field_return_transfer then
    if v_current_stock_center_id is not null then
      raise exception 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
    end if;

    insert into public.trafo_instances (
      tenant_id,
      material_id,
      serial_number,
      lot_code,
      current_stock_center_id,
      last_stock_transfer_id,
      last_project_id,
      last_movement_type,
      last_entry_date,
      created_by,
      updated_by
    ) values (
      new.tenant_id,
      new.material_id,
      new.serial_number,
      '-',
      v_transfer.to_stock_center_id,
      v_transfer.id,
      v_transfer.project_id,
      v_transfer.movement_type,
      v_transfer.entry_date,
      new.created_by,
      new.updated_by
    )
    on conflict (tenant_id, material_id, serial_number, lot_code) do update
    set
      current_stock_center_id = excluded.current_stock_center_id,
      last_stock_transfer_id = excluded.last_stock_transfer_id,
      last_project_id = excluded.last_project_id,
      last_movement_type = excluded.last_movement_type,
      last_entry_date = excluded.last_entry_date,
      updated_by = excluded.updated_by,
      updated_at = now();

    return null;
  end if;

  if v_transfer.movement_type in ('EXIT', 'TRANSFER') and (
    v_instance_id is null
    or v_current_stock_center_id is distinct from v_transfer.from_stock_center_id
  ) then
    raise exception 'SERIAL_TRACKED_UNIT_NOT_IN_FROM_CENTER: material %, serial %', coalesce(v_material_code, new.material_id::text), new.serial_number;
  end if;

  if v_transfer.movement_type = 'ENTRY' then
    insert into public.trafo_instances (
      tenant_id,
      material_id,
      serial_number,
      lot_code,
      current_stock_center_id,
      last_stock_transfer_id,
      last_project_id,
      last_movement_type,
      last_entry_date,
      created_by,
      updated_by
    ) values (
      new.tenant_id,
      new.material_id,
      new.serial_number,
      '-',
      v_transfer.to_stock_center_id,
      v_transfer.id,
      v_transfer.project_id,
      v_transfer.movement_type,
      v_transfer.entry_date,
      new.created_by,
      new.updated_by
    )
    on conflict (tenant_id, material_id, serial_number, lot_code) do update
    set
      current_stock_center_id = excluded.current_stock_center_id,
      last_stock_transfer_id = excluded.last_stock_transfer_id,
      last_project_id = excluded.last_project_id,
      last_movement_type = excluded.last_movement_type,
      last_entry_date = excluded.last_entry_date,
      updated_by = excluded.updated_by,
      updated_at = now();
  elsif v_transfer.movement_type = 'EXIT' then
    update public.trafo_instances
    set
      current_stock_center_id = null,
      last_stock_transfer_id = v_transfer.id,
      last_project_id = v_transfer.project_id,
      last_movement_type = v_transfer.movement_type,
      last_entry_date = v_transfer.entry_date,
      updated_by = new.updated_by
    where id = v_instance_id;
  else
    update public.trafo_instances
    set
      current_stock_center_id = v_transfer.to_stock_center_id,
      last_stock_transfer_id = v_transfer.id,
      last_project_id = v_transfer.project_id,
      last_movement_type = v_transfer.movement_type,
      last_entry_date = v_transfer.entry_date,
      updated_by = new.updated_by
    where id = v_instance_id;
  end if;

  return null;
end;
$$;

create or replace function public.identify_pending_serial_tracked_unit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid,
  p_stock_center_id uuid,
  p_project_id uuid,
  p_entry_type text,
  p_serial_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_serial_number text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_tracking_type text;
  v_material_code text;
  v_allow_pending_serial boolean := false;
  v_instance public.trafo_instances%rowtype;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_material_id is null or p_stock_center_id is null or v_serial_number is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PENDING_SERIAL_REQUIRED_FIELDS',
      'message', 'Material, centro, tipo e serial sao obrigatorios para identificar a pendencia.'
    );
  end if;

  if v_entry_type not in ('NOVO', 'SUCATA') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PENDING_SERIAL_INVALID_ENTRY_TYPE',
      'message', 'Tipo do material deve ser NOVO ou SUCATA.'
    );
  end if;

  select
    case
      when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
      when coalesce(m.is_transformer, false) then 'TRAFO'
      else 'NONE'
    end,
    m.codigo,
    coalesce(m.allow_pending_serial_identification, false)
  into v_tracking_type, v_material_code, v_allow_pending_serial
  from public.materials m
  where m.id = p_material_id
    and m.tenant_id = p_tenant_id
    and m.is_active = true;

  if not found or v_tracking_type = 'NONE' then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'MATERIAL_NOT_SERIAL_TRACKED',
      'message', 'Material rastreavel por serial nao encontrado ou inativo.'
    );
  end if;

  if v_tracking_type = 'TRAFO' or v_allow_pending_serial is not true then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'PENDING_SERIAL_NOT_ALLOWED',
      'message', 'Este material exige serial na entrada e nao aceita pendencia de identificacao.'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_material_id::text || '|' || v_serial_number || '|-')
  );

  select *
  into v_instance
  from public.trafo_instances
  where tenant_id = p_tenant_id
    and material_id = p_material_id
    and serial_number = v_serial_number
    and lot_code = '-'
  for update;

  if found and v_instance.current_stock_center_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'SERIAL_TRACKED_UNIT_ALREADY_IN_STOCK',
      'message', 'A unidade por serial informada ja esta registrada em estoque proprio ou vinculada a outra operacao.'
    );
  end if;

  perform public.adjust_stock_serial_pending_balance(
    p_tenant_id,
    p_actor_user_id,
    p_material_id,
    p_stock_center_id,
    p_project_id,
    v_entry_type,
    -1
  );

  insert into public.trafo_instances (
    tenant_id,
    material_id,
    serial_number,
    lot_code,
    current_stock_center_id,
    last_stock_transfer_id,
    last_project_id,
    last_movement_type,
    last_entry_date,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_material_id,
    v_serial_number,
    '-',
    p_stock_center_id,
    null,
    p_project_id,
    'ENTRY',
    current_date,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (tenant_id, material_id, serial_number, lot_code) do update
  set
    current_stock_center_id = excluded.current_stock_center_id,
    last_project_id = excluded.last_project_id,
    last_movement_type = excluded.last_movement_type,
    last_entry_date = excluded.last_entry_date,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Serial identificado com sucesso.',
    'materialCode', v_material_code,
    'serialNumber', v_serial_number
  );
exception
  when others then
    if upper(sqlerrm) like '%PENDING_SERIAL_INSUFFICIENT_BALANCE%' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PENDING_SERIAL_INSUFFICIENT_BALANCE',
        'message', 'Nao existe quantidade pendente suficiente para identificar este serial.'
      );
    end if;
    raise;
end;
$$;

revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from anon;
revoke all on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.identify_pending_serial_tracked_unit(uuid, uuid, uuid, uuid, uuid, text, text) to service_role;

create or replace function public.save_team_stock_operation_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_operation_kind text,
  p_stock_center_id uuid,
  p_team_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_kind text := upper(btrim(coalesce(p_operation_kind, '')));
  v_effective_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_team_stock_center_id uuid;
  v_team_name_snapshot text;
  v_foreman_person_id_snapshot uuid;
  v_foreman_name_snapshot text;
  v_transfer_id uuid;
  v_save_result jsonb;
  v_field_origin_stock_center_id uuid;
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_serial_number text;
  v_lot_code text;
  v_tracking_type text;
  v_material_code text;
begin
  if v_operation_kind not in ('REQUISITION', 'RETURN', 'FIELD_RETURN') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TEAM_OPERATION_KIND',
      'message', 'Operacao de equipe deve ser REQUISITION, RETURN ou FIELD_RETURN.'
    );
  end if;

  if p_stock_center_id is null or p_team_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TEAM_OPERATION_REQUIRED_FIELDS',
      'message', 'Centro de estoque e equipe sao obrigatorios para a operacao.'
    );
  end if;

  select
    t.stock_center_id,
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado'),
    t.foreman_person_id,
    coalesce(nullif(btrim(coalesce(p.nome, '')), ''), 'Nao informado')
  into
    v_team_stock_center_id,
    v_team_name_snapshot,
    v_foreman_person_id_snapshot,
    v_foreman_name_snapshot
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = p_tenant_id
  where t.id = p_team_id
    and t.tenant_id = p_tenant_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.'
    );
  end if;

  if v_team_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_NOT_LINKED',
      'message', 'A equipe selecionada nao possui centro de estoque proprio vinculado.'
    );
  end if;

  perform 1
  from public.stock_centers sc
  where sc.id = p_stock_center_id
    and sc.tenant_id = p_tenant_id
    and sc.is_active = true
    and sc.center_type = 'OWN';

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'STOCK_CENTER_NOT_FOUND',
      'message', 'Centro de estoque proprio nao encontrado ou inativo para este tenant.'
    );
  end if;

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.stock_center_id = p_stock_center_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_AS_MAIN_NOT_ALLOWED',
      'message', 'Centro de estoque principal nao pode ser um centro vinculado a equipe.'
    );
  end if;

  if p_stock_center_id = v_team_stock_center_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_STOCK_CENTER',
      'message', 'Centro de estoque e centro vinculado da equipe devem ser diferentes.'
    );
  end if;

  perform 1
  from public.stock_centers sc
  where sc.id = v_team_stock_center_id
    and sc.tenant_id = p_tenant_id
    and sc.is_active = true
    and sc.center_type = 'OWN';

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_INVALID',
      'message', 'O centro de estoque proprio vinculado a equipe esta inativo ou invalido.'
    );
  end if;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    begin
      v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
    exception
      when others then
        v_material_id := null;
    end;

    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception
      when others then
        v_quantity := null;
    end;

    v_serial_number := nullif(btrim(coalesce(v_item ->> 'serialNumber', '')), '');
    v_lot_code := nullif(btrim(coalesce(v_item ->> 'lotCode', '')), '');

    if v_material_id is null then
      continue;
    end if;

    select
      case
        when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
        when coalesce(m.is_transformer, false) then 'TRAFO'
        else 'NONE'
      end,
      m.codigo
    into v_tracking_type, v_material_code
    from public.materials m
    where m.id = v_material_id
      and m.tenant_id = p_tenant_id
      and m.is_active = true;

    if not found or v_tracking_type = 'NONE' then
      continue;
    end if;

    if v_quantity <> 1 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'SERIAL_TRACKED_QUANTITY_MUST_BE_ONE',
        'message', format('Material rastreavel por serial permite somente quantidade 1 por movimentacao: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;

    if v_serial_number is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'SERIAL_TRACKED_SERIAL_REQUIRED',
        'message', format('Serial e obrigatorio para material rastreavel por serial: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;

    if v_tracking_type = 'TRAFO' and v_lot_code is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'TRANSFORMER_SERIAL_OR_LOT_REQUIRED',
        'message', format('Serial e LP sao obrigatorios para material TRAFO: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;
  end loop;

  if v_operation_kind = 'FIELD_RETURN' then
    v_field_origin_stock_center_id := public.ensure_team_operation_field_origin_center(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id
    );

    if v_field_origin_stock_center_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'FIELD_RETURN_CENTER_UNAVAILABLE',
        'message', 'Nao foi possivel preparar o centro tecnico CAMPO / INSTALADO.'
      );
    end if;
  end if;

  v_save_result := public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => case when v_operation_kind = 'FIELD_RETURN' then 'ENTRY' else 'TRANSFER' end,
    p_from_stock_center_id => case
      when v_operation_kind = 'REQUISITION' then p_stock_center_id
      when v_operation_kind = 'RETURN' then v_team_stock_center_id
      else v_field_origin_stock_center_id
    end,
    p_to_stock_center_id => case
      when v_operation_kind = 'REQUISITION' then v_team_stock_center_id
      else p_stock_center_id
    end,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => v_effective_entry_type,
    p_notes => p_notes,
    p_items => p_items,
    p_direct_purchase => false,
    p_operation_purpose => 'NORMAL',
    p_balance_correction_reason => null
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) is not true then
    return v_save_result;
  end if;

  begin
    v_transfer_id := nullif(v_save_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  if v_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'TRANSFER_ID_MISSING',
      'message', 'Falha ao obter id da operacao de equipe salva.'
    );
  end if;

  insert into public.stock_transfer_team_operations (
    transfer_id,
    tenant_id,
    team_id,
    operation_kind,
    technical_origin_stock_center_id,
    team_name_snapshot,
    foreman_person_id_snapshot,
    foreman_name_snapshot,
    created_by,
    updated_by
  ) values (
    v_transfer_id,
    p_tenant_id,
    p_team_id,
    v_operation_kind,
    case when v_operation_kind = 'FIELD_RETURN' then v_field_origin_stock_center_id else null end,
    v_team_name_snapshot,
    v_foreman_person_id_snapshot,
    v_foreman_name_snapshot,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_transfer_id,
    'message', case
      when v_operation_kind = 'REQUISITION' then 'Requisicao salva com sucesso.'
      when v_operation_kind = 'RETURN' then 'Devolucao salva com sucesso.'
      else 'Retorno de campo salvo com sucesso.'
    end
  );
end;
$$;

revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;
