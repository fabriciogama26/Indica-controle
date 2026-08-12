-- 365_drop_duplicate_project_indexes.sql
-- Fase P0 da auditoria de performance (`Auditoria/02-nivel-a-indices.md` secao 2):
-- remove os pares de indice EXATAMENTE duplicados em `public.project`, mas
-- somente quando o par realmente existir no ambiente alvo.
--
-- ORIGEM DO PROBLEMA
-- ---------------------------------------------------------------------------
-- A migration 038 converteu `project.priority` e `project.city` de texto para
-- UUID e recriou os indices com sufixo `_uuid`.
--
-- No banco auditado havia dois pares com MESMAS colunas e MESMO predicado:
--
--   idx_project_tenant_priority       (tenant_id, priority)   <- 029
--   idx_project_tenant_priority_uuid  (tenant_id, priority)   <- 038, duplicata
--   idx_project_tenant_city           (tenant_id, city)       <- 029
--   idx_project_tenant_city_uuid      (tenant_id, city)       <- 038, duplicata
--
-- O teste real da migration revelou mais um par, criado pela propria 029:
--
--   project_tenant_id_sob_key         (tenant_id, sob)        <- constraint UNIQUE
--   idx_project_tenant_sob            (tenant_id, sob)        <- indice nao-unique redundante
--
-- Mas a 038 e idempotente/defensiva e, em replay limpo ou em ambiente que ja
-- sofreu cleanup, os nomes originais podem nao existir: ao renomear/dropar as
-- colunas texto, o Postgres tambem move ou remove os indices originais. Nesse
-- caso os `_uuid` NAO sao duplicatas; sao os unicos indices do par e DEVEM ser
-- preservados.
--
-- POR QUE E SEGURO, E POR QUE DISPENSA MEDICAO
-- ---------------------------------------------------------------------------
-- Duplicata exata nunca e o unico caminho de acesso de nenhuma consulta: o
-- planner escolhe um dos dois e o outro so custa. Ambos sao mantidos em TODO
-- `INSERT`/`UPDATE`/`DELETE` de `project`, que hoje carrega 17 indices — e
-- escrita de indice gera WAL, que vai para disco. Este e o unico item da
-- auditoria que nao depende do Nivel B, porque nao ha o que medir: remover um
-- indice identico a outro nao pode piorar plano nenhum.
--
-- Quando os dois nomes existem e a assinatura e identica, mantemos os nomes SEM
-- sufixo (`_priority` e `_city`), que sao os originais da 029 e os mais antigos
-- do schema. Quando so o `_uuid` existe, ele e preservado.
--
-- Para SOB, mantemos sempre o indice da constraint UNIQUE: ele atende as mesmas
-- buscas por `(tenant_id, sob)` e ainda preserva a regra de unicidade.
--
-- Nao altera schema, RLS, policies, grants nem cria funcao.
--
-- POR QUE SEM `concurrently`
-- ---------------------------------------------------------------------------
-- A primeira versao deste arquivo usava `drop index concurrently` e FALHOU com
-- `25001: DROP INDEX CONCURRENTLY cannot run inside a transaction block`: o
-- Supabase CLI executa o arquivo inteiro numa transacao, nao statement a
-- statement.
--
-- `drop index` simples pega ACCESS EXCLUSIVE na tabela, mas por um intervalo
-- desprezivel aqui: derrubar indice e mudanca de catalogo mais unlink de
-- arquivo, nao reescrita de dados, e `project` e pequena (o banco inteiro tem
-- ~90 MB). E o mesmo padrao ja usado pela migration 300, que dropou duplicatas
-- de indice exatamente por este motivo — 15 dos 18 `drop index` do repositorio
-- sao assim.

