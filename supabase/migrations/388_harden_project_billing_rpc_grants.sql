-- 388_harden_project_billing_rpc_grants.sql
-- Fecha as tres RPCs SECURITY DEFINER de Faturamento que a migration 298 deixou de fora.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A 298 estabeleceu a politica do projeto: RPC SECURITY DEFINER e chamada apenas
-- pelos Route Handlers com service_role, depois de validar bearer token, tenant
-- ativo e permissao de pagina. Ela aplicou o revoke em `save_project_billing_order`
-- e ate no gemeo do As Built (`save_project_asbuilt_measurement_order_batch_partial`),
-- mas nao alcancou tres funcoes do mesmo modulo, que seguiam com o GRANT original
-- da 176 para `authenticated`:
--
--   1. set_project_billing_order_status  -- a mais grave: recebe p_tenant_id e
--      p_actor_user_id por parametro e NAO tinha nenhuma validacao interna do
--      chamador (a 278 adicionou esse guard so na funcao irma). Com o anon key e
--      o JWT disponiveis no browser, qualquer usuario autenticado podia chamar
--      /rest/v1/rpc/set_project_billing_order_status e FECHAR, CANCELAR ou
--      REABRIR faturamento sem ter a pagina `faturamento` liberada, gravando
--      `updated_by`/`canceled_by` com o id de outra pessoa. O `expected_updated_at`
--      nao era barreira: a RLS de leitura permite SELECT a qualquer membro do
--      tenant, entao o valor era lido antes da chamada.
--   2. save_project_billing_order_batch_partial -- o guard de auth.uid() da
--      funcao interna impede uso cross-tenant, mas nenhuma das duas olha
--      permissao de pagina: dava para criar 500 faturamentos por chamada sem
--      passar pelo `authorizePageAction(..., "import")` da rota.
--   3. append_project_billing_order_history_record -- valida apenas se os
--      parametros sao nao-nulos. Permitia forjar linha de historico em qualquer
--      tenant, com `created_by` arbitrario, corrompendo a trilha de auditoria
--      financeira que a tela exibe.
--
-- O QUE MUDA ALEM DOS GRANTS
-- ---------------------------------------------------------------------------
-- a) `set_project_billing_order_status` passa a validar o chamador internamente,
--    exatamente no formato que a 278 aplicou em `save_project_billing_order`:
--    defesa em camadas, para que um GRANT reaberto por engano no futuro nao
--    reabra sozinho a brecha. Chamada por service_role (auth.uid() null) segue
--    o caminho normal. O corpo restante e identico ao da 259.
-- b) `save_project_billing_order_batch_partial` passa a isolar cada linha numa
--    subtransacao (`begin ... exception when others`). Antes, o nome prometia
--    importacao PARCIAL mas so entregava isso para falhas que a funcao interna
--    devolvia como jsonb; qualquer erro SQL de verdade abortava a transacao
--    inteira e a importacao dos 500 registros virava um 500 opaco. O caso real e
--    a colisao de `project_billing_orders_unique_number`: o numero e
--    'FAT-<timestamp>-<6 hex>' e `now()` e constante na transacao, entao todas as
--    linhas do lote compartilham o timestamp e sobram 6 hex aleatorios como
--    unico diferenciador (~0,7% de colisao num lote de 500).

-- ============================================================
-- 1. set_project_billing_order_status
--    corpo da 259 + guard de identidade do chamador (padrao da 278)
-- ============================================================

create or replace function public.set_project_billing_order_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_billing_order_id uuid,
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
  v_order public.project_billing_orders%rowtype;
  v_action text := upper(nullif(btrim(coalesce(p_action, '')), ''));
  v_next_status text;
  v_updated_at timestamptz;
begin
  -- Valida identidade do chamador quando chamado via RPC (auth.uid() preenchido).
  -- service_role (auth.uid() null) e chamadas internas ignoram esta verificacao.
  if auth.uid() is not null then
    if not exists (
      select 1
      from public.app_users au
      where au.auth_user_id = auth.uid()
        and au.tenant_id = p_tenant_id
        and au.id = p_actor_user_id
        and au.ativo = true
    ) then
      return jsonb_build_object('success', false, 'status', 403, 'reason', 'FORBIDDEN', 'message', 'Acesso negado.');
    end if;
  end if;

  if p_tenant_id is null or p_billing_order_id is null or v_action not in ('FECHAR', 'CANCELAR', 'ABRIR') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_STATUS_PAYLOAD', 'message', 'Payload de status invalido.');
  end if;

  select *
  into v_order
  from public.project_billing_orders
  where tenant_id = p_tenant_id
    and id = p_billing_order_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'BILLING_ORDER_NOT_FOUND', 'message', 'Faturamento nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'MISSING_EXPECTED_UPDATED_AT', 'message', 'Atualize a lista antes de alterar o status.', 'currentUpdatedAt', v_order.updated_at);
  end if;

  if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STALE_BILLING_ORDER', 'message', 'Faturamento alterado por outro usuario. Recarregue os dados antes de alterar o status.', 'currentUpdatedAt', v_order.updated_at);
  end if;

  if v_action = 'FECHAR' then
    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Somente faturamento aberto pode ser fechado.');
    end if;
    v_next_status := 'FECHADA';

  elsif v_action = 'CANCELAR' then
    if v_order.status = 'CANCELADA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Faturamento ja esta cancelado.');
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_CANCEL_REASON', 'message', 'Informe motivo do cancelamento.');
    end if;
    -- A2 (migration 259): minimo 10 caracteres no motivo de cancelamento
    if length(btrim(coalesce(p_reason, ''))) < 10 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'SHORT_REASON', 'message', 'Motivo do cancelamento deve ter no minimo 10 caracteres.');
    end if;
    v_next_status := 'CANCELADA';

  else -- ABRIR
    if v_order.status <> 'FECHADA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'INVALID_BILLING_STATUS_TRANSITION', 'message', 'Somente faturamento fechado pode ser reaberto.');
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_REOPEN_REASON', 'message', 'Informe motivo da reabertura.');
    end if;
    -- A2 (migration 259): minimo 10 caracteres no motivo de reabertura
    if length(btrim(coalesce(p_reason, ''))) < 10 then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'SHORT_REASON', 'message', 'Motivo da reabertura deve ter no minimo 10 caracteres.');
    end if;
    v_next_status := 'ABERTA';
  end if;

  update public.project_billing_orders
  set
    status = v_next_status,
    cancellation_reason = case when v_action = 'CANCELAR' then nullif(btrim(coalesce(p_reason, '')), '') when v_action = 'ABRIR' then null else cancellation_reason end,
    canceled_at = case when v_action = 'CANCELAR' then now() when v_action = 'ABRIR' then null else canceled_at end,
    canceled_by = case when v_action = 'CANCELAR' then p_actor_user_id when v_action = 'ABRIR' then null else canceled_by end,
    updated_by = p_actor_user_id,
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_billing_order_id
  returning updated_at into v_updated_at;

  perform public.append_project_billing_order_history_record(
    p_tenant_id,
    p_actor_user_id,
    p_billing_order_id,
    v_action,
    nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('fromStatus', v_order.status, 'toStatus', v_next_status),
    jsonb_build_object('source', 'faturamento_status')
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Status do faturamento atualizado com sucesso.',
    'billing_order_id', p_billing_order_id,
    'updated_at', v_updated_at,
    'billing_status', v_next_status
  );
