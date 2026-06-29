-- 278_harden_security_advisor_warnings.sql
-- Corrige alertas do Supabase Advisor que nao foram capturados pela migration 210
-- porque as funcoes afetadas foram criadas ou recriadas depois dela.
--
-- 1. normalize_minimum_billing_token: add SET search_path = public, pg_temp
--    (criada na 212, depois da 210 — ficou fora da lista)
--
-- 2. save_project_billing_order: revoga anon + valida chamador via auth.uid()
--    (recriada na 259/262 sem REVOKE anon explicito; CREATE OR REPLACE repoe
--     o grant padrao TO PUBLIC)
--
-- 3. user_has_page_action: revoga anon
--    (recriada na 253 sem REVOKE anon explicito)
--
-- 4. save_user_permissions: adiciona guard de admin no inicio da funcao
--    (qualquer usuario autenticado podia alterar permissoes de outros)
--
-- Nota externa (nao corrigivel por migration):
--   auth_leaked_password_protection deve ser habilitado no Supabase Dashboard
--   Authentication > Settings > "Enable Leaked Password Protection".

-- ============================================================
-- 1. normalize_minimum_billing_token — fix search_path
-- ============================================================

create or replace function public.normalize_minimum_billing_token(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
    translate(
      upper(btrim(coalesce(p_value, ''))),
      U&'\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7',
      'AAAAAEEEEIIIIOOOOOUUUUC'
    ),
    '[^A-Z0-9]+',
    '',
    'g'
  );
$$;

revoke all on function public.normalize_minimum_billing_token(text) from public;
grant execute on function public.normalize_minimum_billing_token(text) to authenticated;
grant execute on function public.normalize_minimum_billing_token(text) to service_role;

-- ============================================================
-- 2. save_project_billing_order
--    - revoga anon
--    - adiciona validacao do chamador (auth.uid() deve corresponder ao actor)
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
    v_order_id := gen_random_uuid();
    v_action := 'CREATE';
    v_changes := '{}'::jsonb;

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
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
      p_ingresso_date,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at into v_order_id, v_updated_at;

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

    update public.project_billing_orders
    set
      project_id = p_project_id,
      billing_kind = v_billing_kind,
      no_production_reason_id = p_no_production_reason_id,
      no_production_reason_name_snapshot = v_reason_name,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      project_code_snapshot = coalesce(nullif(btrim(v_project_code), ''), p_project_id::text),
      ingresso_date = p_ingresso_date,
      updated_by = p_actor_user_id,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_order_id
    returning updated_at into v_updated_at;

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
    if v_order.notes is distinct from nullif(btrim(coalesce(p_notes, '')), '') then
      v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('from', v_order.notes, 'to', nullif(btrim(coalesce(p_notes, '')), '')));
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

revoke all on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) from public;
revoke execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) from anon;
grant execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) to authenticated;
grant execute on function public.save_project_billing_order(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, timestamptz, date) to service_role;

-- ============================================================
-- 3. user_has_page_action — revoga anon
--    REVOKE FROM PUBLIC obrigatorio: CREATE OR REPLACE na 253 repoe EXECUTE TO PUBLIC
--    e REVOKE FROM anon sozinho nao remove o grant herdado de PUBLIC.
-- ============================================================

revoke all on function public.user_has_page_action(text, text) from public;
revoke execute on function public.user_has_page_action(text, text) from anon;
grant execute on function public.user_has_page_action(text, text) to authenticated;
grant execute on function public.user_has_page_action(text, text) to service_role;

-- ============================================================
-- 4. save_user_permissions — adiciona guard de admin
-- ============================================================

