-- 442_pi_issue_link_reconciliation.sql
-- Barreira de vinculo na EMISSAO da PI.
--
-- A BRECHA
-- ---------------------------------------------------------------------------
-- `pi_validate_for_issue` (migrations 430 e 432) nunca leu `link_status`. Le
-- `programming_id`, e apenas para a regra do Responsavel pela Intervencao. Disso
-- decorriam tres furos na emissao:
--
--   1. PI em ATTENTION emitia normalmente. O estado era enfeite vermelho.
--   2. PI PENDING emitia mesmo existindo etapa ativa naquela chave, e como a
--      regra do supervisor so vale para PI COM etapa, a emissao escapava dela.
--   3. PI vinculada a uma etapa que deixou de ser a ativa daquela data emitia
--      como se estivesse correta.
--
-- O furo 2 NAO depende de o gatilho da 441 falhar. A reprogramacao chega la por
-- caminho normal: a etapa 500 sai de 17/09 para 18/09 e continua sendo da PI de
-- 17/09; a PI de 18/09 existe e o gatilho, por regra, nao a vincula, porque a
-- etapa ja tem dona. Ela fica PENDING e emite sem a regra do supervisor, sem
-- que nada tenha dado errado em lugar nenhum.
--
-- A REGRA
-- ---------------------------------------------------------------------------
-- Existindo etapa ativa para tenant + projeto + data, a PI precisa estar
-- vinculada EXATAMENTE a essa etapa, ou a emissao falha.
--
-- Salvar uma etapa pode falhar aberto, e o gatilho da 441 falha aberto de
-- proposito. Emitir documento oficial nao pode. Esta migration torna a emissao
-- independente da qualidade do que aconteceu antes dela.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao altera `pi_validate_for_issue`: a reconciliacao vive no ramo ISSUE, e nao
-- na validacao, para que marcar uma PI como PRONTA continue possivel enquanto o
-- vinculo esta em revisao. A barreira e a emissao, nao a preparacao.
--
-- Nao muda nada de PI ja EMITIDA. Uma emitida que vira ATTENTION depois
-- permanece emitida, com o documento intacto.
--
-- Nao corrige nada sozinha: as tres recusas pedem acao humana. O unico caso em
-- que a migration escreve e o vinculo de uma PI PENDING a uma etapa ativa LIVRE,
-- que e completar, nao corrigir.
--
-- SEMANTICA TRANSACIONAL DO VINCULO FEITO AQUI
-- ---------------------------------------------------------------------------
-- O vinculo PERSISTE quando a validacao seguinte recusa a emissao. Nenhuma
-- recusa de negocio desta funcao usa `raise`: todas devolvem o envelope
-- `{success:false, ...}` que `rpcResponse` traduz em HTTP, padrao de toda a
-- familia de RPCs desde a 430. Funcao que RETORNA nao desfaz nada, entao o
-- UPDATE, a fotografia e o `LINK_AUTO` ficam gravados e `updated_at` muda.
--
-- E o comportamento certo: a PI pertence aquela etapa de fato, e a recusa
-- seguinte, por supervisor ausente, existe JUSTAMENTE porque o vinculo passou a
-- existir. O diagnostico chega ao usuario do mesmo jeito, porque a lista de
-- erros viaja no envelope.
--
-- A alternativa, emissao atomica que desfaz o vinculo junto, exigiria `raise`
-- para provocar rollback, e `raise` perderia a lista de erros da validacao no
-- caminho — o cliente receberia 500 generico em vez das pendencias. Se essa
-- troca for desejada, ela e deliberada e muda tambem a tela; nao acontece por
-- acidente de escrita.
--
-- ORDEM E O SEQUENCIAL: as cinco recusas do ramo ISSUE ficam TODAS antes do
-- `update public.pi_sequence_counter`. Nenhuma delas pode queimar numero de
-- documento, e mover qualquer uma para depois quebraria isso.

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
-- Verificacao
-- =============================================================================
do $$
declare
  v_fn text := 'public.set_permission_intervention_status(uuid, uuid, uuid, text, text, timestamptz)';
begin
  if has_function_privilege('anon', v_fn::regprocedure, 'execute')
     or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
    raise exception '442: % ainda executavel por anon/authenticated', v_fn;
  end if;

  if not has_function_privilege('service_role', v_fn::regprocedure, 'execute') then
    raise exception '442: % deveria ser executavel por service_role', v_fn;
  end if;

  -- A reconciliacao depende dos helpers da 441 e do localizador da 430.
  if to_regprocedure('public.pi_bind_stage(uuid, uuid, uuid, uuid, text, text, text, jsonb)') is null
     or to_regprocedure('public.pi_stage_has_live_pi(uuid, uuid, uuid)') is null
     or to_regprocedure('public.pi_find_active_programming(uuid, uuid, date)') is null then
    raise exception '442: helpers de vinculo ausentes. Aplique a migration 441 antes desta.';
  end if;
end;
$$;
