-- 351_medicao_match_normalized_programming.sql
-- Fase 5b do corte: Medicao passa a vincular `project_measurement_orders.programming_id`
-- a `programming` (modelo normalizado) em vez da tela congelada `project_programming`.
-- Fecha o corte: depois desta migration nenhuma tela em producao le/escreve
-- `project_programming` como fonte viva (ela permanece so como arquivo historico).
--
-- POR QUE E MAIS COMPLEXO QUE APR (350)
-- ---------------------------------------------------------------------------
-- `save_project_apr_control` (226) tinha 1 bloco de match, nunca redefinida.
-- Medicao tem DUAS RPCs de escrita e o corpo VIVO de `save_project_measurement_order`
-- nao existe integro em nenhum arquivo do repo: a ultima reescrita completa foi a
-- migration 127, e desde entao 4 migrations (194, 202, 204, 214) aplicaram PATCHES
-- DINAMICOS por cima (via `pg_get_functiondef` + `replace()` + `execute`, sem
-- reescrever o corpo inteiro). Editar um `create or replace function` estatico
-- aqui poderia silenciosamente apagar algum desses 4 patches. Por isso esta
-- migration usa a MESMA tecnica dinamica (ja usada 4x neste modulo) para trocar
-- so os trechos de match, preservando tudo o mais que estiver vivo no banco.
--
-- BLOCOS TROCADOS EM save_project_measurement_order (3, todos em `project_programming`)
-- ---------------------------------------------------------------------------
-- 1) Match explicito por `p_programming_id` no CREATE (linha ~160-186 da 127):
--    legado resolvia projeto+equipe+data+nomes num join direto na linha (1
--    equipe por linha). Normalizado: `programming` e 1 linha por projeto+data
--    (sem equipe propria) — resolve so projeto/data/estado da etapa; NAO
--    sobrescreve `v_team_id` (fica com o que o chamador mandou em p_team_id,
--    sempre preenchido na pratica — confirmado que o front SEMPRE envia os 3
--    juntos, tanto na importacao em lote quanto no form manual) e valida por
--    `exists` que essa equipe esta ATIVA em `programming_team` da etapa. Nomes
--    de projeto/equipe (snapshot) continuam resolvidos pelos blocos
--    `if v_project_code is null`/`if v_team_name is null` alguns passos abaixo,
--    que ja existiam pra cobrir o caminho sem match — nao precisam mudar.
-- 2) Match explicito por `p_programming_id` no EDIT (linha ~314-323): mesma
--    ideia, mais simples (so busca work_completion_status/updated_at; projeto/
--    equipe/data ja vem resolvidos antes nesse caminho). Ganha a mesma
--    validacao de equipe ATIVA.
-- 3) Fallback por projeto+equipe+data (linha ~199-221, texto IDENTICO nos dois
--    caminhos — create e edit —, por isso 1 `replace()` so troca os dois):
--    passa a ler `programming` + `exists` em `programming_team` (ATIVA).
--    PRESERVADA a mesma prioridade de desempate do legado (unica coisa que este
--    modulo faz diferente de APR/Cronograma, de proposito): PROGRAMADA(0) >
--    REPROGRAMADA(1) > ADIADA(2) > CANCELADA(3) > outro(4) — CANCELADA continua
--    elegivel em ultimo caso (nao e excluida como em APR), porque e o
--    comportamento ja existente e nada nesta entrega pede mudar regra de
--    negocio, so fonte.
--
-- BLOCO TROCADO EM save_project_measurement_order_batch_partial (1, migration 123,
-- nunca redefinida por patch dinamico — texto fonte integro e confiavel)
-- ---------------------------------------------------------------------------
-- Match por `id` explicito por linha importada (linha ~679-684 da 123): mesma
-- logica do item 1 acima, adaptada ao loop da importacao (erro por linha, nao
-- return direto).
--
-- MEDICAO EM PRODUCAO (2026-07-31, scripts/audit-medicao-programming-match-readonly.mjs)
-- ---------------------------------------------------------------------------
-- - 717 ordens; 181 com `programming_id` preenchido (536 nunca vinculadas, fora
--   do escopo deste remap).
-- - 0 orfaos em `programming_legacy_map` para as 181 linhas com FK.
-- - Remap simples via o mapa concorda com recalcular o match do zero pelo NOVO
--   criterio em 167/181 (92,3%). 0 casos em que o recalculo aponta para uma
--   etapa DIFERENTE (nenhuma divergencia real). Os 14 casos em que o recalculo
--   nao acha nenhuma etapa sao ordens cujo `execution_date` gravado ficou
--   defasado porque a etapa foi REPROGRAMADA (7 casos), ADIADA (2) ou CANCELADA
--   (1) para outra data DEPOIS que a ordem foi criada — o recalculo busca pela
--   data da ORDEM (snapshot antigo), nao acha a etapa na data nova, e
--   corretamente nao acharia substituta. CONFIRMA (mesmo padrao medido na 350
--   para APR) que o backfill deve ser remap simples via `programming_legacy_map`,
--   nao recalculo — recalcular aqui apagaria vinculos historicos corretos.
-- - A nova validacao da RPC (equipe pedida precisa estar ATIVA na etapa) so
--   rejeitaria 1 das 181 ordens ja vinculadas (0,6%) SE ela fosse reeditada hoje
--   pela RPC — nao bloqueia nem altera o vinculo ja gravado por esta migration
--   (o UPDATE do passo 3 nao passa pela RPC), so afeta uma edicao futura dessa
--   ordem especifica atraves da tela.
--
-- FORA DO ESCOPO DESTA MIGRATION (decisao registrada, nao e omissao)
-- ---------------------------------------------------------------------------
-- `project_measurement_order_items.programming_activity_id` continua apontando
-- para `project_programming_activities` (tabela legada, sem par no
-- `programming_legacy_map` — o mapa so cobre etapa e equipe, nunca atividade).
-- DECISAO: manter assim. A coluna e nullable, `on delete set null`, nunca lida
-- de volta em nenhuma query de Medicao ou APR (so gravada do payload e
-- devolvida como rastro), e `project_programming`/`project_programming_activities`
-- sao arquivos historicos permanentes (nunca apagados) — nao ha janela em que
-- essa FK vire orfa, entao nao ha custo em deixa-la apontando pra sempre pro
-- legado. Remapear exigiria um de/para de atividade que nao existe e que nenhum
-- consumidor precisa hoje.
--
-- `loadProgrammingMatchMap` (src/app/api/medicao/route.ts, leitura em TS, so
-- afeta exibicao/filtro) e trocado numa entrega separada de codigo (nao SQL),
-- junto com a fachada `@/server/modules/programacao-normalizada`.

