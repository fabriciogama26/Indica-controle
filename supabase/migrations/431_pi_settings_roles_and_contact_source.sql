-- 431_pi_settings_roles_and_contact_source.sql
-- Configuracao da PI que faltava, decidida com o usuario: de onde vem o contato
-- da distribuidora, a partir de quantas equipes o Supervisor passa a ser
-- obrigatorio, e QUAIS CARGOS contam como Encarregado e como Supervisor.
--
-- POR QUE OS CARGOS SAO CONFIGURACAO, E NAO REGRA NO CODIGO
-- ---------------------------------------------------------------------------
-- `job_titles.name` e texto livre por contrato. Casar `'Encarregado de Turma'`
-- ou um `ilike '%encarregad%'` dentro da aplicacao seria hardcode disfarcado,
-- que a secao 6 do CLAUDE.md proibe, e quebraria no primeiro contrato que
-- nomear o cargo de outro jeito.
--
-- POR QUE POR CARGO, E NAO POR EQUIPE
-- ---------------------------------------------------------------------------
-- Medido no contrato em producao antes desta decisao: 13 pessoas tem o cargo de
-- encarregado e 2 o de supervisor, mas so 10 encarregados estao como
-- `teams.foreman_person_id` de equipe ativa. Filtrar por equipe deixaria 3
-- encarregados legitimos fora do select (reserva, ferias, equipe inativa).
-- Nenhum encarregado de equipe esta sem o cargo, entao o cargo e o superconjunto
-- correto.
--
-- Sobre "(Tecnica)": categoria e atributo de EQUIPE (`team_categories`), nao de
-- pessoa. Nao ha como filtrar pessoa por categoria no modelo atual. Escolher os
-- cargos tecnicos nesta configuracao e o que expressa a regra.

-- =============================================================================
-- 1) Novas colunas de configuracao em `pi_settings`
-- =============================================================================
alter table if exists public.pi_settings
  -- Supervisor passa a ser obrigatorio quando a etapa vinculada tem MAIS do que
  -- este numero de equipes ativas. So se aplica a PI VINCULADA: PI sem
  -- Programacao nao tem etapa para contar.
  add column if not exists supervisor_required_team_count smallint not null default 3,
  -- De qual cadastro sai o "Contato Enel / representante da unidade" do projeto.
  add column if not exists utility_contact_source text not null default 'RESPONSIBLE';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pi_settings_supervisor_team_count_check'
      and conrelid = 'public.pi_settings'::regclass
  ) then
    alter table public.pi_settings
      add constraint pi_settings_supervisor_team_count_check
      check (supervisor_required_team_count between 1 and 50);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pi_settings_utility_contact_source_check'
      and conrelid = 'public.pi_settings'::regclass
  ) then
    alter table public.pi_settings
      add constraint pi_settings_utility_contact_source_check
      check (utility_contact_source in ('RESPONSIBLE', 'FIELD_MANAGER'));
  end if;
end;
$$;

comment on column public.pi_settings.supervisor_required_team_count is
  'Acima deste numero de equipes ativas na etapa VINCULADA, o Supervisor vira obrigatorio na emissao. Nao se aplica a PI sem Programacao.';

comment on column public.pi_settings.utility_contact_source is
  'RESPONSIBLE le project_utility_responsibles; FIELD_MANAGER le project_utility_field_managers. Define quem preenche o Contato da distribuidora na PI.';

-- =============================================================================
-- 2) `pi_role_job_titles` — cargos que contam como Encarregado e Supervisor
-- =============================================================================
-- Tabela em vez de coluna com array: array nao aceita FK, e sem FK um cargo
-- removido deixaria id orfao apontando para nada.
create table if not exists public.pi_role_job_titles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null,
  job_title_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),

  constraint pi_role_job_titles_role_check check (role in ('FOREMAN', 'SUPERVISOR')),
  constraint pi_role_job_titles_unique unique (tenant_id, role, job_title_id),
  constraint pi_role_job_titles_job_title_tenant_fk
    foreign key (job_title_id, tenant_id) references public.job_titles (id, tenant_id) on delete cascade
);

