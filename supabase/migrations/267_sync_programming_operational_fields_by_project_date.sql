-- Sincroniza campos operacionais da Programacao entre equipes ativas do mesmo Projeto + Data.
-- A sincronizacao ocorre dentro da RPC full individual para manter salvamento e cascata na mesma transacao.

create or replace function public.sync_project_programming_group_operational_fields(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_row public.project_programming%rowtype;
  v_next public.project_programming%rowtype;
  v_changes jsonb;
  v_history_result jsonb;
  v_updated_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_structured_error jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_source_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_OPERATIONAL_SYNC_PAYLOAD',
      'message', 'Informe tenant, usuario e programacao origem para sincronizar campos operacionais.'
    );
  end if;

  select *
  into v_source
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_source_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao origem nao encontrada para sincronizacao operacional.'
    );
  end if;

  if coalesce(v_source.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'affected_count', 0,
      'updated_programming_ids', array[]::uuid[],
      'message', 'Programacao origem nao esta ativa; nenhuma sincronizacao operacional foi aplicada.'
    );
  end if;

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source.project_id
      and pp.execution_date = v_source.execution_date
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> v_source.id
      and (
        pp.feeder is distinct from v_source.feeder
        or pp.campo_eletrico is distinct from v_source.campo_eletrico
        or pp.electrical_eq_catalog_id is distinct from v_source.electrical_eq_catalog_id
        or pp.sgd_type_id is distinct from v_source.sgd_type_id
        or pp.affected_customers is distinct from v_source.affected_customers
        or pp.outage_start_time is distinct from v_source.outage_start_time
        or pp.outage_end_time is distinct from v_source.outage_end_time
        or pp.support is distinct from v_source.support
        or pp.support_item_id is distinct from v_source.support_item_id
        or pp.poste_qty is distinct from v_source.poste_qty
        or pp.estrutura_qty is distinct from v_source.estrutura_qty
        or pp.trafo_qty is distinct from v_source.trafo_qty
        or pp.rede_qty is distinct from v_source.rede_qty
      )
    order by pp.created_at asc, pp.id asc
    for update
  loop
    v_changes := '{}'::jsonb;

    if v_row.feeder is distinct from v_source.feeder then
      v_changes := v_changes || jsonb_build_object('feeder', jsonb_build_object('from', nullif(v_row.feeder, ''), 'to', nullif(v_source.feeder, '')));
    end if;
    if v_row.campo_eletrico is distinct from v_source.campo_eletrico then
      v_changes := v_changes || jsonb_build_object('electricalField', jsonb_build_object('from', nullif(v_row.campo_eletrico, ''), 'to', nullif(v_source.campo_eletrico, '')));
    end if;
    if v_row.electrical_eq_catalog_id is distinct from v_source.electrical_eq_catalog_id then
      v_changes := v_changes || jsonb_build_object(
        'electricalEqCatalogId',
        jsonb_build_object(
          'from', case when v_row.electrical_eq_catalog_id is null then null else v_row.electrical_eq_catalog_id::text end,
          'to', case when v_source.electrical_eq_catalog_id is null then null else v_source.electrical_eq_catalog_id::text end
        )
      );
    end if;
    if v_row.sgd_type_id is distinct from v_source.sgd_type_id then
      v_changes := v_changes || jsonb_build_object(
        'sgdTypeId',
        jsonb_build_object(
          'from', case when v_row.sgd_type_id is null then null else v_row.sgd_type_id::text end,
          'to', case when v_source.sgd_type_id is null then null else v_source.sgd_type_id::text end
        )
      );
    end if;
    if v_row.affected_customers is distinct from v_source.affected_customers then
      v_changes := v_changes || jsonb_build_object('affectedCustomers', jsonb_build_object('from', v_row.affected_customers, 'to', v_source.affected_customers));
    end if;
    if v_row.outage_start_time is distinct from v_source.outage_start_time then
      v_changes := v_changes || jsonb_build_object(
        'outageStartTime',
        jsonb_build_object(
          'from', case when v_row.outage_start_time is null then null else v_row.outage_start_time::text end,
          'to', case when v_source.outage_start_time is null then null else v_source.outage_start_time::text end
        )
      );
    end if;
    if v_row.outage_end_time is distinct from v_source.outage_end_time then
      v_changes := v_changes || jsonb_build_object(
        'outageEndTime',
        jsonb_build_object(
          'from', case when v_row.outage_end_time is null then null else v_row.outage_end_time::text end,
          'to', case when v_source.outage_end_time is null then null else v_source.outage_end_time::text end
        )
      );
    end if;
    if v_row.support is distinct from v_source.support then
      v_changes := v_changes || jsonb_build_object('support', jsonb_build_object('from', nullif(v_row.support, ''), 'to', nullif(v_source.support, '')));
    end if;
    if v_row.support_item_id is distinct from v_source.support_item_id then
      v_changes := v_changes || jsonb_build_object(
        'supportItemId',
        jsonb_build_object(
          'from', case when v_row.support_item_id is null then null else v_row.support_item_id::text end,
          'to', case when v_source.support_item_id is null then null else v_source.support_item_id::text end
        )
      );
    end if;
    if v_row.poste_qty is distinct from v_source.poste_qty then
      v_changes := v_changes || jsonb_build_object('posteQty', jsonb_build_object('from', v_row.poste_qty, 'to', v_source.poste_qty));
    end if;
    if v_row.estrutura_qty is distinct from v_source.estrutura_qty then
      v_changes := v_changes || jsonb_build_object('estruturaQty', jsonb_build_object('from', v_row.estrutura_qty, 'to', v_source.estrutura_qty));
    end if;
    if v_row.trafo_qty is distinct from v_source.trafo_qty then
      v_changes := v_changes || jsonb_build_object('trafoQty', jsonb_build_object('from', v_row.trafo_qty, 'to', v_source.trafo_qty));
    end if;
    if v_row.rede_qty is distinct from v_source.rede_qty then
      v_changes := v_changes || jsonb_build_object('redeQty', jsonb_build_object('from', v_row.rede_qty, 'to', v_source.rede_qty));
    end if;

    update public.project_programming
    set
      feeder = v_source.feeder,
      campo_eletrico = v_source.campo_eletrico,
      electrical_eq_catalog_id = v_source.electrical_eq_catalog_id,
      sgd_type_id = v_source.sgd_type_id,
      affected_customers = coalesce(v_source.affected_customers, 0),
      outage_start_time = v_source.outage_start_time,
      outage_end_time = v_source.outage_end_time,
      support = v_source.support,
      support_item_id = v_source.support_item_id,
      poste_qty = coalesce(v_source.poste_qty, 0),
      estrutura_qty = coalesce(v_source.estrutura_qty, 0),
      trafo_qty = coalesce(v_source.trafo_qty, 0),
      rede_qty = coalesce(v_source.rede_qty, 0),
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_row.id
    returning *
    into v_next;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_programming_id => v_next.id,
      p_project_id => v_next.project_id,
      p_team_id => v_next.team_id,
      p_related_programming_id => v_source.id,
      p_action_type => 'UPDATE',
      p_reason => 'Sincronizacao automatica de campos operacionais por Projeto + Data.',
      p_changes => v_changes,
      p_metadata => jsonb_build_object(
        'source', 'programming-operational-fields-project-date-sync',
        'syncSourceProgrammingId', v_source.id,
        'scope', 'project+execution_date',
        'fields', jsonb_build_array(
          'feeder',
          'electricalField',
          'electricalEqCatalogId',
          'sgdTypeId',
          'affectedCustomers',
          'outageStartTime',
          'outageEndTime',
          'support',
          'supportItemId',
          'posteQty',
          'estruturaQty',
          'trafoQty',
          'redeQty'
        )
      ),
      p_from_status => v_row.status,
      p_to_status => v_next.status,
      p_from_execution_date => v_row.execution_date,
      p_to_execution_date => v_next.execution_date,
      p_from_team_id => v_row.team_id,
      p_to_team_id => v_next.team_id,
      p_from_start_time => v_row.start_time,
      p_to_start_time => v_next.start_time,
      p_from_end_time => v_row.end_time,
      p_to_end_time => v_next.end_time,
      p_from_etapa_number => v_row.etapa_number,
      p_to_etapa_number => v_next.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da sincronizacao operacional.')
        )::text;
    end if;

    v_affected_count := v_affected_count + 1;
    v_updated_ids := array_append(v_updated_ids, v_next.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'affected_count', v_affected_count,
    'updated_programming_ids', v_updated_ids,
    'message', case
      when v_affected_count = 0 then 'Nenhuma programacao do grupo precisava sincronizar campos operacionais.'
      else 'Campos operacionais sincronizados por Projeto + Data.'
    end
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'SYNC_OPERATIONAL_FIELDS_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao sincronizar campos operacionais da programacao.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.sync_project_programming_group_operational_fields(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.sync_project_programming_group_operational_fields(
  uuid,
  uuid,
  uuid
) to service_role;