begin;

-- =============================================================================
-- 1) Guarda: nenhuma linha pode ficar orfa na virada da constraint.
-- =============================================================================
do $$
declare
  v_sem_par bigint;
begin
  select count(*)
    into v_sem_par
  from public.project_measurement_orders o
  left join public.programming_legacy_map m
    on m.legacy_programming_id = o.programming_id
  where o.programming_id is not null
    and m.legacy_programming_id is null;

  if v_sem_par > 0 then
    raise exception
      'Migration 351 abortada: % ordem(ns) de medicao apontam para programacao legada sem par em programming_legacy_map. Rode scripts/audit-medicao-programming-match-readonly.mjs e trate os casos antes de repontar a FK.',
      v_sem_par
      using errcode = 'P0001';
  end if;
end
$$;

-- =============================================================================
-- 2) Soltar a constraint ANTES do remap. ORDEM IMPORTA (bug pego no teste da
--    350/APR): se o UPDATE do passo 3 rodasse com a constraint antiga ainda
--    ativa (apontando pra `project_programming`), gravar um id de `programming`
--    violaria a propria FK (23503). O nome vivo hoje e `pmo_programming_tenant_fk`
--    (renomeado pela 231 ao endurecer pra composta por tenant — NAO e o nome
--    gerado pela 112); o DROP cobre os dois nomes por seguranca.
-- =============================================================================
alter table public.project_measurement_orders
  drop constraint if exists pmo_programming_tenant_fk,
  drop constraint if exists project_measurement_orders_programming_id_fkey;

-- =============================================================================
-- 3) Remapear os valores existentes (legado -> etapa normalizada), agora sem
--    nenhuma FK ativa em `programming_id` pra violar. Remap SIMPLES via o
--    de/para (nao recalculo do match): medido acima que os dois concordam em
--    92,3% dos casos, e os 14 casos divergentes sao exatamente onde o remap
--    simples preserva o vinculo historico correto (etapa reprogramada/adiada/
--    cancelada para outra data depois do vinculo original).
-- =============================================================================
update public.project_measurement_orders o
set programming_id = m.programming_id
from public.programming_legacy_map m
where o.programming_id = m.legacy_programming_id
  and o.tenant_id = m.tenant_id
  and o.programming_id is distinct from m.programming_id;

-- =============================================================================
-- 3b) Recriar a constraint, agora apontando para `programming`. So valida com
--     sucesso porque o remap acima ja rodou. O indice unico parcial
--     `idx_project_measurement_orders_programming_context_unique` (194) nao
--     precisa mudar: e sobre colunas da propria tabela (programming_id +
--     project_id + team_id + execution_date), e o remap nao toca as outras tres.
-- =============================================================================
alter table public.project_measurement_orders
  add constraint pmo_programming_tenant_fk
    foreign key (programming_id, tenant_id)
    references public.programming (id, tenant_id)
    on delete set null (programming_id);

