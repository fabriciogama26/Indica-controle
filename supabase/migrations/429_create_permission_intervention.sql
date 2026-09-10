-- 429_create_permission_intervention.sql
-- Fase 1 da Permissao de Intervencao, parte 2 de 3: a entidade e suas filhas.
-- Escopo desta migration: SOMENTE schema (tabelas, constraints, indices, RLS).
-- As tabelas nascem vazias e as RPCs de escrita ficam na 430.
--
-- NADA AQUI TOCA A PROGRAMACAO. `programming` e lida por FK e nunca escrita
-- por este modulo. A fase que altera a Programacao (elementos bloqueados/corte
-- na etapa e o campo PI virando herdado) e separada e posterior.
--
-- IDENTIDADE E VINCULO (decisoes travadas com o usuario)
-- ---------------------------------------------------------------------------
-- O vinculo com a Programacao e SEMPRE pelo UUID da linha da etapa
-- (`programming_id`), nunca pelo rotulo calculado. `Etapa 2`, `Final` e `Unica`
-- sao derivados de posicao: o `reclassify_project_programming_stages` (311)
-- recalcula todos quando uma etapa e cancelada ou adiada, e a etapa que hoje e
-- `Etapa 3` vira `Etapa 2` amanha sem nada ter acontecido com ela. Usar rotulo
-- como chave ligaria a PI a outra etapa em silencio.
--
-- A BUSCA que estabelece o vinculo e por `tenant_id + project_id + work_date`,
-- restrita a etapa ATIVA (`PROGRAMADA`/`REPROGRAMADA`). O indice parcial
-- `programming_active_project_date_key` (migration 346) garante NO MAXIMO UMA
-- etapa ativa por projeto+data, entao essa busca nunca e ambigua. Etapa
-- CANCELADA, ADIADA ou ANTECIPADA pode coexistir na mesma data e NAO serve
-- para vincular.
--
-- INDEPENDENCIA
-- ---------------------------------------------------------------------------
-- Os campos abaixo sao da PI, nao da Programacao. Quando a PI nasce de uma
-- etapa, eles sao PRE-PREENCHIDOS e continuam editaveis; alterar a Programacao
-- depois nao altera a PI, e editar a PI nunca altera a Programacao. A
-- divergencia e calculada contra `source_programming_snapshot` e vira aviso,
-- nunca bloqueio.

