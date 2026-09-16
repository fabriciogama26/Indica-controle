-- 441_pi_stage_link_convergence.sql
-- Convergencia do vinculo PI x etapa da Programacao.
--
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- A busca da etapa so acontecia no INSERT da PI. Uma PI que nascia sem
-- Programacao ficava PENDING para sempre: salvar de novo nao tentava vincular,
-- nao havia gatilho na etapa e nao havia rotina agendada. A tela, mesmo assim,
-- prometia ao usuario que "o vinculo e feito sozinho quando a etapa daquela
-- data existir". O indice parcial `idx_permission_intervention_pending_link`
-- (migration 429) ja tinha sido criado para essa fila e nunca teve consumidor.
--
-- A REGRA
-- ---------------------------------------------------------------------------
-- A identidade da PI e `tenant_id + project_id + work_date`. A etapa e apenas
-- um RELACIONAMENTO dessa PI, nunca parte da identidade. Disso decorre tudo:
--
--   1. Duplicidade se mede pela chave de negocio, com ou sem etapa vinculada.
--   2. Existindo etapa e PI na mesma chave, as duas devem convergir, nao
--      importa qual nasceu primeiro. A PI ja procurava a etapa na criacao; esta
--      migration acrescenta o caminho inverso, da etapa para a PI.
--   3. Vinculo existente NUNCA e trocado por automacao. Etapa que muda de data,
--      de projeto ou sai do plano vira ATTENTION, que e revisao humana, e nao
--      auto-correcao.
--   4. PI EMITIDA e congelada para automacao de vinculo: nao ganha etapa, nao
--      recria fotografia e nao reabre. Ganha apenas a SINALIZACAO de ATTENTION,
--      porque `status` (RASCUNHO/PRONTA/EMITIDA/CANCELADA) e `link_status`
--      (LINKED/PENDING/ATTENTION) sao dimensoes separadas desde a migration
--      429. E na emitida que ATTENTION vale mais: o documento historico
--      continua valido e o planejamento mudou depois dele.
--
-- POR QUE GATILHO E NAO ROTINA AGENDADA
-- ---------------------------------------------------------------------------
-- A regra do Responsavel pela Intervencao (migration 432) so e cobrada quando a
-- PI TEM etapa vinculada. Vincular com atraso deixa uma janela em que a PI pode
-- ser emitida escapando dessa regra, e emissao nao se desfaz. O vinculo precisa
-- acontecer no instante em que a etapa passa a existir, nao horas ou dias
-- depois. Nao ha `pg_cron` neste projeto e este gatilho dispensa a extensao.
--
-- O custo e uma busca indexada por gravacao de etapa. A tabela `programming`
-- tinha 666 linhas no levantamento que precedeu esta migration.
--
-- AUDITORIA PREVIA (obrigatoria)
-- ---------------------------------------------------------------------------
-- `scripts/auditoria/pi-vinculo-auditoria.mjs`, somente leitura, mede o passivo
-- e diz se o indice unico por etapa pode ser criado. Execucao contra o banco
-- ligado antes desta migration: 2 PIs no total, ambas RASCUNHO e ja vinculadas,
-- e passivo ZERO nas cinco verificacoes. As rotinas de reconciliacao abaixo
-- ficam mesmo assim: elas documentam a regra e protegem quem aplicar esta
-- migration depois de a operacao comecar a usar a tela.

-- =============================================================================
-- 1) Estrutura nova: origem da fotografia
-- =============================================================================
-- A fotografia deixa de ser exclusivamente "a etapa da qual a PI nasceu". Ela
-- passa a existir tambem quando a etapa e encontrada DEPOIS. Sem identificar a
-- origem, o painel de comparacao mostraria uma etapa localizada mais tarde como
-- se tivesse originado a PI, o que falsifica o historico. Com a origem
-- explicita, o painel compara e ainda sabe dizer de onde aquilo veio.
alter table if exists public.permission_intervention
  add column if not exists snapshot_source text null;

-- =============================================================================
-- 2) Preenchimento retroativo da origem
-- =============================================================================
-- Toda fotografia que ja existe hoje so pode ter vindo do INSERT, porque era o
-- unico caminho que a gravava.
update public.permission_intervention
set snapshot_source = 'PI_CREATION'
where source_programming_snapshot is not null
  and snapshot_source is null;

-- =============================================================================
-- 3) Constraints da estrutura nova
-- =============================================================================
-- Depois do preenchimento, nunca antes: com linhas fora do dominio a criacao da
-- constraint falharia e derrubaria a migration inteira.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.permission_intervention'::regclass
      and conname = 'permission_intervention_snapshot_source_check'
  ) then
    alter table public.permission_intervention
      add constraint permission_intervention_snapshot_source_check
      check (snapshot_source is null or snapshot_source in ('PI_CREATION', 'LATE_STAGE_LINK'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.permission_intervention'::regclass
      and conname = 'permission_intervention_snapshot_source_pairing_check'
  ) then
    alter table public.permission_intervention
      add constraint permission_intervention_snapshot_source_pairing_check
      check ((source_programming_snapshot is null) = (snapshot_source is null));
  end if;
end;
$$;

comment on column public.permission_intervention.snapshot_source is
  'Origem da fotografia em source_programming_snapshot. PI_CREATION = a PI nasceu daquela etapa. LATE_STAGE_LINK = a etapa foi localizada depois da criacao, por automacao ou por vinculo manual.';

-- O comentario da 429 dizia que a fotografia e imutavel e sempre do momento da
-- criacao. Deixou de ser verdade nesta migration.
comment on column public.permission_intervention.source_programming_snapshot is
  'Fotografia da etapa vinculada, base da comparacao Programacao x PI. Tirada na criacao quando a PI nasce de uma etapa, ou no momento do vinculo quando a etapa e localizada depois. `snapshot_source` diz qual dos dois casos.';

-- =============================================================================
-- 4) Helpers do vinculo
-- =============================================================================

