-- 443_pi_bind_stage_race_guard.sql
-- Fecha a janela de corrida entre escolher a etapa e grava-la.
--
-- O DEFEITO
-- ---------------------------------------------------------------------------
-- A 442 passou a reconciliar o vinculo na emissao, mas a sequencia era:
--
--   1. `pi_find_active_programming` devolve a etapa 500, ativa para a chave;
--   2. ...nada trava a linha da etapa...
--   3. `pi_bind_stage` grava 500;
--   4. a barreira final compara `programming_id` com o id lido no passo 1.
--
-- O passo 4 comparava o id gravado com o MESMO id que ele proprio mandou
-- gravar. Sempre batia. Toda mudanca ocorrida no passo 2 passava batida, e
-- `pi_bind_stage` nao ajudava, porque so conferia que a etapa existe no tenant.
--
-- Dois desfechos concretos, ambos em producao de documento oficial:
--
--   A) A etapa e CANCELADA na janela. `pi_bind_stage` mapeia etapa fora do plano
--      para ATTENTION, entao a PI era vinculada JA em ATTENTION, a barreira
--      passava e a PI emitia em ATTENTION — exatamente o que a primeira recusa
--      da 442 existe para impedir.
--
--   B) A etapa MUDA DE DATA na janela. `pi_bind_stage` nao confere data, entao a
--      PI era vinculada a uma etapa de outro dia, a barreira passava e a PI
--      emitia com vinculo errado. Pior que o desfecho A: o estado ruim fica
--      gravado e so seria corrigido na proxima alteracao daquela etapa.
--
-- A CORRECAO, EM DUAS CAMADAS
-- ---------------------------------------------------------------------------
--   1. `pi_bind_stage` passa a exigir que a etapa continue sendo do mesmo
--      projeto e da mesma data da PI no momento da ESCRITA. Protege todos os
--      caminhos de vinculo de uma vez, nao so a emissao.
--   2. A emissao reavalia a etapa ativa DEPOIS do vinculo e recusa se o vinculo
--      tiver nascido em ATTENTION. A barreira final passa a comparar com um
--      valor lido depois da escrita, e nao antes.
--
-- POR QUE NAO TRAVAR A LINHA DA ETAPA
-- ---------------------------------------------------------------------------
-- Seria a solucao obvia e abriria deadlock. O gatilho da 441 roda dentro do
-- salvamento da etapa: trava a etapa, depois a PI. A emissao trava a PI logo no
-- inicio; pedir a etapa depois inverteria a ordem entre os dois fluxos. Emitir
-- uma PI e salvar uma etapa passariam a poder travar um ao outro. Reavaliar
-- custa duas leituras indexadas e nao cria ordem de lock nova.

-- =============================================================================
-- 1) `pi_bind_stage` — guarda de chave
-- =============================================================================
-- A 441 documentou que esta funcao "NAO decide se pode vincular" e confia em
-- quem chama. A confianca era boa demais: quem chama decide alguns statements
-- ANTES, sem travar a linha da etapa, e nesse intervalo a etapa pode mudar de
-- projeto ou de data.
--
-- Nenhum chamador legitimo vincula etapa de outra chave. O vinculo manual ja
-- recusa projeto/data divergente, `pi_link_pending_for_stage` procura a PI pela
-- chave DA ETAPA, `pi_reconcile_pending_links` procura a etapa pela chave DA PI
-- e a emissao faz o mesmo. Entao divergir aqui e sempre corrida ou defeito, e a
-- guarda nao muda nenhum fluxo correto.
--
-- Devolver NULL, e nao levantar excecao, mantem o contrato: quem chama ja trata
-- NULL como "nao vinculou" e transforma isso na recusa da sua propria camada.
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
  v_pi_project_id uuid;
  v_pi_work_date date;
  v_link_status text;
  v_updated_at timestamptz;
begin
  select * into v_stage
  from public.programming
  where tenant_id = p_tenant_id and id = p_programming_id;

  if not found then
    return null;
  end if;

  select programming_id, link_status, project_id, work_date
  into v_previous_programming, v_previous_link, v_pi_project_id, v_pi_work_date
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id;

  if not found then
    return null;
  end if;

  -- Guarda de chave (migration 443). A etapa tem de continuar sendo do mesmo
  -- projeto e da mesma data da PI NO MOMENTO DA ESCRITA, e nao no momento em
  -- que quem chama a escolheu.
  if v_stage.project_id <> v_pi_project_id
     or v_stage.execution_date is distinct from v_pi_work_date then
    return null;
  end if;

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

