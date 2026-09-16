-- 444_pi_form_transactional_save.sql
-- Salvamento do formulario da PI numa transacao unica, com contrato versionado.
--
-- OS DOIS DEFEITOS
-- ---------------------------------------------------------------------------
-- 1. ESCRITA PARCIAL. A tela salvava em DUAS chamadas: primeiro o Plano de
--    Execucao, depois o cadastro. Como o plano e substituicao completa, uma
--    falha na segunda chamada deixava o banco com plano NOVO e cadastro VELHO,
--    e a tela dizia apenas "falha ao salvar a PI".
--
-- 2. LIMPEZA SILENCIOSA. O contrato da RPC de cadastro e "payload completo;
--    chave ausente vale como NULO". Isso funciona enquanto todo cliente manda
--    todas as chaves. O caminho que quebra nao e o formulario esquecer um
--    campo — o TypeScript impede, porque `PiFormState` declara as 41 chaves
--    como obrigatorias. E o inverso: alguem acrescenta uma coluna, poe no
--    `update` da RPC e NAO poe no estado do formulario. A partir dali todo
--    salvamento grava nulo naquela coluna, e nada acusa, nem em build nem em
--    runtime.
--
-- A SOLUCAO
-- ---------------------------------------------------------------------------
-- `save_permission_intervention_form` vira o UNICO ponto de escrita do
-- formulario. As duas RPCs anteriores continuam existindo e passam a ser
-- helpers internos, sem grant nenhum: manter qualquer uma delas chamavel pela
-- aplicacao recriaria a escrita parcial fora da transacao.
--
-- A versao do contrato viaja como ARGUMENTO, e nao como mais uma chave do
-- payload: ela descreve o formato do payload, entao nao pode morar dentro dele.
--
-- ORDEM DE VALIDACAO, e ela importa:
--   1. versao do contrato        -> PI_FORM_VERSION_OUTDATED
--   2. presenca das 41 chaves    -> PI_PAYLOAD_MISSING_KEY (diz quais faltaram)
--   3. estrutura do plano        -> INVALID_EXECUTION_PLAN
--   4. daqui para baixo quem valida sao os helpers, ja dentro da transacao
--
-- Chave PRESENTE com `null` continua limpando o campo. A diferenca passa a ser
-- explicita: ausente e payload invalido, `null` e vontade do usuario.
--
-- ATOMICIDADE — a parte que exige cuidado
-- ---------------------------------------------------------------------------
-- Nao basta chamar os dois helpers dentro da mesma funcao. `RETURN` nao desfaz
-- nada (foi o que a 442 provou no P0), entao um helper que recusa DEPOIS de o
-- outro ter gravado deixaria estado parcial.
--
-- Por isso esta funcao tem duas regras internas:
--   - todo `return` de erro acontece ANTES da primeira escrita;
--   - depois da primeira escrita, falha so por `raise`, capturada pelo bloco
--     de excecao desta propria funcao, que desfaz TUDO e so entao devolve o
--     envelope amigavel. `v_failure` sobrevive porque variavel de PL/pgSQL nao
--     e desfeita por rollback de subtransacao — apenas a escrita e.
--
-- INVARIANTE: se esta funcao devolver `success:false`, nem o cadastro, nem o
-- Plano de Execucao, nem os historicos daquela tentativa foram alterados.