drop function if exists public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamp with time zone,
  uuid,
  integer,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean,
  boolean,
  uuid,
  uuid
);

create or replace function public.save_project_programming_full_decimal_with_electrical_and_eq(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_id uuid,
  p_execution_date date,
  p_period text,
  p_start_time time,
  p_end_time time,
  p_expected_minutes integer,
  p_feeder text default null,
  p_support text default null,
  p_note text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty numeric default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null,
  p_history_action_override text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb,
  p_campo_eletrico text default null,
  p_electrical_eq_catalog_id uuid default null,
  p_etapa_unica boolean default false,
  p_etapa_final boolean default false,
  p_copied_from_programming_id uuid default null,
  p_copy_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_rede_result jsonb;
  v_sync_result jsonb;
  v_programming_id uuid;
  v_history_action text;
  v_structured_error jsonb;
begin
  if p_rede_qty is not null and (p_rede_qty::text = 'NaN' or p_rede_qty < 0) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_REDE_QTY',
      'message', 'REDE deve ser um numero maior ou igual a zero.'
    );
  end if;

  if p_copied_from_programming_id is not null and not exists (
    select 1
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.id = p_copied_from_programming_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'COPY_SOURCE_NOT_FOUND',
      'message', 'Programacao de origem da copia nao encontrada no tenant atual.'
    );
  end if;

  if p_copy_batch_id is not null and not exists (
    select 1
    from public.project_programming_copy_batches batch
    where batch.tenant_id = p_tenant_id
      and batch.id = p_copy_batch_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'COPY_BATCH_NOT_FOUND',
      'message', 'Lote de copia nao encontrado no tenant atual.'
    );
  end if;

  v_result := public.save_project_programming_full_with_electrical_and_eq(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_project_id => p_project_id,
    p_team_id => p_team_id,
    p_execution_date => p_execution_date,
    p_period => p_period,
    p_start_time => p_start_time,
    p_end_time => p_end_time,
    p_expected_minutes => p_expected_minutes,
    p_feeder => p_feeder,
    p_support => p_support,
    p_note => p_note,
    p_documents => p_documents,
    p_activities => p_activities,
    p_programming_id => p_programming_id,
    p_expected_updated_at => p_expected_updated_at,
    p_support_item_id => p_support_item_id,
    p_poste_qty => p_poste_qty,
    p_estrutura_qty => p_estrutura_qty,
    p_trafo_qty => p_trafo_qty,
    p_rede_qty => trunc(coalesce(p_rede_qty, 0))::integer,
    p_affected_customers => p_affected_customers,
    p_sgd_type_id => p_sgd_type_id,
    p_outage_start_time => p_outage_start_time,
    p_outage_end_time => p_outage_end_time,
    p_service_description => p_service_description,
    p_etapa_number => p_etapa_number,
    p_work_completion_status => p_work_completion_status,
    p_history_action_override => p_history_action_override,
    p_history_reason => p_history_reason,
    p_history_metadata => p_history_metadata,
    p_campo_eletrico => p_campo_eletrico,
    p_electrical_eq_catalog_id => p_electrical_eq_catalog_id,
    p_etapa_unica => p_etapa_unica,
    p_etapa_final => p_etapa_final
  );

  if coalesce((v_result ->> 'success')::boolean, false) = false then
    return v_result;
  end if;

  v_programming_id := nullif(v_result ->> 'programming_id', '')::uuid;
  if v_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'SAVE_PROGRAMMING_FULL_INVALID_RESULT',
        'message', 'Falha ao recuperar o ID da programacao salva.'
      )::text;
  end if;

  if p_copied_from_programming_id is not null or p_copy_batch_id is not null then
    update public.project_programming
    set copied_from_programming_id = p_copied_from_programming_id,
        copy_batch_id = p_copy_batch_id,
        updated_by = p_actor_user_id,
        updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_programming_id;
  end if;

  v_history_action := coalesce(
    nullif(upper(btrim(coalesce(p_history_action_override, ''))), ''),
    case
      when upper(coalesce(v_result ->> 'action', 'UPDATE')) = 'INSERT' then 'CREATE'
      else 'UPDATE'
    end
  );

  v_rede_result := public.set_project_programming_rede_qty_decimal(
    p_tenant_id,
    p_actor_user_id,
    v_programming_id,
    coalesce(p_rede_qty, 0),
    v_history_action,
    p_history_reason,
    coalesce(p_history_metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'source', 'save-project-programming-full-decimal',
        'copiedFromProgrammingId', p_copied_from_programming_id,
        'copyBatchId', p_copy_batch_id
      )
  );

  if coalesce((v_rede_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_rede_result ->> 'status')::integer, 400),
        'reason', coalesce(v_rede_result ->> 'reason', 'SET_REDE_DECIMAL_FAILED'),
        'message', coalesce(v_rede_result ->> 'message', 'Falha ao salvar REDE decimal da programacao.')
      )::text;
  end if;

  if p_programming_id is not null then
    v_sync_result := public.sync_project_programming_group_operational_fields(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id
    );

    if coalesce((v_sync_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_sync_result ->> 'status')::integer, 400),
          'reason', coalesce(v_sync_result ->> 'reason', 'SYNC_OPERATIONAL_FIELDS_FAILED'),
          'message', coalesce(v_sync_result ->> 'message', 'Falha ao sincronizar campos operacionais da programacao.'),
          'detail', v_sync_result ->> 'detail'
        )::text;
    end if;
  else
    v_sync_result := jsonb_build_object(
      'success', true,
      'affected_count', 0,
      'updated_programming_ids', array[]::uuid[]
    );
  end if;

  return v_result || jsonb_build_object(
    'updated_at',
    coalesce(v_rede_result ->> 'updated_at', v_result ->> 'updated_at'),
    'copied_from_programming_id',
    p_copied_from_programming_id,
    'copy_batch_id',
    p_copy_batch_id,
    'operational_sync_affected_count',
    coalesce((v_sync_result ->> 'affected_count')::integer, 0),
    'operational_sync_updated_programming_ids',
    coalesce(v_sync_result -> 'updated_programming_ids', '[]'::jsonb)
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_DECIMAL_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao com REDE decimal.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamp with time zone,
  uuid,
  integer,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean,
  boolean,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.save_project_programming_full_decimal_with_electrical_and_eq(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamp with time zone,
  uuid,
  integer,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  boolean,
  boolean,
  uuid,
  uuid
) to service_role;
