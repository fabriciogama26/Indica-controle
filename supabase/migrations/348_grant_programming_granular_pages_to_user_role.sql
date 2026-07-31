-- 348_grant_programming_granular_pages_to_user_role.sql
-- Libera as 3 permissoes granulares da Programacao Normalizada (328:
-- programacao-concluir, programacao-pendencia, programacao-corrigir-data)
-- para o papel "Usuario" (role_key = 'user', nao-admin).
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Auditoria pedida pelo usuario nesta rodada: um usuario do papel "Usuario"
-- (ALAN REIS) ja tinha acesso a tela `programacao-normalizada`, mas nao via o
-- checkbox de Pendencia no formulario de "Nova etapa" (`canPendencia` em
-- hooks.ts:65 exige `isAdmin || hasPageAccess(..., "programacao-pendencia")`).
-- Confirmado em producao antes desta migration: das 17 pessoas ativas com
-- papel "Usuario" (unico papel nao-admin do sistema, tenant "INDICA SERVICO -
-- ANGRA"), 0 tinham `programacao-pendencia`, `programacao-concluir` ou
-- `programacao-corrigir-data` concedidas (migration 328 as registrou com
-- default_user_access = false, admin-only por padrao). Decisao do usuario:
-- liberar o trio inteiro para todo o papel "Usuario", nao so para o ALAN REIS.
--
-- ESCOPO
-- ---------------------------------------------------------------------------
-- `app_roles` e `app_pages` sao tabelas GLOBAIS (sem tenant_id) — so existe UM
-- papel "Usuario" no sistema inteiro, compartilhado entre tenants. Hoje so o
-- tenant "INDICA SERVICO - ANGRA" tem pessoas ativas com esse papel (17); o
-- tenant "TESTE" tem zero. O UPDATE de `app_user_page_permissions` abaixo e
-- naturalmente escopado por tenant via o proprio `user_id` (cada linha ja
-- pertence a um tenant), entao nao ha necessidade de um WHERE tenant_id
-- explicito — o efeito pratico e restrito ao tenant real hoje.
--
-- O QUE MUDA
-- ---------------------------------------------------------------------------
-- 1) `app_pages.default_user_access = true` para os 3 page_keys: qualquer
--    NOVO usuario nao-admin criado a partir de agora (gatilho
--    `ensure_app_user_default_page_permissions`, migration 253) ja nasce com
--    o trio liberado, sem precisar de ajuste manual depois.
-- 2) `role_page_permissions.can_access = true` para o papel "Usuario": mantem
--    o template consistente com o novo default (nao e lido em runtime — a
--    sessao usa so `app_user_page_permissions`, ver session-access/route.ts —
--    mas evita a mesma divergencia template/dado real que esta migration esta
--    corrigindo).
-- 3) `app_user_page_permissions` das 17 pessoas atuais do papel "Usuario":
--    todas as 7 colunas de acao (can_access/create/update/cancel/reverse/
--    import/export) viram true para os 3 page_keys — mesmo padrao de
--    `save_user_permissions` (253): "o toggle da UI habilita/desabilita todas
--    as acoes simultaneamente".
-- 4) Registro em `app_user_permission_history` (change_type
--    'PAGE_ACCESS_CHANGED', created_by null = mudanca via migration, nao via
--    admin na UI) para as pessoas que realmente mudaram de false para true —
--    mesma tabela que `save_user_permissions` grava, para o historico de
--    auditoria nao ficar com um buraco nesta mudanca.

do $$
declare
  v_user_role_id uuid;
  v_page_keys text[] := array['programacao-concluir', 'programacao-pendencia', 'programacao-corrigir-data'];
  v_pages_updated integer;
  v_role_perms_updated integer;
  v_user_perms_updated integer;
  v_history_inserted integer;
begin
  select id into v_user_role_id from public.app_roles where role_key = 'user' and ativo = true;

  if v_user_role_id is null then
    raise exception '348: papel "user" nao encontrado ou inativo — nada a fazer.';
  end if;

  -- 1) Default para novos usuarios.
  update public.app_pages
  set default_user_access = true, updated_at = now()
  where page_key = any (v_page_keys)
    and coalesce(default_user_access, false) = false;
  get diagnostics v_pages_updated = row_count;

  -- 2) Template do papel (consistencia; nao lido em runtime).
  update public.role_page_permissions
  set can_access = true, updated_at = now()
  where page_key = any (v_page_keys)
    and role_id = v_user_role_id
    and coalesce(can_access, false) = false;
  get diagnostics v_role_perms_updated = row_count;

  -- 3) Historico ANTES do update (precisa do valor anterior).
  insert into public.app_user_permission_history (
    tenant_id, target_user_id, page_key, change_type,
    previous_can_access, new_can_access, metadata, created_by
  )
  select
    upp.tenant_id, upp.user_id, upp.page_key, 'PAGE_ACCESS_CHANGED',
    upp.can_access, true,
    jsonb_build_object('source', 'migration_348', 'reason', 'liberar trio granular da Programacao Normalizada para o papel Usuario'),
    null
  from public.app_user_page_permissions upp
  join public.app_users au on au.id = upp.user_id
  where upp.page_key = any (v_page_keys)
    and au.role_id = v_user_role_id
    and coalesce(upp.can_access, false) = false;
  get diagnostics v_history_inserted = row_count;

  -- 4) Permissoes reais das pessoas atuais do papel.
  update public.app_user_page_permissions upp
  set
    can_access = true,
    can_create = true,
    can_update = true,
    can_cancel = true,
    can_reverse = true,
    can_import = true,
    can_export = true,
    updated_at = now()
  from public.app_users au
  where au.id = upp.user_id
    and au.role_id = v_user_role_id
    and upp.page_key = any (v_page_keys)
    and (
      coalesce(upp.can_access, false) = false
      or coalesce(upp.can_create, false) = false
      or coalesce(upp.can_update, false) = false
      or coalesce(upp.can_cancel, false) = false
      or coalesce(upp.can_reverse, false) = false
      or coalesce(upp.can_import, false) = false
      or coalesce(upp.can_export, false) = false
    );
  get diagnostics v_user_perms_updated = row_count;

  raise notice '348: app_pages.default_user_access atualizadas=% | role_page_permissions atualizadas=% | app_user_page_permissions atualizadas=% | historico gravado=%',
    v_pages_updated, v_role_perms_updated, v_user_perms_updated, v_history_inserted;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao: ninguem do papel "Usuario" pode ficar sem o trio.
-- =============================================================================
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.app_users au
  join public.app_roles r on r.id = au.role_id and r.role_key = 'user' and r.ativo = true
  cross join (values ('programacao-concluir'), ('programacao-pendencia'), ('programacao-corrigir-data')) as pk(page_key)
  left join public.app_user_page_permissions upp
    on upp.user_id = au.id and upp.page_key = pk.page_key
  where au.ativo = true
    and (upp.can_access is distinct from true);

  if v_missing > 0 then
    raise exception '348: % combinacao(oes) usuario+page_key do papel Usuario ainda sem can_access=true apos a migration.', v_missing;
  end if;
end;
$$;
