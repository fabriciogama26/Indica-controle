-- 402_move_team_type_screen_to_tipo_equipe.sql
-- Consolida a tela de cadastro de `team_types` em `/tipo-equipe` e aposenta o
-- page_key `tipo-atividade` criado pela 401.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A 401 criou a tela como `tipo-atividade`, um page_key novo, para o cadastro
-- do campo `Tipo` de Atividades. Mas `Tipo de Atividade` e `Tipo de Equipe` sao
-- a MESMA informacao: as duas telas apontavam para `public.team_types`. Manter
-- as duas seria manter dois CRUDs concorrentes do mesmo dominio, com historico
-- de auditoria partido em dois `module_key`.
--
-- A 401 nao e editada: ela ja foi commitada e publicada, e pode ter sido
-- aplicada em algum ambiente (guia_sql regra 2). A correcao e para a frente.
-- Se a 401 nunca tiver sido aplicada, todos os blocos abaixo que tratam de
-- `tipo-atividade` simplesmente nao encontram linha e viram no-op.
--
-- O QUE MUDA
-- ---------------------------------------------------------------------------
-- 1) As duas RPCs sao republicadas gravando `module_key = 'tipo-equipe'` em
--    `app_entity_history`. A assinatura nao muda.
-- 2) O historico ja gravado como `tipo-atividade` migra para `tipo-equipe`, para
--    a tela nao perder a auditoria feita antes da consolidacao.
-- 3) `tipo-atividade` e desativada em `app_pages` e tem as permissoes revogadas,
--    no mesmo padrao da 364 (desativar, nao deletar, para nao zerar o page_key
--    de `app_user_permission_history`).
-- 4) `tipo-equipe` deixa de conceder acoes de ESCRITA a nao administradores.
--    Ver a justificativa no bloco 4.
--
-- Nao altera schema, RLS, policies nem cria tabela.

-- =============================================================================
-- 1) RPCs republicadas com module_key = 'tipo-equipe'
-- =============================================================================

create or replace function public.save_team_type_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_type_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
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
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_type_id, v_updated_at;
  else
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

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end
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
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_type_id', v_team_type_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_team_type_id is null then format('Tipo de equipe %s cadastrado com sucesso.', v_name)
        else format('Tipo de equipe %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe tipo de equipe com este nome no tenant atual.'
    );
end;
$$;

-- `create or replace` preserva os grants de uma funcao que ja existia, mas nao
-- ajuda se a 401 nunca tiver sido aplicada: nesse caso a funcao nasce aqui e
-- nasceria executavel por public. Por isso o revoke/grant e repetido.
revoke all on function public.save_team_type_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_team_type_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_team_type_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_type_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.team_types%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_linked_activities integer;
  v_linked_teams integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar tipo de equipe.'
    );
  end if;

  if p_team_type_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TEAM_TYPE_REQUIRED',
      'message', 'Tipo de equipe invalido para atualizar status.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', case when v_action = 'ACTIVATE' then 'ACTIVATION_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ACTIVATE' then 'Informe o motivo da ativacao.' else 'Informe o motivo do cancelamento.' end
    );
  end if;

  select *
  into v_current
  from public.team_types
  where tenant_id = p_tenant_id
    and id = p_team_type_id
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
      'message', 'Atualize a lista antes de alterar o status do tipo de equipe.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O tipo de equipe %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Tipo de equipe %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Tipo de equipe %s ja esta ativo.', v_current.name)
    );
  end if;

  -- `team_types` alimenta Equipes e o campo Tipo de Atividades. Inativar um tipo
  -- em uso tiraria a opcao dos selects sem tocar nos registros ja gravados,
  -- entao o cancelamento so passa quando nao ha vinculo ativo.
  if v_action = 'CANCEL' then
    select count(*)
    into v_linked_activities
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.team_type_id = p_team_type_id
      and sa.ativo = true;

    select count(*)
    into v_linked_teams
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.team_type_id = p_team_type_id
      and t.ativo = true;

    if coalesce(v_linked_activities, 0) > 0 or coalesce(v_linked_teams, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'TEAM_TYPE_IN_USE',
        'message', format(
          'Tipo de equipe %s esta em uso por %s atividade(s) e %s equipe(s) ativas. Realoque os registros antes de cancelar.',
          v_current.name,
          coalesce(v_linked_activities, 0),
          coalesce(v_linked_teams, 0)
        )
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.team_types
  set
    ativo = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_team_type_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.ativo::text, 'to', v_next_active::text)
  ) || case
    when v_action = 'ACTIVATE' then jsonb_build_object('activationReason', jsonb_build_object('from', null, 'to', v_reason))
    else jsonb_build_object('cancellationReason', jsonb_build_object('from', null, 'to', v_reason))
  end;

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
    p_team_type_id,
    v_current.name,
    v_action,
    v_reason,
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_type_id', p_team_type_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Tipo de equipe %s ativado com sucesso.', v_current.name)
        else format('Tipo de equipe %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_team_type_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_team_type_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- =============================================================================
-- 2) Historico gravado como `tipo-atividade` passa para `tipo-equipe`
-- =============================================================================
-- A tela le `app_entity_history` filtrando por module_key. Sem esta migracao,
-- qualquer alteracao feita enquanto a tela se chamava `tipo-atividade` sumiria
-- do modal de historico. O filtro por `entity_table` evita tocar em registro de
-- outro dominio que porventura use o mesmo module_key.
update public.app_entity_history
set module_key = 'tipo-equipe'
where module_key = 'tipo-atividade'
  and entity_table = 'team_types';

