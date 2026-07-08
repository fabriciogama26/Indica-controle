-- 294_create_stock_requisition_module.sql
-- Cria a base multi-tenant do fluxo de Requisicao com Atendimento no Almoxarifado.
-- Etapa 1 (schema). RPCs ficam na migration 295 e o cadastro de paginas na 296.
--
-- Modelo:
--   stock_requisition_requests       -> cabecalho do pedido (nao toca saldo).
--   stock_requisition_request_items  -> itens do pedido (solicitado x atendido).
--   stock_requisition_adjustment_reason_catalog -> motivos de Reduzir/Recusar.
-- O saldo so se move no atendimento (migration 294), reusando save_team_stock_operation_record.

-- 1) Catalogo de motivos de nao atendimento (Reduzir/Recusar). Global, como o catalogo de estorno.
create table if not exists public.stock_requisition_adjustment_reason_catalog (
  code text primary key,
  label_pt text not null,
  requires_notes boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_requisition_reason_code_not_blank check (nullif(btrim(code), '') is not null),
  constraint stock_requisition_reason_label_not_blank check (nullif(btrim(label_pt), '') is not null)
);

insert into public.stock_requisition_adjustment_reason_catalog (code, label_pt, requires_notes, sort_order)
values
  ('INSUFFICIENT_STOCK', 'Saldo insuficiente', false, 10),
  ('DAMAGED_MATERIAL', 'Material avariado', false, 20),
  ('PARTIAL_SEPARATION', 'Separacao parcial', false, 30),
  ('TRANSPORT_LIMIT', 'Limite de transporte', false, 40),
  ('REQUEST_DIVERGENCE', 'Divergencia de pedido', false, 50),
  ('BLOCKED_MATERIAL', 'Material bloqueado', false, 60),
  ('OTHER', 'Outro', true, 900)
on conflict (code) do update
set
  label_pt = excluded.label_pt,
  requires_notes = excluded.requires_notes,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- 2) Cabecalho do pedido de requisicao.
create table if not exists public.stock_requisition_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  stock_center_id uuid not null,
  team_id uuid not null,
  project_id uuid not null,
  request_date date not null,
  requested_by uuid null,
  requested_by_name_snapshot text null,
  status text not null default 'PENDING',
  resultado_atendimento text null,
  claimed_by uuid null,
  claimed_by_name_snapshot text null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  atendido_por uuid null,
  atendido_em timestamptz null,
  cancelado_por uuid null,
  cancelado_em timestamptz null,
  notes text null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_requisition_requests_id_tenant_key unique (id, tenant_id),
  constraint stock_requisition_requests_status_check
    check (status in ('PENDING', 'EM_ATENDIMENTO', 'ENCERRADO', 'CANCELADO')),
  constraint stock_requisition_requests_resultado_check
    check (
      resultado_atendimento is null
      or resultado_atendimento in ('TOTAL', 'PARCIAL', 'RECUSADO')
    ),
  constraint stock_requisition_requests_center_tenant_fk
    foreign key (stock_center_id, tenant_id)
    references public.stock_centers (id, tenant_id),
  constraint stock_requisition_requests_team_tenant_fk
    foreign key (team_id, tenant_id)
    references public.teams (id, tenant_id),
  constraint stock_requisition_requests_project_tenant_fk
    foreign key (project_id, tenant_id)
    references public.project (id, tenant_id)
);

create index if not exists idx_stock_requisition_requests_tenant_status
  on public.stock_requisition_requests (tenant_id, status, request_date desc);

create index if not exists idx_stock_requisition_requests_tenant_team_project_date
  on public.stock_requisition_requests (tenant_id, team_id, project_id, request_date);

-- 3) Itens do pedido.
create table if not exists public.stock_requisition_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  tenant_id uuid not null references public.tenants(id),
  material_id uuid not null,
  quantity_requested numeric not null,
  quantity_fulfilled numeric null,
  item_status text not null default 'PENDING',
  unfulfilled_reason_code text null,
  serial_number text null,
  lot_code text null,
  notes text null,
  resulting_transfer_item_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_requisition_request_items_id_tenant_key unique (id, tenant_id),
  constraint stock_requisition_request_items_request_fk
    foreign key (request_id, tenant_id)
    references public.stock_requisition_requests (id, tenant_id) on delete cascade,
  constraint stock_requisition_request_items_material_tenant_fk
    foreign key (material_id, tenant_id)
    references public.materials (id, tenant_id),
  constraint stock_requisition_request_items_reason_fk
    foreign key (unfulfilled_reason_code)
    references public.stock_requisition_adjustment_reason_catalog (code),
  constraint stock_requisition_request_items_qty_requested_positive
    check (quantity_requested > 0),
  constraint stock_requisition_request_items_qty_fulfilled_valid
    check (quantity_fulfilled is null or quantity_fulfilled >= 0),
  constraint stock_requisition_request_items_status_check
    check (item_status in ('PENDING', 'ACCEPTED', 'REDUCED', 'REJECTED'))
);

create index if not exists idx_stock_requisition_request_items_request
  on public.stock_requisition_request_items (tenant_id, request_id);

create index if not exists idx_stock_requisition_request_items_material
  on public.stock_requisition_request_items (tenant_id, material_id);

create index if not exists idx_stock_requisition_request_items_resulting_transfer_item
  on public.stock_requisition_request_items (tenant_id, resulting_transfer_item_id)
  where resulting_transfer_item_id is not null;

-- 4) RLS. Leitura pelo tenant; escrita somente pelas RPCs (service_role).
alter table public.stock_requisition_requests enable row level security;
alter table public.stock_requisition_request_items enable row level security;
alter table public.stock_requisition_adjustment_reason_catalog enable row level security;

drop policy if exists stock_requisition_requests_select on public.stock_requisition_requests;
create policy stock_requisition_requests_select
  on public.stock_requisition_requests
  for select
  to authenticated
  using (public.user_can_access_tenant(stock_requisition_requests.tenant_id));

drop policy if exists stock_requisition_request_items_select on public.stock_requisition_request_items;
create policy stock_requisition_request_items_select
  on public.stock_requisition_request_items
  for select
  to authenticated
  using (public.user_can_access_tenant(stock_requisition_request_items.tenant_id));

drop policy if exists stock_requisition_reason_select on public.stock_requisition_adjustment_reason_catalog;
create policy stock_requisition_reason_select
  on public.stock_requisition_adjustment_reason_catalog
  for select
  to authenticated
  using (true);

-- Escrita direta bloqueada para authenticated: nenhuma policy de insert/update/delete e criada,
-- portanto a gravacao ocorre apenas pelas RPCs SECURITY DEFINER (migration 294).

comment on table public.stock_requisition_requests is
  'Pedidos de requisicao de material (etapa de solicitacao). Nao movimenta saldo; o atendimento gera a REQUISITION real.';
comment on table public.stock_requisition_request_items is
  'Itens do pedido de requisicao com quantidade solicitada e atendida; vinculo com o item do ledger via resulting_transfer_item_id.';