-- =============================================================================
-- 4) save_project_measurement_order — patch dinamico (mesma tecnica das
--    migrations 194/202/204/214): pega a definicao VIVA (ja com os 4 patches
--    anteriores aplicados), troca so os 3 trechos de match, e reexecuta.
-- =============================================================================
do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_step text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  -- Normaliza CRLF -> LF antes de qualquer replace(): os arquivos-fonte deste
  -- modulo (112..127) tem final de linha CRLF (confirmado ao gerar esta
  -- migration), e nao ha garantia de qual formato ficou de fato armazenado no
  -- corpo da funcao viva. Os literais `$blockNold$` abaixo sao todos LF-only;
  -- normalizar aqui deixa o match imune ao formato original, sem afetar a
  -- execucao (SQL nao liga pra estilo de fim de linha).
  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  -- Bloco 1: match explicito no CREATE (join direto na linha legada; vira
  -- so etapa/projeto/data + validacao de equipe, sem sobrescrever v_team_id).
  -- Os literais `$blockNold$/$blockNnew$` tambem passam por replace(CRLF->LF):
  -- nao basta normalizar so `v_definition` — se o ARQUIVO desta migration (ou o
  -- copy/paste no editor) tiver sido salvo com CRLF (este checkout Windows tem
  -- autocrlf, confirmado por warning do git em outra tarefa desta sessao), o
  -- literal em si chega com \r\n embutido e o replace() abaixo nunca bate,
  -- mesmo com o conteudo logicamente identico (foi exatamente isso que
  -- aconteceu: hash batendo via chr(10) construido em SQL, mas o literal
  -- multi-linha do arquivo falhando).
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($block1old$    if p_programming_id is not null then
      select
        pp.id,
        pp.project_id,
        pp.team_id,
        pp.execution_date,
        p.sob,
        t.name,
        pe.nome,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_project_id,
        v_team_id,
        v_execution_date,
        v_project_code,
        v_team_name,
        v_foreman_name,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      join public.project p on p.id = pp.project_id and p.tenant_id = pp.tenant_id
      join public.teams t on t.id = pp.team_id and t.tenant_id = pp.tenant_id
      left join public.people pe on pe.id = t.foreman_person_id and pe.tenant_id = t.tenant_id
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para gerar a ordem.');
      end if;
    end if;$block1old$, chr(13) || chr(10), chr(10)),
    replace($block1new$    if p_programming_id is not null then
      select
        p.id,
        p.project_id,
        p.execution_date,
        p.work_completion_status,
        p.updated_at
      into
        v_link_programming_id,
        v_project_id,
        v_execution_date,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.programming p
      where p.tenant_id = p_tenant_id
        and p.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para gerar a ordem.');
      end if;

      if v_team_id is not null and not exists (
        select 1
        from public.programming_team pt
        where pt.tenant_id = p_tenant_id
          and pt.programming_id = v_link_programming_id
          and pt.team_id = v_team_id
          and pt.status = 'ATIVA'
      ) then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Equipe informada nao esta ativa nesta etapa da Programacao.');
      end if;
    end if;$block1new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '351: bloco 1 (match explicito CREATE) nao encontrado em save_project_measurement_order — corpo vivo divergiu do esperado, revisar antes de aplicar.';
  end if;

  -- Bloco 2: match explicito no EDIT (mais simples — projeto/equipe/data ja
  -- resolvidos antes nesse caminho; so busca estado da etapa + valida equipe).
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($block2old$    if p_programming_id is not null then
      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para vinculo da ordem.');
      end if;
    else$block2old$, chr(13) || chr(10), chr(10)),
    replace($block2new$    if p_programming_id is not null then
      select
        p.id,
        p.work_completion_status,
        p.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.programming p
      where p.tenant_id = p_tenant_id
        and p.id = p_programming_id
      for update;

      if not found then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Programacao nao encontrada para vinculo da ordem.');
      end if;

      if not exists (
        select 1
        from public.programming_team pt
        where pt.tenant_id = p_tenant_id
          and pt.programming_id = v_link_programming_id
          and pt.team_id = v_team_id
          and pt.status = 'ATIVA'
      ) then
        return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND', 'message', 'Equipe informada nao esta ativa nesta etapa da Programacao.');
      end if;
    else$block2new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '351: bloco 2 (match explicito EDIT) nao encontrado em save_project_measurement_order — corpo vivo divergiu do esperado, revisar antes de aplicar.';
  end if;

  -- Bloco 3: fallback por projeto+equipe+data — texto IDENTICO no CREATE e no
  -- EDIT (confirmado byte a byte), entao 1 replace() (global no Postgres) troca
  -- as duas ocorrencias de uma vez. Mesma prioridade de status do legado.
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($block3old$      select
        pp.id,
        pp.work_completion_status,
        pp.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.project_id = v_project_id
        and pp.team_id = v_team_id
        and pp.execution_date = v_execution_date
      order by
        case pp.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        pp.updated_at desc
      limit 1;$block3old$, chr(13) || chr(10), chr(10)),
    replace($block3new$      select
        p.id,
        p.work_completion_status,
        p.updated_at
      into
        v_link_programming_id,
        v_programming_completion_status,
        v_programming_completion_updated_at
      from public.programming p
      where p.tenant_id = p_tenant_id
        and p.project_id = v_project_id
        and p.execution_date = v_execution_date
        and exists (
          select 1
          from public.programming_team pt
          where pt.tenant_id = p_tenant_id
            and pt.programming_id = p.id
            and pt.team_id = v_team_id
            and pt.status = 'ATIVA'
        )
      order by
        case p.status
          when 'PROGRAMADA' then 0
          when 'REPROGRAMADA' then 1
          when 'ADIADA' then 2
          when 'CANCELADA' then 3
          else 4
        end,
        p.updated_at desc
      limit 1;$block3new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '351: bloco 3 (fallback projeto+equipe+data) nao encontrado em save_project_measurement_order — corpo vivo divergiu do esperado, revisar antes de aplicar.';
  end if;

  execute v_definition;
end;
$$;

-- Grants (regras 16/17 do guia_sql.md): mesma assinatura/ACL desde a 112
-- (authenticated + service_role, diferente de APR que e so service_role — o
-- backend chama esta RPC autenticado como o proprio usuario). CREATE OR REPLACE
-- via execute() preserva o ACL existente; reaplicar explicitamente mantem a
-- migration re-executavel e auditavel por si so.
revoke all on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) from public;
grant execute on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) to authenticated;
grant execute on function public.save_project_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz
) to service_role;