create index if not exists idx_pi_role_job_titles_tenant_role
  on public.pi_role_job_titles (tenant_id, role);

comment on table public.pi_role_job_titles is
  'Cargos que habilitam uma pessoa como Encarregado (FOREMAN) ou Supervisor (SUPERVISOR) nos selects da PI. Configuracao por contrato, porque job_titles.name e texto livre.';

alter table if exists public.pi_role_job_titles enable row level security;

drop policy if exists pi_role_job_titles_tenant_select on public.pi_role_job_titles;
create policy pi_role_job_titles_tenant_select on public.pi_role_job_titles
for select to authenticated
using (public.user_can_access_tenant(pi_role_job_titles.tenant_id));

revoke insert, update, delete on public.pi_role_job_titles from public, anon, authenticated;

-- =============================================================================
-- 3) Seed inicial dos cargos
-- =============================================================================
-- O casamento por nome acontece UMA VEZ, aqui, como valor inicial — nao como
-- regra da aplicacao. A partir da primeira edicao na tela, quem manda e a
-- configuracao. Sem este seed a tela nasceria com os selects vazios e a PI
-- ficaria inutilizavel ate alguem configurar.
insert into public.pi_role_job_titles (tenant_id, role, job_title_id)
select jt.tenant_id, 'FOREMAN', jt.id
from public.job_titles jt
where jt.ativo = true
  and jt.name ~* 'encarregad'
on conflict (tenant_id, role, job_title_id) do nothing;

-- Supervisor aceita tambem os cargos de encarregado, conforme a regra acordada:
-- "Responsavel pela Intervencao aceita encarregados E supervisores".
insert into public.pi_role_job_titles (tenant_id, role, job_title_id)
select jt.tenant_id, 'SUPERVISOR', jt.id
from public.job_titles jt
where jt.ativo = true
  and (jt.name ~* 'supervisor' or jt.name ~* 'encarregad')
on conflict (tenant_id, role, job_title_id) do nothing;

