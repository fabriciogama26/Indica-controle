-- 356_force_new_pages_blocked_by_default.sql
-- Garante, por construcao, que toda tela nova nasca BLOQUEADA para usuarios nao
-- administrativos, independentemente do valor que a migration de cadastro passar.
--
-- INCIDENTE QUE ORIGINOU ESTA MIGRATION
-- ---------------------------------------------------------------------------
-- A migration 355 cadastrou `medicao-visualizacao` herdando o `default_user_access`
-- da pagina `medicao`:
--
--   coalesce((select default_user_access from app_pages where page_key = 'medicao'), false)
--
-- A migration 245 tinha feito um UPDATE em massa marcando TODAS as paginas existentes
-- como `true` (exceto `mapa-programacao`), entao `medicao` = true e a tela nova nasceu
-- `true`. Consequencia em cadeia:
--
--   1. O trigger AFTER INSERT `trg_app_pages_default_user_permissions` (253) dispara no
--      proprio `insert into app_pages` e grava as 7 colunas = `new.default_user_access`
--      para TODOS os usuarios ja existentes -> todos com a tela liberada.
--   2. O backfill "por usuario" da 355 (copiar o valor que cada um tem em `medicao`)
--      vinha DEPOIS e terminava em `on conflict do nothing`. As linhas ja existiam
--      (passo 1), entao o backfill foi um no-op completo.
--   3. A validacao pos-execucao da 355 so checava o sentido "ninguem perdeu acesso",
--      nunca "ninguem ganhou" -> passou em silencio.
--
-- Resultado medido antes desta migration: 12 de 20 usuarios com acesso a
-- `medicao-visualizacao`, contra 3 com acesso a `medicao` — 10 usuarios nao
-- administrativos ganharam uma tela que nunca lhes foi concedida.
--
-- SOLUCAO
-- ---------------------------------------------------------------------------
-- O default da coluna ja era `false` (245); o furo estava em migrations que passam um
-- valor explicito no INSERT. O trigger BEFORE INSERT abaixo torna o INSERT incapaz de
-- liberar uma tela: qualquer valor informado e sobrescrito por `false`, e o trigger
-- AFTER INSERT que cria a matriz de permissoes passa a enxergar sempre `false`.
--
-- Liberar uma tela continua possivel — mas apenas como passo EXPLICITO e posterior:
-- `update app_pages set default_user_access = true where page_key = '...'` mais o
-- backfill em `app_user_page_permissions` (padrao da migration 348). Isso mantem a
-- concessao visivel no diff da migration em vez de escondida num `coalesce`.

-- =============================================================================
-- 1. Trigger: INSERT em app_pages nunca libera a tela
-- =============================================================================
-- SECURITY INVOKER de proposito: a funcao so escreve em NEW, nao le nem grava em
-- nenhuma outra tabela, entao nao precisa de privilegio elevado (guia_sql.md, regra 15).
create or replace function public.force_new_app_page_blocked_by_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Atribuicao incondicional: nao ha IF sobre booleano nulavel a proteger
  -- (guia_sql.md, regras 18-22).
  new.default_user_access := false;
  return new;
end;
$$;

drop trigger if exists trg_app_pages_force_blocked_by_default on public.app_pages;
create trigger trg_app_pages_force_blocked_by_default
before insert on public.app_pages
for each row execute function public.force_new_app_page_blocked_by_default();

comment on function public.force_new_app_page_blocked_by_default() is
'Forca default_user_access = false em todo INSERT de app_pages. Tela nova nasce bloqueada para usuarios nao administrativos; liberar exige UPDATE explicito posterior + backfill em app_user_page_permissions.';

-- =============================================================================
-- 2. Correcao do estado atual: medicao-visualizacao nasceu liberada por engano
-- =============================================================================
-- Corrige apenas o default da PAGINA (usuarios novos e o fallback por role em
-- `requirePageAction`). As linhas ja gravadas em `app_user_page_permissions` para os
-- usuarios atuais NAO sao revogadas aqui: revogar acesso de usuario ativo e decisao de
-- negocio e deve ser feita pela tela de Permissoes, com trilha de auditoria e
-- `created_by`/`updated_by` reais.
update public.app_pages
set
  default_user_access = false,
  updated_at = now()
where page_key = 'medicao-visualizacao'
  and default_user_access is distinct from false;

-- =============================================================================
-- 3. Validacao pos-execucao
-- =============================================================================
do $$
declare
  v_default   boolean;
  v_has_trigger boolean;
begin
  select default_user_access
  into v_default
  from public.app_pages
  where page_key = 'medicao-visualizacao';

  if coalesce(v_default, true) is distinct from false then
    raise exception '356: medicao-visualizacao continua com default_user_access diferente de false.';
  end if;

  select exists (
    select 1
    from pg_trigger
    where tgname = 'trg_app_pages_force_blocked_by_default'
      and tgrelid = 'public.app_pages'::regclass
      and not tgisinternal
  )
  into v_has_trigger;

  if coalesce(v_has_trigger, false) is distinct from true then
    raise exception '356: trigger trg_app_pages_force_blocked_by_default nao foi criada.';
  end if;
end;
$$;