-- =============================================================================
-- 1) A RPC orquestradora
-- =============================================================================
create or replace function public.save_permission_intervention_form(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_pi_id uuid,
  p_payload_version integer,
  p_payload jsonb default '{}'::jsonb,
  p_steps jsonb default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Versao do contrato do formulario. Sobe SEMPRE que o conjunto de chaves
  -- mudar. O cliente manda a dele; divergiu, a tela esta velha.
  v_expected_version constant integer := 1;

  -- As 41 chaves editaveis. Esta lista e o contrato: acrescentar coluna ao
  -- `update` da RPC de cadastro sem acrescentar aqui deixa de ser possivel em
  -- silencio, porque o formulario tem de mandar a chave e a lista tem de
  -- conhece-la.
  v_required_keys constant text[] := array[
    'primaryOperationAreaCode', 'primaryVoltageLevelCode',
    'operationAreas', 'contactOperationAreas', 'voltageLevels', 'interferingVoltageLevels',
    'managerName', 'companyName', 'contractNumber', 'managerPhone', 'managerEmail',
    'utilityContactName', 'utilityContactPhone', 'utilityContactEmail',
    'activityDescription', 'workPlan', 'liveWorkAuthorization', 'preApr', 'emergencyAuthorization',
    'startTime', 'endDate', 'endTime', 'secondaryDate', 'secondaryStartTime',
    'installationDescription', 'feeder', 'address', 'coordX', 'coordY',
    'blockedElements', 'cutElements', 'hasInterferingInstallation', 'interferingDescription',
    'trafficInstructions',
    'supervisorPersonId', 'supervisorAlternatePersonId',
    'foremanPersonId', 'foremanAlternatePersonId',
    'authorPersonId', 'validatorPersonId', 'observations'
  ];

  v_is_insert boolean := p_pi_id is null;
  v_key text;
  v_missing text[] := '{}'::text[];
  v_saved jsonb;
  v_plan jsonb;
  v_failure jsonb;
  v_pi_id uuid;
  v_updated_at timestamptz;
  v_step_count integer;
begin
  -- ===========================================================================
  -- VALIDACAO. Nenhuma escrita ainda, entao `return` aqui e seguro.
  -- ===========================================================================
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar a PI.');
  end if;

  if p_payload_version is distinct from v_expected_version then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'PI_FORM_VERSION_OUTDATED',
      'message', 'O formulario foi atualizado. Recarregue a pagina antes de salvar.',
      'expected_version', v_expected_version,
      'received_version', p_payload_version);
  end if;

  -- So na EDICAO. Na criacao o formulario ainda nao existe: o modal manda
  -- projeto, data e os campos herdados da etapa, e os demais nascem do
  -- pre-preenchimento por contrato.
  if not v_is_insert then
    foreach v_key in array v_required_keys
    loop
      if not (coalesce(p_payload, '{}'::jsonb) ? v_key) then
        v_missing := v_missing || v_key;
      end if;
    end loop;

    if array_length(v_missing, 1) > 0 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'PI_PAYLOAD_MISSING_KEY',
        'message', format(
          'O formulario nao enviou %s campo(s) obrigatorio(s) do contrato: %s. Para limpar um campo, envie-o com valor nulo.',
          array_length(v_missing, 1), array_to_string(v_missing, ', ')),
        'missing_keys', to_jsonb(v_missing));
    end if;
  end if;

  if p_steps is not null then
    if jsonb_typeof(p_steps) <> 'array' then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_EXECUTION_PLAN',
        'message', 'O Plano de Execucao precisa ser uma lista.');
    end if;

    if exists (
      select 1 from jsonb_array_elements(p_steps) as e(step)
      where jsonb_typeof(e.step) <> 'object'
    ) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_EXECUTION_PLAN',
        'message', 'Ha linha do Plano de Execucao que nao e um objeto.');
    end if;

    -- Formato do identificador da equipe conferido ANTES de escrever. Sem isso
    -- a falha do cast so apareceria dentro do helper, ja com o cadastro
    -- gravado — e ainda daria certo por causa do rollback, mas ao custo de
    -- desfazer trabalho que nunca precisou comecar.
    if exists (
      select 1 from jsonb_array_elements(p_steps) as e(step)
      where nullif(btrim(coalesce(e.step ->> 'teamId', '')), '') is not null
        and nullif(btrim(coalesce(e.step ->> 'teamId', '')), '')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_EXECUTION_PLAN',
        'message', 'Ha equipe com identificador invalido no Plano de Execucao.');
    end if;
  end if;

  -- ===========================================================================
  -- ESCRITA. Daqui para baixo NENHUM `return` de erro: so `raise`, para que o
  -- bloco de excecao desfaca tudo antes de responder.
  -- ===========================================================================
  v_saved := public.save_permission_intervention(
    p_tenant_id, p_actor_user_id, p_pi_id, coalesce(p_payload, '{}'::jsonb), p_expected_updated_at
  );

  if coalesce((v_saved ->> 'success')::boolean, false) <> true then
    v_failure := v_saved;
    raise exception using errcode = 'PI444', message = 'cadastro da PI recusado';
  end if;

  v_pi_id := nullif(v_saved ->> 'pi_id', '')::uuid;
  v_updated_at := nullif(v_saved ->> 'updated_at', '')::timestamptz;

  -- `p_steps` nulo significa "nao mexe no plano". Lista vazia significa
  -- "esvazia o plano", e e vontade explicita de quem chamou.
  if p_steps is not null then
    v_plan := public.save_pi_execution_steps(
      p_tenant_id, p_actor_user_id, v_pi_id, p_steps, v_updated_at
    );

    if coalesce((v_plan ->> 'success')::boolean, false) <> true then
      v_failure := v_plan;
      raise exception using errcode = 'PI444', message = 'Plano de Execucao recusado';
    end if;

    v_updated_at := nullif(v_plan ->> 'updated_at', '')::timestamptz;
    v_step_count := nullif(v_plan ->> 'step_count', '')::integer;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'pi_id', v_pi_id,
    'updated_at', v_updated_at,
    'link_status', v_saved -> 'link_status',
    'programming_id', v_saved -> 'programming_id',
    'step_count', v_step_count,
    'message', coalesce(v_saved ->> 'message', 'PI salva com sucesso.')
  );