-- =============================================================================
-- 3) Aposenta o page_key `tipo-atividade` (padrao da 364: desativa, nao deleta)
-- =============================================================================
-- `app_pages.page_key` e referenciado por `app_user_permission_history` com
-- `on delete set null`: deletar a linha zeraria a chave da pagina no historico
-- de concessao de permissao. Por isso a pagina fica na tabela, inativa.
do $$
declare
  v_page_key text := 'tipo-atividade';
  v_pages_updated integer := 0;
  v_role_perms_updated integer := 0;
  v_user_perms_updated integer := 0;
  v_history_inserted integer := 0;
begin
  if not exists (select 1 from public.app_pages where page_key = v_page_key) then
    raise notice '402: page_key % nao existe em app_pages (401 nao aplicada) — nada a aposentar.', v_page_key;
    return;
  end if;

  insert into public.app_user_permission_history (
    tenant_id, target_user_id, page_key, change_type,
    previous_can_access, new_can_access, metadata, created_by
  )
  select
    upp.tenant_id, upp.user_id, upp.page_key, 'PAGE_ACCESS_CHANGED',
    upp.can_access, false,
    jsonb_build_object(
      'source', 'migration_402',
      'reason', 'Tela consolidada em tipo-equipe; page_key tipo-atividade aposentado'
    ),
    null
  from public.app_user_page_permissions upp
  where upp.page_key = v_page_key
    and coalesce(upp.can_access, false) = true;
  get diagnostics v_history_inserted = row_count;

  update public.app_user_page_permissions
  set
    can_access = false,
    can_create = false,
    can_update = false,
    can_cancel = false,
    can_reverse = false,
    can_import = false,
    can_export = false,
    updated_at = now()
  where page_key = v_page_key
    and (
      coalesce(can_access, false) = true
      or coalesce(can_create, false) = true
      or coalesce(can_update, false) = true
      or coalesce(can_cancel, false) = true
      or coalesce(can_reverse, false) = true
      or coalesce(can_import, false) = true
      or coalesce(can_export, false) = true
    );
  get diagnostics v_user_perms_updated = row_count;

  update public.role_page_permissions
  set can_access = false, updated_at = now()
  where page_key = v_page_key
    and coalesce(can_access, false) = true;
  get diagnostics v_role_perms_updated = row_count;

  update public.app_pages
  set ativo = false, default_user_access = false, updated_at = now()
  where page_key = v_page_key
    and (ativo = true or coalesce(default_user_access, false) = true);
  get diagnostics v_pages_updated = row_count;

  raise notice '402: app_pages=% | role_page_permissions=% | app_user_page_permissions=% | historico=%',
    v_pages_updated, v_role_perms_updated, v_user_perms_updated, v_history_inserted;
end;
$$;

