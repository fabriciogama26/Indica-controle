-- 261_fix_ingresso_date_functions.sql
-- Garante que ingresso_date funciona mesmo se migration 260 aplicou apenas o ALTER TABLE.
-- Abordagem defensiva:
--   1. Garante que a coluna existe com default seguro (idempotente)
--   2. Cria overload de 10 params de save_project_billing_order (para POST/PUT direto)
--   3. Atualiza save_project_billing_order_batch_partial para usar ingresso_date
--      via UPDATE apos o save, evitando dependencia do overload 10-params em ambientes antigos

-- ============================================================
-- 1. Coluna ingresso_date — garantir existencia e default como seguranca
-- ============================================================

alter table public.project_billing_orders
  add column if not exists ingresso_date date;

-- DEFAULT permanente: formulario e batch sempre enviam o valor correto;
-- o default evita que funcoes antigas quebrem com NOT NULL durante transicao.
alter table public.project_billing_orders
  alter column ingresso_date set default now()::date;

-- Backfill de registros sem data (caso coluna tenha sido adicionada sem valor)
update public.project_billing_orders
set ingresso_date = created_at::date
where ingresso_date is null;

-- Agora aplica NOT NULL com seguranca (todos os registros tem valor)
alter table public.project_billing_orders
  alter column ingresso_date set not null;

-- Indice (idempotente)
create index if not exists idx_project_billing_orders_tenant_ingresso
  on public.project_billing_orders (tenant_id, ingresso_date desc);

-- ============================================================
-- 2. Overload 10-params de save_project_billing_order
--    Usado por POST/PUT direto (formulario de cadastro e edicao)
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
  v_result jsonb;
begin
  -- Valida ingresso_date antes de delegar a funcao base (9-params)
  if p_ingresso_date is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_INGRESSO_DATE',
      'message', 'Data Ingresso e obrigatoria para o faturamento.'
    );
  end if;

  -- Chama a funcao base (9-params, migration 259) que faz todo o trabalho
  v_result := public.save_project_billing_order(
    p_tenant_id,
    p_actor_user_id,
    p_billing_order_id,
    p_project_id,
    p_billing_kind,
    p_no_production_reason_id,
    p_notes,
    p_items,
    p_expected_updated_at
  );

  -- Se salvou com sucesso, atualiza ingresso_date
  if coalesce((v_result->>'success')::boolean, false) then
    update public.project_billing_orders
    set ingresso_date = p_ingresso_date
    where tenant_id = p_tenant_id
      and id = (v_result->>'billing_order_id')::uuid;
  end if;

  return v_result;
end;
$$;

-- ============================================================
-- 3. save_project_billing_order_batch_partial
--    Extrai ingressoDate do JSON e aplica via UPDATE pos-save
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
  v_ingresso_date date;
  v_order_id uuid;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_BILLING_BATCH', 'message', 'Nenhuma linha valida enviada para importacao.');
  end if;

  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'BATCH_TOO_LARGE', 'message', 'Maximo de 500 faturamentos por importacao em lote.');
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_numbers := coalesce(v_row->'rowNumbers', '[]'::jsonb);
    v_ingresso_date := nullif(v_row->>'ingressoDate', '')::date;

    if v_ingresso_date is null then
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'rowNumbers', v_row_numbers,
        'success', false,
        'reason', 'MISSING_INGRESSO_DATE',
        'message', 'Data Ingresso e obrigatoria para o faturamento.'
      ));
      continue;
    end if;

    v_result := public.save_project_billing_order(
      p_tenant_id,
      p_actor_user_id,
      null,
      nullif(v_row->>'projectId', '')::uuid,
      coalesce(v_row->>'billingKind', 'COM_PRODUCAO'),
      nullif(v_row->>'noProductionReasonId', '')::uuid,
      v_row->>'notes',
      coalesce(v_row->'items', '[]'::jsonb),
      null
    );

    if coalesce((v_result->>'success')::boolean, false) then
      v_order_id := nullif(v_result->>'billing_order_id', '')::uuid;

      -- Aplica ingresso_date na ordem recem criada
      if v_order_id is not null then
        update public.project_billing_orders
        set ingresso_date = v_ingresso_date
        where tenant_id = p_tenant_id
          and id = v_order_id;
      end if;

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
