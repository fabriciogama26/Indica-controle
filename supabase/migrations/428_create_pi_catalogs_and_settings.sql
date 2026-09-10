-- 428_create_pi_catalogs_and_settings.sql
-- Fase 1 da Permissao de Intervencao, parte 1 de 3: catalogos, configuracao por
-- contrato e o contador do sequencial. A entidade `permission_intervention`
-- nasce na 429 e as RPCs de escrita na 430.
--
-- POR QUE CATALOGO E NAO ENUM
-- ---------------------------------------------------------------------------
-- Area de atuacao e nivel de tensao tem dominio fechado no formulario oficial,
-- mas: (a) o rotulo e o token que compoe o codigo precisam ser editaveis por
-- contrato sem migration; (b) um item pode ser desativado sem sumir do
-- historico das PIs que ja o usaram. `enum` do Postgres nao permite nem uma
-- coisa nem outra sem DDL.
--
-- POR QUE NAO REUSAR `project_voltage_levels`
-- ---------------------------------------------------------------------------
-- Aquele catalogo (031) e TEXTO LIVRE por tenant, semeado a partir do que ja
-- estava digitado em `project.voltage_level`, e o Projeto usa selecao unica.
-- O documento da PI precisa de codigo fechado (AT/MT/BT) para marcar as caixas
-- e de multiselecao. Decisao confirmada com o usuario: catalogo proprio, sem
-- tocar o do Projeto.
--
-- NADA DE `PI-RJ` OU `INDICA` NO CODIGO DA APLICACAO
-- ---------------------------------------------------------------------------
-- Os dois vivem em `pi_settings`, por contrato. O seed abaixo apenas da o valor
-- INICIAL para os tenants que ja existem; a partir dai e configuracao editavel.

-- =============================================================================
-- 1) `pi_settings` — configuracao da PI por contrato
-- =============================================================================
create table if not exists public.pi_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Componentes fixos do codigo: `PI-RJ-[TENSAO]-[AREA]-INDICA-[SEQUENCIAL]`.
  code_prefix text not null,
  company_code text not null,
  sequence_digits smallint not null default 4,

  -- Plano de Emergencia em Caso de Acidentes. NAO e digitado na PI: e
  -- configuracao. A PI guarda o snapshot do texto e da versao no momento da
  -- emissao, para o documento continuar reconstruivel depois de o plano mudar.
  emergency_plan_text text null,
  emergency_plan_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_settings_tenant_key unique (tenant_id),
  constraint pi_settings_id_tenant_key unique (id, tenant_id),
  constraint pi_settings_code_prefix_not_blank_check
    check (nullif(btrim(code_prefix), '') is not null),
  constraint pi_settings_company_code_not_blank_check
    check (nullif(btrim(company_code), '') is not null),
  -- 1 a 8 digitos. Abaixo de 1 nao formata; acima de 8 nao ha volume que
  -- justifique e o codigo passaria a nao caber na celula do Word.
  constraint pi_settings_sequence_digits_range_check
    check (sequence_digits between 1 and 8),
  constraint pi_settings_emergency_plan_text_not_blank_check
    check (emergency_plan_text is null or btrim(emergency_plan_text) <> ''),
  constraint pi_settings_emergency_plan_version_positive_check
    check (emergency_plan_version > 0)
);

comment on table public.pi_settings is
  'Configuracao da Permissao de Intervencao por contrato: componentes fixos do codigo e Plano de Emergencia vigente.';

comment on column public.pi_settings.emergency_plan_text is
  'Texto vigente do Plano de Emergencia. Nulo bloqueia a EMISSAO (a tag do documento e obrigatoria), nunca o rascunho.';

-- =============================================================================
-- 2) `pi_sequence_counter` — contador do sequencial, por contrato
-- =============================================================================
-- Tabela separada de `pi_settings` de proposito: a emissao trava esta linha com
-- `UPDATE ... RETURNING`, e ela nao pode disputar lock com quem esta editando o
-- Plano de Emergencia.
--
-- POR QUE CONTADOR E NAO `CREATE SEQUENCE`:
--   1. `sequence` e objeto global; um por contrato exigiria DDL dinamico.
--   2. `nextval` NAO faz rollback. Uma emissao que falhasse depois de pegar o
--      numero deixaria buraco permanente na numeracao de um documento oficial.
-- O `UPDATE` abaixo toma lock exclusivo de linha: dois usuarios simultaneos
-- serializam, e o segundo so prossegue apos o commit do primeiro.
create table if not exists public.pi_sequence_counter (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id),
  constraint pi_sequence_counter_last_value_non_negative_check check (last_value >= 0)
);

