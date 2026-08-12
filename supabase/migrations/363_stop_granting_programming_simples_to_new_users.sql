-- 363_stop_granting_programming_simples_to_new_users.sql
-- Fase C7 do corte da Programacao Normalizada: a tela antiga
-- `programacao-simples` para de ser concedida a usuario NOVO.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- No C6 a Normalizada assumiu o nome principal e a tela antiga saiu do menu.
-- Ela continua alcancavel por URL direta, somente leitura, ate o C8 remove-la —
-- e essa e a rede de seguranca para comparar as duas em producao se preciso.
--
-- O QUE MUDA, E O QUE DELIBERADAMENTE NAO MUDA
-- ---------------------------------------------------------------------------
-- MUDA: `app_pages.default_user_access` de `programacao-simples` vai para
-- `false`. Efeito: usuario nao-admin criado a partir de agora NAO nasce mais com
-- a tela antiga (gatilho `ensure_app_user_default_page_permissions`, 253, que le
-- `default_user_access` da pagina).
--
-- NAO MUDA: `app_user_page_permissions` de quem JA tem acesso. Revogar aqui
-- mataria a rede de seguranca do C6 no mesmo dia em que ela passou a ser o unico
-- caminho para a tela antiga. A limpeza dessas linhas e do C8, junto com a
-- remocao da tela — la o page_key deixa de existir e a revogacao vira
-- consequencia, nao decisao.
--
-- POR QUE ESTA MIGRATION PRECISA VIR ANTES DA MUDANCA NO FRONT
-- ---------------------------------------------------------------------------
-- `DEFAULT_USER_PAGE_ACCESS` (src/lib/auth/authorization.ts) documenta a regra:
-- "Alteracao permitida nesta lista: REMOVER chave cujo `default_user_access` no
-- banco seja `false`." Enquanto o banco disser `true`, tirar `programacao-simples`
-- da constante criaria divergencia lista-x-banco no sentido contrario ao que a
-- regra permite. Esta migration deixa o banco em `false` primeiro; a remocao da
-- constante entra na mesma entrega, depois.
--
-- Nao altera schema, RLS, policies, grants nem cria funcao.

do $$
declare
  v_page_key text := 'programacao-simples';
  v_pages_updated integer;
  v_role_perms_updated integer;
  v_user_role_id uuid;
begin
  if not exists (select 1 from public.app_pages where page_key = v_page_key) then
    raise exception '363: page_key % nao existe em app_pages.', v_page_key;
  end if;

  select id into v_user_role_id from public.app_roles where role_key = 'user' and ativo = true;

  -- 1) Usuario NOVO deixa de nascer com a tela antiga.
  update public.app_pages
  set default_user_access = false, updated_at = now()
  where page_key = v_page_key
    and coalesce(default_user_access, false) = true;
  get diagnostics v_pages_updated = row_count;

  -- 2) Template do papel acompanha (nao e lido em runtime; mantido coerente com
  --    o novo default, mesmo raciocinio da 348 e da 362).
  if v_user_role_id is not null then
    update public.role_page_permissions
    set can_access = false, updated_at = now()
    where page_key = v_page_key
      and role_id = v_user_role_id
      and coalesce(can_access, false) = true;
    get diagnostics v_role_perms_updated = row_count;
  else
    v_role_perms_updated := 0;
  end if;

  raise notice '363: app_pages atualizadas=% | role_page_permissions atualizadas=% | app_user_page_permissions PRESERVADAS de proposito (rede de seguranca do C6)',
    v_pages_updated, v_role_perms_updated;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao 1: o default tem de estar desligado.
-- =============================================================================
do $$
declare
  v_default boolean;
begin
  select coalesce(default_user_access, false) into v_default
  from public.app_pages where page_key = 'programacao-simples';

  if v_default then
    raise exception '363: programacao-simples continua com default_user_access = true.';
  end if;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao 2: NINGUEM pode ter perdido acesso.
-- Esta migration existe para parar de CONCEDER, nunca para revogar. Se alguem
-- perdeu `can_access`, algo revogou junto e a rede de seguranca do C6 caiu.
-- =============================================================================
do $$
declare
  v_with_access integer;
begin
  select count(*) into v_with_access
  from public.app_user_page_permissions
  where page_key = 'programacao-simples'
    and can_access = true;

  raise notice '363: usuarios que MANTIVERAM acesso a tela antiga=% (esperado: o mesmo numero de antes da migration)', v_with_access;
end;
$$;

-- =============================================================================
-- Validacao pos-execucao 3: a Normalizada tem de estar liberada.
-- Tirar o default da tela antiga so e seguro se a nova ja estiver concedida —
-- caso contrario um usuario novo nasceria sem NENHUMA Programacao.
-- =============================================================================
do $$
declare
  v_normalized_default boolean;
begin
  select coalesce(default_user_access, false) into v_normalized_default
  from public.app_pages where page_key = 'programacao-normalizada';

  if not v_normalized_default then
    raise exception '363: programacao-normalizada ainda esta com default_user_access = false — aplique a 362 antes. Usuario novo nasceria sem nenhuma Programacao.';
  end if;
end;
$$;
