-- 212_measurement_minimum_billing_guarantee.sql
-- Calcula garantia de faturamento minimo da Medicao sem producao no banco.

alter table if exists public.project_measurement_orders
  add column if not exists minimum_billing_amount numeric(14, 2) not null default 0,
  add column if not exists minimum_billing_team_type_id uuid null,
  add column if not exists minimum_billing_team_type_name_snapshot text null,
  add column if not exists minimum_billing_score_target_id uuid null,
  add column if not exists minimum_billing_target_points numeric(12, 2) null,
  add column if not exists minimum_billing_unit_value_source_activity_id uuid null,
  add column if not exists minimum_billing_unit_value_group_snapshot text null,
  add column if not exists minimum_billing_unit_value numeric(14, 2) null,
  add column if not exists minimum_billing_calculated_at timestamptz null;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_minimum_billing_amount_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_minimum_billing_amount_check
  check (minimum_billing_amount >= 0);

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_minimum_billing_values_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_minimum_billing_values_check
  check (
    (
      minimum_billing_amount = 0
      and minimum_billing_team_type_id is null
      and minimum_billing_score_target_id is null
      and minimum_billing_target_points is null
      and minimum_billing_unit_value_source_activity_id is null
      and minimum_billing_unit_value_group_snapshot is null
      and minimum_billing_unit_value is null
      and minimum_billing_calculated_at is null
    )
    or
    (
      minimum_billing_amount > 0
      and minimum_billing_team_type_id is not null
      and minimum_billing_score_target_id is not null
      and minimum_billing_target_points is not null
      and minimum_billing_target_points > 0
      and minimum_billing_unit_value_source_activity_id is not null
      and btrim(coalesce(minimum_billing_unit_value_group_snapshot, '')) <> ''
      and minimum_billing_unit_value is not null
      and minimum_billing_unit_value > 0
      and minimum_billing_calculated_at is not null
    )
  );

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_measurement_orders'
      and tc.constraint_name = 'project_measurement_orders_minimum_billing_team_type_fk'
  ) then
    alter table public.project_measurement_orders
      add constraint project_measurement_orders_minimum_billing_team_type_fk
      foreign key (minimum_billing_team_type_id, tenant_id)
      references public.team_types(id, tenant_id);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_measurement_orders'
      and tc.constraint_name = 'project_measurement_orders_minimum_billing_score_target_fk'
  ) then
    alter table public.project_measurement_orders
      add constraint project_measurement_orders_minimum_billing_score_target_fk
      foreign key (minimum_billing_score_target_id)
      references public.measurement_score_targets(id);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_measurement_orders'
      and tc.constraint_name = 'project_measurement_orders_minimum_billing_activity_fk'
  ) then
    alter table public.project_measurement_orders
      add constraint project_measurement_orders_minimum_billing_activity_fk
      foreign key (minimum_billing_unit_value_source_activity_id)
      references public.service_activities(id);
  end if;
end;
$$;

create index if not exists idx_project_measurement_orders_minimum_billing
  on public.project_measurement_orders (tenant_id, minimum_billing_amount)
  where minimum_billing_amount > 0;

insert into public.measurement_no_production_reasons (tenant_id, code, name, sort_order)
select
  t.id,
  'GARANTIA_FATURAMENTO_MINIMO',
  'Garantia de faturamento minimo',
  50
from public.tenants t
on conflict (tenant_id, code) do update
set
  name = excluded.name,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace function public.normalize_minimum_billing_token(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(
      upper(btrim(coalesce(p_value, ''))),
      U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
      'AAAAAEEEEIIIIOOOOOUUUUC'
    ),
    '[^A-Z0-9]+',
    '',
    'g'
  );
$$;

create or replace function public.apply_measurement_minimum_billing_guarantee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason_token text;
  v_team_type_id uuid;
  v_team_type_name text;
  v_team_type_token text;
  v_group_label text;
  v_group_tokens text[];
  v_score_target_id uuid;
  v_target_points numeric(12, 2);
  v_unit_value numeric(14, 2);
  v_source_activity_id uuid;
  v_distinct_unit_values integer;
