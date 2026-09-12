-- 389_project_billing_unique_semantic_key.sql
-- Impede que a mesma importacao entre duas vezes no banco.
--
-- O PROBLEMA
-- ---------------------------------------------------------------------------
-- A importacao em massa de Faturamento so deduplicava DENTRO de uma chamada: o
-- `groupKey` de `BillingPageView.tsx` agrupa as linhas do CSV por
-- projeto|tipo|motivo|data_ingresso|notas, e a mensagem "Atividade duplicada no
-- mesmo faturamento" so dispara quando o mesmo codigo de atividade se repete
-- dentro desse grupo. Nada nunca comparou a linha com o que JA estava no banco, e
-- `save_project_billing_order` sempre faz INSERT quando `p_billing_order_id` e
-- nulo. Importar dois arquivos com sobreposicao criava dois conjuntos completos de
-- faturamentos, sem um unico aviso.
--
-- Caso real que motivou esta migration: dois arquivos do mesmo contrato
-- (R$ 3.976.127,11 e R$ 1.674.806,35) foram importados e a tela passou a somar
-- R$ 5.366.906,08 — a soma dos dois menos as linhas recusadas por duplicidade
-- DENTRO de cada arquivo.
--
-- A CHAVE
-- ---------------------------------------------------------------------------
-- Mesma chave que a importacao ja usa para agrupar: projeto + data de ingresso +
-- tipo (com o motivo de sem producao, que faz parte do tipo) + notas do pedido.
-- O motivo entra porque o `groupKey` do importador ja o considera: sem ele, o
-- banco recusaria como duplicado um par de faturamentos SEM_PRODUCAO que o
-- importador legitimamente separa por motivos diferentes.
--
-- Indice PARCIAL (`status <> 'CANCELADA'`): cancelar um faturamento tem que
-- liberar a chave para o lancamento correto entrar no lugar.
--
-- `ingresso_date` nula (linhas anteriores a migration 260) nao colide com nada:
-- NULL e sempre distinto num indice unico. Registros legados ficam de fora da
-- trava, o que e o comportamento desejado — a trava vale para o que entra agora.
--
-- ORDEM DE APLICACAO (importa)
-- ---------------------------------------------------------------------------
-- O indice unico NAO pode ser criado sobre dados que ja violam a chave. Por isso
-- o bloco 1 conta as violacoes e ABORTA com a lista, em vez de deixar a migration
-- falhar no meio com um erro de indice. Limpe os duplicados primeiro, depois
-- aplique esta migration, e so entao reimporte.

-- ============================================================
-- 1. Guarda: aborta com diagnostico se ja existe duplicidade
-- ============================================================

do $$
declare
  v_duplicate_groups integer;
  v_duplicate_rows integer;
  v_sample text;
