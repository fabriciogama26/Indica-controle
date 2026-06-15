-- 240_merge_split_stock_transfer_import_batches.sql
-- Une lotes historicos que a migration 239 separou por segundo durante a importacao sequencial.

select set_config('app.stock_transfer_internal_update', 'true', true);

alter table public.stock_transfers
  disable trigger trg_stock_transfers_audit;

with eligible_transfers as (
  select
    transfer.id,
    transfer.tenant_id,
    transfer.created_by,
    transfer.created_at,
    transfer.movement_type,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_date,
    transfer.direct_purchase,
    transfer.operation_purpose,
    transfer.balance_correction_reason,
    transfer.operation_batch_id,
    (
      substr(per_second_hash, 1, 8) || '-' ||
      substr(per_second_hash, 9, 4) || '-' ||
      substr(per_second_hash, 13, 4) || '-' ||
      substr(per_second_hash, 17, 4) || '-' ||
      substr(per_second_hash, 21, 12)
    )::uuid as migration_239_batch_id
  from public.stock_transfers transfer
  cross join lateral (
    select md5(concat_ws(
      '|',
      transfer.tenant_id::text,
      transfer.created_by::text,
      date_trunc('second', transfer.created_at)::text,
      transfer.movement_type,
      transfer.from_stock_center_id::text,
      transfer.to_stock_center_id::text,
      coalesce(transfer.project_id::text, ''),
      transfer.entry_date::text,
      transfer.direct_purchase::text,
      transfer.operation_purpose,
      coalesce(transfer.balance_correction_reason, '')
    )) as per_second_hash
  ) hash_source
  where transfer.created_by is not null
    and not exists (
      select 1
      from public.stock_transfer_team_operations team_operation
      where team_operation.tenant_id = transfer.tenant_id
        and team_operation.transfer_id = transfer.id
    )
    and not exists (
      select 1
      from public.stock_transfer_reversals reversal
      where reversal.tenant_id = transfer.tenant_id
        and reversal.reversal_stock_transfer_id = transfer.id
    )
    and not exists (
      select 1
      from public.stock_transfer_item_reversals item_reversal
      where item_reversal.tenant_id = transfer.tenant_id
        and item_reversal.reversal_stock_transfer_id = transfer.id
    )
    and (
      select count(*)
      from public.stock_transfer_items item
      where item.tenant_id = transfer.tenant_id
        and item.stock_transfer_id = transfer.id
    ) = 1
),
historical_transfers as (
  select eligible.*
  from eligible_transfers eligible
  where eligible.operation_batch_id is null
     or eligible.operation_batch_id = eligible.migration_239_batch_id
),
ordered_transfers as (
  select
    historical.*,
    lag(historical.created_at) over (
      partition by
        historical.tenant_id,
        historical.created_by,
        historical.movement_type,
        historical.from_stock_center_id,
        historical.to_stock_center_id,
        historical.project_id,
        historical.entry_date,
        historical.direct_purchase,
        historical.operation_purpose,
        historical.balance_correction_reason
      order by historical.created_at, historical.id
    ) as previous_created_at
  from historical_transfers historical
),
numbered_islands as (
  select
    ordered.*,
    sum(
      case
        when ordered.previous_created_at is null
          or ordered.created_at - ordered.previous_created_at > interval '2 seconds'
        then 1
        else 0
      end
    ) over (
      partition by
        ordered.tenant_id,
        ordered.created_by,
        ordered.movement_type,
        ordered.from_stock_center_id,
        ordered.to_stock_center_id,
        ordered.project_id,
        ordered.entry_date,
        ordered.direct_purchase,
        ordered.operation_purpose,
        ordered.balance_correction_reason
      order by ordered.created_at, ordered.id
      rows between unbounded preceding and current row
    ) as island_number
  from ordered_transfers ordered
),
resolved_islands as (
  select
    numbered.tenant_id,
    numbered.created_by,
    numbered.movement_type,
    numbered.from_stock_center_id,
    numbered.to_stock_center_id,
    numbered.project_id,
    numbered.entry_date,
    numbered.direct_purchase,
    numbered.operation_purpose,
    numbered.balance_correction_reason,
    numbered.island_number,
    min(numbered.created_at) as first_created_at,
    max(numbered.created_at) as last_created_at,
    count(*) as transfer_count
  from numbered_islands numbered
  group by
    numbered.tenant_id,
    numbered.created_by,
    numbered.movement_type,
    numbered.from_stock_center_id,
    numbered.to_stock_center_id,
    numbered.project_id,
    numbered.entry_date,
    numbered.direct_purchase,
    numbered.operation_purpose,
    numbered.balance_correction_reason,
    numbered.island_number
  having count(*) > 1
),
resolved_batches as (
  select
    island.*,
    md5(concat_ws(
      '|',
      island.tenant_id::text,
      island.created_by::text,
      island.movement_type,
      island.from_stock_center_id::text,
      island.to_stock_center_id::text,
      coalesce(island.project_id::text, ''),
      island.entry_date::text,
      island.direct_purchase::text,
      island.operation_purpose,
      coalesce(island.balance_correction_reason, ''),
      island.first_created_at::text,
      island.last_created_at::text
    )) as batch_hash
  from resolved_islands island
),
batch_members as (
  select
    numbered.id,
    (
      substr(batch.batch_hash, 1, 8) || '-' ||
      substr(batch.batch_hash, 9, 4) || '-' ||
      substr(batch.batch_hash, 13, 4) || '-' ||
      substr(batch.batch_hash, 17, 4) || '-' ||
      substr(batch.batch_hash, 21, 12)
    )::uuid as operation_batch_id
  from numbered_islands numbered
  join resolved_batches batch
    on batch.tenant_id = numbered.tenant_id
   and batch.created_by = numbered.created_by
   and batch.movement_type = numbered.movement_type
   and batch.from_stock_center_id = numbered.from_stock_center_id
   and batch.to_stock_center_id = numbered.to_stock_center_id
   and batch.project_id is not distinct from numbered.project_id
   and batch.entry_date = numbered.entry_date
   and batch.direct_purchase = numbered.direct_purchase
   and batch.operation_purpose = numbered.operation_purpose
   and batch.balance_correction_reason is not distinct from numbered.balance_correction_reason
   and batch.island_number = numbered.island_number
)
update public.stock_transfers transfer
set
  operation_batch_id = member.operation_batch_id,
  updated_at = transfer.updated_at
from batch_members member
where transfer.id = member.id
  and transfer.operation_batch_id is distinct from member.operation_batch_id;

alter table public.stock_transfers
  enable trigger trg_stock_transfers_audit;

select set_config('app.stock_transfer_internal_update', 'false', true);
