-- 364_retire_programming_simples_page.sql
-- Fase C8 do corte da Programacao Normalizada: aposenta o page_key
-- `programacao-simples` no banco, agora que a tela, as rotas
-- `/api/programacao(/meta)` e `server/modules/programacao` sairam do codigo.
--
-- POR QUE DESATIVAR (`ativo = false`) E NAO DELETAR A LINHA
-- ---------------------------------------------------------------------------
-- `app_pages.page_key` e referenciado por tres tabelas:
--   role_page_permissions.page_key      -> on delete CASCADE
--   app_user_page_permissions.page_key  -> on delete CASCADE
--   app_user_permission_history.page_key-> on delete SET NULL
--
-- Um `delete from app_pages` limparia as permissoes sozinho (cascade), mas
-- zeraria o `page_key` do HISTORICO — todo registro de quem concedeu ou revogou
-- essa tela viraria "pagina nula". O historico de permissao existe justamente
-- para responder "quem deu acesso a que, e quando"; perder a chave nele para
-- economizar uma linha em `app_pages` e mau negocio.
--
-- Por isso: a pagina fica na tabela, marcada `ativo = false`, e as permissoes
-- sao revogadas EXPLICITAMENTE, com registro no historico.
--
-- O QUE MUDA
-- ---------------------------------------------------------------------------
-- 1) `app_pages.ativo = false` — `requirePageAction` filtra por `ativo = true`,
--    entao a chave deixa de autorizar qualquer coisa mesmo que sobrasse alguma
--    permissao concedida.
-- 2) `app_user_page_permissions`: as 7 colunas de acao viram false para todos.
--    Diferente da 363, que deliberadamente NAO revogou: la a tela ainda existia
--    e a URL direta era a rede de seguranca do C6. Aqui a tela nao existe mais —
--    manter a permissao seria guardar acesso a uma rota que devolve 404.
-- 3) `role_page_permissions`: idem, para o template nao sugerir a tela.
-- 4) Historico das revogacoes, mesma tabela que `save_user_permissions` grava.
--
-- Nao altera schema, RLS, policies, grants nem cria funcao. Nao apaga
-- `project_programming*`, que permanece como arquivo historico.

do $$
declare
  v_page_key text := 'programacao-simples';
  v_pages_updated integer;
  v_role_perms_updated integer;
  v_user_perms_updated integer;
  v_history_inserted integer;
begin
  if not exists (select 1 from public.app_pages where page_key = v_page_key) then
    raise notice '364: page_key % ja nao existe em app_pages — nada a fazer.', v_page_key;
    return;
  end if;

  -- 1) Historico ANTES da revogacao (precisa do valor anterior).
  insert into public.app_user_permission_history (
    tenant_id, target_user_id, page_key, change_type,
    previous_can_access, new_can_access, metadata, created_by
  )
  select
    upp.tenant_id, upp.user_id, upp.page_key, 'PAGE_ACCESS_CHANGED',
    upp.can_access, false,
    jsonb_build_object(
      'source', 'migration_364',
      'reason', 'C8 do corte: tela programacao-simples removida do codigo; acesso revogado'
    ),
    null
  from public.app_user_page_permissions upp
  where upp.page_key = v_page_key
    and coalesce(upp.can_access, false) = true;
  get diagnostics v_history_inserted = row_count;

  -- 2) Revoga o acesso real.
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

  -- 3) Template por papel.
  update public.role_page_permissions
  set can_access = false, updated_at = now()
  where page_key = v_page_key
    and coalesce(can_access, false) = true;
  get diagnostics v_role_perms_updated = row_count;

  -- 4) Desativa a pagina (mantendo a linha, e com ela o page_key do historico).
  update public.app_pages
  set ativo = false, default_user_access = false, updated_at = now()
  where page_key = v_page_key
    and (ativo = true or coalesce(default_user_access, false) = true);
  get diagnostics v_pages_updated = row_count;

  raise notice '364: app_pages=% | role_page_permissions=% | app_user_page_permissions=% | historico=%',
    v_pages_updated, v_role_perms_updated, v_user_perms_updated, v_history_inserted;
end;
$$;

-- =============================================================================
-- Validacao 1: a pagina tem de estar inativa e sem concessao residual.
-- =============================================================================
do $$
declare
  v_active boolean;
  v_still_granted integer;
begin
  select ativo into v_active from public.app_pages where page_key = 'programacao-simples';

  if coalesce(v_active, false) then
    raise exception '364: programacao-simples continua ativa em app_pages.';
  end if;

  select count(*) into v_still_granted
  from public.app_user_page_permissions
  where page_key = 'programacao-simples' and can_access = true;

  if v_still_granted > 0 then
    raise exception '364: % usuario(s) ainda com can_access = true na tela removida.', v_still_granted;
  end if;
end;
$$;

-- =============================================================================
-- Validacao 2: ninguem pode ter ficado sem NENHUMA Programacao.
-- Este e o unico risco real do C8: revogar a tela antiga de alguem que nunca
-- recebeu a nova. Aborta em vez de deixar usuario sem acesso.
-- =============================================================================
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans
  from public.app_users au
  join public.app_roles r on r.id = au.role_id and r.ativo = true
  left join public.app_user_page_permissions upp
    on upp.user_id = au.id and upp.page_key = 'programacao-normalizada'
  where au.ativo = true
    and coalesce(r.is_admin, false) = false
    and coalesce(upp.can_access, false) = false;

  if v_orphans > 0 then
    raise exception '364: % usuario(s) nao-admin ativo(s) ficariam sem NENHUMA Programacao (sem acesso a programacao-normalizada). Aplique a 362 antes.', v_orphans;
  end if;
end;
$$;

-- =============================================================================
-- Validacao 3: o historico nao pode ter perdido a chave da pagina.
-- E a razao de esta migration desativar em vez de deletar.
-- =============================================================================
do $$
declare
  v_history_rows integer;
begin
  select count(*) into v_history_rows
  from public.app_user_permission_history
  where page_key = 'programacao-simples';

  raise notice '364: registros de historico preservados com o page_key da tela antiga=%', v_history_rows;
end;
$$;