-- A etapa ja pertence a alguma PI viva?
--
-- Invariante nova desta migration: no maximo UMA PI nao cancelada por etapa. O
-- indice unico da secao 7 e a barreira; esta funcao e a checagem barata que os
-- caminhos usam antes de tentar.
create or replace function public.pi_stage_has_live_pi(
  p_tenant_id uuid,
  p_programming_id uuid,
  p_except_pi_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.permission_intervention
    where tenant_id = p_tenant_id
      and programming_id = p_programming_id
      and status <> 'CANCELLED'
      and (p_except_pi_id is null or id <> p_except_pi_id)
  );
$$;

revoke all on function public.pi_stage_has_live_pi(uuid, uuid, uuid) from public, anon, authenticated;

-- Grava o vinculo, a fotografia e o historico. Ponto unico de escrita do
-- relacionamento: automacao, reconciliacao e vinculo manual passam todos por
-- aqui, para que os tres produzam exatamente o mesmo registro.
--
-- NAO decide se pode vincular. Quem chama ja verificou status da PI, posse da
-- etapa e concorrencia.
create or replace function public.pi_bind_stage(
  p_tenant_id uuid,
  p_pi_id uuid,
  p_programming_id uuid,
  p_actor_user_id uuid,
  p_snapshot_source text,
  p_action_type text,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.programming%rowtype;
  v_previous_programming uuid;
  v_previous_link text;
  v_link_status text;
  v_updated_at timestamptz;
begin
  select * into v_stage
  from public.programming
  where tenant_id = p_tenant_id and id = p_programming_id;

  if not found then
    return null;
  end if;

  select programming_id, link_status into v_previous_programming, v_previous_link
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id;

  v_link_status := case
    when v_stage.status in ('PROGRAMADA', 'REPROGRAMADA') then 'LINKED'
    else 'ATTENTION'
  end;

  -- A fotografia acompanha a etapa vinculada. Num religamento, manter a
  -- fotografia da etapa antiga faria o painel comparar a PI com uma etapa a
  -- qual ela nao aponta mais. O historico guarda a troca.
  update public.permission_intervention set
    programming_id = p_programming_id,
    link_status = v_link_status,
    source_programming_snapshot = public.pi_build_programming_snapshot(p_tenant_id, p_programming_id),
    snapshot_source = p_snapshot_source,
    updated_by = coalesce(p_actor_user_id, updated_by)
  where tenant_id = p_tenant_id and id = p_pi_id
  returning updated_at into v_updated_at;

  perform public.pi_append_history(
    p_tenant_id, p_pi_id, p_actor_user_id, p_action_type, p_reason,
    jsonb_build_object(
      'programmingId', jsonb_build_object('from', v_previous_programming, 'to', p_programming_id),
      'linkStatus', jsonb_build_object('from', v_previous_link, 'to', v_link_status)
    ),
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('programmingStatus', v_stage.status, 'snapshotSource', p_snapshot_source)
  );

  return v_updated_at;
end;
$$;

revoke all on function public.pi_bind_stage(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Lado ETAPA -> PI. Procura a PI pendente da chave de negocio daquela etapa e
-- vincula. Devolve o id da PI vinculada, ou NULL quando nao havia o que fazer.
--
-- Recusa em quatro situacoes, todas de proposito:
--   - etapa fora do plano ativo (so PROGRAMADA e REPROGRAMADA vinculam);
--   - etapa que ja pertence a outra PI viva, o caso da reprogramacao;
--   - PI emitida ou cancelada, que a automacao nao toca;
--   - nenhuma PI pendente naquela chave.
create or replace function public.pi_link_pending_for_stage(
  p_tenant_id uuid,
  p_programming_id uuid,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.programming%rowtype;
  v_pi_id uuid;
begin
  select * into v_stage
  from public.programming
  where tenant_id = p_tenant_id and id = p_programming_id;

  if not found or v_stage.execution_date is null then
    return null;
  end if;

  if v_stage.status not in ('PROGRAMADA', 'REPROGRAMADA') then
    return null;
  end if;

  if public.pi_stage_has_live_pi(p_tenant_id, p_programming_id) then
    return null;
  end if;

  -- `for update` sem `skip locked` de proposito: a espera e o tempo de um save
  -- de PI, na casa dos milissegundos, e pular deixaria a PI pendente em
  -- silencio, que e exatamente o defeito que esta migration corrige. Nao ha
  -- ciclo de deadlock: o caminho que salva a PI trava a PI e apenas LE a
  -- Programacao, sem travar linha nenhuma dela.
  select id into v_pi_id
  from public.permission_intervention
  where tenant_id = p_tenant_id
    and project_id = v_stage.project_id
    and work_date = v_stage.execution_date
    and programming_id is null
    and status in ('DRAFT', 'READY')
  for update;

  if v_pi_id is null then
    return null;
  end if;

  perform public.pi_bind_stage(
    p_tenant_id, v_pi_id, p_programming_id, p_actor_user_id,
    'LATE_STAGE_LINK', 'LINK_AUTO', null,
    jsonb_build_object('trigger', 'PROGRAMMING_SAVE')
  );

  return v_pi_id;
end;
$$;

revoke all on function public.pi_link_pending_for_stage(uuid, uuid, uuid) from public, anon, authenticated;

-- Lado ETAPA -> PI, para vinculo que JA existe e ficou inconsistente.
--
-- Marca, nunca corrige. Trocar a etapa de uma PI e decisao humana e continua so
-- no vinculo manual. Alcanca PI EMITIDA porque `link_status` e estado de
-- consistencia, nao status documental: a emitida nao muda de etapa, nao recria
-- fotografia e nao reabre, apenas passa a sinalizar que o planejamento mudou
-- depois do documento.
--
-- Nao existe caminho de volta automatico. Uma vez em ATTENTION, so o vinculo
-- manual tira, porque voltar sozinho para LINKED seria a auto-correcao que a
-- regra 3 proibe.
create or replace function public.pi_flag_stage_link_attention(
  p_tenant_id uuid,
  p_programming_id uuid,
  p_actor_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage public.programming%rowtype;
  v_pi record;
  v_count integer := 0;
begin
  select * into v_stage
  from public.programming
  where tenant_id = p_tenant_id and id = p_programming_id;

  if not found then
    return 0;
  end if;

  for v_pi in
    select id, project_id, work_date, link_status
    from public.permission_intervention
    where tenant_id = p_tenant_id
      and programming_id = p_programming_id
      and status <> 'CANCELLED'
      and link_status <> 'ATTENTION'
    for update
  loop
    if v_stage.status in ('PROGRAMADA', 'REPROGRAMADA')
       and v_stage.project_id = v_pi.project_id
       and v_stage.execution_date is not distinct from v_pi.work_date then
      continue;
    end if;

    update public.permission_intervention set
      link_status = 'ATTENTION',
      updated_by = coalesce(p_actor_user_id, updated_by)
    where tenant_id = p_tenant_id and id = v_pi.id;

    perform public.pi_append_history(
      p_tenant_id, v_pi.id, p_actor_user_id, 'LINK_ATTENTION', null,
      jsonb_build_object('linkStatus', jsonb_build_object('from', v_pi.link_status, 'to', 'ATTENTION')),
      jsonb_build_object(
        'programmingId', p_programming_id,
        'programmingStatus', v_stage.status,
        'programmingDate', v_stage.execution_date,
        'piWorkDate', v_pi.work_date
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.pi_flag_stage_link_attention(uuid, uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 5) Reconciliacao do passivo
-- =============================================================================
-- Lado PI -> ETAPA, em lote. Percorre as PIs pendentes e vincula APENAS os
-- casos inequivocos: PI editavel, exatamente uma etapa ativa na chave, e essa
-- etapa sem outra PI viva. Qualquer coisa fora disso fica como esta e aparece
-- na auditoria para decisao humana.
--
-- Fica publicada como funcao, e nao como bloco solto, porque e a mesma rotina
-- que serve de ferramenta operacional se o passivo reaparecer.
create or replace function public.pi_reconcile_pending_links(
  p_tenant_id uuid default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pi record;
  v_stage_id uuid;
  v_stage_count integer;
  v_linked integer := 0;
  v_skipped integer := 0;
begin
  for v_pi in
    select id, tenant_id, project_id, work_date
    from public.permission_intervention
    where programming_id is null
      and status in ('DRAFT', 'READY')
      and (p_tenant_id is null or tenant_id = p_tenant_id)
    order by created_at
  loop
    select count(*), min(p.id) into v_stage_count, v_stage_id
    from public.programming p
    where p.tenant_id = v_pi.tenant_id
      and p.project_id = v_pi.project_id
      and p.execution_date = v_pi.work_date
      and p.status in ('PROGRAMADA', 'REPROGRAMADA');

    if v_stage_count <> 1 or v_stage_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if public.pi_stage_has_live_pi(v_pi.tenant_id, v_stage_id, v_pi.id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform public.pi_bind_stage(
      v_pi.tenant_id, v_pi.id, v_stage_id, p_actor_user_id,
      'LATE_STAGE_LINK', 'LINK_AUTO', null,
      jsonb_build_object('trigger', 'RECONCILE')
    );
    v_linked := v_linked + 1;
  end loop;

  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped);
end;
$$;

revoke all on function public.pi_reconcile_pending_links(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 6) Execucao sobre o passivo existente
-- =============================================================================
-- Reconciliacao silenciosa e a mesma doenca do vinculo silencioso: as duas
-- rotinas gravam historico linha a linha.
do $$
declare
  v_result jsonb;
  v_flagged integer := 0;
  v_stage record;
begin
  v_result := public.pi_reconcile_pending_links(null, null);
  raise notice '441: reconciliacao de PI pendente -> %', v_result;

  for v_stage in
    select distinct p.tenant_id, p.id
    from public.programming p
    join public.permission_intervention pi
      on pi.tenant_id = p.tenant_id
     and pi.programming_id = p.id
     and pi.status <> 'CANCELLED'
     and pi.link_status <> 'ATTENTION'
    where p.status not in ('PROGRAMADA', 'REPROGRAMADA')
       or p.project_id <> pi.project_id
       or p.execution_date is distinct from pi.work_date
  loop
    v_flagged := v_flagged + public.pi_flag_stage_link_attention(v_stage.tenant_id, v_stage.id, null);
  end loop;

  raise notice '441: vinculos marcados como ATTENTION -> %', v_flagged;
end;
$$;

-- =============================================================================
-- 7) Uma PI viva por etapa
-- =============================================================================
-- Sem esta barreira, a reprogramacao de uma etapa deixaria duas PIs vivas
-- apontando para ela: a antiga, que nao e desvinculada por regra, e a pendente
-- da data nova, que o gatilho encontraria. O indice transforma esse acidente em
-- erro, e o gatilho ja desvia antes de chegar nele.
do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
  from (
    select tenant_id, programming_id
    from public.permission_intervention
    where programming_id is not null
      and status <> 'CANCELLED'
    group by tenant_id, programming_id
    having count(*) > 1
  ) duplicated;

  if v_duplicates > 0 then
    raise exception '441: % etapa(s) vinculada(s) a mais de uma PI viva. Escolher qual PI fica e decisao de negocio: rode `node scripts/auditoria/pi-vinculo-auditoria.mjs --detalhe`, corrija e aplique de novo.', v_duplicates;
  end if;
end;
$$;

create unique index if not exists permission_intervention_live_stage_key
  on public.permission_intervention (tenant_id, programming_id)
  where programming_id is not null and status <> 'CANCELLED';

-- =============================================================================
-- 8) Gatilho na etapa
-- =============================================================================
-- Ordem interna importa: marcar ATTENTION ANTES de tentar vincular. Numa etapa
-- que mudou de data, a PI antiga precisa ser sinalizada mesmo que a PI da data
-- nova nao possa ser vinculada.
--
-- O bloco de excecao existe para uma unica finalidade: vincular PI e efeito
-- colateral de salvar etapa, e efeito colateral nao pode derrubar o ato
-- principal. Falha aqui vira WARNING no log e a Programacao segue gravada.
create or replace function public.pi_programming_link_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.pi_flag_stage_link_attention(new.tenant_id, new.id, new.updated_by);
    perform public.pi_link_pending_for_stage(new.tenant_id, new.id, new.updated_by);
  exception
    when others then
      raise warning 'pi_programming_link_sync: etapa % nao sincronizou a PI (%)', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.pi_programming_link_sync() from public, anon, authenticated;

-- Prefixo `zz_` pelo mesmo motivo das migrations 258 e 272: o gatilho le o
-- estado final da etapa, entao precisa rodar depois dos demais.
drop trigger if exists zz_trg_programming_pi_link_sync on public.programming;
create trigger zz_trg_programming_pi_link_sync
  after insert or update of status, execution_date, project_id on public.programming
  for each row execute function public.pi_programming_link_sync();

-- =============================================================================
-- 9) `save_permission_intervention` — pre-checagem de duplicidade
-- =============================================================================
-- Corpo da migration 434, com quatro mudancas e nenhuma alteracao nos 40 campos
-- editaveis:
--
--   1. Pre-checagem por tenant + projeto + data antes do INSERT, devolvendo
--      `PI_ALREADY_EXISTS` com os dados da PI existente. Antes o usuario recebia
--      `DUPLICATE_PI` sem identificacao nenhuma, e so depois de preencher tudo.
--   2. Etapa ja pertencente a outra PI viva nao e adotada: a PI nasce pendente.
--   3. `snapshot_source` gravado junto com a fotografia.
--   4. O tratamento de `unique_violation` reconsulta a chave de negocio e
--      devolve a MESMA resposta da pre-checagem, para que a corrida termine na
--      mesma tela do caminho normal.
--
-- A pre-checagem NAO substitui o indice unico: entre o SELECT e o INSERT cabe
-- outra transacao. Ela existe para a resposta boa no caso comum; o indice e a
-- correcao.

create or replace function public.save_permission_intervention(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_insert boolean := p_pi_id is null;
  v_current public.permission_intervention%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
  v_pi_id uuid := p_pi_id;
  v_project_id uuid;
  v_work_date date;
  v_programming_id uuid;
  v_link_status text;
  v_creation_source text;
  v_snapshot jsonb;
  v_updated_at timestamptz;
  -- Valores iniciais, resolvidos SO na criacao.
  -- Escalares, e nao `record`: um `record` nao atribuido estoura ao ser
  -- referenciado, mesmo no ramo do CASE que nao e tomado. Era esse o defeito.
  v_contract_manager text;
  v_contract_company text;
  v_contract_number text;
  v_contract_phone text;
  v_contract_email text;
  v_contact_name text;
  v_contact_phone text;
  v_contact_email text;
  v_contact_source text;
  v_existing_id uuid;
  v_existing_code text;
  v_existing_status text;
  v_existing_programming uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar a PI.');
  end if;

  if v_is_insert then
    v_project_id := nullif(btrim(coalesce(p_payload ->> 'projectId', '')), '')::uuid;
    v_work_date := nullif(btrim(coalesce(p_payload ->> 'workDate', '')), '')::date;

    if v_project_id is null or v_work_date is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_IDENTITY',
        'message', 'Projeto e data da etapa sao obrigatorios para criar a PI.');
    end if;

    if not exists (
      select 1 from public.project
      where tenant_id = p_tenant_id and id = v_project_id and is_active = true
    ) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'PROJECT_NOT_FOUND',
        'message', 'Projeto nao encontrado ou inativo neste contrato.');
    end if;

    -- Duplicidade se mede por tenant + projeto + data, COM OU SEM etapa
    -- vinculada. A etapa e relacionamento da PI, nao parte da identidade dela.
    -- Sem esta checagem o usuario so descobria o choque depois de preencher a
    -- tela inteira, e a resposta nao dizia qual era a PI que ja existia.
    select id, pi_code, status, programming_id
    into v_existing_id, v_existing_code, v_existing_status, v_existing_programming
    from public.permission_intervention
    where tenant_id = p_tenant_id
      and project_id = v_project_id
      and work_date = v_work_date
      and status <> 'CANCELLED'
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_ALREADY_EXISTS',
        'message', format('Ja existe uma PI para este projeto em %s.', to_char(v_work_date, 'DD/MM/YYYY')),
        'existing_pi_id', v_existing_id,
        'existing_pi_code', v_existing_code,
        'existing_pi_status', v_existing_status,
        'existing_programming_id', v_existing_programming);
    end if;

    -- Reconsulta DENTRO da transacao: fecha a janela de corrida em que o
    -- usuario comeca uma PI manual e outra pessoa cria a Programacao daquela
    -- data antes de ele salvar.
    v_programming_id := public.pi_find_active_programming(p_tenant_id, v_project_id, v_work_date);

    -- Etapa que ja pertence a outra PI viva nao e adotada. Acontece quando uma
    -- etapa e reprogramada para uma data que ja tem PI: a PI antiga continua
    -- dona do vinculo e esta nasce pendente, para revisao humana. Sem este
    -- desvio o INSERT esbarraria no indice unico por etapa da migration 441.
    if v_programming_id is not null
       and public.pi_stage_has_live_pi(p_tenant_id, v_programming_id) then
      v_programming_id := null;
    end if;

    v_link_status := case when v_programming_id is null then 'PENDING' else 'LINKED' end;
    v_creation_source := case
      when upper(coalesce(p_payload ->> 'creationSource', '')) = 'FROM_PROGRAMMING' then 'FROM_PROGRAMMING'
      else 'MANUAL'
    end;

    if v_programming_id is not null and v_creation_source = 'FROM_PROGRAMMING' then
      v_snapshot := public.pi_build_programming_snapshot(p_tenant_id, v_programming_id);
    else
      v_snapshot := null;
    end if;

    -- Contrato: uma linha por tenant desde a migration 413.
    select c.nome_gestor::text, c.empresa::text, c."number"::text,
           c.telefone_corporativo::text, c.email::text
    into v_contract_manager, v_contract_company, v_contract_number,
         v_contract_phone, v_contract_email
    from public.contract c
    where c.tenant_id = p_tenant_id
    limit 1;

    -- Contato da distribuidora, do cadastro que a configuracao apontar.
    select coalesce(s.utility_contact_source, 'RESPONSIBLE') into v_contact_source
    from public.pi_settings s where s.tenant_id = p_tenant_id;
    v_contact_source := coalesce(v_contact_source, 'RESPONSIBLE');

    if v_contact_source = 'FIELD_MANAGER' then
      select m.name::text, m.telefone_corporativo::text, m.email::text
      into v_contact_name, v_contact_phone, v_contact_email
      from public.project p
      join public.project_utility_field_managers m
        on m.id = p.utility_field_manager and m.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id and p.id = v_project_id;
    else
      select r.name::text, r.telefone_corporativo::text, r.email::text
      into v_contact_name, v_contact_phone, v_contact_email
      from public.project p
      join public.project_utility_responsibles r
        on r.id = p.utility_responsible and r.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id and p.id = v_project_id;
    end if;

    insert into public.permission_intervention (
      tenant_id, project_id, work_date, programming_id, creation_source, link_status, status,
      source_programming_snapshot, snapshot_source, created_by, updated_by
    )
    values (
      p_tenant_id, v_project_id, v_work_date, v_programming_id, v_creation_source, v_link_status, 'DRAFT',
      v_snapshot, case when v_snapshot is null then null else 'PI_CREATION' end,
      p_actor_user_id, p_actor_user_id
    )
    returning id into v_pi_id;
  else
    select * into v_current
    from public.permission_intervention
    where tenant_id = p_tenant_id and id = v_pi_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND',
        'message', 'PI nao encontrada.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a tela antes de salvar a PI.');
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
        'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de salvar.');
    end if;

    if v_current.status in ('ISSUED', 'CANCELLED') then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_NOT_EDITABLE',
        'message', format('PI %s nao pode ser editada.',
          case when v_current.status = 'ISSUED' then 'ja emitida' else 'cancelada' end));
    end if;

    v_before := to_jsonb(v_current);
  end if;

  -- O payload continua sendo o conjunto COMPLETO dos campos editaveis: chave
  -- ausente grava NULO. A unica excecao e a CRIACAO, onde os campos de contrato
  -- e contato caem no valor inicial quando o payload nao os traz — e o que faz a
  -- PI nascer preenchida sem quebrar a regra de edicao.
  update public.permission_intervention set
    primary_operation_area_code = nullif(btrim(coalesce(p_payload ->> 'primaryOperationAreaCode', '')), ''),
    primary_voltage_level_code = nullif(btrim(coalesce(p_payload ->> 'primaryVoltageLevelCode', '')), ''),
    manager_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerName', '')), ''), v_contract_manager)
      else nullif(btrim(coalesce(p_payload ->> 'managerName', '')), '') end,
    company_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'companyName', '')), ''), v_contract_company)
      else nullif(btrim(coalesce(p_payload ->> 'companyName', '')), '') end,
    contract_number = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), ''), v_contract_number)
      else nullif(btrim(coalesce(p_payload ->> 'contractNumber', '')), '') end,
    manager_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), ''), v_contract_phone)
      else nullif(btrim(coalesce(p_payload ->> 'managerPhone', '')), '') end,
    manager_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), ''), v_contract_email)
      else nullif(btrim(coalesce(p_payload ->> 'managerEmail', '')), '') end,
    utility_contact_name = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), ''), v_contact_name)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactName', '')), '') end,
    utility_contact_phone = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), ''), v_contact_phone)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactPhone', '')), '') end,
    utility_contact_email = case when v_is_insert
      then coalesce(nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), ''), v_contact_email)
      else nullif(btrim(coalesce(p_payload ->> 'utilityContactEmail', '')), '') end,
    activity_description = nullif(btrim(coalesce(p_payload ->> 'activityDescription', '')), ''),
    work_plan = nullif(btrim(coalesce(p_payload ->> 'workPlan', '')), ''),
    live_work_authorization = nullif(btrim(coalesce(p_payload ->> 'liveWorkAuthorization', '')), ''),
    pre_apr = nullif(btrim(coalesce(p_payload ->> 'preApr', '')), ''),
    emergency_authorization = nullif(btrim(coalesce(p_payload ->> 'emergencyAuthorization', '')), ''),
    start_time = nullif(btrim(coalesce(p_payload ->> 'startTime', '')), '')::time,
    end_date = nullif(btrim(coalesce(p_payload ->> 'endDate', '')), '')::date,
    end_time = nullif(btrim(coalesce(p_payload ->> 'endTime', '')), '')::time,
    secondary_date = nullif(btrim(coalesce(p_payload ->> 'secondaryDate', '')), '')::date,
    secondary_start_time = nullif(btrim(coalesce(p_payload ->> 'secondaryStartTime', '')), '')::time,
    installation_description = nullif(btrim(coalesce(p_payload ->> 'installationDescription', '')), ''),
    feeder = nullif(btrim(coalesce(p_payload ->> 'feeder', '')), ''),
    address = nullif(btrim(coalesce(p_payload ->> 'address', '')), ''),
    coord_x = nullif(btrim(coalesce(p_payload ->> 'coordX', '')), ''),
    coord_y = nullif(btrim(coalesce(p_payload ->> 'coordY', '')), ''),
    blocked_elements = nullif(btrim(coalesce(p_payload ->> 'blockedElements', '')), ''),
    cut_elements = nullif(btrim(coalesce(p_payload ->> 'cutElements', '')), ''),
    has_interfering_installation = case
      when jsonb_typeof(p_payload -> 'hasInterferingInstallation') = 'boolean'
        then (p_payload -> 'hasInterferingInstallation')::text::boolean
      else null
    end,
    interfering_description = nullif(btrim(coalesce(p_payload ->> 'interferingDescription', '')), ''),
    traffic_instructions = nullif(btrim(coalesce(p_payload ->> 'trafficInstructions', '')), ''),
    supervisor_person_id = nullif(btrim(coalesce(p_payload ->> 'supervisorPersonId', '')), '')::uuid,
    supervisor_alternate_person_id = nullif(btrim(coalesce(p_payload ->> 'supervisorAlternatePersonId', '')), '')::uuid,
    foreman_person_id = nullif(btrim(coalesce(p_payload ->> 'foremanPersonId', '')), '')::uuid,
    foreman_alternate_person_id = nullif(btrim(coalesce(p_payload ->> 'foremanAlternatePersonId', '')), '')::uuid,
    author_person_id = nullif(btrim(coalesce(p_payload ->> 'authorPersonId', '')), '')::uuid,
    validator_person_id = nullif(btrim(coalesce(p_payload ->> 'validatorPersonId', '')), '')::uuid,
    observations = nullif(btrim(coalesce(p_payload ->> 'observations', '')), ''),
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = v_pi_id;

  update public.permission_intervention pi set
    supervisor_name_snapshot = (select nome from public.people where id = pi.supervisor_person_id and tenant_id = p_tenant_id),
    supervisor_alternate_name_snapshot = (select nome from public.people where id = pi.supervisor_alternate_person_id and tenant_id = p_tenant_id),
    foreman_name_snapshot = (select nome from public.people where id = pi.foreman_person_id and tenant_id = p_tenant_id),
    foreman_alternate_name_snapshot = (select nome from public.people where id = pi.foreman_alternate_person_id and tenant_id = p_tenant_id),
    author_name_snapshot = (select nome from public.people where id = pi.author_person_id and tenant_id = p_tenant_id),
    validator_name_snapshot = (select nome from public.people where id = pi.validator_person_id and tenant_id = p_tenant_id)
  where pi.tenant_id = p_tenant_id and pi.id = v_pi_id
  returning pi.updated_at into v_updated_at;

  delete from public.pi_operation_area_link where tenant_id = p_tenant_id and pi_id = v_pi_id;
  insert into public.pi_operation_area_link (tenant_id, pi_id, scope, area_code, created_by)
  select p_tenant_id, v_pi_id, 'PI', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'operationAreas', '[]'::jsonb)) as value
  on conflict do nothing;

  insert into public.pi_operation_area_link (tenant_id, pi_id, scope, area_code, created_by)
  select p_tenant_id, v_pi_id, 'CONTACT', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'contactOperationAreas', '[]'::jsonb)) as value
  on conflict do nothing;

  delete from public.pi_voltage_level_link where tenant_id = p_tenant_id and pi_id = v_pi_id;
  insert into public.pi_voltage_level_link (tenant_id, pi_id, scope, voltage_code, created_by)
  select p_tenant_id, v_pi_id, 'PI', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'voltageLevels', '[]'::jsonb)) as value
  on conflict do nothing;

  insert into public.pi_voltage_level_link (tenant_id, pi_id, scope, voltage_code, created_by)
  select p_tenant_id, v_pi_id, 'INTERFERING', value, p_actor_user_id
  from jsonb_array_elements_text(coalesce(p_payload -> 'interferingVoltageLevels', '[]'::jsonb)) as value
  on conflict do nothing;

  if v_is_insert then
    perform public.pi_append_history(
      p_tenant_id, v_pi_id, p_actor_user_id, 'CREATE', null, '{}'::jsonb,
      jsonb_build_object(
        'creationSource', v_creation_source,
        'linkStatus', v_link_status,
        'programmingId', v_programming_id,
        'utilityContactSource', v_contact_source
      )
    );
    if v_programming_id is not null and v_creation_source = 'MANUAL' then
      perform public.pi_append_history(
        p_tenant_id, v_pi_id, p_actor_user_id, 'LINK_AUTO', null, '{}'::jsonb,
        jsonb_build_object('programmingId', v_programming_id, 'trigger', 'SAVE_RECHECK')
      );
    end if;
  else
    select to_jsonb(pi) into v_after
    from public.permission_intervention pi
    where pi.tenant_id = p_tenant_id and pi.id = v_pi_id;

    select coalesce(jsonb_object_agg(
             field_key, jsonb_build_object('from', v_before -> field_key, 'to', v_after -> field_key)
           ), '{}'::jsonb)
    into v_changes
    from jsonb_object_keys(v_after) as field_key
    where (v_before -> field_key) is distinct from (v_after -> field_key)
      and field_key not in ('updated_at', 'updated_by');

    if v_changes <> '{}'::jsonb then
      perform public.pi_append_history(p_tenant_id, v_pi_id, p_actor_user_id, 'UPDATE', null, v_changes);
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'pi_id', v_pi_id,
    'updated_at', v_updated_at,
    'link_status', coalesce(v_link_status, (select link_status from public.permission_intervention where id = v_pi_id and tenant_id = p_tenant_id)),
    'programming_id', v_programming_id,
    'message', case when v_is_insert then 'PI criada com sucesso.' else 'PI salva com sucesso.' end
  );
