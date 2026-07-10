-- 303_add_query_performance_indexes.sql
-- Fecha parte objetiva dos achados de Query Performance/Index Advisor.
--
-- Os indices abaixo seguem o padrao multi-tenant do projeto: `tenant_id` vem antes
-- dos filtros/ordenacoes observados. As sugestoes cruas do Advisor indicavam
-- colunas isoladas, mas as queries reais filtram por tenant.

create index if not exists idx_project_programming_history_tenant_action_programming_created
  on public.project_programming_history (tenant_id, action_type, programming_id, created_at desc);

create index if not exists idx_project_measurement_orders_tenant_exec_updated
  on public.project_measurement_orders (tenant_id, execution_date desc, updated_at desc);

create index if not exists idx_project_tenant_active_test_deadline
  on public.project (tenant_id, is_active, is_test, execution_deadline);

create index if not exists idx_materials_tenant_active_codigo_id
  on public.materials (tenant_id, is_active, codigo, id);

-- O novo indice acima cobre o mesmo prefixo de busca/ordenacao e tambem evita
-- sort adicional por `id` na listagem de materiais.
drop index if exists public.idx_materials_tenant_active_codigo;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_project_programming_history_tenant_action_programming_created',
        'idx_project_measurement_orders_tenant_exec_updated',
        'idx_project_tenant_active_test_deadline',
        'idx_materials_tenant_active_codigo_id'
      )
    group by schemaname
    having count(*) = 4
  ) then
    raise exception '303: indices de performance esperados nao foram criados';
  end if;
end;
$$;
