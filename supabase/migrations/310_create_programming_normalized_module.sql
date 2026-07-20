-- 310_create_programming_normalized_module.sql
-- Cria o schema normalizado da NOVA tela de Programacao (ao lado da atual).
-- Modelo: etapa (programming) como pai; equipe (programming_team) como filha;
-- atividades e documentos tambem como filhas. Elimina a duplicacao por equipe que
-- hoje exige triggers de sincronizacao em cima de project_programming (migrations
-- 267, 273, 275-282). Fonte da verdade: docs/planejamento/Spec_Nova_Programacao_Modelo_Normalizado.md.
--
-- Escopo desta migration: SOMENTE schema (tabelas + RLS + indices), tabelas nascem
-- vazias. Nao migra dado de project_programming (isso fica para uma tarefa
-- separada, com auditoria/homologacao propria). RPCs ficam na migration 311.
-- project_programming e a tela programacao-simples continuam intocadas e em
-- producao sem nenhuma mudanca.
--
-- Catalogos reaproveitados sem alteracao estrutural: programming_sgd_types,
-- programming_eq_catalog, programming_work_completion_catalog,
-- programming_reason_catalog, programming_support_items, service_activities.
-- BENEFICIO_ATINGIDO entra como codigo NOVO no catalogo de Estado Trabalho —
-- nao renomeia nem remove o codigo com typo (PARCIAL_PLANEJADO_BENFICIO_ATINGIDO)
-- que programacao-simples ainda usa em producao.

-- =============================================================================
-- 1) programming (a etapa) — uma linha por (tenant, projeto, data)
-- =============================================================================
create table if not exists public.programming (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null,
  execution_date date not null,

  -- Classificacao derivada da posicao (secao 5 do spec). Escrita so por RPC
  -- (reclassify_project_programming_stages), nunca por edicao direta do usuario.
  etapa_number integer null,
  etapa_unica boolean not null default false,
  etapa_final boolean not null default false,

  -- Eixo 1 — agenda da etapa.
  status text not null default 'PROGRAMADA',
  -- Eixo 2 — execucao da etapa (catalogo por tenant; em branco = etapa a fazer).
  work_completion_status text null,

  -- Cadastro operacional (por etapa; base herdada + override, conforme secao 9).
  service_description text null,
  period text null,
  start_time time null,
  end_time time null,
  expected_minutes integer null,
  outage_start_time time null,
  outage_end_time time null,
  feeder text null,
  campo_eletrico text null,
  affected_customers integer null,
  sgd_type_id uuid null,
  electrical_eq_catalog_id uuid null,
  support text null,
  support_item_id uuid null,
  poste_qty numeric(14, 2) null,
  estrutura_qty numeric(14, 2) null,
  trafo_qty numeric(14, 2) null,
  rede_qty numeric(14, 2) null,
  note text null,

  -- Rastreio (secao 2/6/7 do spec).
  resolve_pendencia_de_id uuid null,
  copied_from_id uuid null,
  copy_batch_id uuid null,
  anticipated_by_id uuid null,
  anticipated_at timestamptz null,
  previous_work_completion_status text null,
  previous_operational_status text null,
  cancellation_reason text null,
  canceled_at timestamptz null,
  canceled_by uuid references public.app_users(id),

  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programming_id_tenant_key unique (id, tenant_id),
  constraint programming_tenant_project_date_key unique (tenant_id, project_id, execution_date),

  constraint programming_status_check
    check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA', 'ANTECIPADA')),
  constraint programming_period_check
    check (period is null or period in ('INTEGRAL', 'PARCIAL')),
  constraint programming_quantities_non_negative_check
    check (
      (poste_qty is null or poste_qty >= 0)
      and (estrutura_qty is null or estrutura_qty >= 0)
      and (trafo_qty is null or trafo_qty >= 0)
      and (rede_qty is null or rede_qty >= 0)
    ),

  -- Guarda de ETAPA ativa (equivalente a migration 275 hoje): NAO da para ser um
  -- CHECK constraint de coluna, porque uma etapa nasce sem classificacao (a
  -- classificacao so e resolvida pelo reclassify_project_programming_stages,
  -- chamado em um statement separado dentro da mesma transacao) e CHECK
  -- constraint no Postgres nao pode ser DEFERRABLE/checado so no commit. A
  -- invariante (toda etapa ativa fora de PENDENCIA esta em exatamente um estado
  -- de classificacao valido) e validada em runtime, como ultimo passo de
  -- reclassify_project_programming_stages (migration 311) — se alguma RPC
  -- chamar reclassify e a invariante nao fechar, a funcao lanca excecao e a
  -- transacao inteira da RPC sofre rollback.

  constraint programming_project_tenant_fk
    foreign key (project_id, tenant_id) references public.project (id, tenant_id),
  constraint programming_sgd_type_tenant_fk
    foreign key (tenant_id, sgd_type_id) references public.programming_sgd_types (tenant_id, id)
    on delete set null (sgd_type_id),
  constraint programming_eq_catalog_tenant_fk
    foreign key (electrical_eq_catalog_id, tenant_id) references public.programming_eq_catalog (id, tenant_id)
    on delete set null (electrical_eq_catalog_id),
  constraint programming_support_item_tenant_fk
    foreign key (support_item_id, tenant_id) references public.programming_support_items (id, tenant_id)
    on delete set null (support_item_id),
  constraint programming_work_completion_status_fk
    foreign key (tenant_id, work_completion_status) references public.programming_work_completion_catalog (tenant_id, code)
    on update cascade on delete restrict,
  constraint programming_resolve_pendencia_tenant_fk
    foreign key (resolve_pendencia_de_id, tenant_id) references public.programming (id, tenant_id)
    on delete set null (resolve_pendencia_de_id),
  constraint programming_copied_from_tenant_fk
    foreign key (copied_from_id, tenant_id) references public.programming (id, tenant_id)
    on delete set null (copied_from_id),
  constraint programming_anticipated_by_tenant_fk
    foreign key (anticipated_by_id, tenant_id) references public.programming (id, tenant_id)
    on delete set null (anticipated_by_id)
);

