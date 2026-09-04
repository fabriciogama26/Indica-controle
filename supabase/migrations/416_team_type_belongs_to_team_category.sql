-- 416_team_type_belongs_to_team_category.sql
-- Vincula o Tipo Operacional (`team_types`) a categoria da equipe.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- A 415 criou `team_categories` (TECNICA/COMERCIAL) e passou a exigir categoria
-- na equipe, mas deixou `team_types` solto. Resultado pratico: uma equipe
-- COMERCIAL era obrigada a escolher CESTO, LINHA MORTA ou LINHA VIVA -- tipos
-- operacionais de rede eletrica, sem significado para quem faz cobranca e nova
-- ligacao.
--
-- Tornar `team_type_id` opcional na equipe comercial nao resolve: Meta,
-- Dashboard Medicao e Apuracao de Fator Minimo AGRUPAM por tipo, entao a equipe
-- sem tipo sumiria do agrupamento em vez de aparecer zerada. A saida e o tipo
-- pertencer a uma categoria: cada categoria passa a ter os seus.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. `team_types.team_category_id` obrigatorio, com backfill TECNICA para todo
--    tipo ja existente -- nenhum cadastro atual muda de comportamento.
-- 2. `save_team_type_record` ganha `p_team_category_id`, registra a troca de
--    categoria no historico e derruba a assinatura antiga, para nao sobrar
--    overload ambiguo no PostgREST.
-- 3. O trigger de equipe passa a exigir coerencia: o Tipo Operacional escolhido
--    tem que pertencer a MESMA categoria da equipe.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao cria nenhum tipo operacional comercial: quem cadastra e o administrador,
-- pela tela `/tipo-equipe`, agora que ela tem o campo de categoria. Enquanto nao
-- houver nenhum, o cadastro de equipe COMERCIAL fica sem opcao de tipo -- e a
-- tela avisa isso em vez de deixar salvar com um tipo tecnico.
--
-- Tambem nao mexe em meta, dashboards ou nas atividades: `service_activities`
-- continua apontando para `team_types` como antes.

-- =============================================================================
-- 1) `team_types.team_category_id` com backfill TECNICA
-- =============================================================================
alter table if exists public.team_types
  add column if not exists team_category_id uuid null;

update public.team_types tt
set team_category_id = tc.id
from public.team_categories tc
where tc.tenant_id = tt.tenant_id
  and tc.code = 'TECNICA'
  and tt.team_category_id is null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'team_types'
      and tc.constraint_name = 'team_types_team_category_tenant_fk'
  ) then
    alter table public.team_types
      add constraint team_types_team_category_tenant_fk
      foreign key (team_category_id, tenant_id)
      references public.team_categories(id, tenant_id);
  end if;
end;
$$;

alter table if exists public.team_types
  alter column team_category_id set not null;

create index if not exists idx_team_types_tenant_category_active_name
  on public.team_types (tenant_id, team_category_id, ativo, name);

-- =============================================================================
-- 2) `save_team_type_record` com categoria
-- =============================================================================
drop function if exists public.save_team_type_record(uuid, uuid, uuid, text, timestamptz);

create or replace function public.save_team_type_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_type_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null,
  p_team_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.team_types%rowtype;
  v_team_type_id uuid := p_team_type_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_id uuid;
  v_category_name text;
  v_current_category_name text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar tipo de equipe.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do tipo de equipe.'
    );
  end if;

  select tc.name
  into v_category_name
  from public.team_categories tc
  where tc.id = p_team_category_id
    and tc.tenant_id = p_tenant_id
    and tc.ativo = true;

  if v_category_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_CATEGORY',
      'message', 'Tipo operacional invalido para o tenant atual.'
    );
  end if;

  -- `team_types` tem unique (tenant_id, name), que e case-sensitive. A checagem
  -- abaixo bloqueia divergencia so de caixa/espaco, que o indice deixaria passar.
  select tt.id
  into v_duplicate_id
  from public.team_types tt
  where tt.tenant_id = p_tenant_id
    and upper(btrim(tt.name)) = upper(v_name)
    and (v_team_type_id is null or tt.id <> v_team_type_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe tipo de equipe com este nome no tenant atual.'
    );
  end if;

  if v_team_type_id is null then
    insert into public.team_types (
      tenant_id,
      name,
      team_category_id,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      p_team_category_id,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_type_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'team_type_id', v_team_type_id,
      'updated_at', v_updated_at,
      'message', 'Tipo de equipe cadastrado com sucesso.'
    );
  end if;

  select *
  into v_current
  from public.team_types
  where tenant_id = p_tenant_id
    and id = v_team_type_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_TYPE_NOT_FOUND',
      'message', 'Tipo de equipe nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar o tipo de equipe.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O tipo de equipe %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative o tipo de equipe antes de editar.'
    );
  end if;

  -- Trocar a categoria de um tipo ja usado moveria equipes inteiras de operacao
  -- em silencio, e o trigger de `teams` recusaria a proxima edicao delas com uma
  -- mensagem que nao explica a origem. Melhor bloquear aqui, com o motivo.
  if v_current.team_category_id is distinct from p_team_category_id
     and exists (
       select 1
       from public.teams t
       where t.tenant_id = p_tenant_id
         and t.team_type_id = v_team_type_id
     ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'TEAM_TYPE_CATEGORY_IN_USE',
      'message', 'Este tipo ja esta vinculado a equipes e por isso nao pode mudar de tipo operacional.'
    );
  end if;

  select tc.name
  into v_current_category_name
  from public.team_categories tc
  where tc.id = v_current.team_category_id
    and tc.tenant_id = p_tenant_id;

  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
    'teamCategoryName', case when v_current.team_category_id is distinct from p_team_category_id then jsonb_build_object('from', v_current_category_name, 'to', v_category_name) end
  ));

  if v_changes = '{}'::jsonb then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'team_type_id', v_team_type_id,
      'updated_at', v_current.updated_at,
      'message', format('Nenhuma alteracao detectada no tipo de equipe %s.', v_current.name)
    );
  end if;

  update public.team_types
  set
    name = v_name,
    team_category_id = p_team_category_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_team_type_id
  returning updated_at
  into v_updated_at;

  insert into public.app_entity_history (
    tenant_id,
    module_key,
    entity_table,
    entity_id,
    entity_code,
    change_type,
    reason,
    changes,
    metadata,
    created_by,
    updated_by
  )
  values (
    p_tenant_id,
    'tipo-equipe',
    'team_types',
    v_team_type_id,
    v_name,
    'UPDATE',
    null,
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_type_id', v_team_type_id,
    'updated_at', v_updated_at,
    'message', 'Tipo de equipe atualizado com sucesso.'
  );