-- =============================================================================
-- Execucao + validacao pos-execucao:
-- - remove `_uuid` apenas quando o par sem sufixo tambem existe e os dois tem a
--   mesma assinatura em pg_index;
-- - preserva `_uuid` quando ele e o unico indice do par;
-- - remove `idx_project_tenant_sob` quando ele duplica o indice UNIQUE de SOB;
-- - garante que resta exatamente 1 indice simples para (tenant_id, priority) e
--   exatamente 1 indice simples para (tenant_id, city);
-- - garante que resta exatamente 1 indice simples para (tenant_id, sob), que
--   precisa ser unico;
-- - nao pode sobrar duplicata exata em `project`.
--
-- A checagem de duplicata usa a mesma assinatura do catalogo (indrelid +
-- indkey + indclass + indexprs + indpred) que a consulta de inventario do
-- Nivel B (`Auditoria/03-nivel-b-pg-stat-statements.md` secao 5).
-- =============================================================================
do $$
declare
  v_priority_original oid := to_regclass('public.idx_project_tenant_priority');
  v_priority_uuid oid := to_regclass('public.idx_project_tenant_priority_uuid');
  v_city_original oid := to_regclass('public.idx_project_tenant_city');
  v_city_uuid oid := to_regclass('public.idx_project_tenant_city_uuid');
  v_sob_redundant oid := to_regclass('public.idx_project_tenant_sob');
  v_priority_count integer;
  v_city_count integer;
  v_sob_count integer;
  v_sob_unique_count integer;
  v_dupes integer;
  v_dupe_details text;
