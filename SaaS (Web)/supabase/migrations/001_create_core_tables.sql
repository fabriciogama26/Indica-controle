-- 001_create_core_tables.sql
-- Core tables para materiais, saldo, requisicoes e movimentos.
create extension if not exists pgcrypto;

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  codigo text not null,
  descricao text not null,
  umb text,
  tipo text,
  lp text,
  serial text,
  unique (tenant_id, codigo)
);

create table if not exists public.inventory_balance (
  tenant_id uuid not null,
  material_id uuid not null references public.materials(id),
  qty_on_hand numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, material_id)
);

create table if not exists public.requisicoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_request_id uuid not null,
  requisitor text,
  projeto text,
  usuario text,
  data timestamptz,
  tipo_operacao text,
  observacao text,
  origem text,
  device_id text,
  created_at timestamptz not null default now(),
  status text not null default 'APLICADA',
  unique (tenant_id, client_request_id)
);

create table if not exists public.requisicao_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  requisicao_id uuid not null references public.requisicoes(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  codigo text,
  descricao text,
  umb text,
  tipo text,
  lp text,
  serial text,
  quantidade numeric not null,
  valor_unitario numeric
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  material_id uuid not null references public.materials(id),
  qty numeric not null,
  created_at timestamptz not null default now(),
  source text,
  request_id uuid,
  requisicao_id uuid references public.requisicoes(id),
  status text not null default 'APPLIED',
  unique (tenant_id, request_id, material_id)
);