-- =============================================================================
-- 5) save_project_measurement_order_batch_partial — nunca sofreu patch
--    dinamico (texto fonte integro e confiavel na 123), mas usa a mesma tecnica
--    por consistencia e para nao depender de o corpo estar identico ao arquivo
--    (o guard abaixo garante isso de qualquer forma).
-- =============================================================================
do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb)'::regprocedure;
  v_definition text;
  v_step text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  -- Mesma normalizacao CRLF -> LF do bloco anterior (ver comentario la).
  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($block4old$    if v_programming_id is not null then
      select pp.project_id, pp.team_id, pp.execution_date
      into v_project_id, v_team_id, v_execution_date
      from public.project_programming pp
      where pp.tenant_id = p_tenant_id
        and pp.id = v_programming_id;

      if not found then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Programacao nao encontrada para a linha importada.'
        ));
        continue;
      end if;
    end if;$block4old$, chr(13) || chr(10), chr(10)),
    replace($block4new$    if v_programming_id is not null then
      select p.project_id, p.execution_date
      into v_project_id, v_execution_date
      from public.programming p
      where p.tenant_id = p_tenant_id
        and p.id = v_programming_id;

      if not found then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Programacao nao encontrada para a linha importada.'
        ));
        continue;
      end if;

      if v_team_id is not null and not exists (
        select 1
        from public.programming_team pt
        where pt.tenant_id = p_tenant_id
          and pt.programming_id = v_programming_id
          and pt.team_id = v_team_id
          and pt.status = 'ATIVA'
      ) then
        v_error_count := v_error_count + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'rowIndex', v_row_index,
          'rowNumbers', v_row_numbers,
          'success', false,
          'alreadyRegistered', false,
          'reason', 'PROGRAMMING_NOT_FOUND',
          'message', 'Equipe informada nao esta ativa nesta etapa da Programacao.'
        ));
        continue;
      end if;
    end if;$block4new$, chr(13) || chr(10), chr(10))
  );
  if v_definition = v_step then
    raise exception '351: bloco 4 (match batch import) nao encontrado em save_project_measurement_order_batch_partial — corpo vivo divergiu do esperado, revisar antes de aplicar.';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) from public;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb) to service_role;

-- =============================================================================
-- 6) Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_com_fk bigint;
  v_fn1 regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_fn2 regprocedure := 'public.save_project_measurement_order_batch_partial(uuid, uuid, jsonb)'::regprocedure;
begin
  select count(*) into v_com_fk
  from public.project_measurement_orders
  where programming_id is not null;

  raise notice '351: ordens de medicao com programming_id preenchido=% (agora apontando para programming)', v_com_fk;

  if has_function_privilege('anon', v_fn1, 'execute') then
    raise exception '351: save_project_measurement_order ainda executavel por anon';
  end if;
  if has_function_privilege('anon', v_fn2, 'execute') then
    raise exception '351: save_project_measurement_order_batch_partial ainda executavel por anon';
  end if;
end
$$;

commit;
