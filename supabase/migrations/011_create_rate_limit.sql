-- 011_create_rate_limit.sql
-- Infraestrutura de rate limit para Edge Functions como login e sync_run.

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  scope text not null,
  route text not null,
  identity_hash text not null,
  owner_id uuid,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rate_limit_events_lookup
  on public.rate_limit_events (scope, route, identity_hash, created_at desc);

create or replace function public.rate_limit_check_and_hit(
  p_scope text,
  p_route text,
  p_identity_hash text,
  p_owner_id uuid default null,
  p_ip_hash text default null,
  p_max_hits integer default 1,
  p_window_seconds integer default 30
)
returns table (
  allowed boolean,
  retry_after integer,
  hits integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz := v_now - make_interval(secs => greatest(p_window_seconds, 1));
  v_hits integer := 0;
  v_oldest timestamptz;
begin
  select count(*), min(created_at)
    into v_hits, v_oldest
  from public.rate_limit_events
  where scope = p_scope
    and route = p_route
    and identity_hash = p_identity_hash
    and created_at >= v_window_start;

  if v_hits >= greatest(p_max_hits, 1) then
    allowed := false;
    retry_after := greatest(1, ceil(extract(epoch from ((v_oldest + make_interval(secs => greatest(p_window_seconds, 1))) - v_now)))::integer);
    hits := v_hits;
    return next;
    return;
  end if;

  insert into public.rate_limit_events (scope, route, identity_hash, owner_id, ip_hash)
  values (p_scope, p_route, p_identity_hash, p_owner_id, p_ip_hash);

  allowed := true;
  retry_after := 0;
  hits := v_hits + 1;
  return next;
end;
$$;

revoke all on function public.rate_limit_check_and_hit(text, text, text, uuid, text, integer, integer) from public;
grant execute on function public.rate_limit_check_and_hit(text, text, text, uuid, text, integer, integer) to service_role;