create index if not exists idx_programming_tenant_status_date
  on public.programming (tenant_id, status, execution_date desc);

create index if not exists idx_programming_tenant_work_completion_status
  on public.programming (tenant_id, work_completion_status);

comment on table public.programming is
  'Etapa da Programacao (modelo normalizado): uma linha por tenant+projeto+data. Pai de programming_team/programming_activity/programming_document.';

-- =============================================================================
-- 2) programming_team (a filha) — equipe alocada na etapa
-- =============================================================================
create table if not exists public.programming_team (
  id uuid primary key default gen_random_uuid(),
  programming_id uuid not null,
  tenant_id uuid not null references public.tenants(id),
  team_id uuid not null,
  status text not null default 'ATIVA',
  added_from_id uuid null,

  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programming_team_id_tenant_key unique (id, tenant_id),
  constraint programming_team_status_check
    check (status in ('ATIVA', 'REMOVIDA', 'TRANSFERIDA')),
  constraint programming_team_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id) on delete cascade,
  constraint programming_team_team_tenant_fk
    foreign key (team_id, tenant_id) references public.teams (id, tenant_id),
  constraint programming_team_added_from_tenant_fk
    foreign key (added_from_id, tenant_id) references public.programming_team (id, tenant_id)
    on delete set null (added_from_id)
);

-- Equipe repetida na MESMA etapa e duplicata pura (secao 5 do spec); so uma
-- alocacao ATIVA por (etapa, equipe) por vez — a equipe pode ser removida e
-- readicionada depois, gerando uma linha nova.
create unique index if not exists uq_programming_team_active_per_stage
  on public.programming_team (programming_id, team_id)
  where status = 'ATIVA';

create index if not exists idx_programming_team_tenant_programming
  on public.programming_team (tenant_id, programming_id);

create index if not exists idx_programming_team_tenant_team_status
  on public.programming_team (tenant_id, team_id, status);

comment on table public.programming_team is
  'Equipe alocada numa etapa da Programacao normalizada. Enxuta: so identidade + status de participacao.';

-- =============================================================================
-- 3) programming_activity (filha) — atividade (codigo + quantidade) da etapa
-- =============================================================================
create table if not exists public.programming_activity (
  id uuid primary key default gen_random_uuid(),
  programming_id uuid not null,
  tenant_id uuid not null references public.tenants(id),
  service_activity_id uuid not null,
  quantity numeric(14, 2) not null,
  is_active boolean not null default true,

  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programming_activity_id_tenant_key unique (id, tenant_id),
  constraint programming_activity_quantity_positive_check check (quantity > 0),
  constraint programming_activity_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id) on delete cascade,
  constraint programming_activity_service_activity_tenant_fk
    foreign key (service_activity_id, tenant_id) references public.service_activities (id, tenant_id)
);