-- =============================================================================
-- 4) `tipo-equipe` deixa de conceder ESCRITA a nao administrador
-- =============================================================================
-- Ate agora `/tipo-equipe` era um `ModulePlaceholder`: sem persistencia, a
-- permissao era inofensiva. A 245 deu `default_user_access = true` a todas as
-- paginas exceto `mapa-programacao`, e a 253 fez backfill de
-- `can_create/can_update/can_cancel/can_export = can_access` para todas as
-- linhas existentes. Ou seja: ao trocar o placeholder por um CRUD real, todo
-- usuario nao-admin que ja enxergava a tela ganharia, sem nenhuma acao do
-- administrador, o poder de renomear e cancelar tipos usados por Equipes,
-- Meta, Medicao e Atividades.
--
-- `can_access` e PRESERVADO: quem via a tela continua vendo e consultando.
-- Apenas as acoes de escrita voltam a false, para o administrador liberar caso
-- a caso em /permissoes — mesmo criterio que a 401 aplicou ao criar a tela.
-- Admin nao e afetado: `requirePageAction` libera tudo antes de consultar estas
-- tabelas.
do $$
declare
  v_user_perms_updated integer := 0;
  v_role_perms_updated integer := 0;
begin
  update public.app_user_page_permissions upp
  set
    can_create = false,
    can_update = false,
    can_cancel = false,
    can_export = false,
    updated_at = now()
  from public.app_users au
  left join public.app_roles r
    on r.id = au.role_id
   and r.ativo = true
  where upp.user_id = au.id
    and upp.tenant_id = au.tenant_id
    and upp.page_key = 'tipo-equipe'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(upp.can_create, false) = true
      or coalesce(upp.can_update, false) = true
      or coalesce(upp.can_cancel, false) = true
      or coalesce(upp.can_export, false) = true
    );
  get diagnostics v_user_perms_updated = row_count;

  update public.role_page_permissions rpp
  set
    can_create = false,
    can_update = false,
    can_cancel = false,
    can_export = false,
    updated_at = now()
  from public.app_roles r
  where r.id = rpp.role_id
    and rpp.page_key = 'tipo-equipe'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(rpp.can_create, false) = true
      or coalesce(rpp.can_update, false) = true
      or coalesce(rpp.can_cancel, false) = true
      or coalesce(rpp.can_export, false) = true
    );
  get diagnostics v_role_perms_updated = row_count;

  raise notice '402: escrita em tipo-equipe revogada para nao-admin | app_user_page_permissions=% | role_page_permissions=%',
    v_user_perms_updated, v_role_perms_updated;
end;
$$;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_team_type_record(uuid, uuid, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_team_type_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
  v_orphan_history integer;
  v_still_active boolean;
  v_write_leaks integer;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '402: save_team_type_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '402: set_team_type_record_status ainda executavel por anon/authenticated';
  end if;

  -- A tela `tipo-equipe` precisa existir e estar ativa: e ela que autoriza agora.
  if not exists (
    select 1
    from public.app_pages
    where page_key = 'tipo-equipe'
      and ativo = true
  ) then
    raise exception '402: pagina tipo-equipe nao esta ativa em app_pages';
  end if;

  -- Nenhum historico de team_types pode ter ficado no module_key antigo.
  select count(*)
  into v_orphan_history
  from public.app_entity_history
  where module_key = 'tipo-atividade'
    and entity_table = 'team_types';

  if v_orphan_history > 0 then
    raise exception '402: % registro(s) de historico de team_types ainda em module_key tipo-atividade', v_orphan_history;
  end if;

  -- Se a 401 tiver sido aplicada, a pagina antiga tem de ter ficado inativa.
  select ativo into v_still_active from public.app_pages where page_key = 'tipo-atividade';
  if coalesce(v_still_active, false) then
    raise exception '402: page_key tipo-atividade continua ativo em app_pages';
  end if;

  -- Nenhum nao-admin pode ter sobrado com escrita em tipo-equipe.
  select count(*)
  into v_write_leaks
  from public.app_user_page_permissions upp
  join public.app_users au
    on au.id = upp.user_id
   and au.tenant_id = upp.tenant_id
  left join public.app_roles r
    on r.id = au.role_id
   and r.ativo = true
  where upp.page_key = 'tipo-equipe'
    and coalesce(r.is_admin, false) = false
    and (
      coalesce(upp.can_create, false) = true
      or coalesce(upp.can_update, false) = true
      or coalesce(upp.can_cancel, false) = true
      or coalesce(upp.can_export, false) = true
    );

  if v_write_leaks > 0 then
    raise exception '402: % permissao(oes) de escrita em tipo-equipe sobraram para nao-admin', v_write_leaks;
  end if;
end;
$$;