comment on table public.pi_sequence_counter is
  'Contador do sequencial do codigo da PI, uma linha por contrato. Incrementado sob lock de linha dentro da transacao da emissao.';

-- =============================================================================
-- 3) `pi_operation_areas` — Area de Atuacao
-- =============================================================================
-- `code_token` e o pedaco que entra no codigo da PI e NAO e necessariamente
-- igual ao `code`: `UT_AT` viraria `PI-RJ-MT-UT_AT-INDICA-0001`, com underscore
-- no meio de um codigo de documento. Por isso o token e coluna propria e
-- editavel.
create table if not exists public.pi_operation_areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  code_token text not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_operation_areas_id_tenant_key unique (id, tenant_id),
  constraint pi_operation_areas_tenant_code_key unique (tenant_id, code),
  constraint pi_operation_areas_code_format_check check (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  constraint pi_operation_areas_code_token_format_check check (code_token ~ '^[A-Z0-9]{1,10}$'),
  constraint pi_operation_areas_label_not_blank_check check (nullif(btrim(label), '') is not null)
);

comment on table public.pi_operation_areas is
  'Area de Atuacao da PI, por contrato. `code` identifica; `code_token` e o pedaco que entra no codigo da PI.';

-- =============================================================================
-- 4) `pi_voltage_levels` — Nivel de Tensao
-- =============================================================================
create table if not exists public.pi_voltage_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label text not null,
  code_token text not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_voltage_levels_id_tenant_key unique (id, tenant_id),
  constraint pi_voltage_levels_tenant_code_key unique (tenant_id, code),
  constraint pi_voltage_levels_code_format_check check (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  constraint pi_voltage_levels_code_token_format_check check (code_token ~ '^[A-Z0-9]{1,10}$'),
  constraint pi_voltage_levels_label_not_blank_check check (nullif(btrim(label), '') is not null)
);

comment on table public.pi_voltage_levels is
  'Nivel de Tensao da PI, por contrato. Codigo fechado (AT/MT/BT), separado de project_voltage_levels, que e texto livre e de selecao unica.';

-- =============================================================================
-- 5) `pi_execution_step_template` — etapas padrao do Plano de Execucao
-- =============================================================================
-- Nasce VAZIA: a lista oficial (check-list de veiculo, EPI/EPC, deslocamento,
-- sinalizacao, APR, aterramento, encerramento...) ainda nao foi fornecida com o
-- texto exato. A tabela existe agora para o modelo de dados fechar; o seed
-- entra numa migration propria quando o conteudo chegar.
create table if not exists public.pi_execution_step_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  description text not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),

  constraint pi_execution_step_template_id_tenant_key unique (id, tenant_id),
  constraint pi_execution_step_template_tenant_code_key unique (tenant_id, code),
  constraint pi_execution_step_template_code_not_blank_check check (nullif(btrim(code), '') is not null),
  constraint pi_execution_step_template_description_not_blank_check
    check (nullif(btrim(description), '') is not null)
);

comment on table public.pi_execution_step_template is
  'Etapas padrao que alimentam o Plano de Execucao de uma PI nova. As atividades especificas vem da Programacao; estas sao as fixas do processo.';

-- =============================================================================
-- 6) Indices de leitura
-- =============================================================================
create index if not exists idx_pi_operation_areas_tenant_active
  on public.pi_operation_areas (tenant_id, sort_order)
  where is_active = true;

create index if not exists idx_pi_voltage_levels_tenant_active
  on public.pi_voltage_levels (tenant_id, sort_order)
  where is_active = true;

create index if not exists idx_pi_execution_step_template_tenant_active
  on public.pi_execution_step_template (tenant_id, sort_order)
  where is_active = true;

-- =============================================================================
-- 7) RLS e grants
-- =============================================================================
-- Mesmo padrao da 424 e da 426: `authenticated` so le, e a escrita passa por
-- Route Handler com `service_role`. `pi_sequence_counter` NAO recebe policy de
-- leitura: o numero corrente nao interessa a nenhuma tela, e expor o proximo
-- sequencial de um contrato nao tem beneficio.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'pi_settings',
    'pi_operation_areas',
    'pi_voltage_levels',
    'pi_execution_step_template',
    'pi_sequence_counter'
  ]
  loop
    execute format('alter table if exists public.%I enable row level security', v_table);
    execute format('revoke insert, update, delete on public.%I from public, anon, authenticated', v_table);
  end loop;
end;
$$;