-- =============================================================================
-- 1) `permission_intervention` — a PI
-- =============================================================================
create table if not exists public.permission_intervention (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),

  -- Identidade operacional: a PI e sempre de um projeto numa data.
  project_id uuid not null,
  work_date date not null,

  -- Vinculo com a etapa. Nulo enquanto a Programacao daquela data nao existir.
  programming_id uuid null,
  creation_source text not null,
  link_status text not null default 'PENDING',
  status text not null default 'DRAFT',

  -- Codigo. Ambos nulos ate a EMISSAO: rascunho abandonado nao pode queimar
  -- numero de documento oficial.
  pi_sequence bigint null,
  pi_code text null,

  -- Componentes escolhidos para compor o codigo. So sao exigidos quando ha mais
  -- de uma area ou tensao marcada; com uma so, a RPC resolve sozinha.
  primary_operation_area_code text null,
  primary_voltage_level_code text null,

  -- Secao 1 — Responsavel executante e contrato. Pre-preenchivel a partir de
  -- `contract`, e editavel na PI.
  manager_name text null,
  company_name text null,
  contract_number text null,
  manager_phone text null,
  manager_email text null,

  -- Secao 1 — Contato da distribuidora. A area de atuacao dele vive em
  -- `pi_operation_area_link` com `scope = 'CONTACT'` e e independente da area
  -- que compoe o codigo.
  utility_contact_name text null,
  utility_contact_phone text null,
  utility_contact_email text null,

  -- Secao 2 — Atividade e autorizacoes. `activity_description` aceita varias
  -- linhas. Plano de Trabalho, Autorizacao de Trabalho e PRE-APR sao SEMPRE
  -- manuais: nao existem na Programacao e nao devem ser buscados de la.
  activity_description text null,
  work_plan text null,
  live_work_authorization text null,
  pre_apr text null,
  emergency_authorization text null,

  -- Secao 3 — Datas e horarios. `work_date` acima e a data de execucao e
  -- participa do vinculo; aqui ficam os horarios e o termino.
  start_time time null,
  end_date date null,
  end_time time null,
  -- Segunda data/hora do formulario. O template nao traz rotulo para ela e a
  -- regra de negocio nao foi definida. Existe mapeada e vazia de proposito.
  secondary_date date null,
  secondary_start_time time null,

  -- Secao 4 — Local e rede.
  installation_description text null,
  feeder text null,
  address text null,
  coord_x text null,
  coord_y text null,
  -- Herdados da Programacao a partir da fase que adiciona esses campos la.
  -- Enquanto ela nao chega, sao preenchidos a mao na PI.
  blocked_elements text null,
  cut_elements text null,
  -- Nulo = nao informado, e deixa as DUAS caixas do documento vazias.
  has_interfering_installation boolean null,
  interfering_description text null,

  -- Secao 5 — Seguranca. O Plano de Emergencia nao e digitado na PI: vem de
  -- `pi_settings`. O snapshot e tirado na emissao, para o documento continuar
  -- reconstruivel depois de o plano mudar.
  traffic_instructions text null,
  emergency_plan_snapshot text null,
  emergency_plan_version_snapshot integer null,

  -- Secao 6 — Responsaveis. Cada FK carrega o nome do momento, no padrao que a
  -- migration 400 fixou em `programming_team`: renomear uma pessoa nao pode
  -- reescrever PI ja emitida.
  supervisor_person_id uuid null,
  supervisor_name_snapshot text null,
  supervisor_alternate_person_id uuid null,
  supervisor_alternate_name_snapshot text null,
  foreman_person_id uuid null,
  foreman_name_snapshot text null,
  foreman_alternate_person_id uuid null,
  foreman_alternate_name_snapshot text null,

  -- Secao 8 — Elaboracao e validacao.
  author_person_id uuid null,
  author_name_snapshot text null,
  prepared_at timestamptz null,
  validator_person_id uuid null,
  validator_name_snapshot text null,
  validated_at timestamptz null,
  observations text null,

  -- Fotografia da etapa no momento em que a PI nasceu dela. Base da comparacao
  -- Programacao x PI. Nulo quando a PI foi criada sem Programacao.
  source_programming_snapshot jsonb null,

  -- Emissao: qual template gerou o documento, na versao e no byte exatos.
  issued_at timestamptz null,
  issued_by uuid references public.app_users(id),
  issued_template_id uuid null,
  issued_template_version integer null,
  issued_template_checksum text null,

  cancellation_reason text null,
  cancelled_at timestamptz null,
  cancelled_by uuid references public.app_users(id),

  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint permission_intervention_id_tenant_key unique (id, tenant_id),

  constraint permission_intervention_creation_source_check
    check (creation_source in ('FROM_PROGRAMMING', 'MANUAL')),
  constraint permission_intervention_status_check
    check (status in ('DRAFT', 'READY', 'ISSUED', 'CANCELLED')),
  constraint permission_intervention_link_status_check
    check (link_status in ('LINKED', 'PENDING', 'ATTENTION')),

  -- PENDING e exatamente "sem etapa vinculada". ATTENTION e uma PI vinculada
  -- cuja etapa saiu do plano ativo — continua apontando para ela, porque o
  -- vinculo historico nao pode ser trocado em silencio.
  constraint permission_intervention_link_consistency_check
    check (
      case
        when link_status = 'PENDING' then programming_id is null
        else programming_id is not null
      end
    ),

  -- Codigo e sequencial andam juntos e so existem a partir da emissao.
  constraint permission_intervention_code_pairing_check
    check ((pi_code is null) = (pi_sequence is null)),
  constraint permission_intervention_issued_requires_code_check
    check (status <> 'ISSUED' or (pi_code is not null and issued_at is not null)),
  constraint permission_intervention_code_format_check
    check (pi_code is null or btrim(pi_code) <> ''),
  constraint permission_intervention_sequence_positive_check
    check (pi_sequence is null or pi_sequence > 0),

  constraint permission_intervention_cancelled_requires_reason_check
    check (
      status <> 'CANCELLED'
      or (cancelled_at is not null and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null)
    ),

  constraint permission_intervention_end_not_before_start_check
    check (end_date is null or end_date >= work_date),

  constraint permission_intervention_snapshot_object_check
    check (source_programming_snapshot is null or jsonb_typeof(source_programming_snapshot) = 'object'),

  constraint permission_intervention_issued_template_checksum_check
    check (issued_template_checksum is null or issued_template_checksum ~ '^[0-9a-f]{64}$'),

  constraint permission_intervention_project_tenant_fk
    foreign key (project_id, tenant_id) references public.project (id, tenant_id),
  -- `on delete set null` seria errado aqui: a etapa nao e apagada, e sim
  -- cancelada. A FK e restritiva de proposito.
  constraint permission_intervention_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id),
  constraint permission_intervention_primary_area_tenant_fk
    foreign key (tenant_id, primary_operation_area_code)
    references public.pi_operation_areas (tenant_id, code),
  constraint permission_intervention_primary_voltage_tenant_fk
    foreign key (tenant_id, primary_voltage_level_code)
    references public.pi_voltage_levels (tenant_id, code),
  constraint permission_intervention_supervisor_tenant_fk
    foreign key (supervisor_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_supervisor_alt_tenant_fk
    foreign key (supervisor_alternate_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_foreman_tenant_fk
    foreign key (foreman_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_foreman_alt_tenant_fk
    foreign key (foreman_alternate_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_author_tenant_fk
    foreign key (author_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_validator_tenant_fk
    foreign key (validator_person_id, tenant_id) references public.people (id, tenant_id),
  constraint permission_intervention_issued_template_tenant_fk
    foreign key (issued_template_id, tenant_id) references public.pi_document_template (id, tenant_id)
);

-- Uma PI viva por projeto+data. Cancelada sai da chave: a data pode receber
-- outra PI depois de a primeira ser cancelada, e a cancelada permanece no
-- historico. Mesma logica do indice parcial da Programacao (346).
create unique index if not exists permission_intervention_live_project_date_key
  on public.permission_intervention (tenant_id, project_id, work_date)
  where status <> 'CANCELLED';

-- Codigo e sequencial sao unicos por contrato, inclusive contra PI cancelada:
-- numero de documento emitido nao volta para o bolo.
create unique index if not exists permission_intervention_code_key
  on public.permission_intervention (tenant_id, pi_code)
  where pi_code is not null;

create unique index if not exists permission_intervention_sequence_key
  on public.permission_intervention (tenant_id, pi_sequence)
  where pi_sequence is not null;

-- Fila do vinculo automatico: quando uma etapa nova e criada, a busca e por
-- PI pendente daquele projeto e data.
create index if not exists idx_permission_intervention_pending_link
  on public.permission_intervention (tenant_id, project_id, work_date)
  where link_status = 'PENDING' and status <> 'CANCELLED';

create index if not exists idx_permission_intervention_tenant_programming
  on public.permission_intervention (tenant_id, programming_id)
  where programming_id is not null;

create index if not exists idx_permission_intervention_tenant_status_date
  on public.permission_intervention (tenant_id, status, work_date desc);

create index if not exists idx_permission_intervention_tenant_project
  on public.permission_intervention (tenant_id, project_id);

comment on table public.permission_intervention is
  'Permissao de Intervencao (PI): um documento por projeto + data da etapa. Vinculada a Programacao pelo UUID da etapa, nunca pelo rotulo calculado. Independente: editar a PI nao altera a Programacao, e vice-versa.';

comment on column public.permission_intervention.link_status is
  'LINKED = etapa vinculada. PENDING = sem etapa (aguardando a Programacao daquela data). ATTENTION = vinculada a etapa que saiu do plano ativo; exige revisao humana e o vinculo historico permanece.';

comment on column public.permission_intervention.source_programming_snapshot is
  'Fotografia da etapa no momento da criacao da PI. Imutavel. Base da comparacao Programacao x PI.';

-- =============================================================================
-- 2) `pi_operation_area_link` — areas marcadas
-- =============================================================================
-- `scope` separa as duas listas que o formulario tem e que sao independentes:
-- a Area de Atuacao da PI (que compoe o codigo) e a Area do contato da
-- distribuidora (que nao compoe).
create table if not exists public.pi_operation_area_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pi_id uuid not null,
  scope text not null,
  area_code text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),

  constraint pi_operation_area_link_scope_check check (scope in ('PI', 'CONTACT')),
  constraint pi_operation_area_link_unique unique (pi_id, scope, area_code),
  constraint pi_operation_area_link_pi_tenant_fk
    foreign key (pi_id, tenant_id) references public.permission_intervention (id, tenant_id) on delete cascade,
  constraint pi_operation_area_link_area_tenant_fk
    foreign key (tenant_id, area_code) references public.pi_operation_areas (tenant_id, code)
);

create index if not exists idx_pi_operation_area_link_pi
  on public.pi_operation_area_link (tenant_id, pi_id);

-- =============================================================================
-- 3) `pi_voltage_level_link` — tensoes marcadas
-- =============================================================================
-- `scope` separa o Nivel de Tensao da PI (que compoe o codigo) do nivel da
-- instalacao interferente (que NAO compoe).
create table if not exists public.pi_voltage_level_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pi_id uuid not null,
  scope text not null,
  voltage_code text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),

  constraint pi_voltage_level_link_scope_check check (scope in ('PI', 'INTERFERING')),
  constraint pi_voltage_level_link_unique unique (pi_id, scope, voltage_code),
  constraint pi_voltage_level_link_pi_tenant_fk
    foreign key (pi_id, tenant_id) references public.permission_intervention (id, tenant_id) on delete cascade,
  constraint pi_voltage_level_link_voltage_tenant_fk
    foreign key (tenant_id, voltage_code) references public.pi_voltage_levels (tenant_id, code)
);