exception
  when invalid_text_representation or invalid_datetime_format then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_FIELD_FORMAT',
      'message', 'Ha campo de data, hora ou identificador com formato invalido.');
  when foreign_key_violation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REFERENCE',
      'message', 'Ha area, tensao ou pessoa que nao existe neste contrato.');
  when unique_violation then
    -- So a CRIACAO tem chave de negocio para reconsultar: `v_project_id` e
    -- `v_work_date` sao preenchidos apenas naquele ramo, e a edicao nao mexe em
    -- projeto, data nem etapa.
    if not v_is_insert then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_PI',
        'message', 'Ja existe uma PI ativa para este projeto nesta data.');
    end if;

    -- Corrida: dois usuarios passaram pela pre-checagem e so um inseriu. A
    -- consulta aqui e pela mesma chave de negocio, para que corrida e caminho
    -- normal terminem na mesma resposta e na mesma tela.
    select id, pi_code, status, programming_id
    into v_existing_id, v_existing_code, v_existing_status, v_existing_programming
    from public.permission_intervention
    where tenant_id = p_tenant_id
      and project_id = v_project_id
      and work_date = v_work_date
      and status <> 'CANCELLED'
    limit 1;

    if v_existing_id is not null then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_ALREADY_EXISTS',
        'message', format('Ja existe uma PI para este projeto em %s.', to_char(v_work_date, 'DD/MM/YYYY')),
        'existing_pi_id', v_existing_id,
        'existing_pi_code', v_existing_code,
        'existing_pi_status', v_existing_status,
        'existing_programming_id', v_existing_programming);
    end if;

    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_ALREADY_LINKED',
      'message', 'A etapa desta data ja pertence a outra PI. Revise o vinculo antes de criar.');