revoke all on function public.pi_bind_stage(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- =============================================================================
-- 2) `set_permission_intervention_status` — reavaliacao pos-vinculo
-- =============================================================================
create or replace function public.set_permission_intervention_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_action text,
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
  v_action text := upper(nullif(btrim(coalesce(p_action, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_errors jsonb;
  v_settings public.pi_settings%rowtype;
  v_sequence bigint;
  v_code text;
  v_area_token text;
  v_voltage_token text;
  v_area_code text;
  v_voltage_code text;
  v_template public.pi_document_template%rowtype;
  v_next_status text;
  v_updated_at timestamptz;
  -- Reconciliacao final do vinculo, migration 442.
  v_active_stage_id uuid;
  v_owner_pi_id uuid;
  v_owner_pi_code text;
  v_bind_updated_at timestamptz;
  v_constraint text;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_pi_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant, usuario e PI sao obrigatorios.');
  end if;

  if v_action is null or v_action not in ('READY', 'REOPEN', 'ISSUE', 'CANCEL') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ACTION',
      'message', 'Acao invalida para a PI.');
  end if;

  select * into v_current
  from public.permission_intervention
  where tenant_id = p_tenant_id and id = p_pi_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PI_NOT_FOUND', 'message', 'PI nao encontrada.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a tela antes de mudar o status da PI.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION',
      'message', 'Esta PI foi alterada por outro usuario. Recarregue antes de continuar.');
  end if;

  if v_current.status = 'CANCELLED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_CANCELLED',
      'message', 'PI cancelada nao aceita mudanca de status.');
  end if;

  if v_action = 'CANCEL' then
    if v_reason is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'CANCELLATION_REASON_REQUIRED',
        'message', 'Informe o motivo do cancelamento.');
    end if;

    update public.permission_intervention
    set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_at = now(),
        cancelled_by = p_actor_user_id, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_pi_id
    returning updated_at into v_updated_at;

    perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id, 'CANCEL', v_reason,
      jsonb_build_object('status', jsonb_build_object('from', v_current.status, 'to', 'CANCELLED')));

    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_updated_at, 'pi_status', 'CANCELLED', 'message', 'PI cancelada com sucesso.');
  end if;

  if v_current.status = 'ISSUED' then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_ALREADY_ISSUED',
      'message', 'PI ja emitida. Para desfazer, cancele e crie outra.');
  end if;

  if v_action = 'REOPEN' then
    if v_current.status <> 'READY' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'So uma PI marcada como pronta pode voltar para rascunho.');
    end if;
    v_next_status := 'DRAFT';
  elsif v_action = 'READY' then
    if v_current.status <> 'DRAFT' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'So um rascunho pode ser marcado como pronto.');
    end if;
    v_errors := public.pi_validate_for_issue(p_tenant_id, p_pi_id);
    if jsonb_array_length(v_errors) > 0 then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'VALIDATION_FAILED',
        'message', 'A PI tem pendencias que impedem a emissao.', 'errors', v_errors);
    end if;
    v_next_status := 'READY';
  else
    if v_current.status <> 'READY' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_TRANSITION',
        'message', 'Marque a PI como pronta antes de emitir.');
    end if;

    -- =======================================================================
    -- RECONCILIACAO FINAL DO VINCULO (migration 442)
    -- =======================================================================
    -- INVARIANTE: existindo etapa ativa para tenant + projeto + data, esta PI
    -- precisa estar vinculada EXATAMENTE a ela, ou a emissao falha.
    --
    -- E mais forte que perguntar `programming_id is not null`, e mais forte que
    -- confiar no `link_status`. A emissao deixa de depender da qualidade do que
    -- aconteceu antes dela: gatilho que falhou, reconciliacao incompleta,
    -- registro legado anterior a 441 e etapa reprogramada caem todos aqui.
    --
    -- Roda ANTES de `pi_validate_for_issue` por duas razoes. A regra do
    -- Responsavel pela Intervencao (migration 432) so e cobrada quando a PI TEM
    -- etapa, entao validar antes de vincular mediria a PI errada. E o sequencial
    -- oficial so e consumido bem depois, entao nenhuma recusa daqui queima
    -- numero de documento.
    if v_current.link_status = 'ATTENTION' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_LINK_REQUIRES_REVIEW',
        'message', 'A etapa vinculada nao corresponde mais a programacao ativa. Revise o vinculo antes de emitir.');
    end if;

    v_active_stage_id := public.pi_find_active_programming(
      p_tenant_id, v_current.project_id, v_current.work_date
    );

    -- Sem etapa ativa nesta chave, a PI e mesmo "Sem Programacao" e segue.
    if v_active_stage_id is not null then
      if v_current.programming_id is null then
        -- Etapa ativa que ja pertence a outra PI viva NAO pode ser lida como
        -- "esta PI e sem Programacao". E inconsistencia de negocio, e e o
        -- caminho da reprogramacao: a etapa mudou de data e continua sendo da
        -- PI da data antiga, enquanto esta PI nasceu pendente na data nova.
        if public.pi_stage_has_live_pi(p_tenant_id, v_active_stage_id, p_pi_id) then
          select id, pi_code into v_owner_pi_id, v_owner_pi_code
          from public.permission_intervention
          where tenant_id = p_tenant_id
            and programming_id = v_active_stage_id
            and status <> 'CANCELLED'
          limit 1;

          return jsonb_build_object('success', false, 'status', 409, 'reason', 'ACTIVE_STAGE_ALREADY_LINKED',
            'message', format(
              'A etapa ativa deste projeto nesta data ja pertence a PI %s. Resolva o conflito antes de emitir.',
              coalesce(v_owner_pi_code, 'ainda sem numero')),
            -- Mesmas chaves de `PI_ALREADY_EXISTS`: o handler ja as repassa ao
            -- cliente, entao a tela recebe a PI dona sem contrato novo.
            'existing_pi_id', v_owner_pi_id,
            'existing_pi_code', v_owner_pi_code,
            'existing_programming_id', v_active_stage_id);
        end if;

        -- A checagem de posse acima e do snapshot desta transacao. Entre ela e
        -- o UPDATE cabe outra transacao vinculando a mesma etapa, e quem decide
        -- de verdade e o indice unico por etapa da migration 441. Sem este
        -- bloco, a emissao perdedora devolveria erro cru de banco em vez do
        -- mesmo conflito de vinculo do caminho normal.
        begin
          v_bind_updated_at := public.pi_bind_stage(
            p_tenant_id, p_pi_id, v_active_stage_id, p_actor_user_id,
            'LATE_STAGE_LINK', 'LINK_AUTO', null,
            jsonb_build_object('trigger', 'ISSUE_RECONCILE')
          );
        exception
          when unique_violation then
            -- Converter QUALQUER unique_violation em conflito de vinculo
            -- mascararia constraint futura como se fosse disputa de etapa.
            -- So o indice da etapa vira conflito; o resto sobe como erro.
            get stacked diagnostics v_constraint = constraint_name;
            if coalesce(v_constraint, '') <> 'permission_intervention_live_stage_key' then
              raise;
            end if;

            select id, pi_code into v_owner_pi_id, v_owner_pi_code
            from public.permission_intervention
            where tenant_id = p_tenant_id
              and programming_id = v_active_stage_id
              and status <> 'CANCELLED'
              and id <> p_pi_id
            limit 1;

            return jsonb_build_object('success', false, 'status', 409, 'reason', 'ACTIVE_STAGE_ALREADY_LINKED',
              'message', format(
                'A etapa ativa deste projeto nesta data acabou de ser vinculada a PI %s. Recarregue antes de emitir.',
                coalesce(v_owner_pi_code, 'ainda sem numero')),
              'existing_pi_id', v_owner_pi_id,
              'existing_pi_code', v_owner_pi_code,
              'existing_programming_id', v_active_stage_id);
        end;

        if v_bind_updated_at is null then
          return jsonb_build_object('success', false, 'status', 409, 'reason', 'LINK_RECONCILE_FAILED',
            'message', 'Nao foi possivel vincular a etapa ativa desta data. Recarregue e tente de novo.');
        end if;

        -- Reler: vinculo, fotografia e `updated_at` mudaram, e a regra do
        -- supervisor logo abaixo precisa enxergar o vinculo novo.
        --
        -- Este vinculo PERSISTE mesmo que a validacao adiante recuse a emissao,
        -- e e o certo: a PI pertence aquela etapa de fato, e a recusa seguinte
        -- (supervisor, por exemplo) so existe porque o vinculo passou a existir.
        select * into v_current
        from public.permission_intervention
        where tenant_id = p_tenant_id and id = p_pi_id;

        -- REAVALIACAO POS-VINCULO (migration 443)
        -- ------------------------------------------------------------------
        -- Nada travou a linha da etapa entre `pi_find_active_programming` e o
        -- `pi_bind_stage`. Naquela janela outra transacao pode ter cancelado a
        -- etapa ou movido a data dela, e a 442 comparava a PI com o id que
        -- tinha lido ANTES — o que sempre batia, porque era o mesmo id.
        --
        -- Travar a linha da etapa resolveria e NAO e o caminho escolhido: o
        -- gatilho da 441 trava a etapa e depois a PI, e travar na ordem inversa
        -- aqui inverteria a ordem de lock entre os dois fluxos, abrindo
        -- deadlock entre emitir uma PI e salvar uma etapa. Reavaliar e barato e
        -- nao cria ordem de lock nova.
        v_active_stage_id := public.pi_find_active_programming(
          p_tenant_id, v_current.project_id, v_current.work_date
        );

        -- Etapa que saiu do plano ativo dentro da janela: `pi_bind_stage` grava
        -- ATTENTION nesse caso, e emitir uma PI em ATTENTION e exatamente o que
        -- a primeira recusa deste ramo existe para impedir.
        if v_current.link_status = 'ATTENTION' then
          return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_LINK_REQUIRES_REVIEW',
            'message', 'A etapa mudou durante a emissao e o vinculo ficou em revisao. Recarregue antes de emitir.');
        end if;
      end if;

      -- Barreira final. Pega a PI presa a uma etapa historica enquanto outra
      -- etapa ativa ocupa a chave dela — caso em que `programming_id is not
      -- null` seria verdadeiro e mentiroso.
      --
      -- E FALLBACK, nao fluxo normal. Com o gatilho da 441 funcionando, essa
      -- PI ja teria virado ATTENTION quando a etapa antiga mudou, e pararia na
      -- primeira recusa. Este `if` so dispara quando `link_status` esta ERRADO:
      -- registro anterior a 441, gatilho que engoliu erro, ou alteracao feita
      -- direto no banco. E exatamente por isso ele compara com a etapa ativa em
      -- vez de reler o estado — a defesa nao pode depender do dado suspeito.
      --
      -- Desde a 443 `v_active_stage_id` foi reavaliado DEPOIS do vinculo, entao
      -- esta comparacao deixou de ser tautologica no caminho que acabou de
      -- vincular: antes ela conferia o id contra o id que ela mesma mandou
      -- gravar.
      if v_current.programming_id is distinct from v_active_stage_id then
        return jsonb_build_object('success', false, 'status', 409, 'reason', 'LINKED_STAGE_NOT_ACTIVE',
          'message', 'Esta PI aponta para uma etapa que nao e mais a ativa desta data. Revise o vinculo antes de emitir.');
      end if;
    end if;

    v_errors := public.pi_validate_for_issue(p_tenant_id, p_pi_id);
    if jsonb_array_length(v_errors) > 0 then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'VALIDATION_FAILED',
        'message', 'A PI tem pendencias que impedem a emissao.', 'errors', v_errors);
    end if;

    select * into v_settings from public.pi_settings where tenant_id = p_tenant_id;
    select * into v_template from public.pi_document_template
    where tenant_id = p_tenant_id and is_active = true limit 1;

    -- Com uma so marcada, a escolha e obvia e a emissao resolve sozinha.
    v_area_code := coalesce(v_current.primary_operation_area_code, (
      select area_code from public.pi_operation_area_link
      where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI' limit 1));
    v_voltage_code := coalesce(v_current.primary_voltage_level_code, (
      select voltage_code from public.pi_voltage_level_link
      where tenant_id = p_tenant_id and pi_id = p_pi_id and scope = 'PI' limit 1));

    select code_token into v_area_token from public.pi_operation_areas
    where tenant_id = p_tenant_id and code = v_area_code;
    select code_token into v_voltage_token from public.pi_voltage_levels
    where tenant_id = p_tenant_id and code = v_voltage_code;

    if v_area_token is null or v_voltage_token is null then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'CODE_COMPONENTS_MISSING',
        'message', 'Nao foi possivel resolver a area ou a tensao que compoem o codigo da PI.');
    end if;

    -- Sequencial sob lock de linha. Dois usuarios emitindo ao mesmo tempo
    -- serializam aqui; o segundo so prossegue depois do commit do primeiro. Se
    -- a emissao falhar adiante, o incremento sofre rollback junto e nao abre
    -- buraco na numeracao.
    update public.pi_sequence_counter
    set last_value = last_value + 1, updated_at = now(), updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
    returning last_value into v_sequence;

    if v_sequence is null then
      return jsonb_build_object('success', false, 'status', 422, 'reason', 'SEQUENCE_NOT_CONFIGURED',
        'message', 'Contador do codigo da PI nao configurado para este contrato.');
    end if;

    v_code := concat_ws('-',
      v_settings.code_prefix,
      v_voltage_token,
      v_area_token,
      v_settings.company_code,
      lpad(v_sequence::text, v_settings.sequence_digits, '0')
    );

    update public.permission_intervention set
      status = 'ISSUED',
      pi_sequence = v_sequence,
      pi_code = v_code,
      primary_operation_area_code = v_area_code,
      primary_voltage_level_code = v_voltage_code,
      -- Snapshot do Plano de Emergencia e do template: o documento tem de
      -- continuar reconstruivel depois de qualquer um dos dois mudar.
      emergency_plan_snapshot = v_settings.emergency_plan_text,
      emergency_plan_version_snapshot = v_settings.emergency_plan_version,
      issued_template_id = v_template.id,
      issued_template_version = v_template.version,
      issued_template_checksum = v_template.checksum_sha256,
      issued_at = now(),
      issued_by = p_actor_user_id,
      prepared_at = coalesce(v_current.prepared_at, now()),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = p_pi_id
    returning updated_at into v_updated_at;

    perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id, 'ISSUE', null,
      jsonb_build_object(
        'status', jsonb_build_object('from', v_current.status, 'to', 'ISSUED'),
        'piCode', jsonb_build_object('from', null, 'to', v_code)
      ),
      jsonb_build_object(
        'sequence', v_sequence,
        'templateVersion', v_template.version,
        'templateChecksum', v_template.checksum_sha256,
        'emergencyPlanVersion', v_settings.emergency_plan_version
      ));

    return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
      'updated_at', v_updated_at, 'pi_status', 'ISSUED', 'pi_code', v_code, 'pi_sequence', v_sequence,
      'message', format('PI emitida com o codigo %s.', v_code));
  end if;

  update public.permission_intervention
  set status = v_next_status, updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_pi_id
  returning updated_at into v_updated_at;

  perform public.pi_append_history(p_tenant_id, p_pi_id, p_actor_user_id,
    case when v_next_status = 'READY' then 'MARK_READY' else 'REOPEN' end, v_reason,
    jsonb_build_object('status', jsonb_build_object('from', v_current.status, 'to', v_next_status)));

  return jsonb_build_object('success', true, 'status', 200, 'pi_id', p_pi_id,
    'updated_at', v_updated_at, 'pi_status', v_next_status,
    'message', case when v_next_status = 'READY' then 'PI marcada como pronta.' else 'PI devolvida para rascunho.' end);
end;
$$;

revoke all on function public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz) to service_role;

-- =============================================================================
-- 3) Verificacao
-- =============================================================================
do $$
declare
  v_status_fn text := 'public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz)';
  v_bind_fn text := 'public.pi_bind_stage(uuid, uuid, uuid, uuid, text, text, text, jsonb)';
begin
  if has_function_privilege('anon', v_status_fn::regprocedure, 'execute')
     or has_function_privilege('authenticated', v_status_fn::regprocedure, 'execute') then
    raise exception '443: % ainda executavel por anon/authenticated', v_status_fn;
  end if;

  if not has_function_privilege('service_role', v_status_fn::regprocedure, 'execute') then
    raise exception '443: % deveria ser executavel por service_role', v_status_fn;
  end if;

  if has_function_privilege('anon', v_bind_fn::regprocedure, 'execute')
     or has_function_privilege('authenticated', v_bind_fn::regprocedure, 'execute') then
    raise exception '443: % ainda executavel por anon/authenticated', v_bind_fn;
  end if;

  if has_function_privilege('service_role', v_bind_fn::regprocedure, 'execute') then
    raise warning '443: % continua executavel por service_role apesar do revoke', v_bind_fn;
  end if;
end;
$$;
