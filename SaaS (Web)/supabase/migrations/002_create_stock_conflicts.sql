-- 002_create_stock_conflicts.sql
-- Conflitos de estoque para tratamento no SaaS (cabecalho + itens).
create table if not exists public.stock_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id uuid,
  data timestamptz,
  projeto text,
  requisitor text,
  usuario text,
  tipo_operacao text,
  observacao text,
  reason text,
  details jsonb,
  source text,
  device_id text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_requisicao_id uuid
);

create table if not exists public.stock_conflict_items (
  id uuid primary key default gen_random_uuid(),
  conflict_id uuid not null references public.stock_conflicts(id) on delete cascade,
  tenant_id uuid not null,
  material_id uuid references public.materials(id),
  codigo text,
  descricao text,
  qty_requested numeric not null,
  qty_new numeric,
  status text not null default 'KEEP',
  saldo_at_conflict numeric,
  created_at timestamptz not null default now()
);
