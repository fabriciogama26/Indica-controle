-- 139_deactivate_blocked_stock_reversal_reasons.sql
-- Remove do fluxo operacional de estorno os motivos bloqueados pelo negocio.

update public.stock_transfer_reversal_reason_catalog
set
  is_active = false,
  updated_at = now()
where code in ('OPERATION_CANCELED', 'OTHER')
  and is_active = true;
