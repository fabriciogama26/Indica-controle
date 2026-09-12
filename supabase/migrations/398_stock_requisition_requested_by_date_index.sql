-- 398_stock_requisition_requested_by_date_index.sql
-- Sustenta a aba "minhas requisicoes" sem aceitar a sugestao crua do Advisor
-- em `request_date`, preservando o padrao tenant-first.

create index if not exists idx_stock_requisition_requests_tenant_requested_date_created
  on public.stock_requisition_requests (tenant_id, requested_by, request_date desc, created_at desc)
  where requested_by is not null;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'stock_requisition_requests'
      and indexname = 'idx_stock_requisition_requests_tenant_requested_date_created'
  ) then
    raise exception '398: indice idx_stock_requisition_requests_tenant_requested_date_created nao foi criado.';
  end if;
end;
$$;