create index if not exists idx_pi_voltage_level_link_pi
  on public.pi_voltage_level_link (tenant_id, pi_id);

-- =============================================================================
-- 4) `pi_execution_step` — Plano de Execucao
-- =============================================================================
-- O documento tem 23 linhas fisicas. O TETO NAO E CONSTRAINT aqui de proposito:
-- o usuario pode montar o plano com mais linhas enquanto rascunha, e quem
-- recusa e a validacao de EMISSAO, com mensagem explicando o limite. Constraint
-- no banco daria erro cru no meio da edicao.
--
-- `unique (pi_id, sort_order)` e DEFERRABLE porque reordenar troca duas linhas
-- de posicao dentro da mesma transacao e passa por um estado intermediario
-- duplicado.
create table if not exists public.pi_execution_step (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pi_id uuid not null,
  sort_order smallint not null,
  work_zone text null,
  team_id uuid null,
  team_name_snapshot text null,
  activity text null,
  -- De onde a linha veio: modelo de etapas padrao, atividade da Programacao ou
  -- digitada na PI. Alimenta a comparacao Programacao x PI.
  origin text not null default 'MANUAL',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_execution_step_id_tenant_key unique (id, tenant_id),
  constraint pi_execution_step_origin_check check (origin in ('TEMPLATE', 'PROGRAMMING', 'MANUAL')),
  constraint pi_execution_step_sort_order_positive_check check (sort_order > 0),
  constraint pi_execution_step_pi_tenant_fk
    foreign key (pi_id, tenant_id) references public.permission_intervention (id, tenant_id) on delete cascade,
  constraint pi_execution_step_team_tenant_fk
    foreign key (team_id, tenant_id) references public.teams (id, tenant_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pi_execution_step_order_unique'
      and conrelid = 'public.pi_execution_step'::regclass
  ) then
    alter table public.pi_execution_step
      add constraint pi_execution_step_order_unique unique (pi_id, sort_order)
      deferrable initially deferred;
  end if;
end;
$$;

create index if not exists idx_pi_execution_step_pi_order
  on public.pi_execution_step (tenant_id, pi_id, sort_order);

comment on table public.pi_execution_step is
  'Plano de Execucao da PI. O teto de 23 linhas do documento e validado na EMISSAO, nao por constraint: passar do limite nao pode dar erro cru no meio da edicao do rascunho.';

-- =============================================================================
-- 5) `pi_history` — historico da PI
-- =============================================================================
-- Tabela propria em vez de `app_entity_history` porque o CHECK daquela tabela
-- so aceita UPDATE/CANCEL/ACTIVATE, e a PI precisa de CREATE, LINK, UNLINK,
-- ISSUE, GENERATE_DOCUMENT e mais. Alargar o CHECK de uma tabela compartilhada
-- por varios modulos e mais arriscado do que criar esta.
create table if not exists public.pi_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  pi_id uuid not null,
  action_type text not null,
  reason text null,
  changes jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),

  constraint pi_history_action_type_not_blank_check
    check (nullif(btrim(action_type), '') is not null),
  constraint pi_history_changes_object_check check (jsonb_typeof(changes) = 'object'),
  constraint pi_history_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint pi_history_pi_tenant_fk
    foreign key (pi_id, tenant_id) references public.permission_intervention (id, tenant_id) on delete cascade
);

