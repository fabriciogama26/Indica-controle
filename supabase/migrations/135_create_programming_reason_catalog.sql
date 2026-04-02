-- 135_create_programming_reason_catalog.sql
-- Cria catalogo unico de motivos da Programacao por tenant
-- (reutilizado em cancelamento, adiamento e reprogramacao).

create table if not exists public.programming_reason_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label_pt text not null,
  requires_notes boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_reason_catalog_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint programming_reason_catalog_label_not_blank_check
    check (nullif(btrim(coalesce(label_pt, '')), '') is not null),
  constraint programming_reason_catalog_sort_order_check
    check (sort_order >= 0),
  constraint programming_reason_catalog_tenant_code_key
    unique (tenant_id, code)
);

create index if not exists idx_programming_reason_catalog_tenant_active_order
  on public.programming_reason_catalog (tenant_id, is_active, sort_order, label_pt);

alter table if exists public.programming_reason_catalog enable row level security;

drop policy if exists programming_reason_catalog_tenant_select on public.programming_reason_catalog;
create policy programming_reason_catalog_tenant_select on public.programming_reason_catalog
for select
to authenticated
using (public.user_can_access_tenant(programming_reason_catalog.tenant_id));

drop policy if exists programming_reason_catalog_tenant_insert on public.programming_reason_catalog;
create policy programming_reason_catalog_tenant_insert on public.programming_reason_catalog
for insert
to authenticated
with check (public.user_can_access_tenant(programming_reason_catalog.tenant_id));

drop policy if exists programming_reason_catalog_tenant_update on public.programming_reason_catalog;
create policy programming_reason_catalog_tenant_update on public.programming_reason_catalog
for update
to authenticated
using (public.user_can_access_tenant(programming_reason_catalog.tenant_id))
with check (public.user_can_access_tenant(programming_reason_catalog.tenant_id));

drop trigger if exists trg_programming_reason_catalog_audit on public.programming_reason_catalog;
create trigger trg_programming_reason_catalog_audit
before insert or update on public.programming_reason_catalog
for each row execute function public.apply_audit_fields();

insert into public.programming_reason_catalog (
  tenant_id,
  code,
  label_pt,
  requires_notes,
  is_active,
  sort_order
)
select
  t.id as tenant_id,
  base.code,
  base.label_pt,
  base.requires_notes,
  true as is_active,
  base.sort_order
from public.tenants t
cross join (
  values
    ('MATERIAL_INDISPONIVEL', 'Material indisponivel', false, 10),
    ('EQUIPE_INDISPONIVEL', 'Equipe indisponivel', false, 20),
    ('CONFLITO_PRIORIDADE', 'Conflito de prioridade', false, 30),
    ('CONDICAO_CLIMATICA', 'Condicao climatica', false, 40),
    ('BLOQUEIO_CLIENTE', 'Bloqueio do cliente/local', false, 50),
    ('FALTA_AUTORIZACAO', 'Falta de autorizacao', false, 60),
    ('SEGURANCA_OPERACIONAL', 'Risco de seguranca operacional', false, 70),
    ('INTERFERENCIA_OPERACIONAL', 'Interferencia operacional', false, 80),
    ('EQUIPE_REALOCADA', 'Equipe realocada', false, 90),
    ('MATERIAL_NAO_ENTREGUE', 'Material nao entregue', false, 100),
    ('CLIENTE_SOLICITOU_NOVA_DATA', 'Cliente solicitou nova data', false, 110),
    ('AGUARDANDO_LIBERACAO', 'Aguardando liberacao', false, 120),
    ('AJUSTE_HORARIO', 'Ajuste de horario', false, 130),
    ('AJUSTE_EQUIPE', 'Ajuste de equipe', false, 140),
    ('AJUSTE_PRIORIDADE', 'Ajuste de prioridade', false, 150),
    ('ADEQUACAO_OPERACIONAL', 'Adequacao operacional', false, 160),
    ('CONFLITO_AGENDA', 'Conflito de agenda', false, 170),
    ('OTIMIZACAO_ROTA', 'Otimizacao de rota/sequencia', false, 180),
    ('OUTRO', 'Outro', true, 999)
) as base(code, label_pt, requires_notes, sort_order)
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  requires_notes = excluded.requires_notes,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();
