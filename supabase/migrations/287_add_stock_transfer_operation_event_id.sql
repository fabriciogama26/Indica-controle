-- 287_add_stock_transfer_operation_event_id.sql
-- Persiste o identificador de evento operacional de estoque por data + equipe + projeto + status.

alter table public.stock_transfers
  add column if not exists operation_event_id uuid;

comment on column public.stock_transfers.operation_event_id is
  'Identificador deterministico do evento operacional: tenant + data da movimentacao + equipe + projeto + status.';

create index if not exists idx_stock_transfers_operation_event
  on public.stock_transfers (tenant_id, operation_event_id)
  where operation_event_id is not null;

create or replace function public.build_stock_transfer_operation_event_id(
  p_tenant_id uuid,
  p_entry_date date,
  p_project_id uuid,
  p_status text,
  p_team_id uuid default null
)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_tenant_id is null
      or p_entry_date is null
      or p_project_id is null
      or nullif(btrim(coalesce(p_status, '')), '') is null
    then null
    else (
      substr(v.hash, 1, 8) || '-' ||
      substr(v.hash, 9, 4) || '-' ||
      substr(v.hash, 13, 4) || '-' ||
      substr(v.hash, 17, 4) || '-' ||
      substr(v.hash, 21, 12)
    )::uuid
  end
  from (
    select md5(concat_ws(
      '|',
      'stock-operation-event-v1',
      p_tenant_id::text,
      p_entry_date::text,
      coalesce(p_team_id::text, ''),
      p_project_id::text,
      upper(btrim(coalesce(p_status, '')))
    )) as hash
  ) v;
$$;

create or replace function public.apply_stock_transfer_operation_event_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
  v_status text;
begin
  select
    sto.team_id,
    coalesce(nullif(btrim(coalesce(sto.operation_kind, '')), ''), new.movement_type)
  into
    v_team_id,
    v_status
  from public.stock_transfer_team_operations sto
  where sto.tenant_id = new.tenant_id
    and sto.transfer_id = new.id
  limit 1;

  new.operation_event_id := public.build_stock_transfer_operation_event_id(
    p_tenant_id => new.tenant_id,
    p_entry_date => new.entry_date,
    p_project_id => new.project_id,
    p_status => coalesce(v_status, new.movement_type),
    p_team_id => v_team_id
  );

  return new;
end;
$$;

create or replace function public.sync_team_stock_operation_event_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_internal_update text;
begin
  v_previous_internal_update := current_setting('app.stock_transfer_internal_update', true);
  perform set_config('app.stock_transfer_internal_update', 'true', true);

  if tg_op = 'DELETE' then
    update public.stock_transfers transfer
    set operation_event_id = public.build_stock_transfer_operation_event_id(
      p_tenant_id => transfer.tenant_id,
      p_entry_date => transfer.entry_date,
      p_project_id => transfer.project_id,
      p_status => transfer.movement_type,
      p_team_id => null
    )
    where transfer.tenant_id = old.tenant_id
      and transfer.id = old.transfer_id;

    perform set_config('app.stock_transfer_internal_update', coalesce(v_previous_internal_update, 'false'), true);
    return old;
  end if;

  update public.stock_transfers transfer
  set operation_event_id = public.build_stock_transfer_operation_event_id(
    p_tenant_id => transfer.tenant_id,
    p_entry_date => transfer.entry_date,
    p_project_id => transfer.project_id,
    p_status => coalesce(nullif(btrim(coalesce(new.operation_kind, '')), ''), transfer.movement_type),
    p_team_id => new.team_id
  )
  where transfer.tenant_id = new.tenant_id
    and transfer.id = new.transfer_id;

  perform set_config('app.stock_transfer_internal_update', coalesce(v_previous_internal_update, 'false'), true);
  return new;
end;
$$;

drop trigger if exists trg_stock_transfers_operation_event_id on public.stock_transfers;
create trigger trg_stock_transfers_operation_event_id
before insert or update of tenant_id, entry_date, project_id, movement_type
on public.stock_transfers
for each row
execute function public.apply_stock_transfer_operation_event_id();

drop trigger if exists trg_stock_transfer_team_operations_event_id on public.stock_transfer_team_operations;
create trigger trg_stock_transfer_team_operations_event_id
after insert or update of tenant_id, transfer_id, team_id, operation_kind or delete
on public.stock_transfer_team_operations
for each row
execute function public.sync_team_stock_operation_event_id();

select set_config('app.stock_transfer_internal_update', 'true', true);

with resolved_events as (
  select
    transfer.id,
    public.build_stock_transfer_operation_event_id(
      p_tenant_id => transfer.tenant_id,
      p_entry_date => transfer.entry_date,
      p_project_id => transfer.project_id,
      p_status => coalesce(nullif(btrim(coalesce(team_operation.operation_kind, '')), ''), transfer.movement_type),
      p_team_id => team_operation.team_id
    ) as operation_event_id
  from public.stock_transfers transfer
  left join public.stock_transfer_team_operations team_operation
    on team_operation.tenant_id = transfer.tenant_id
   and team_operation.transfer_id = transfer.id
)
update public.stock_transfers transfer
set operation_event_id = resolved_events.operation_event_id
from resolved_events
where transfer.id = resolved_events.id
  and transfer.operation_event_id is distinct from resolved_events.operation_event_id;

select set_config('app.stock_transfer_internal_update', 'false', true);

revoke all on function public.build_stock_transfer_operation_event_id(uuid, date, uuid, text, uuid) from public;
revoke all on function public.build_stock_transfer_operation_event_id(uuid, date, uuid, text, uuid) from anon;
revoke all on function public.build_stock_transfer_operation_event_id(uuid, date, uuid, text, uuid) from authenticated;
grant execute on function public.build_stock_transfer_operation_event_id(uuid, date, uuid, text, uuid) to service_role;

revoke all on function public.apply_stock_transfer_operation_event_id() from public;
revoke all on function public.apply_stock_transfer_operation_event_id() from anon;
revoke all on function public.apply_stock_transfer_operation_event_id() from authenticated;

revoke all on function public.sync_team_stock_operation_event_id() from public;
revoke all on function public.sync_team_stock_operation_event_id() from anon;
revoke all on function public.sync_team_stock_operation_event_id() from authenticated;
