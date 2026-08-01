-- 352_harden_idempotency_requests_with_hash_and_actor.sql
-- Endurece idempotency_requests para bater com guia_backend.md regra 17:
-- chave persistida por tenant + usuario + rota + hash do request; nao pode
-- ser reutilizada com payload diferente.
--
-- Ate aqui (migration 252) a chave era unica apenas por (tenant_id,
-- idempotency_key, endpoint) e nao existia hash do corpo da requisicao —
-- uma colisao de chave (bug de geracao no frontend, nao intencional)
-- fazia o backend devolver silenciosamente a resposta de OUTRA operacao.

alter table public.idempotency_requests
  add column if not exists actor_user_id uuid references public.app_users(id) on delete set null;

alter table public.idempotency_requests
  add column if not exists request_hash text
    check (request_hash is null or length(request_hash) between 1 and 128);

comment on column public.idempotency_requests.actor_user_id is
  'Usuario (app_users.id) que originou a chave de idempotencia. Nulo apenas em registros anteriores a esta migration (TTL 24h, expiram naturalmente).';
comment on column public.idempotency_requests.request_hash is
  'sha256 hex do corpo bruto da requisicao. Usado para detectar reuso da mesma chave com payload diferente (resposta 409, nunca replay silencioso).';

alter table public.idempotency_requests
  drop constraint if exists idempotency_requests_unique;

alter table public.idempotency_requests
  add constraint idempotency_requests_unique
  unique (tenant_id, actor_user_id, idempotency_key, endpoint);

-- Validacao: colunas novas e constraint aplicadas
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'idempotency_requests' and column_name = 'actor_user_id'
  ) then
    raise exception 'Migration 352: coluna actor_user_id nao foi criada.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'idempotency_requests' and column_name = 'request_hash'
  ) then
    raise exception 'Migration 352: coluna request_hash nao foi criada.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'idempotency_requests_unique'
  ) then
    raise exception 'Migration 352: constraint idempotency_requests_unique nao foi recriada.';
  end if;
end;
$$;