begin
  select
    count(*),
    coalesce(sum(grupo.pedidos), 0)
  into v_duplicate_groups, v_duplicate_rows
  from (
    select count(*) as pedidos
    from public.project_billing_orders
    where status <> 'CANCELADA'
    group by
      tenant_id,
      project_id,
      ingresso_date,
      billing_kind,
      coalesce(no_production_reason_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(btrim(notes), '')
    having count(*) > 1
  ) as grupo;

  if v_duplicate_groups > 0 then
    select string_agg(linha, E'\n')
    into v_sample
    from (
      select format(
        '  projeto=%s data=%s tipo=%s notas=%s -> %s pedidos',
        min(o.project_code_snapshot),
        coalesce(o.ingresso_date::text, '(nula)'),
        o.billing_kind,
        coalesce(nullif(coalesce(btrim(o.notes), ''), ''), '(vazias)'),
        count(*)
      ) as linha
      from public.project_billing_orders o
      where o.status <> 'CANCELADA'
      group by
        o.tenant_id,
        o.project_id,
        o.ingresso_date,
        o.billing_kind,
        coalesce(o.no_production_reason_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(btrim(o.notes), '')
      having count(*) > 1
      order by count(*) desc
      limit 10
    ) as amostra;

    raise exception E'389: existem % chave(s) duplicada(s) cobrindo % faturamento(s) nao cancelados. O indice unico nao pode ser criado sobre esses dados.\nLimpe (ou cancele) os duplicados e aplique a migration de novo.\nAmostra (ate 10):\n%',
      v_duplicate_groups, v_duplicate_rows, coalesce(v_sample, '  (nenhuma)');
  end if;
end;
$$;

-- ============================================================
-- 2. Indice unico parcial
-- ============================================================

create unique index if not exists ux_project_billing_orders_semantic_key
  on public.project_billing_orders (
    tenant_id,
    project_id,
    ingresso_date,
    billing_kind,
    coalesce(no_production_reason_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(btrim(notes), '')
  )
  where status <> 'CANCELADA';

comment on index public.ux_project_billing_orders_semantic_key is
'Chave semantica do faturamento (mesma do groupKey da importacao em massa): projeto + data de ingresso + tipo + motivo de sem producao + notas do pedido. Parcial em status <> CANCELADA para que cancelar libere a chave. Barreira real contra reimportacao do mesmo arquivo; a pre-checagem em save_project_billing_order existe apenas para dar mensagem legivel.';

-- ============================================================
-- 3. save_project_billing_order
--    corpo da 278 + pre-checagem de duplicidade na criacao
--    + traducao de unique_violation em 409 legivel
-- ============================================================

create or replace function public.save_project_billing_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_billing_order_id uuid default null,
  p_project_id uuid default null,
  p_billing_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_ingresso_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.project_billing_orders%rowtype;
  v_order_id uuid;
  v_updated_at timestamptz;
  v_project_code text;
  v_reason_name text;
  v_billing_kind text := upper(nullif(btrim(coalesce(p_billing_kind, 'COM_PRODUCAO')), ''));
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_items, '[]'::jsonb)), 0);
  v_inserted_count integer := 0;
  v_action text;
  v_item jsonb;
  v_activity public.service_activities%rowtype;
  v_activity_id uuid;
  v_quantity numeric;
  v_rate numeric;
  v_changes jsonb := '{}'::jsonb;
  v_old_item_count integer := 0;
  v_old_total_amount numeric := 0;
  v_new_total_amount numeric := 0;
  v_old_items jsonb := '[]'::jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_constraint text;
  v_message text;
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

  if v_billing_kind not in ('COM_PRODUCAO', 'SEM_PRODUCAO') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_KIND', 'message', 'Tipo de faturamento invalido.');
  end if;

  if p_project_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_PROJECT', 'message', 'Projeto e obrigatorio para o faturamento.');
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or v_item_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_ITEMS', 'message', 'Informe itens validos do faturamento.');
  end if;

  if p_ingresso_date is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_INGRESSO_DATE', 'message', 'Data Ingresso e obrigatoria para o faturamento.');
  end if;

  select p.sob
  into v_project_code
  from public.project p
  where p.tenant_id = p_tenant_id
    and p.id = p_project_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'PROJECT_NOT_FOUND', 'message', 'Projeto nao encontrado.');
  end if;

  if v_billing_kind = 'SEM_PRODUCAO' then
    select r.name
    into v_reason_name
    from public.measurement_no_production_reasons r
    where r.tenant_id = p_tenant_id
      and r.id = p_no_production_reason_id
      and r.is_active = true;

    if not found then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'NO_PRODUCTION_REASON_NOT_FOUND', 'message', 'Motivo de sem producao nao encontrado.');
    end if;
  else
    p_no_production_reason_id := null;
    v_reason_name := null;
  end if;

  if (
    select count(*) <> count(distinct nullif(x->>'activityId', '')::uuid)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where nullif(x->>'activityId', '') is not null
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DUPLICATE_BILLING_ACTIVITY', 'message', 'A mesma atividade nao pode se repetir no faturamento.');
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_activity_id := nullif(v_item->>'activityId', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;

    if v_activity_id is null
      or coalesce(v_quantity, 0) <= 0
      or coalesce(v_rate, 0) <= 0
    then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_ITEM', 'message', 'Item de faturamento invalido.');
    end if;
  end loop;

  if p_billing_order_id is null then
    -- Pre-checagem da chave semantica. Existe SO para dar mensagem legivel: a
    -- barreira real contra corrida e o indice unico parcial
    -- `ux_project_billing_orders_semantic_key` (guia_sql.md regra 6).
    if exists (
      select 1
      from public.project_billing_orders o
      where o.tenant_id = p_tenant_id
        and o.project_id = p_project_id
        and o.ingresso_date is not distinct from p_ingresso_date
        and o.billing_kind = v_billing_kind
        and o.no_production_reason_id is not distinct from p_no_production_reason_id
        and coalesce(btrim(o.notes), '') = coalesce(v_notes, '')
        and o.status <> 'CANCELADA'
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_BILLING_ORDER',
        'message', 'Ja existe faturamento para este projeto, data de ingresso, tipo e notas do pedido.'
      );
    end if;

    v_order_id := gen_random_uuid();
    v_action := 'CREATE';
    v_changes := '{}'::jsonb;

    begin
      insert into public.project_billing_orders (
        id, tenant_id, billing_number, project_id, billing_kind, no_production_reason_id,
        no_production_reason_name_snapshot, status, notes, project_code_snapshot,
        ingresso_date, created_by, updated_by
      ) values (
        v_order_id,
        p_tenant_id,
        'FAT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
        p_project_id,
        v_billing_kind,
        p_no_production_reason_id,
        v_reason_name,
        'ABERTA',
        v_notes,
        coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
        p_ingresso_date,
        p_actor_user_id,
        p_actor_user_id
      )
      returning id, updated_at into v_order_id, v_updated_at;
    exception
      when unique_violation then
        get stacked diagnostics
          v_constraint = constraint_name,
          v_message = message_text;
        -- So traduz a violacao da chave semantica; qualquer outra (ex.: colisao
        -- de `billing_number`) continua subindo como erro de verdade.
        if coalesce(v_constraint, '') = 'ux_project_billing_orders_semantic_key'
          or position('ux_project_billing_orders_semantic_key' in coalesce(v_message, '')) > 0
        then
          return jsonb_build_object(
            'success', false,
            'status', 409,
            'reason', 'DUPLICATE_BILLING_ORDER',
            'message', 'Ja existe faturamento para este projeto, data de ingresso, tipo e notas do pedido.'
          );
        end if;
        raise;
    end;

  else
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
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'MISSING_EXPECTED_UPDATED_AT', 'message', 'Atualize a lista antes de editar o faturamento.', 'currentUpdatedAt', v_order.updated_at);
    end if;

    if date_trunc('milliseconds', v_order.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'STALE_BILLING_ORDER', 'message', 'Faturamento alterado por outro usuario. Recarregue os dados antes de salvar.', 'currentUpdatedAt', v_order.updated_at);
    end if;

    if v_order.status <> 'ABERTA' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'BILLING_ORDER_NOT_EDITABLE', 'message', 'Somente faturamento aberto pode ser editado.');
    end if;

    v_order_id := p_billing_order_id;
    v_action := 'UPDATE';

    select
      count(*)::integer,
      coalesce(sum(total_value), 0),
      coalesce(jsonb_agg(jsonb_build_object(
        'activityId', service_activity_id,
        'quantity', quantity,
        'rate', rate,
        'activityActiveSnapshot', activity_active_snapshot,
        'observation', observation
      ) order by service_activity_id), '[]'::jsonb)
    into v_old_item_count, v_old_total_amount, v_old_items
    from public.project_billing_order_items
    where tenant_id = p_tenant_id
      and billing_order_id = v_order_id
      and is_active = true;

    -- A edicao tambem pode colidir com a chave semantica (mudando projeto, data
    -- ou notas para os de um faturamento existente).
    begin
      update public.project_billing_orders
      set
        project_id = p_project_id,
        billing_kind = v_billing_kind,
        no_production_reason_id = p_no_production_reason_id,
        no_production_reason_name_snapshot = v_reason_name,
        notes = v_notes,
        project_code_snapshot = coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
        ingresso_date = p_ingresso_date,
        updated_by = p_actor_user_id,
        updated_at = now()
      where tenant_id = p_tenant_id
        and id = v_order_id
      returning updated_at into v_updated_at;
    exception
      when unique_violation then
        get stacked diagnostics
          v_constraint = constraint_name,
          v_message = message_text;
        if coalesce(v_constraint, '') = 'ux_project_billing_orders_semantic_key'
          or position('ux_project_billing_orders_semantic_key' in coalesce(v_message, '')) > 0
        then
          return jsonb_build_object(
            'success', false,
            'status', 409,
            'reason', 'DUPLICATE_BILLING_ORDER',
            'message', 'Ja existe outro faturamento para este projeto, data de ingresso, tipo e notas do pedido.'
          );
        end if;
        raise;
    end;

    update public.project_billing_order_items
    set
      is_active = false,
      updated_by = p_actor_user_id,
      updated_at = now()
    where tenant_id = p_tenant_id
      and billing_order_id = v_order_id
      and is_active = true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_activity_id := nullif(v_item->>'activityId', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_rate := nullif(v_item->>'rate', '')::numeric;

    select *
    into v_activity
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.id = v_activity_id;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'BILLING_ACTIVITY_NOT_FOUND', 'message', 'Atividade do faturamento nao encontrada.');
    end if;

    insert into public.project_billing_order_items (
      tenant_id, billing_order_id, service_activity_id, activity_code, activity_description,
      activity_unit, voice_point, quantity, rate, unit_value, activity_active_snapshot, observation, created_by, updated_by
    ) values (
      p_tenant_id,
      v_order_id,
      v_activity.id,
      v_activity.code,
      v_activity.description,
      v_activity.unit,
      coalesce(v_activity.voice_point, 1),
      v_quantity,
      v_rate,
      coalesce(v_activity.unit_value, 0),
      coalesce(v_activity.ativo, false),
      nullif(btrim(coalesce(v_item->>'observation', '')), ''),
      p_actor_user_id,
      p_actor_user_id
    );

    v_inserted_count := v_inserted_count + 1;
  end loop;

  select
    coalesce(sum(total_value), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'activityId', service_activity_id,
      'quantity', quantity,
      'rate', rate,
      'activityActiveSnapshot', activity_active_snapshot,
      'observation', observation
    ) order by service_activity_id), '[]'::jsonb)
  into v_new_total_amount, v_new_items
  from public.project_billing_order_items
  where tenant_id = p_tenant_id
    and billing_order_id = v_order_id
    and is_active = true;

  if v_action = 'UPDATE' then
    if v_order.project_id is distinct from p_project_id then
      v_changes := v_changes || jsonb_build_object('projectId', jsonb_build_object('from', v_order.project_id, 'to', p_project_id));
    end if;
    if v_order.billing_kind is distinct from v_billing_kind then
      v_changes := v_changes || jsonb_build_object('billingKind', jsonb_build_object('from', v_order.billing_kind, 'to', v_billing_kind));
    end if;
    if v_order.no_production_reason_id is distinct from p_no_production_reason_id then
      v_changes := v_changes || jsonb_build_object('noProductionReasonId', jsonb_build_object('from', v_order.no_production_reason_id, 'to', p_no_production_reason_id));
    end if;
    if v_order.ingresso_date is distinct from p_ingresso_date then
      v_changes := v_changes || jsonb_build_object('ingressoDate', jsonb_build_object('from', v_order.ingresso_date, 'to', p_ingresso_date));
    end if;
    if v_order.notes is distinct from v_notes then
      v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('from', v_order.notes, 'to', v_notes));
    end if;
    if v_old_item_count is distinct from v_inserted_count then
      v_changes := v_changes || jsonb_build_object('itemCount', jsonb_build_object('from', v_old_item_count, 'to', v_inserted_count));
    end if;
    if v_old_total_amount is distinct from v_new_total_amount then
      v_changes := v_changes || jsonb_build_object('totalAmount', jsonb_build_object('from', v_old_total_amount, 'to', v_new_total_amount));
    end if;
    if v_old_items is distinct from v_new_items then
      v_changes := v_changes || jsonb_build_object('items', jsonb_build_object('from', v_old_items, 'to', v_new_items));
    end if;
  end if;

  if v_action = 'CREATE' or v_changes <> '{}'::jsonb then
    perform public.append_project_billing_order_history_record(
      p_tenant_id,
      p_actor_user_id,
      v_order_id,
      v_action,
      null,
      v_changes,
      jsonb_build_object(
        'source', 'faturamento',
        'itemCount', v_inserted_count,
        'totalAmount', v_new_total_amount
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'message', 'Faturamento salvo com sucesso.',
    'billing_order_id', v_order_id,
    'updated_at', v_updated_at
  );
end;
$$;

revoke all on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)
from public, anon, authenticated;
grant execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)
to service_role;

-- ============================================================
-- 4. Verificacao
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'ux_project_billing_orders_semantic_key'
  ) then
    raise exception '389: indice ux_project_billing_orders_semantic_key nao foi criado';
  end if;

  if has_function_privilege('anon', 'public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)', 'execute')
    or has_function_privilege('authenticated', 'public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date)', 'execute')
  then
    raise exception '389: save_project_billing_order voltou a ser executavel por anon/authenticated';
  end if;
end;
$$;
