-- 239_backfill_stock_transfer_import_batches.sql
-- Reconstrui lotes historicos de importacao com uma assinatura conservadora.

select set_config('app.stock_transfer_internal_update', 'true', true);

alter table public.stock_transfers
  disable trigger trg_stock_transfers_audit;

with eligible_transfers as (
  select
    transfer.id,
    transfer.tenant_id,
    transfer.created_by,
    date_trunc('second', transfer.created_at) as created_second,
    transfer.movement_type,
    transfer.from_stock_center_id,
    transfer.to_stock_center_id,
    transfer.project_id,
    transfer.entry_date,
    transfer.direct_purchase,
    transfer.operation_purpose,
    transfer.balance_correction_reason
  from public.stock_transfers transfer
  where transfer.operation_batch_id is null
    and transfer.created_by is not null
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
candidate_groups as (
  select
    eligible.tenant_id,
    eligible.created_by,
    eligible.created_second,
    eligible.movement_type,
    eligible.from_stock_center_id,
    eligible.to_stock_center_id,
    eligible.project_id,
    eligible.entry_date,
    eligible.direct_purchase,
    eligible.operation_purpose,
    eligible.balance_correction_reason,
    md5(concat_ws(
      '|',
      eligible.tenant_id::text,
      eligible.created_by::text,
      eligible.created_second::text,
      eligible.movement_type,
      eligible.from_stock_center_id::text,
      eligible.to_stock_center_id::text,
      coalesce(eligible.project_id::text, ''),
      eligible.entry_date::text,
      eligible.direct_purchase::text,
      eligible.operation_purpose,
      coalesce(eligible.balance_correction_reason, '')
    )) as group_hash
  from eligible_transfers eligible
  group by
    eligible.tenant_id,
    eligible.created_by,
    eligible.created_second,
    eligible.movement_type,
    eligible.from_stock_center_id,
    eligible.to_stock_center_id,
    eligible.project_id,
    eligible.entry_date,
    eligible.direct_purchase,
    eligible.operation_purpose,
    eligible.balance_correction_reason
  having count(*) > 1
),
resolved_groups as (
  select
    candidate_groups.*,
    (
      substr(group_hash, 1, 8) || '-' ||
      substr(group_hash, 9, 4) || '-' ||
      substr(group_hash, 13, 4) || '-' ||
      substr(group_hash, 17, 4) || '-' ||
      substr(group_hash, 21, 12)
    )::uuid as operation_batch_id
  from candidate_groups
)
update public.stock_transfers transfer
set
  operation_batch_id = resolved_groups.operation_batch_id,
  updated_at = transfer.updated_at
from resolved_groups
where transfer.operation_batch_id is null
  and transfer.tenant_id = resolved_groups.tenant_id
  and transfer.created_by = resolved_groups.created_by
  and date_trunc('second', transfer.created_at) = resolved_groups.created_second
  and transfer.movement_type = resolved_groups.movement_type
  and transfer.from_stock_center_id = resolved_groups.from_stock_center_id
  and transfer.to_stock_center_id = resolved_groups.to_stock_center_id
  and transfer.project_id is not distinct from resolved_groups.project_id
  and transfer.entry_date = resolved_groups.entry_date
  and transfer.direct_purchase = resolved_groups.direct_purchase
  and transfer.operation_purpose = resolved_groups.operation_purpose
  and transfer.balance_correction_reason is not distinct from resolved_groups.balance_correction_reason
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
  ) = 1;

select set_config('app.stock_transfer_internal_update', 'false', true);

alter table public.stock_transfers
  enable trigger trg_stock_transfers_audit;
