-- 299_add_internal_rls_policies_for_system_tables.sql
-- Fecha alertas INFO do Supabase Advisor (RLS Enabled No Policy) em tabelas internas.
--
-- As tabelas abaixo sao infraestrutura do backend:
-- - idempotency_requests: cache de respostas de operacoes criticas, acessado via service_role.
-- - rate_limit_events: ledger de rate limit usado pela RPC rate_limit_check_and_hit.
--
-- Nao ha acesso operacional direto por anon/authenticated.

alter table public.idempotency_requests enable row level security;
alter table public.rate_limit_events enable row level security;

revoke all on table public.idempotency_requests from anon, authenticated;
revoke all on table public.rate_limit_events from anon, authenticated;

grant select, insert, update, delete on table public.idempotency_requests to service_role;
grant select, insert, update, delete on table public.rate_limit_events to service_role;

drop policy if exists idempotency_requests_service_role_all on public.idempotency_requests;
create policy idempotency_requests_service_role_all
  on public.idempotency_requests
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists rate_limit_events_service_role_all on public.rate_limit_events;
create policy rate_limit_events_service_role_all
  on public.rate_limit_events
  for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'idempotency_requests'
      and policyname = 'idempotency_requests_service_role_all'
  ) then
    raise exception '299: policy idempotency_requests_service_role_all nao foi criada';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'rate_limit_events'
      and policyname = 'rate_limit_events_service_role_all'
  ) then
    raise exception '299: policy rate_limit_events_service_role_all nao foi criada';
  end if;
end;
$$;