create unique index if not exists uq_programming_activity_active_per_stage
  on public.programming_activity (programming_id, service_activity_id)
  where is_active = true;

create index if not exists idx_programming_activity_tenant_programming
  on public.programming_activity (tenant_id, programming_id);

comment on table public.programming_activity is
  'Atividade (codigo + quantidade) de uma etapa da Programacao normalizada. Substitui a replicacao por equipe do modelo antigo.';

-- =============================================================================
-- 4) programming_document (filha) — SGD / PI / PEP da etapa
-- =============================================================================
create table if not exists public.programming_document (
  id uuid primary key default gen_random_uuid(),
  programming_id uuid not null,
  tenant_id uuid not null references public.tenants(id),
  document_type text not null,
  number text null,
  included_at date null,
  delivered_at date null,

  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programming_document_id_tenant_key unique (id, tenant_id),
  constraint programming_document_type_check check (document_type in ('SGD', 'PI', 'PEP')),
  constraint programming_document_unique_type unique (programming_id, document_type),
  constraint programming_document_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id) on delete cascade
);

create index if not exists idx_programming_document_tenant_programming
  on public.programming_document (tenant_id, programming_id);

comment on table public.programming_document is
  'Documento (SGD/PI/PEP) de uma etapa da Programacao normalizada. Substitui as 9 colunas inline + sync por Projeto+Data/janela LV do modelo antigo.';

-- =============================================================================
-- 5) programming_history — historico da etapa/equipe (RECLASSIFY_STAGE, CREATE,
--    CANCEL, POSTPONE, ADD_TEAM, REMOVE_TEAM, COMPLETE, REOPEN...)
-- =============================================================================
create table if not exists public.programming_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  programming_id uuid not null,
  programming_team_id uuid null,
  action_type text not null,
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),

  constraint programming_history_action_type_not_blank_check
    check (nullif(btrim(action_type), '') is not null),
  constraint programming_history_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id) on delete cascade,
  constraint programming_history_programming_team_tenant_fk
    foreign key (programming_team_id, tenant_id) references public.programming_team (id, tenant_id)
    on delete set null (programming_team_id)
);

create index if not exists idx_programming_history_tenant_programming_created
  on public.programming_history (tenant_id, programming_id, created_at desc);

comment on table public.programming_history is
  'Historico de acoes sobre etapa/equipe da Programacao normalizada.';

-- =============================================================================
-- 6) RLS — leitura pelo tenant; escrita somente pelas RPCs SECURITY DEFINER
--    (migration 311), rodando como service_role. Nenhuma policy de
--    insert/update/delete e criada (mesmo padrao da migration 294).
-- =============================================================================
alter table public.programming enable row level security;
alter table public.programming_team enable row level security;
alter table public.programming_activity enable row level security;
alter table public.programming_document enable row level security;
alter table public.programming_history enable row level security;

drop policy if exists programming_select on public.programming;
create policy programming_select
  on public.programming
  for select
  to authenticated
  using (public.user_can_access_tenant(programming.tenant_id));

drop policy if exists programming_team_select on public.programming_team;
create policy programming_team_select
  on public.programming_team
  for select
  to authenticated
  using (public.user_can_access_tenant(programming_team.tenant_id));

drop policy if exists programming_activity_select on public.programming_activity;
create policy programming_activity_select
  on public.programming_activity
  for select
  to authenticated
  using (public.user_can_access_tenant(programming_activity.tenant_id));

drop policy if exists programming_document_select on public.programming_document;
create policy programming_document_select
  on public.programming_document
  for select
  to authenticated
  using (public.user_can_access_tenant(programming_document.tenant_id));

drop policy if exists programming_history_select on public.programming_history;
create policy programming_history_select
  on public.programming_history
  for select
  to authenticated
  using (public.user_can_access_tenant(programming_history.tenant_id));

-- =============================================================================
-- 7) Catalogo de Estado Trabalho: novo codigo BENEFICIO_ATINGIDO (parcial
--    informativo, secao 4 do spec). Nao toca no codigo com typo existente
--    (PARCIAL_PLANEJADO_BENFICIO_ATINGIDO), que programacao-simples ainda usa.
-- =============================================================================
insert into public.programming_work_completion_catalog (tenant_id, code, label_pt, is_active, sort_order)
select t.id, 'BENEFICIO_ATINGIDO', 'Beneficio atingido', true, 45
from public.tenants t
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = true,
  updated_at = now();