end;
$$;

revoke all on function public.set_project_billing_order_status(uuid, uuid, uuid, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.set_project_billing_order_status(uuid, uuid, uuid, text, text, timestamptz)
to service_role;

-- ============================================================
-- 2. save_project_billing_order_batch_partial
--    corpo da 260 + subtransacao por linha
-- ============================================================

create or replace function public.save_project_billing_order_batch_partial(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_saved_count integer := 0;
  v_error_count integer := 0;
  v_row_numbers jsonb;
  v_sqlstate text;
  v_sqlerrm text;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_BATCH', 'message', 'Nenhuma linha valida enviada para importacao.');
  end if;

  -- C3: limite de 500 grupos por importacao (migration 259)
  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'BATCH_TOO_LARGE', 'message', 'Maximo de 500 faturamentos por importacao em lote.');
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);

    -- Subtransacao por linha: erro SQL (unique violation, check constraint, cast)
    -- desfaz SO esta linha. Sem este bloco a importacao "parcial" abortava o lote
    -- inteiro no primeiro erro que a funcao interna nao tratasse como jsonb.
    begin
      v_result := public.save_project_billing_order(
        p_tenant_id,
        p_actor_user_id,
        null,
        nullif(v_row->>'projectId', '')::uuid,
        coalesce(v_row->>'billingKind', 'COM_PRODUCAO'),
        nullif(v_row->>'noProductionReasonId', '')::uuid,
        v_row->>'notes',
        coalesce(v_row->'items', '[]'::jsonb),
        null,
        nullif(v_row->>'ingressoDate', '')::date
      );
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_sqlerrm = message_text;
        v_result := jsonb_build_object(
          'success', false,
          'reason', 'BILLING_ROW_DB_ERROR',
          'message', 'Falha de banco ao salvar a linha (' || coalesce(v_sqlstate, '?') || '): ' || coalesce(v_sqlerrm, 'erro nao identificado')
        );
    end;

    if coalesce((v_result->>'success')::boolean, false) then
      v_saved_count := v_saved_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', true,
        'message', v_result->>'message',
        'billingOrderId', v_result->>'billing_order_id'
      ));
    else
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', false,
        'reason', v_result->>'reason',
        'message', v_result->>'message'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Importacao parcial de faturamento concluida.',
    'savedCount', v_saved_count,
    'errorCount', v_error_count,
    'results', v_results
  );
end;
$$;

revoke all on function public.save_project_billing_order_batch_partial(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_project_billing_order_batch_partial(uuid, uuid, jsonb)
to service_role;

-- ============================================================
-- 3. append_project_billing_order_history_record
--    apenas grants: a funcao e helper interno, chamada so de dentro
--    de outras funcoes SECURITY DEFINER do modulo (nenhum chamador em src/).
-- ============================================================

revoke all on function public.append_project_billing_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.append_project_billing_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb)
to service_role;

-- ============================================================
-- 4. Verificacao (mesmo padrao da 298)
-- ============================================================

do $$
declare
  v_function text;
  v_functions text[] := array[
    'public.set_project_billing_order_status(uuid, uuid, uuid, text, text, timestamptz)',
    'public.save_project_billing_order_batch_partial(uuid, uuid, jsonb)',
    'public.append_project_billing_order_history_record(uuid, uuid, uuid, text, text, jsonb, jsonb)'
  ];
begin
  foreach v_function in array v_functions loop
    if has_function_privilege('anon', v_function, 'execute') then
      raise exception '388: funcao % ainda executavel por anon', v_function;
    end if;

    if has_function_privilege('authenticated', v_function, 'execute') then
      raise exception '388: funcao % ainda executavel por authenticated', v_function;
    end if;

    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '388: funcao % sem EXECUTE para service_role', v_function;
    end if;
  end loop;
end;
$$;