exception
  when sqlstate 'PI444' then
    -- A subtransacao desta funcao foi desfeita: nada que os helpers gravaram
    -- sobreviveu. `v_failure` e variavel de PL/pgSQL e NAO e desfeita pelo
    -- rollback, entao a recusa original do helper chega ao cliente intacta,
    -- com o mesmo motivo e a mesma mensagem que ele veria antes.
    return v_failure;
end;
$$;

revoke all on function public.save_permission_intervention_form(uuid, uuid, uuid, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_permission_intervention_form(uuid, uuid, uuid, integer, jsonb, jsonb, timestamptz) to service_role;

comment on function public.save_permission_intervention_form(uuid, uuid, uuid, integer, jsonb, jsonb, timestamptz) is
  'Unico ponto de escrita do formulario da PI. Cadastro e Plano de Execucao na mesma transacao: se devolver success:false, nada da tentativa foi gravado. `p_payload_version` descreve o formato do payload e recusa cliente desatualizado.';

-- =============================================================================
-- 2) As duas RPCs antigas viram helpers internos
-- =============================================================================
-- Elas continuam existindo e sao chamadas de DENTRO da orquestradora, onde o
-- usuario corrente e o dono da funcao. Perder o grant de `service_role` e o que
-- impede a aplicacao de voltar a escrever fora da transacao: enquanto a rota do
-- plano existir e a chave de servico puder chama-la, a brecha da escrita
-- parcial continua aberta, mesmo com a tela corrigida.
revoke all on function public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;

-- =============================================================================
-- 3) Verificacao
-- =============================================================================
do $$
declare
  v_form_fn text := 'public.save_permission_intervention_form(uuid, uuid, uuid, integer, jsonb, jsonb, timestamptz)';
  v_fn text;
begin
  if has_function_privilege('anon', v_form_fn::regprocedure, 'execute')
     or has_function_privilege('authenticated', v_form_fn::regprocedure, 'execute') then
    raise exception '444: % ainda executavel por anon/authenticated', v_form_fn;
  end if;

  if not has_function_privilege('service_role', v_form_fn::regprocedure, 'execute') then
    raise exception '444: % deveria ser executavel por service_role', v_form_fn;
  end if;

  -- Os dois helpers nao podem mais ser chamados pela aplicacao. Aqui a
  -- assercao sobre `service_role` ABORTA, e nao avisa: e o ponto da migration.
  foreach v_fn in array array[
    'public.save_permission_intervention(uuid, uuid, uuid, jsonb, timestamptz)',
    'public.save_pi_execution_steps(uuid, uuid, uuid, jsonb, timestamptz)'
  ]
  loop
    if has_function_privilege('anon', v_fn::regprocedure, 'execute')
       or has_function_privilege('authenticated', v_fn::regprocedure, 'execute') then
      raise exception '444: % ainda executavel por anon/authenticated', v_fn;
    end if;

    if has_function_privilege('service_role', v_fn::regprocedure, 'execute') then
      raise exception '444: % continua executavel por service_role; a escrita parcial seguiria possivel', v_fn;
    end if;
  end loop;
end;
$$;
