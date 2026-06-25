-- 264_fix_billing_paid_value_legacy_not_null.sql
-- Corrige ambientes que ja aplicaram a 263, mas ainda possuem paid_value legado
-- como NOT NULL em project_billing_order_items.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'project_billing_order_items'
      and column_name = 'paid_value'
  ) then
    execute $sql$
      alter table public.project_billing_order_items
        alter column paid_value set default 0,
        alter column paid_value drop not null,
        drop constraint if exists project_billing_order_items_paid_value_check
    $sql$;
  end if;
end;
$$;

notify pgrst, 'reload schema';