begin
  if v_priority_original is not null and v_priority_uuid is not null then
    if not exists (
      select 1
      from pg_index original
      join pg_index duplicate
        on duplicate.indrelid = original.indrelid
       and duplicate.indkey = original.indkey
       and duplicate.indclass = original.indclass
       and coalesce(duplicate.indexprs::text, '') = coalesce(original.indexprs::text, '')
       and coalesce(duplicate.indpred::text, '') = coalesce(original.indpred::text, '')
      where original.indexrelid = v_priority_original
        and duplicate.indexrelid = v_priority_uuid
    ) then
      raise exception '365: indices priority existem com nomes esperado/uuid, mas nao sao duplicatas exatas. NAO prosseguir sem investigar.';
    end if;

    execute 'drop index public.idx_project_tenant_priority_uuid';
    raise notice '365: removido indice duplicado public.idx_project_tenant_priority_uuid.';
  elsif v_priority_original is null and v_priority_uuid is null then
    raise exception '365: nenhum indice conhecido para public.project(tenant_id, priority). NAO prosseguir sem investigar.';
  else
    raise notice '365: priority ja tem apenas um indice conhecido; nada a remover.';
  end if;

  if v_city_original is not null and v_city_uuid is not null then
    if not exists (
      select 1
      from pg_index original
      join pg_index duplicate
        on duplicate.indrelid = original.indrelid
       and duplicate.indkey = original.indkey
       and duplicate.indclass = original.indclass
       and coalesce(duplicate.indexprs::text, '') = coalesce(original.indexprs::text, '')
       and coalesce(duplicate.indpred::text, '') = coalesce(original.indpred::text, '')
      where original.indexrelid = v_city_original
        and duplicate.indexrelid = v_city_uuid
    ) then
      raise exception '365: indices city existem com nomes esperado/uuid, mas nao sao duplicatas exatas. NAO prosseguir sem investigar.';
    end if;

    execute 'drop index public.idx_project_tenant_city_uuid';
    raise notice '365: removido indice duplicado public.idx_project_tenant_city_uuid.';
  elsif v_city_original is null and v_city_uuid is null then
    raise exception '365: nenhum indice conhecido para public.project(tenant_id, city). NAO prosseguir sem investigar.';
  else
    raise notice '365: city ja tem apenas um indice conhecido; nada a remover.';
  end if;

  select count(*) into v_priority_count
  from pg_index ix
  join pg_attribute tenant_att
    on tenant_att.attrelid = ix.indrelid
   and tenant_att.attname = 'tenant_id'
  join pg_attribute priority_att
    on priority_att.attrelid = ix.indrelid
   and priority_att.attname = 'priority'
  where ix.indrelid = 'public.project'::regclass
    and ix.indexprs is null
    and ix.indpred is null
    and ix.indisvalid
    and ix.indnatts = 2
    and ix.indnkeyatts = 2
    and ix.indkey[0] = tenant_att.attnum
    and ix.indkey[1] = priority_att.attnum;

  if v_priority_count <> 1 then
    raise exception '365: esperado 1 indice simples em project(tenant_id, priority), encontrados %. NAO prosseguir sem investigar.', v_priority_count;
  end if;

  select count(*) into v_city_count
  from pg_index ix
  join pg_attribute tenant_att
    on tenant_att.attrelid = ix.indrelid
   and tenant_att.attname = 'tenant_id'
  join pg_attribute city_att
    on city_att.attrelid = ix.indrelid
   and city_att.attname = 'city'
  where ix.indrelid = 'public.project'::regclass
    and ix.indexprs is null
    and ix.indpred is null
    and ix.indisvalid
    and ix.indnatts = 2
    and ix.indnkeyatts = 2
    and ix.indkey[0] = tenant_att.attnum
    and ix.indkey[1] = city_att.attnum;

  if v_city_count <> 1 then
    raise exception '365: esperado 1 indice simples em project(tenant_id, city), encontrados %. NAO prosseguir sem investigar.', v_city_count;
  end if;

  if v_sob_redundant is not null then
    if not exists (
      select 1
      from pg_index redundant
      join pg_index keeper
        on keeper.indrelid = redundant.indrelid
       and keeper.indexrelid <> redundant.indexrelid
       and keeper.indkey = redundant.indkey
       and keeper.indclass = redundant.indclass
       and coalesce(keeper.indexprs::text, '') = coalesce(redundant.indexprs::text, '')
       and coalesce(keeper.indpred::text, '') = coalesce(redundant.indpred::text, '')
       and keeper.indisunique
      where redundant.indexrelid = v_sob_redundant
        and redundant.indrelid = 'public.project'::regclass
    ) then
      raise exception '365: idx_project_tenant_sob existe, mas nao ha indice UNIQUE equivalente para manter. NAO prosseguir sem investigar.';
    end if;

    execute 'drop index public.idx_project_tenant_sob';
    raise notice '365: removido indice redundante public.idx_project_tenant_sob; UNIQUE (tenant_id, sob) preservado.';
  else
    raise notice '365: idx_project_tenant_sob nao existe; nada a remover para SOB.';
  end if;

  select count(*), count(*) filter (where ix.indisunique)
  into v_sob_count, v_sob_unique_count
  from pg_index ix
  join pg_attribute tenant_att
    on tenant_att.attrelid = ix.indrelid
   and tenant_att.attname = 'tenant_id'
  join pg_attribute sob_att
    on sob_att.attrelid = ix.indrelid
   and sob_att.attname = 'sob'
  where ix.indrelid = 'public.project'::regclass
    and ix.indexprs is null
    and ix.indpred is null
    and ix.indisvalid
    and ix.indnatts = 2
    and ix.indnkeyatts = 2
    and ix.indkey[0] = tenant_att.attnum
    and ix.indkey[1] = sob_att.attnum;

  if v_sob_count <> 1 or v_sob_unique_count <> 1 then
    raise exception '365: esperado 1 indice UNIQUE simples em project(tenant_id, sob), encontrados % indice(s), % unique. NAO prosseguir sem investigar.', v_sob_count, v_sob_unique_count;
  end if;

  select count(*), string_agg(index_names, '; ' order by index_names)
  into v_dupes, v_dupe_details
  from (
    select string_agg(i.relname, ', ' order by i.relname) as index_names
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    where ix.indrelid = 'public.project'::regclass
    group by indrelid, indkey, indclass, indexprs, indpred
    having count(*) > 1
  ) as duplicated_groups;

  if v_dupes > 0 then
    raise exception '365: ainda existem % grupo(s) de indice duplicado em public.project: %.', v_dupes, v_dupe_details;
  end if;

  raise notice '365: validacao concluida; project(tenant_id, priority/city/sob) tem exatamente um indice por chave.';
end;
$$;
