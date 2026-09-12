-- 393_close_authenticated_write_surface.sql
-- Fecha a escrita direta de `authenticated` nas tabelas de `public`.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A arquitetura do projeto, declarada nas migrations 251/298/388, e: toda
-- operacao passa por Route Handler do Next com `service_role`, depois de
-- validar bearer token, tenant ativo e permissao de pagina. Nenhuma tabela e
-- escrita com o JWT do usuario -- o client anon do browser so faz auth.
--
-- As RPCs `SECURITY DEFINER` ja foram fechadas nesse padrao (251 e 309 em
-- varredura, 298 e 388 pontualmente). As TABELAS nao. Ate aqui, 83 delas
-- mantinham policy no molde
--
--     for insert/update to authenticated using (user_can_access_tenant(tenant_id))
--
-- que valida apenas o vinculo com o tenant: nao olha papel, nao olha permissao
-- de pagina, nao conhece regra de negocio. Com o anon key (publico, vai no
-- bundle) e o proprio JWT, um usuario de papel `viewer` podia chamar
-- /rest/v1/<tabela> e gravar direto, contornando `authorizePageAction`, as
-- validacoes do handler, os guards internos das RPCs e a atomicidade das
-- transacoes. E o mesmo cenario que a 388 descreve para
-- `set_project_billing_order_status`, so que pelo lado da tabela.
--
-- O isolamento multi-tenant nunca esteve em risco: `user_can_access_tenant` da
-- conta disso nos dois caminhos. O que faltava era a camada de permissao.
--
-- Isto nao e regra nova. `guias/guia_sql.md` ja dizia:
--   regra 13 - tabela operacional critica nao aceita INSERT/UPDATE direto de
--              `authenticated` quando a regra exige API/RPC;
--   regra 14 - RLS continua obrigatoria para SELECT mesmo quando a escrita
--              passa por RPC.
-- O schema e que tinha derivado do guia. Esta migration realinha os dois.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. Preserva a LEITURA antes de qualquer remocao. Uma policy `FOR ALL` cobre
--    tambem o SELECT; derrubar sem olhar poderia cegar a tabela. Para cada
--    policy `ALL` de `authenticated`, se a tabela nao tiver outra policy de
--    SELECT para `authenticated`, o `USING` original e recriado como policy de
--    SELECT antes do drop. Se ja tiver, apenas registra em NOTICE para
--    conferencia -- nao cria policy redundante, que reabriria o alerta
--    `multiple_permissive_policies` fechado pela 300.
-- 2. Derruba as policies de INSERT/UPDATE/DELETE/ALL de `authenticated`.
-- 3. Revoga INSERT/UPDATE/DELETE de `anon` e `authenticated` no schema inteiro.
--    Defesa em camadas: mesmo que uma policy volte por engano, sem o GRANT de
--    tabela o PostgREST nao escreve. SELECT permanece intocado.
-- 4. Ajusta ALTER DEFAULT PRIVILEGES para que tabela futura nao nasca aberta.
-- 5. Valida no fim e aborta a propria migration se sobrar superficie de escrita.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao toca em policy de SELECT, nao toca em `service_role` (que ignora RLS por
-- BYPASSRLS e continua sendo o caminho do backend), nao toca em GRANT de SELECT
-- e nao altera nenhuma linha de dado. Nenhum arquivo TypeScript muda: o app
-- nunca dependeu dessas policies.

-- ---------------------------------------------------------------------------
-- Passo 0 - snapshot do estado anterior, no mesmo padrao da 173.
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.write_policies_before_393;

create temporary table write_policies_before_393 on commit drop as
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  and 'authenticated' = any(roles);

do $$
declare
  v_total int;
begin
  select count(*) into v_total from pg_temp.write_policies_before_393;
  raise notice '393: % policy(ies) de escrita para authenticated encontradas antes do hardening.', v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Passo 1 - preservar leitura das policies FOR ALL antes de derrubar.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy       record;
  v_has_select   boolean;
  v_using        text;
  v_policy_name  text;
  v_preserved    int := 0;
  v_skipped      int := 0;
begin
  for v_policy in
    select *
    from pg_temp.write_policies_before_393
    where cmd = 'ALL'
  loop
    if to_regclass(format('%I.%I', v_policy.schemaname, v_policy.tablename)) is null then
      continue;
    end if;

    -- COALESCE obrigatorio: `exists` nunca e null aqui, mas a variavel entra
    -- direto num IF e a regra 20 do guia_sql vale para toda booleana nulavel.
    select coalesce(
      exists (
        select 1
        from pg_policies p
        where p.schemaname = v_policy.schemaname
          and p.tablename = v_policy.tablename
          and p.cmd = 'SELECT'
          and 'authenticated' = any(p.roles)
      ),
      false
    )
    into v_has_select;

    if v_has_select then
      v_skipped := v_skipped + 1;
      raise notice '393: %.% ja possui policy de SELECT para authenticated; policy ALL % sera apenas removida.',
        v_policy.schemaname, v_policy.tablename, v_policy.policyname;
      continue;
    end if;

    v_using := coalesce(nullif(v_policy.qual, ''), 'true');

    v_policy_name := left(format('%s_select_preserved', v_policy.policyname), 54)
      || '_'
      || substr(md5(v_policy.schemaname || '.' || v_policy.tablename || '.' || v_policy.policyname), 1, 8);

    execute format('drop policy if exists %I on %I.%I', v_policy_name, v_policy.schemaname, v_policy.tablename);
    execute format(
      'create policy %I on %I.%I as %s for select to authenticated using (%s)',
      v_policy_name,
      v_policy.schemaname,
      v_policy.tablename,
      v_policy.permissive,
      v_using
    );

    v_preserved := v_preserved + 1;
    raise notice '393: leitura de %.% preservada em %.',
      v_policy.schemaname, v_policy.tablename, v_policy_name;
  end loop;

  raise notice '393: % policy(ies) de SELECT criada(s) para preservar leitura, % tabela(s) ja cobertas.',
    v_preserved, v_skipped;