end;
$$;

revoke all on function public.save_team_type_record(uuid, uuid, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.save_team_type_record(uuid, uuid, uuid, text, timestamptz, uuid) to service_role;

-- =============================================================================
-- 3) Equipe: tipo operacional tem que ser da mesma categoria
-- =============================================================================
-- Republica o trigger da 415 acrescentando a coerencia entre `team_type_id` e
-- `team_category_id`. As duas regras anteriores ficam identicas.
create or replace function public.enforce_team_category_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_type_category_id uuid;
begin
  select tc.code
  into v_code
  from public.team_categories tc
  where tc.id = new.team_category_id
    and tc.tenant_id = new.tenant_id;

  if v_code is null then
    raise exception using
      errcode = '23503',
      message = 'invalid_team_category: tipo de equipe invalido para o tenant atual.';
  end if;

  if v_code = 'TECNICA' and new.foreman_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_foreman: encarregado e obrigatorio para equipe tecnica.';
  end if;

  if v_code = 'COMERCIAL' and new.supervisor_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_supervisor: supervisor e obrigatorio para equipe comercial.';
  end if;

  select tt.team_category_id
  into v_type_category_id
  from public.team_types tt
  where tt.id = new.team_type_id
    and tt.tenant_id = new.tenant_id;

  if v_type_category_id is null then
    raise exception using
      errcode = '23503',
      message = 'invalid_team_type: tipo de equipe invalido para o tenant atual.';
  end if;

  if v_type_category_id is distinct from new.team_category_id then
    raise exception using
      errcode = '23514',
      message = 'team_type_category_mismatch: o tipo de equipe escolhido nao pertence ao tipo operacional da equipe.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_team_category_links() from public;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_team_type_record(uuid, uuid, uuid, text, timestamptz, uuid)'::regprocedure;
  v_missing integer;
  v_old_overloads integer;
  v_old_signatures text;
begin
  select count(*)
  into v_missing
  from public.team_types
  where team_category_id is null;

  if v_missing > 0 then
    raise exception '416: % tipo(s) de equipe ficaram sem team_category_id.', v_missing;
  end if;

  -- Nenhuma equipe pode ter ficado com tipo de outra categoria: o backfill poe
  -- tudo em TECNICA, entao so quebraria se a 415 tivesse deixado equipe
  -- comercial com tipo tecnico gravado antes desta migration.
  select count(*)
  into v_missing
  from public.teams t
  join public.team_types tt
    on tt.id = t.team_type_id
   and tt.tenant_id = t.tenant_id
  where tt.team_category_id is distinct from t.team_category_id;

  if v_missing > 0 then
    raise exception
      '416: % equipe(s) estao com tipo de equipe de outra categoria. Corrija o vinculo antes de seguir.',
      v_missing;
  end if;

  select count(*), coalesce(string_agg(sig, ' | '), '(nenhuma)')
  into v_old_overloads, v_old_signatures
  from (
    select pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_team_type_record'
      and p.oid <> v_save_fn::oid
  ) leftovers;

  if v_old_overloads > 0 then
    raise exception '416: % versao(oes) antiga(s) de save_team_type_record ainda publicada(s): %',
      v_old_overloads, v_old_signatures;
  end if;

  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '416: save_team_type_record ainda executavel por anon/authenticated';
  end if;
end;
$$;