end;
$$;

revoke all on function public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz) to service_role;

-- =============================================================================
-- 10) `link_permission_intervention_to_programming` — vinculo manual
-- =============================================================================
-- Duas mudancas sobre a migration 430:
--
--   1. Recusa etapa que ja pertence a outra PI viva, com motivo proprio em vez
--      de esbarrar no indice unico e virar erro de banco.
--   2. A escrita passa a ser feita por `pi_bind_stage`, que grava tambem a
--      fotografia marcada como `LATE_STAGE_LINK`. Antes o vinculo manual nao
--      gravava fotografia nenhuma, e o painel de comparacao ficava mudo numa PI
--      vinculada depois da criacao.
--
-- O que NAO muda: continua exigindo motivo para trocar um vinculo existente,
-- continua recusando PI cancelada e continua aceitando PI EMITIDA. Corrigir uma
-- emitida e acao manual e auditavel, que e a excecao prevista ao congelamento.
-- A fotografia nova nao altera documento emitido: o documento le os snapshots de
-- pessoas, o Plano de Emergencia e o template da emissao, nunca este campo.
create or replace function public.link_permission_intervention_to_programming(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_programming_id uuid default null,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.permission_intervention%rowtype;
  v_programming public.programming%rowtype;
  v_target_id uuid := p_programming_id;
  v_updated_at timestamptz;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_pi_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e PI sao obrigatorios.');
  end if;

  select * into v_current
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.');
  end if;

  if p_expected_updated_at is null or v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de vincular.');
  end if;

  if v_current.status = 'CANCELLED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_CANCELLED',
      'message', 'PI cancelada nao aceita vinculo.');
  end if;

  -- Sem etapa informada, procura a ativa daquela data.
  if v_target_id is null then
    v_target_id := public.pi_find_active_programming(p_tenant_id, v_current.project_id, v_current.work_date);
    if v_target_id is null then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'NO_ACTIVE_PROGRAMMING',
        'message', 'Nao ha etapa ativa da Programacao para este projeto nesta data.');
    end if;
  end if;

  select * into v_programming
  from public.programming
  where tenant_id = p_tenant_id and id = v_target_id;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Etapa da Programacao nao encontrada neste contrato.');
  end if;

  if v_programming.project_id <> v_current.project_id or v_programming.execution_date is distinct from v_current.work_date then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PROGRAMMING_MISMATCH',
      'message', 'A etapa escolhida e de outro projeto ou de outra data.');
  end if;

  -- `is not null` explicito: com `programming_id` nulo, `NULL = uuid` devolve
  -- NULL e o `IF` nao dispara. O efeito seria o desejado por acidente, e a
  -- regra 20 do guia_sql existe para nao depender disso.
  if v_current.programming_id is not null and v_current.programming_id = v_target_id then
    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_current.updated_at, 'message', 'A PI ja estava vinculada a esta etapa.');
  end if;

  -- Uma PI viva por etapa (migration 441). Sem esta checagem o UPDATE violaria
  -- o indice unico e o usuario receberia erro de banco em vez de explicacao.
  if public.pi_stage_has_live_pi(p_tenant_id, v_target_id, p_pi_id) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STAGE_ALREADY_LINKED',
      'message', 'Esta etapa ja pertence a outra PI. Desfaca aquele vinculo antes de criar este.');
  end if;

  -- Trocar um vinculo existente e decisao humana e fica registrada. O sistema
  -- nunca faz essa troca sozinho, nem quando a etapa antiga sai do plano.
  if v_current.programming_id is not null and nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'RELINK_REASON_REQUIRED',
      'message', 'Informe o motivo para trocar a etapa vinculada a esta PI.');
  end if;

  v_updated_at := public.pi_bind_stage(
    p_tenant_id, p_pi_id, v_target_id, p_actor_user_id,
    'LATE_STAGE_LINK',
    case when v_current.programming_id is null then 'LINK_MANUAL' else 'RELINK' end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('trigger', 'MANUAL')
  );

  return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
    'updated_at', v_updated_at, 'programming_id', v_target_id, 'message', 'Vinculo com a Programacao atualizado.');