-- =============================================================================
-- 4) RPC de escrita da configuracao
-- =============================================================================
-- Historico da configuracao vai para `app_entity_history`, e nao para
-- `pi_history`: `pi_history` e por PI (tem FK para `permission_intervention`) e
-- a configuracao e do contrato inteiro.
create or replace function public.pi_append_settings_history(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_change_type text,
  p_changes jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_entity_history (
    tenant_id, module_key, entity_table, entity_id, entity_code,
    change_type, reason, changes, metadata, created_by, updated_by
  )
  select
    p_tenant_id, 'modelo-pi', 'pi_settings', s.id, 'configuracao',
    p_change_type, null, coalesce(p_changes, '{}'::jsonb), '{}'::jsonb, p_actor_user_id, p_actor_user_id
  from public.pi_settings s
  where s.tenant_id = p_tenant_id;
$$;

revoke all on function public.pi_append_settings_history(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.save_pi_settings(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_code_prefix text,
  p_company_code text,
  p_sequence_digits smallint,
  p_emergency_plan_text text,
  p_supervisor_required_team_count smallint,
  p_utility_contact_source text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.pi_settings%rowtype;
  v_prefix text := nullif(btrim(coalesce(p_code_prefix, '')), '');
  v_company text := nullif(btrim(coalesce(p_company_code, '')), '');
  v_plan text := nullif(btrim(coalesce(p_emergency_plan_text, '')), '');
  v_source text := upper(nullif(btrim(coalesce(p_utility_contact_source, '')), ''));
  v_digits smallint := coalesce(p_sequence_digits, 4);
  v_count smallint := coalesce(p_supervisor_required_team_count, 3);
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios.');
  end if;

  if v_prefix is null or v_company is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Prefixo e codigo da empresa sao obrigatorios.');
  end if;

  if v_digits < 1 or v_digits > 8 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SEQUENCE_DIGITS',
      'message', 'Os digitos do sequencial devem ficar entre 1 e 8.');
  end if;

  if v_count < 1 or v_count > 50 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TEAM_COUNT',
      'message', 'O limite de equipes deve ficar entre 1 e 50.');
  end if;

  if v_source is null or v_source not in ('RESPONSIBLE', 'FIELD_MANAGER') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CONTACT_SOURCE',
      'message', 'Origem do contato da distribuidora invalida.');
  end if;

  select * into v_current from public.pi_settings where tenant_id = p_tenant_id for update;

  if not found then
    insert into public.pi_settings (
      tenant_id, code_prefix, company_code, sequence_digits, emergency_plan_text,
      supervisor_required_team_count, utility_contact_source, created_by, updated_by
    )
    values (
      p_tenant_id, v_prefix, v_company, v_digits, v_plan, v_count, v_source, p_actor_user_id, p_actor_user_id
    )
    returning updated_at into v_updated_at;

    perform public.pi_append_settings_history(p_tenant_id, p_actor_user_id, 'UPDATE',
      jsonb_build_object('settings', jsonb_build_object('from', null, 'to', 'criada')));

    return jsonb_build_object('success', true, 'status', 200, 'updated_at', v_updated_at,
      'message', 'Configuracao da PI criada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a tela antes de salvar a configuracao.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'A configuracao foi alterada por outro usuario. Recarregue antes de salvar.');
  end if;

  -- Mudar o Plano de Emergencia e um fato auditavel: PI ja emitida guarda o
  -- texto antigo em snapshot, e a versao sobe para as proximas.
  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'codePrefix', case when v_current.code_prefix is distinct from v_prefix
      then jsonb_build_object('from', v_current.code_prefix, 'to', v_prefix) end,
    'companyCode', case when v_current.company_code is distinct from v_company
      then jsonb_build_object('from', v_current.company_code, 'to', v_company) end,
    'sequenceDigits', case when v_current.sequence_digits is distinct from v_digits
      then jsonb_build_object('from', v_current.sequence_digits::text, 'to', v_digits::text) end,
    'emergencyPlan', case when v_current.emergency_plan_text is distinct from v_plan
      then jsonb_build_object('from', left(coalesce(v_current.emergency_plan_text, ''), 80), 'to', left(coalesce(v_plan, ''), 80)) end,
    'supervisorRequiredTeamCount', case when v_current.supervisor_required_team_count is distinct from v_count
      then jsonb_build_object('from', v_current.supervisor_required_team_count::text, 'to', v_count::text) end,
    'utilityContactSource', case when v_current.utility_contact_source is distinct from v_source
      then jsonb_build_object('from', v_current.utility_contact_source, 'to', v_source) end
  ));

  update public.pi_settings set
    code_prefix = v_prefix,
    company_code = v_company,
    sequence_digits = v_digits,
    emergency_plan_text = v_plan,
    -- A versao sobe SO quando o texto muda, para o snapshot da PI apontar para
    -- uma versao que significa alguma coisa.
    emergency_plan_version = case
      when v_current.emergency_plan_text is distinct from v_plan
        then v_current.emergency_plan_version + 1
      else v_current.emergency_plan_version
    end,
    supervisor_required_team_count = v_count,
    utility_contact_source = v_source,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
  returning updated_at into v_updated_at;

  if v_changes <> '{}'::jsonb then
    perform public.pi_append_settings_history(p_tenant_id, p_actor_user_id, 'UPDATE', v_changes);
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'updated_at', v_updated_at,
    'message', 'Configuracao da PI salva.');
end;
$$;