end;
$$;

-- ---------------------------------------------------------------------------
-- Passo 2 - derrubar as policies de escrita de authenticated.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy  record;
  v_dropped int := 0;
begin
  for v_policy in
    select *
    from pg_temp.write_policies_before_393
  loop
    if to_regclass(format('%I.%I', v_policy.schemaname, v_policy.tablename)) is null then
      continue;
    end if;

    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename
    );

    v_dropped := v_dropped + 1;
  end loop;

  raise notice '393: % policy(ies) de escrita removida(s).', v_dropped;
end;
$$;

-- ---------------------------------------------------------------------------
-- Passo 3 - revogar o GRANT de escrita no schema inteiro.
-- SELECT permanece: e o que sustenta a RLS de leitura por tenant.
-- ---------------------------------------------------------------------------
-- `public` entra na lista porque privilegio concedido a PUBLIC alcanca anon e
-- authenticated por heranca, e revogar so dos dois nao o removeria -- a
-- validacao do passo 5 abortaria a migration apontando residuo. `service_role`
-- nao e afetado: tem GRANT proprio e ainda ignora RLS por BYPASSRLS.
revoke insert, update, delete on all tables in schema public from public;
revoke insert, update, delete on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------
-- Passo 4 - tabela futura nao nasce com escrita aberta.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  revoke insert, update, delete on tables from public;

alter default privileges in schema public
  revoke insert, update, delete on tables from anon;

alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

-- ---------------------------------------------------------------------------
-- Passo 5 - validacao pos-aplicacao. Aborta se sobrar superficie de escrita.
-- ---------------------------------------------------------------------------
do $$
declare
  v_row            record;
  v_policy_count   int := 0;
  v_grant_count    int := 0;
  v_blind_count    int := 0;
  v_service_count  int := 0;
begin
  -- 5a. nenhuma policy de escrita para authenticated pode restar.
  for v_row in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and 'authenticated' = any(roles)
    order by tablename, policyname
  loop
    raise warning '393 RESIDUO: policy de escrita %.% (%) ainda aceita authenticated.',
      v_row.tablename, v_row.policyname, v_row.cmd;
    v_policy_count := v_policy_count + 1;
  end loop;

  -- 5b. nenhum GRANT de escrita para anon/authenticated pode restar.
  for v_row in
    select c.relname as tablename, g.role_name, g.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      values ('anon', 'INSERT'), ('anon', 'UPDATE'), ('anon', 'DELETE'),
             ('authenticated', 'INSERT'), ('authenticated', 'UPDATE'), ('authenticated', 'DELETE')
    ) as g(role_name, priv)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege(g.role_name, c.oid, g.priv)
    order by c.relname, g.role_name, g.priv
  loop
    raise warning '393 RESIDUO: % ainda tem % em public.%.',
      v_row.role_name, v_row.priv, v_row.tablename;
    v_grant_count := v_grant_count + 1;
  end loop;

  -- 5c. nenhuma tabela pode ter ficado cega para leitura por causa do passo 1.
  for v_row in
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = c.relname
          and p.cmd in ('SELECT', 'ALL')
          and 'authenticated' = any(p.roles)
      )
      and exists (
        select 1
        from pg_temp.write_policies_before_393 b
        where b.tablename = c.relname
          and b.cmd = 'ALL'
      )
    order by c.relname
  loop
    raise warning '393 REGRESSAO: public.% perdeu a policy de SELECT para authenticated.', v_row.tablename;
    v_blind_count := v_blind_count + 1;
  end loop;

  -- 5d. rede de seguranca: `service_role` e o caminho de TODO o backend. O
  -- passo 3 revoga de PUBLIC, o que em Postgres e no-op para tabela (o default
  -- embutido nao concede nada a PUBLIC em tabelas -- so EXECUTE em funcoes).
  -- Mas se neste banco alguem tiver concedido escrita via PUBLIC e o
  -- service_role dependesse disso, o revoke o deixaria sem acesso e derrubaria
  -- a aplicacao inteira. Melhor abortar dentro da transacao do que descobrir
  -- em producao.
  for v_row in
    select c.relname as tablename, g.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (values ('INSERT'), ('UPDATE'), ('DELETE')) as g(priv)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not has_table_privilege('service_role', c.oid, g.priv)
    order by c.relname, g.priv
  loop
    raise warning '393 REGRESSAO CRITICA: service_role perdeu % em public.%.', v_row.priv, v_row.tablename;
    v_service_count := v_service_count + 1;
  end loop;

  if v_policy_count > 0 or v_grant_count > 0 or v_blind_count > 0 or v_service_count > 0 then
    raise exception
      '393 FALHOU: % policy(ies) de escrita, % grant(s) de escrita, % regressao(oes) de leitura e % perda(s) de acesso do service_role. Veja os WARNINGs acima.',
      v_policy_count, v_grant_count, v_blind_count, v_service_count;
  end if;

  raise notice '393 OK: nenhuma escrita direta de anon/authenticated em public, leitura e service_role preservados.';
end;
$$;
