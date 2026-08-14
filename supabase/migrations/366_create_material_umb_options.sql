-- 366_create_material_umb_options.sql
-- Cria catalogo multi-tenant de UMB para materiais e restringe a escrita a opcoes ativas.

create table if not exists public.material_umb_options (
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
  constraint material_umb_options_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint material_umb_options_label_not_blank_check
    check (nullif(btrim(coalesce(label_pt, '')), '') is not null),
  constraint material_umb_options_sort_order_check
    check (sort_order >= 0),
  constraint material_umb_options_tenant_code_key
    unique (tenant_id, code)
);

create index if not exists idx_material_umb_options_tenant_active_order
  on public.material_umb_options (tenant_id, is_active, sort_order, code);

alter table if exists public.material_umb_options enable row level security;

drop policy if exists material_umb_options_tenant_select on public.material_umb_options;
create policy material_umb_options_tenant_select on public.material_umb_options
for select
to authenticated
using (public.user_can_access_tenant(material_umb_options.tenant_id));

grant select on public.material_umb_options to authenticated;

drop trigger if exists trg_material_umb_options_audit on public.material_umb_options;
create trigger trg_material_umb_options_audit
before insert or update on public.material_umb_options
for each row execute function public.apply_audit_fields();

insert into public.material_umb_options (
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
    ('M', 'M', 10),
    ('KG', 'KG', 20),
    ('UN', 'UN', 30)
) as base(code, label_pt, sort_order)
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.seed_material_umb_options_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.material_umb_options (
    tenant_id,
    code,
    label_pt,
    is_active,
    sort_order
  )
  values
    (new.id, 'M', 'M', true, 10),
    (new.id, 'KG', 'KG', true, 20),
    (new.id, 'UN', 'UN', true, 30)
  on conflict (tenant_id, code) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_material_umb_options_for_tenant() from public;
revoke all on function public.seed_material_umb_options_for_tenant() from anon;
revoke all on function public.seed_material_umb_options_for_tenant() from authenticated;

drop trigger if exists trg_tenants_seed_material_umb_options on public.tenants;
create trigger trg_tenants_seed_material_umb_options
after insert on public.tenants
for each row execute function public.seed_material_umb_options_for_tenant();

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
  v_umb text := upper(btrim(coalesce(p_umb, '')));
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

  if not exists (
    select 1
    from public.material_umb_options options
    where options.tenant_id = p_tenant_id
      and options.code = v_umb
      and options.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UMB', 'message', 'UMB invalida. Selecione M, KG ou UN.');
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