revoke all on function public.save_pi_settings(uuid, uuid, text, text, smallint, text, smallint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_pi_settings(uuid, uuid, text, text, smallint, text, smallint, text, timestamptz)
  to service_role;

-- =============================================================================
-- 5) RPC de escrita dos cargos de cada papel
-- =============================================================================
-- Substituicao completa da lista de um papel. Diff item a item nao traria nada:
-- a tela edita o conjunto inteiro de uma vez.
create or replace function public.save_pi_role_job_titles(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_role text,
  p_job_title_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := upper(nullif(btrim(coalesce(p_role, '')), ''));
  v_before text;
  v_after text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios.');
  end if;

  if v_role is null or v_role not in ('FOREMAN', 'SUPERVISOR') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ROLE',
      'message', 'Papel invalido.');
  end if;

  select string_agg(jt.name, ', ' order by jt.name) into v_before
  from public.pi_role_job_titles link
  join public.job_titles jt on jt.id = link.job_title_id and jt.tenant_id = link.tenant_id
  where link.tenant_id = p_tenant_id and link.role = v_role;

  delete from public.pi_role_job_titles where tenant_id = p_tenant_id and role = v_role;

  insert into public.pi_role_job_titles (tenant_id, role, job_title_id, created_by)
  select p_tenant_id, v_role, unnest, p_actor_user_id
  from unnest(coalesce(p_job_title_ids, array[]::uuid[])) as unnest
  on conflict (tenant_id, role, job_title_id) do nothing;

  select string_agg(jt.name, ', ' order by jt.name) into v_after
  from public.pi_role_job_titles link
  join public.job_titles jt on jt.id = link.job_title_id and jt.tenant_id = link.tenant_id
  where link.tenant_id = p_tenant_id and link.role = v_role;

  if coalesce(v_before, '') is distinct from coalesce(v_after, '') then
    perform public.pi_append_settings_history(
      p_tenant_id, p_actor_user_id, 'UPDATE',
      jsonb_build_object(
        case when v_role = 'FOREMAN' then 'cargosEncarregado' else 'cargosSupervisor' end,
        jsonb_build_object('from', coalesce(v_before, 'nenhum'), 'to', coalesce(v_after, 'nenhum'))
      )
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200,
    'message', 'Cargos do papel atualizados.');
exception
  when foreign_key_violation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_JOB_TITLE',
      'message', 'Ha cargo que nao existe neste contrato.');
end;
$$;

revoke all on function public.save_pi_role_job_titles(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.save_pi_role_job_titles(uuid, uuid, text, uuid[]) to service_role;

-- =============================================================================
-- 6) A tela passa a ser Modelo E Configuracao da PI
-- =============================================================================
-- `page_key` e `path` NAO mudam: trocar qualquer um dos dois derrubaria as
-- permissoes ja concedidas. So o rotulo e a descricao acompanham o conteudo.
update public.app_pages
set
  name = 'Modelo e Configuracao da PI',
  description = 'Versoes do template Word da PI e a configuracao do contrato: codigo, Plano de Emergencia, limite de equipes e cargos.',
  updated_at = now()
where page_key = 'modelo-pi';

-- =============================================================================
-- 7) Verificacao
-- =============================================================================
do $$
declare
  v_settings_fn regprocedure := 'public.save_pi_settings(uuid, uuid, text, text, smallint, text, smallint, text, timestamptz)'::regprocedure;
  v_roles_fn regprocedure := 'public.save_pi_role_job_titles(uuid, uuid, text, uuid[])'::regprocedure;
  v_sem_cargo bigint;
begin
  if has_function_privilege('anon', v_settings_fn, 'execute')
     or has_function_privilege('authenticated', v_settings_fn, 'execute')
     or has_function_privilege('anon', v_roles_fn, 'execute')
     or has_function_privilege('authenticated', v_roles_fn, 'execute') then
    raise exception '431: RPC de configuracao ainda executavel por anon/authenticated';
  end if;

  if has_table_privilege('authenticated', 'public.pi_role_job_titles', 'insert')
     or has_table_privilege('authenticated', 'public.pi_role_job_titles', 'update')
     or has_table_privilege('authenticated', 'public.pi_role_job_titles', 'delete') then
    raise exception '431: pi_role_job_titles ainda aceita escrita por authenticated';
  end if;

  -- Aviso, nao erro: contrato sem cargo casado pelo seed abre a tela com o
  -- select vazio e precisa configurar a mao. Falhar a migration por isso
  -- impediria a feature de existir onde o cargo tem outro nome.
  select count(*) into v_sem_cargo
  from (select distinct tenant_id from public.pi_settings) s
  where not exists (
    select 1 from public.pi_role_job_titles r where r.tenant_id = s.tenant_id and r.role = 'FOREMAN'
  );

  if v_sem_cargo > 0 then
    raise notice '431: % contrato(s) ficaram sem cargo de Encarregado no seed; configure em Modelo e Configuracao da PI.', v_sem_cargo;
  end if;
end;
$$;