begin
  new.minimum_billing_amount := 0;
  new.minimum_billing_team_type_id := null;
  new.minimum_billing_team_type_name_snapshot := null;
  new.minimum_billing_score_target_id := null;
  new.minimum_billing_target_points := null;
  new.minimum_billing_unit_value_source_activity_id := null;
  new.minimum_billing_unit_value_group_snapshot := null;
  new.minimum_billing_unit_value := null;
  new.minimum_billing_calculated_at := null;

  if new.measurement_kind <> 'SEM_PRODUCAO' or new.no_production_reason_id is null then
    return new;
  end if;

  select case
    when public.normalize_minimum_billing_token(r.code) = 'GARANTIAFATURAMENTOMINIMO'
      or public.normalize_minimum_billing_token(r.name) = 'GARANTIAFATURAMENTOMINIMO'
      then 'GARANTIAFATURAMENTOMINIMO'
    else public.normalize_minimum_billing_token(r.code)
  end
  into v_reason_token
  from public.measurement_no_production_reasons r
  where r.tenant_id = new.tenant_id
    and r.id = new.no_production_reason_id
    and r.is_active = true;

  if v_reason_token <> 'GARANTIAFATURAMENTOMINIMO' then
    return new;
  end if;

  select h.team_type_id, h.team_type_name_snapshot
  into v_team_type_id, v_team_type_name
  from public.team_type_history h
  where h.tenant_id = new.tenant_id
    and h.team_id = new.team_id
    and h.valid_from <= new.execution_date
    and (h.valid_to is null or h.valid_to >= new.execution_date)
  order by h.valid_from desc, h.updated_at desc
  limit 1;

  if v_team_type_id is null then
    select t.team_type_id, tt.name
    into v_team_type_id, v_team_type_name
    from public.teams t
    left join public.team_types tt
      on tt.tenant_id = t.tenant_id
     and tt.id = t.team_type_id
    where t.tenant_id = new.tenant_id
      and t.id = new.team_id;
  end if;

  if v_team_type_id is null then
    raise exception 'Garantia de faturamento minimo sem tipo de equipe vinculado.';
  end if;

  if nullif(btrim(coalesce(v_team_type_name, '')), '') is null then
    select tt.name
    into v_team_type_name
    from public.team_types tt
    where tt.tenant_id = new.tenant_id
      and tt.id = v_team_type_id;
  end if;

  v_team_type_token := public.normalize_minimum_billing_token(v_team_type_name);

  if v_team_type_token in ('LV', 'LINHAVIVA') then
    v_group_label := 'LLEE/LINHA VIVA';
    v_group_tokens := array['LLEE', 'LINHAVIVA'];
  elsif v_team_type_token in ('MK', 'LM', 'LINHAMORTA', 'CESTO', 'CETO') then
    v_group_label := 'SOT AEREA';
    v_group_tokens := array['SOTAEREA'];
  else
    raise exception 'Tipo de equipe sem regra de garantia de faturamento minimo: %', coalesce(v_team_type_name, v_team_type_id::text);
  end if;

  select mst.id, mst.target_points
  into v_score_target_id, v_target_points
  from public.measurement_score_targets mst
  where mst.tenant_id = new.tenant_id
    and mst.team_type_id = v_team_type_id
    and mst.ativo = true
  limit 1;

  if v_score_target_id is null or coalesce(v_target_points, 0) <= 0 then
    raise exception 'Meta de pontos nao encontrada para garantia de faturamento minimo: %', coalesce(v_team_type_name, v_team_type_id::text);
  end if;

  select count(distinct sa.unit_value)
  into v_distinct_unit_values
  from public.service_activities sa
  where sa.tenant_id = new.tenant_id
    and sa.ativo = true
    and sa.unit_value > 0
    and public.normalize_minimum_billing_token(sa.group_name) = any(v_group_tokens);

  if coalesce(v_distinct_unit_values, 0) = 0 then
    raise exception 'Valor do ponto nao encontrado para garantia de faturamento minimo: %', v_group_label;
  end if;

  if v_distinct_unit_values > 1 then
    raise exception 'Valor do ponto ambiguo para garantia de faturamento minimo: %', v_group_label;
  end if;

  select sa.id, sa.unit_value
  into v_source_activity_id, v_unit_value
  from public.service_activities sa
  where sa.tenant_id = new.tenant_id
    and sa.ativo = true
    and sa.unit_value > 0
    and public.normalize_minimum_billing_token(sa.group_name) = any(v_group_tokens)
  order by sa.updated_at desc, sa.id
  limit 1;

  new.minimum_billing_amount := round(v_target_points * v_unit_value, 2);
  new.minimum_billing_team_type_id := v_team_type_id;
  new.minimum_billing_team_type_name_snapshot := nullif(btrim(coalesce(v_team_type_name, '')), '');
  new.minimum_billing_score_target_id := v_score_target_id;
  new.minimum_billing_target_points := v_target_points;
  new.minimum_billing_unit_value_source_activity_id := v_source_activity_id;
  new.minimum_billing_unit_value_group_snapshot := v_group_label;
  new.minimum_billing_unit_value := v_unit_value;
  new.minimum_billing_calculated_at := now();

  return new;
end;
$$;

drop trigger if exists trg_project_measurement_orders_minimum_billing on public.project_measurement_orders;
create trigger trg_project_measurement_orders_minimum_billing
before insert or update of measurement_kind, no_production_reason_id, team_id, execution_date
on public.project_measurement_orders
for each row execute function public.apply_measurement_minimum_billing_guarantee();

revoke all on function public.normalize_minimum_billing_token(text) from public;
grant execute on function public.normalize_minimum_billing_token(text) to authenticated;
grant execute on function public.normalize_minimum_billing_token(text) to service_role;

revoke all on function public.apply_measurement_minimum_billing_guarantee() from public;
grant execute on function public.apply_measurement_minimum_billing_guarantee() to authenticated;
grant execute on function public.apply_measurement_minimum_billing_guarantee() to service_role;