end;
$$;

revoke all on function public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;

-- =============================================================================
-- 11) Verificacao
-- =============================================================================
do $$
declare
  v_fn text;
begin
  -- Os helpers desta migration sao internos: chamados de dentro de outras
  -- funcoes `security definer` e do gatilho, nunca pela aplicacao. Nenhum
  -- recebe grant, nem para `service_role`.
  foreach v_fn in array array[
    'public.pi_stage_has_live_pi(uuid, uuid, uuid)',
    'public.pi_bind_stage(uuid, uuid, uuid, uuid, text, text, text, jsonb)',
    'public.pi_link_pending_for_stage(uuid, uuid, uuid)',
    'public.pi_flag_stage_link_attention(uuid, uuid, uuid)',
    'public.pi_reconcile_pending_links(uuid, uuid)'
  ]
  loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute')
       or has_function_privilege('service_role', v_fn::regprocedure, 'execute') then
      raise exception '441: % nao deveria ter grant de execucao', v_fn;
    end if;
  end loop;

  -- As duas RPCs publicas continuam so como `service_role`.
  foreach v_fn in array array[
    'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.link_permission_intervention_to_programming(uuid, uuid, uuid, uuid, text, timestamptz)'
  ]
  loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception '441: % ainda executavel por anon/authenticated', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn::regprocedure, 'execute') then
      raise exception '441: % deveria ser executavel por service_role', v_fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.programming'::regclass
      and tgname = 'zz_trg_programming_pi_link_sync'
      and not tgisinternal
  ) then
    raise exception '441: gatilho zz_trg_programming_pi_link_sync nao instalado';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'permission_intervention'
      and indexname = 'permission_intervention_live_stage_key'
  ) then
    raise exception '441: indice permission_intervention_live_stage_key nao criado';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'permission_intervention'
      and column_name = 'snapshot_source'
  ) then
    raise exception '441: coluna snapshot_source nao criada';
  end if;
end;
$$;
