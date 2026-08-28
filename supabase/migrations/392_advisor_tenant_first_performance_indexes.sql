-- 392_advisor_tenant_first_performance_indexes.sql
-- Fecha a leva de recomendacoes do Supabase Advisor que apontava colunas
-- isoladas, reescrevendo-as no padrao multi-tenant do projeto.

create index if not exists idx_stock_transfer_team_operations_tenant_created
  on public.stock_transfer_team_operations (tenant_id, created_at desc);

create index if not exists idx_programming_tenant_execution_date
  on public.programming (tenant_id, execution_date);

create index if not exists idx_programming_tenant_project_execution_date
  on public.programming (tenant_id, project_id, execution_date);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'stock_transfer_team_operations'
      and indexname = 'idx_stock_transfer_team_operations_tenant_created'
  ) then
    raise exception '392: indice idx_stock_transfer_team_operations_tenant_created nao foi criado.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'programming'
      and indexname = 'idx_programming_tenant_execution_date'
  ) then
    raise exception '392: indice idx_programming_tenant_execution_date nao foi criado.';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'programming'
      and indexname = 'idx_programming_tenant_project_execution_date'
  ) then
    raise exception '392: indice idx_programming_tenant_project_execution_date nao foi criado.';
  end if;
end;
$$;
