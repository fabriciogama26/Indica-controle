-- 130_fix_stock_center_type_and_enforce_movement_rule.sql
-- Normalizes legacy stock center type values and enforces movement rules at table level.

alter table if exists public.stock_centers
  add column if not exists center_type text not null default 'OWN',
  add column if not exists controls_balance boolean not null default true;

-- Normalize free-text / legacy values safely.
update public.stock_centers
set center_type = upper(
  regexp_replace(
    btrim(coalesce(center_type, '')),
    '[^A-Za-z0-9]+',
    '_',
    'g'
  )
);

update public.stock_centers
set center_type = case
  when center_type in ('OWN', 'PROPRIO', 'PROPRIA', 'PROPRIO_ESTOQUE', 'ESTOQUE_PROPRIO') then 'OWN'
  when center_type in ('THIRD_PARTY', 'THIRD', 'TERCEIRO', 'TERCEIROS', 'ESTOQUE_TERCEIRO') then 'THIRD_PARTY'
  else center_type
end;

-- Fallback for any remaining invalid token.
update public.stock_centers
set center_type = case when coalesce(controls_balance, true) = true then 'OWN' else 'THIRD_PARTY' end
where center_type not in ('OWN', 'THIRD_PARTY');

-- Keep center_type and controls_balance always consistent.
update public.stock_centers
set controls_balance = case when center_type = 'OWN' then true else false end;

alter table if exists public.stock_centers
  drop constraint if exists stock_centers_center_type_check;

alter table if exists public.stock_centers
  add constraint stock_centers_center_type_check
  check (center_type in ('OWN', 'THIRD_PARTY'));

alter table if exists public.stock_centers
  drop constraint if exists stock_centers_controls_balance_consistency_check;

alter table if exists public.stock_centers
  add constraint stock_centers_controls_balance_consistency_check
  check (
    (center_type = 'OWN' and controls_balance = true)
    or (center_type = 'THIRD_PARTY' and controls_balance = false)
  );

create or replace function public.validate_stock_transfer_movement_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_center_type text;
  v_to_center_type text;
begin
  new.movement_type := upper(btrim(coalesce(new.movement_type, '')));

  if new.movement_type not in ('ENTRY', 'EXIT', 'TRANSFER') then
    raise exception 'movement_type deve ser ENTRY, EXIT ou TRANSFER.'
      using errcode = '23514';
  end if;

  select center_type
  into v_from_center_type
  from public.stock_centers
  where id = new.from_stock_center_id
    and tenant_id = new.tenant_id;

  if not found then
    raise exception 'from_stock_center_id invalido para este tenant.'
      using errcode = '23514';
  end if;

  select center_type
  into v_to_center_type
  from public.stock_centers
  where id = new.to_stock_center_id
    and tenant_id = new.tenant_id;

  if not found then
    raise exception 'to_stock_center_id invalido para este tenant.'
      using errcode = '23514';
  end if;

  if (
    (new.movement_type = 'ENTRY' and not (v_from_center_type = 'THIRD_PARTY' and v_to_center_type = 'OWN'))
    or (new.movement_type = 'EXIT' and not (v_from_center_type = 'OWN' and v_to_center_type = 'THIRD_PARTY'))
    or (new.movement_type = 'TRANSFER' and not (v_from_center_type = 'OWN' and v_to_center_type = 'OWN'))
  ) then
    raise exception 'Combinacao de origem/destino invalida para movement_type.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_transfers_validate_movement_rule on public.stock_transfers;
create trigger trg_stock_transfers_validate_movement_rule
before insert or update on public.stock_transfers
for each row execute function public.validate_stock_transfer_movement_rule();

create or replace function public.block_stock_transfer_direct_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Edicao direta de movimentacao de estoque bloqueada. Utilize estorno.'
    using errcode = '23514';
end;
$$;

drop trigger if exists trg_stock_transfers_block_direct_update on public.stock_transfers;
create trigger trg_stock_transfers_block_direct_update
before update on public.stock_transfers
for each row execute function public.block_stock_transfer_direct_update();
