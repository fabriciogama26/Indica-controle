-- 394_harden_function_search_path_post_210.sql
-- Aplica `set search_path` nas funcoes criadas DEPOIS da migration 210.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A 210 corrigiu `function_search_path_mutable` em bloco, para uma lista fixa
-- de 17 funcoes que existiam naquele momento. Quatro funcoes criadas depois
-- dela nao trazem a clausula na propria definicao:
--
--   user_is_admin_in_tenant                         (386)
--   tg_programming_set_updated_at                   (320)
--   tg_programming_capture_anticipated_snapshot     (338)
--   tg_programming_clear_snapshot_source            (338)
--
-- Nenhuma e `SECURITY DEFINER`, entao nao ha escalada direta de privilegio.
-- Ainda assim `user_is_admin_in_tenant` merece a clausula pelo papel que ocupa:
-- e a expressao das policies de escrita de `role_page_permissions` e
-- `app_user_page_permissions`, ou seja, a funcao que decide quem pode alterar
-- permissao. O Supabase Advisor sinaliza as quatro.
--
-- Em vez de repetir a lista fixa (que e justamente o que fez a 210 envelhecer),
-- este bloco varre todas as funcoes de `public` sem `search_path` configurado.
-- Assim a migration tambem cobre qualquer funcao antiga que tenha escapado, e
-- nao precisa ser reescrita quando surgir uma nova.
--
-- FUNCAO DE EXTENSAO FICA DE FORA
-- ---------------------------------------------------------------------------
-- Se alguma extensao estiver instalada em `public` (pgcrypto, uuid-ossp), suas
-- funcoes pertencem ao pacote da extensao: alterar uma delas falha por falta de
-- ownership ou quebra o `pg_dump` da extensao. O filtro por `pg_depend` com
-- `deptype = 'e'` remove essas funcoes da varredura, no bloco de aplicacao e no
-- de validacao -- se so um dos dois filtrasse, a validacao abortaria sozinha.

do $$
declare
  r        record;
  v_fixed  int := 0;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      -- proconfig guarda os SET da funcao; sem entrada search_path = mutavel.
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where split_part(cfg, '=', 1) = 'search_path'
      )
      -- nao mexer em funcao que pertence a uma extensao.
      and not exists (
        select 1
        from pg_depend d
        where d.objid = p.oid
          and d.classid = 'pg_proc'::regclass
          and d.deptype = 'e'
      )
    order by p.proname
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      r.schema_name,
      r.function_name,
      r.identity_args
    );

    v_fixed := v_fixed + 1;
    raise notice '394: search_path fixado em %.%(%).', r.schema_name, r.function_name, r.identity_args;
  end loop;

  raise notice '394: % funcao(oes) ajustada(s).', v_fixed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validacao pos-aplicacao. Aborta se sobrar funcao com search_path mutavel.
-- Mesmo filtro de extensao do bloco acima.
-- ---------------------------------------------------------------------------
do $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where split_part(cfg, '=', 1) = 'search_path'
      )
      and not exists (
        select 1
        from pg_depend d
        where d.objid = p.oid
          and d.classid = 'pg_proc'::regclass
          and d.deptype = 'e'
      )
    order by p.proname
  loop
    raise warning '394 RESIDUO: public.%(%) segue com search_path mutavel.',
      v_row.function_name, v_row.identity_args;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise exception '394 FALHOU: % funcao(oes) com search_path mutavel. Veja os WARNINGs acima.', v_count;
  end if;

  raise notice '394 OK: nenhuma funcao de public com search_path mutavel.';
end;
$$;
