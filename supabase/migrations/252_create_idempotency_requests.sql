-- 252_create_idempotency_requests.sql
-- Cache de respostas para operacoes criticas com chave de idempotencia.
-- Evita processamento duplicado em retentativas de POST/PUT/PATCH.
-- TTL padrao: 24 horas. Acesso exclusivo por service_role (RLS sem policies publicas).

create table if not exists public.idempotency_requests (
  id          uuid        default gen_random_uuid() primary key,
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  idempotency_key text    not null
    check (length(idempotency_key) between 1 and 255),
  endpoint    text        not null
    check (length(endpoint) between 1 and 500),
  response_status integer not null
    check (response_status between 100 and 599),
  response_body   jsonb   not null,
  created_at  timestamptz default now() not null,
  expires_at  timestamptz not null,

  constraint idempotency_requests_unique
    unique (tenant_id, idempotency_key, endpoint)
);

alter table public.idempotency_requests enable row level security;
-- Sem policies para authenticated: idempotencia e controle de sistema,
-- acessada apenas via service_role (que ignora RLS por definicao do Supabase).

-- Indice para limpeza periodica de registros expirados
create index idx_idempotency_requests_expires_at
  on public.idempotency_requests (expires_at);

comment on table public.idempotency_requests is
  'Cache de respostas para operacoes com chave de idempotencia. TTL: 24h. Acesso exclusivo service_role.';

-- Validacao: tabela foi criada e RLS ativo
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'idempotency_requests'
  ) then
    raise exception 'Migration 252: tabela idempotency_requests nao foi criada.';
  end if;
end;
$$;
