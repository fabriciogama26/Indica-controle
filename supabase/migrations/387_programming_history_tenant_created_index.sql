-- 387_programming_history_tenant_created_index.sql
-- Sustenta a leitura de historico de Estado Trabalho usada pela Medicao contra
-- programming_history, sempre filtrada por tenant e ordenada por created_at.

create index if not exists idx_programming_history_tenant_created
  on public.programming_history (tenant_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'programming_history'
      and indexname = 'idx_programming_history_tenant_created'
  ) then
    raise exception '387: indice idx_programming_history_tenant_created nao foi criado.';
  end if;
end;
$$;
