-- 362_grant_programming_normalized_page_to_user_role.sql
-- Libera a TELA `programacao-normalizada` para o papel "Usuario"
-- (role_key = 'user', nao-admin). Fase C3 do corte da Programacao Normalizada.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Premissa do usuario: `/programacao-normalizada` passa a ser a Programacao
-- principal e as demais saem de uso. Hoje o caminho padrao do menu ainda leva
-- para `programacao-simples` (congelada), e a Normalizada nasceu BLOQUEADA para
-- nao-admin na migration 312 (`default_user_access = false`).
--
-- Existe hoje uma inversao concreta: a migration 348 liberou as TRES permissoes
-- granulares filhas (`programacao-concluir`, `programacao-pendencia`,
-- `programacao-corrigir-data`) para o papel "Usuario", mas a tela PAI continuou
-- bloqueada por default. Ou seja, o papel tem as sub-permissoes de uma tela a
-- que so chega por concessao individual. Esta migration fecha essa inversao.
--
-- POR QUE PRECISA SER MIGRATION, e nao so editar a constante do front
-- ---------------------------------------------------------------------------
-- `DEFAULT_USER_PAGE_ACCESS` (src/lib/auth/authorization.ts) documenta a regra:
-- adicionar uma chave la exige que o banco JA tenha `default_user_access = true`
-- para ela. E a migration 356 instalou um trigger BEFORE INSERT que forca
-- `false` em todo INSERT de `app_pages`, justamente para que liberar tela seja
-- sempre um passo explicito e visivel no diff — nunca escondido num `coalesce`.
-- Aquele trigger nao afeta UPDATE, que e o caminho usado aqui.
--
-- ESCOPO
-- ---------------------------------------------------------------------------
-- `app_roles` e `app_pages` sao tabelas GLOBAIS (sem tenant_id): existe um unico
-- papel "Usuario" no sistema. O UPDATE de `app_user_page_permissions` e
-- naturalmente escopado por tenant pelo proprio `user_id`, entao nao precisa de
-- WHERE tenant_id explicito — mesmo raciocinio registrado na 348.
--
-- O QUE MUDA (mesmos 4 passos da 348, mesma ordem)
-- ---------------------------------------------------------------------------
-- 1) `app_pages.default_user_access = true` para `programacao-normalizada`:
--    usuario nao-admin criado a partir de agora ja nasce com a tela liberada
--    pelo gatilho `ensure_app_user_default_page_permissions` (253).
-- 2) `role_page_permissions.can_access = true` para o papel "Usuario": mantem o
--    template coerente com o novo default. Nao e lido em runtime (a sessao usa
--    so `app_user_page_permissions`, ver session-access/route.ts), mas evita a
--    divergencia template/dado real.
-- 3) `app_user_page_permissions` das pessoas atuais do papel "Usuario": as 7
--    colunas de acao viram true, mesmo padrao de `save_user_permissions` (253),
--    em que o toggle da UI habilita todas as acoes juntas.
-- 4) Registro em `app_user_permission_history` para quem realmente mudou de
--    false para true, para o historico de auditoria nao ficar com buraco.
--
-- O QUE ESTA MIGRATION NAO FAZ (decisao registrada, nao e omissao)
-- ---------------------------------------------------------------------------
-- - NAO remove acesso a `programacao-simples` nem a `programacao-visualizacao`.
--   Enquanto o menu ainda aponta para a Simples (C6/C7), tirar acesso aqui
--   deixaria o usuario comum sem NENHUMA Programacao. A retirada e passo
--   posterior e separado.
-- - NAO mexe nas tres granulares: a 348 ja as liberou.
-- - NAO altera schema, RLS, policies, grants nem cria funcao.

do $$
declare
  v_user_role_id uuid;
  v_page_key text := 'programacao-normalizada';
  v_pages_updated integer;
  v_role_perms_updated integer;
  v_user_perms_updated integer;
  v_history_inserted integer;
begin
  select id into v_user_role_id from public.app_roles where role_key = 'user' and ativo = true;

  if v_user_role_id is null then
    raise exception '362: papel "user" nao encontrado ou inativo — nada a fazer.';
  end if;

  if not exists (select 1 from public.app_pages where page_key = v_page_key) then
    raise exception '362: page_key % nao existe em app_pages — a 312 deveria te-la cadastrado.', v_page_key;
  end if;

  -- 1) Default para novos usuarios.
  update public.app_pages
  set default_user_access = true, updated_at = now()
  where page_key = v_page_key
    and coalesce(default_user_access, false) = false;
  get diagnostics v_pages_updated = row_count;

  -- 2) Template do papel (consistencia; nao lido em runtime).
  update public.role_page_permissions
  set can_access = true, updated_at = now()
  where page_key = v_page_key
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
    jsonb_build_object(
      'source', 'migration_362',
      'reason', 'C3 do corte: liberar a tela programacao-normalizada para o papel Usuario'
    ),
    null
  from public.app_user_page_permissions upp
  join public.app_users au on au.id = upp.user_id
  where upp.page_key = v_page_key
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
    and upp.page_key = v_page_key
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

  raise notice '362: app_pages atualizadas=% | role_page_permissions atualizadas=% | app_user_page_permissions atualizadas=% | historico gravado=%',
    v_pages_updated, v_role_perms_updated, v_user_perms_updated, v_history_inserted;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao 1: ninguem do papel "Usuario" pode ficar sem a tela.
-- =============================================================================
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.app_users au
  join public.app_roles r on r.id = au.role_id and r.role_key = 'user' and r.ativo = true
  left join public.app_user_page_permissions upp
    on upp.user_id = au.id and upp.page_key = 'programacao-normalizada'
  where au.ativo = true
    and (upp.can_access is distinct from true);

  if v_missing > 0 then
    raise exception '362: % usuario(s) do papel Usuario ainda sem can_access=true em programacao-normalizada.', v_missing;
  end if;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao 2: a inversao pai/filho tem de estar fechada.
-- A tela PAI nao pode continuar mais restrita que as granulares filhas que a
-- 348 liberou — era exatamente o estado que esta migration veio corrigir.
-- =============================================================================
do $$
declare
  v_parent_default boolean;
  v_children_default integer;
begin
  select coalesce(default_user_access, false) into v_parent_default
  from public.app_pages where page_key = 'programacao-normalizada';

  select count(*) into v_children_default
  from public.app_pages
  where page_key in ('programacao-concluir', 'programacao-pendencia', 'programacao-corrigir-data')
    and coalesce(default_user_access, false) = true;

  if v_children_default > 0 and v_parent_default = false then
    raise exception '362: % permissao(oes) granular(es) liberada(s) por default com a tela pai bloqueada — inversao nao corrigida.', v_children_default;
  end if;

  raise notice '362: pai default_user_access=% | granulares liberadas por default=%', v_parent_default, v_children_default;
end;
$$;