create index if not exists idx_pi_history_tenant_pi_created
  on public.pi_history (tenant_id, pi_id, created_at desc);

comment on table public.pi_history is
  'Historico da PI: criacao, edicao campo a campo, mudanca de status, vinculo, emissao e geracao de documento.';

-- =============================================================================
-- 6) RLS e grants
-- =============================================================================
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'permission_intervention',
    'pi_operation_area_link',
    'pi_voltage_level_link',
    'pi_execution_step',
    'pi_history'
  ]
  loop
    execute format('alter table if exists public.%I enable row level security', v_table);
    execute format('revoke insert, update, delete on public.%I from public, anon, authenticated', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_tenant_select', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.user_can_access_tenant(%I.tenant_id))',
      v_table || '_tenant_select', v_table, v_table
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['permission_intervention', 'pi_execution_step']
  loop
    execute format('drop trigger if exists trg_%I_audit on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_%I_audit before insert or update on public.%I for each row execute function public.apply_audit_fields()',
      v_table, v_table
    );
  end loop;
end;
$$;

-- =============================================================================
-- 7) Verificacao
-- =============================================================================
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'permission_intervention',
    'pi_operation_area_link',
    'pi_voltage_level_link',
    'pi_execution_step',
    'pi_history'
  ]
  loop
    if has_table_privilege('anon', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception '429: % ainda aceita escrita por anon/authenticated', v_table;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table and cmd = 'SELECT'
    ) then
      raise exception '429: % ficou sem policy de leitura por tenant', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'permission_intervention_live_project_date_key'
  ) then
    raise exception '429: indice de PI viva unica por projeto+data nao foi criado';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'permission_intervention_code_key'
  ) then
    raise exception '429: indice de unicidade do codigo da PI nao foi criado';
  end if;

  -- A tabela nasce vazia; qualquer linha aqui indica execucao fora de ordem.
  if exists (select 1 from public.permission_intervention) then
    raise exception '429: permission_intervention deveria nascer vazia';
  end if;
end;
$$;