create or replace function public.save_user_permissions(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role_id uuid,
  p_ativo boolean,
  p_permissions jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user public.app_users%rowtype;
  v_next_updated_at timestamptz := now();
  v_permission_item jsonb;
  v_page_key text;
  v_can_access boolean;
  v_current_permission boolean;
begin
  -- Somente administradores podem gerenciar permissoes de outros usuarios.
  -- service_role (auth.uid() null) e chamadas internas ignoram esta verificacao.
  if auth.uid() is not null and not public.user_is_admin_in_tenant(p_tenant_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'FORBIDDEN', 'message', 'Somente administradores podem gerenciar permissoes.');
  end if;

  if jsonb_typeof(coalesce(p_permissions, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_PERMISSIONS_PAYLOAD', 'message', 'A lista de permissoes deve ser um array json.');
  end if;

  select *
  into v_target_user
  from public.app_users
  where id = p_target_user_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'TARGET_USER_NOT_FOUND', 'message', 'Usuario nao encontrado no tenant atual.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Recarregue as credenciais do usuario antes de salvar.');
  end if;

  if v_target_user.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('As credenciais do usuario %s foram alteradas por outro administrador. Recarregue os dados antes de salvar novamente.', v_target_user.login_name)
    );
  end if;

  update public.app_users
  set
    role_id    = p_role_id,
    ativo      = p_ativo,
    updated_by = p_actor_user_id,
    updated_at = v_next_updated_at
  where id        = p_target_user_id
    and tenant_id = p_tenant_id;

  if v_target_user.role_id is distinct from p_role_id then
    insert into public.app_user_permission_history (
      tenant_id, target_user_id, change_type,
      previous_role_id, new_role_id, metadata, created_by
    ) values (
      p_tenant_id, p_target_user_id, 'ROLE_CHANGED',
      v_target_user.role_id, p_role_id,
      jsonb_build_object('previousRoleId', v_target_user.role_id, 'newRoleId', p_role_id),
      p_actor_user_id
    );
  end if;

  if v_target_user.ativo is distinct from p_ativo then
    insert into public.app_user_permission_history (
      tenant_id, target_user_id, change_type,
      previous_ativo, new_ativo, created_by
    ) values (
      p_tenant_id, p_target_user_id, 'STATUS_CHANGED',
      v_target_user.ativo, p_ativo, p_actor_user_id
    );
  end if;

  for v_permission_item in
    select value
    from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb))
  loop
    v_page_key := nullif(btrim(coalesce(v_permission_item ->> 'pageKey', '')), '');
    if v_page_key is null then
      continue;
    end if;

    v_can_access := coalesce((v_permission_item ->> 'enabled')::boolean, false);

    select upp.can_access
    into v_current_permission
    from public.app_user_page_permissions upp
    where upp.tenant_id = p_tenant_id
      and upp.user_id   = p_target_user_id
      and upp.page_key  = v_page_key;

    insert into public.app_user_page_permissions (
      tenant_id, user_id, page_key,
      can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export,
      created_by, updated_by
    ) values (
      p_tenant_id, p_target_user_id, v_page_key,
      v_can_access, v_can_access, v_can_access, v_can_access, v_can_access, v_can_access, v_can_access,
      p_actor_user_id, p_actor_user_id
    )
    on conflict (tenant_id, user_id, page_key) do update
    set
      can_access  = excluded.can_access,
      can_create  = excluded.can_create,
      can_update  = excluded.can_update,
      can_cancel  = excluded.can_cancel,
      can_reverse = excluded.can_reverse,
      can_import  = excluded.can_import,
      can_export  = excluded.can_export,
      updated_by  = excluded.updated_by,
      updated_at  = now();

    if v_current_permission is distinct from v_can_access then
      insert into public.app_user_permission_history (
        tenant_id, target_user_id, page_key, change_type,
        previous_can_access, new_can_access, created_by
      ) values (
        p_tenant_id, p_target_user_id, v_page_key, 'PAGE_ACCESS_CHANGED',
        v_current_permission, v_can_access, p_actor_user_id
      );
    end if;
  end loop;

  return jsonb_build_object('success', true, 'status', 200, 'updated_at', v_next_updated_at);
end;
$$;

revoke all on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) from public;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to authenticated;
grant execute on function public.save_user_permissions(uuid, uuid, uuid, uuid, boolean, jsonb, timestamptz) to service_role;

-- ============================================================
-- Validacao
-- ============================================================

do $$
begin
  -- 1. normalize_minimum_billing_token deve ter search_path fixo
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'normalize_minimum_billing_token'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception '278: normalize_minimum_billing_token ainda sem search_path fixo';
  end if;

  -- 2. save_project_billing_order nao deve ser executavel por anon
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_project_billing_order'
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception '278: save_project_billing_order ainda executavel por anon';
  end if;

  -- 3. user_has_page_action nao deve ser executavel por anon
  if has_function_privilege('anon', 'public.user_has_page_action(text, text)', 'execute') then
    raise exception '278: user_has_page_action ainda executavel por anon';
  end if;
end;
$$;