drop policy if exists pi_settings_tenant_select on public.pi_settings;
create policy pi_settings_tenant_select on public.pi_settings
for select to authenticated
using (public.user_can_access_tenant(pi_settings.tenant_id));

drop policy if exists pi_operation_areas_tenant_select on public.pi_operation_areas;
create policy pi_operation_areas_tenant_select on public.pi_operation_areas
for select to authenticated
using (public.user_can_access_tenant(pi_operation_areas.tenant_id));

drop policy if exists pi_voltage_levels_tenant_select on public.pi_voltage_levels;
create policy pi_voltage_levels_tenant_select on public.pi_voltage_levels
for select to authenticated
using (public.user_can_access_tenant(pi_voltage_levels.tenant_id));

drop policy if exists pi_execution_step_template_tenant_select on public.pi_execution_step_template;
create policy pi_execution_step_template_tenant_select on public.pi_execution_step_template
for select to authenticated
using (public.user_can_access_tenant(pi_execution_step_template.tenant_id));

revoke select on public.pi_sequence_counter from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'pi_settings',
    'pi_operation_areas',
    'pi_voltage_levels',
    'pi_execution_step_template'
  ]
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
-- 8) Seed por contrato
-- =============================================================================
-- Valor INICIAL, nao constante da aplicacao. `PI-RJ` e `INDICA` vieram do
-- formulario oficial em uso; contrato que precise de outro prefixo edita a
-- propria linha depois. `emergency_plan_text` fica NULO de proposito: o texto
-- oficial ainda nao foi fornecido, e a validacao de emissao cobra a ausencia.
insert into public.pi_settings (tenant_id, code_prefix, company_code, sequence_digits)
select distinct app_users.tenant_id, 'PI-RJ', 'INDICA', 4
from public.app_users
where app_users.tenant_id is not null
on conflict (tenant_id) do nothing;

insert into public.pi_sequence_counter (tenant_id, last_value)
select distinct app_users.tenant_id, 0
from public.app_users
where app_users.tenant_id is not null
on conflict (tenant_id) do nothing;

insert into public.pi_operation_areas (tenant_id, code, label, code_token, sort_order)
select tenants.tenant_id, seed.code, seed.label, seed.code_token, seed.sort_order
from (
  select distinct tenant_id from public.app_users where tenant_id is not null
) tenants
cross join (values
  ('UT_AT', 'UT AT', 'UTAT', 1),
  ('UT_MT', 'UT MT', 'UTMT', 2),
  ('OM',    'OM',    'OM',   3),
  ('PM',    'PM',    'PM',   4),
  ('CE',    'CE',    'CE',   5),
  ('EC',    'EC',    'EC',   6)
) as seed(code, label, code_token, sort_order)
on conflict (tenant_id, code) do nothing;

insert into public.pi_voltage_levels (tenant_id, code, label, code_token, sort_order)
select tenants.tenant_id, seed.code, seed.label, seed.code_token, seed.sort_order
from (
  select distinct tenant_id from public.app_users where tenant_id is not null
) tenants
cross join (values
  ('AT', 'AT', 'AT', 1),
  ('MT', 'MT', 'MT', 2),
  ('BT', 'BT', 'BT', 3)
) as seed(code, label, code_token, sort_order)
on conflict (tenant_id, code) do nothing;

-- =============================================================================
-- 9) Verificacao
-- =============================================================================
do $$
declare
  v_table text;
  v_tenants bigint;
  v_missing bigint;
begin
  foreach v_table in array array[
    'pi_settings',
    'pi_operation_areas',
    'pi_voltage_levels',
    'pi_execution_step_template',
    'pi_sequence_counter'
  ]
  loop
    if has_table_privilege('anon', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception '428: % ainda aceita escrita por anon/authenticated', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.pi_sequence_counter', 'select') then
    raise exception '428: pi_sequence_counter nao deveria ser legivel por authenticated';
  end if;

  select count(distinct tenant_id) into v_tenants
  from public.app_users where tenant_id is not null;

  select count(*) into v_missing
  from (select distinct tenant_id from public.app_users where tenant_id is not null) t
  where not exists (select 1 from public.pi_settings s where s.tenant_id = t.tenant_id)
     or not exists (select 1 from public.pi_sequence_counter c where c.tenant_id = t.tenant_id)
     or (select count(*) from public.pi_operation_areas a where a.tenant_id = t.tenant_id) < 6
     or (select count(*) from public.pi_voltage_levels v where v.tenant_id = t.tenant_id) < 3;

  if v_missing > 0 then
    raise exception '428: % de % contrato(s) ficaram sem configuracao ou catalogo completo', v_missing, v_tenants;
  end if;
end;
$$;
