-- 140_create_team_stock_operations.sql
-- Vincula centro de estoque proprio a equipe e cria fluxo dedicado de requisicao/devolucao.

alter table if exists public.teams
  add column if not exists stock_center_id uuid null references public.stock_centers(id);

create index if not exists idx_teams_tenant_stock_center
  on public.teams (tenant_id, stock_center_id)
  where stock_center_id is not null;

create unique index if not exists idx_teams_unique_stock_center
  on public.teams (stock_center_id)
  where stock_center_id is not null;

create table if not exists public.stock_transfer_team_operations (
  transfer_id uuid primary key references public.stock_transfers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  team_id uuid not null references public.teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id)
);

create index if not exists idx_stock_transfer_team_operations_tenant_team
  on public.stock_transfer_team_operations (tenant_id, team_id, created_at desc);

alter table if exists public.stock_transfer_team_operations enable row level security;

drop policy if exists stock_transfer_team_operations_tenant_select on public.stock_transfer_team_operations;
create policy stock_transfer_team_operations_tenant_select on public.stock_transfer_team_operations
for select
to authenticated
using (public.user_can_access_tenant(stock_transfer_team_operations.tenant_id));

drop policy if exists stock_transfer_team_operations_tenant_insert on public.stock_transfer_team_operations;
create policy stock_transfer_team_operations_tenant_insert on public.stock_transfer_team_operations
for insert
to authenticated
with check (public.user_can_access_tenant(stock_transfer_team_operations.tenant_id));

drop policy if exists stock_transfer_team_operations_tenant_update on public.stock_transfer_team_operations;
create policy stock_transfer_team_operations_tenant_update on public.stock_transfer_team_operations
for update
to authenticated
using (public.user_can_access_tenant(stock_transfer_team_operations.tenant_id))
with check (public.user_can_access_tenant(stock_transfer_team_operations.tenant_id));

drop function if exists public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, jsonb, timestamptz);

create or replace function public.save_team_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_team_id uuid default null,
  p_name text default null,
  p_vehicle_plate text default null,
  p_service_center_id uuid default null,
  p_team_type_id uuid default null,
  p_foreman_person_id uuid default null,
  p_stock_center_id uuid default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.teams%rowtype;
  v_team_id uuid;
  v_updated_at timestamptz;
begin
  if p_stock_center_id is not null then
    perform 1
    from public.stock_centers sc
    where sc.id = p_stock_center_id
      and sc.tenant_id = p_tenant_id
      and sc.is_active = true
      and sc.center_type = 'OWN';

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_STOCK_CENTER',
        'message', 'Centro de estoque proprio invalido para a equipe.'
      );
    end if;

    if exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.stock_center_id = p_stock_center_id
        and (p_team_id is null or t.id <> p_team_id)
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;
  end if;

  if p_team_id is null then
    if exists (
      select 1
      from public.teams t
      where t.tenant_id = p_tenant_id
        and t.foreman_person_id = p_foreman_person_id
        and t.ativo = true
    ) then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_TEAM_FOREMAN',
        'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
      );
    end if;

    insert into public.teams (
      tenant_id,
      name,
      vehicle_plate,
      service_center_id,
      team_type_id,
      foreman_person_id,
      stock_center_id,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_name,
      p_vehicle_plate,
      p_service_center_id,
      p_team_type_id,
      p_foreman_person_id,
      p_stock_center_id,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'team_id', v_team_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.teams
  where id = p_team_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a equipe.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A equipe %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a equipe antes de editar.'
    );
  end if;

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.foreman_person_id = p_foreman_person_id
      and t.ativo = true
      and t.id <> p_team_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_FOREMAN',
      'message', 'Ja existe equipe ativa cadastrada para este encarregado. Selecione outro encarregado.'
    );
  end if;

  update public.teams
  set
    name = p_name,
    vehicle_plate = p_vehicle_plate,
    service_center_id = p_service_center_id,
    team_type_id = p_team_type_id,
    foreman_person_id = p_foreman_person_id,
    stock_center_id = p_stock_center_id,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_team_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.app_entity_history (
      tenant_id,
      module_key,
      entity_table,
      entity_id,
      entity_code,
      change_type,
      reason,
      changes,
      metadata,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      'equipes',
      'teams',
      p_team_id,
      p_name,
      'UPDATE',
      null,
      coalesce(p_changes, '{}'::jsonb),
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'team_id', v_team_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    if p_stock_center_id is not null then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'STOCK_CENTER_ALREADY_LINKED',
        'message', 'Este centro de estoque proprio ja esta vinculado a outra equipe.'
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_TEAM_COMBINATION',
      'message', 'Ja existe equipe com o mesmo nome, encarregado e placa no tenant atual.'
    );
end;
$$;

create or replace function public.save_team_stock_operation_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_operation_kind text,
  p_stock_center_id uuid,
  p_team_id uuid,
  p_project_id uuid,
  p_entry_date date,
  p_entry_type text,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_kind text := upper(btrim(coalesce(p_operation_kind, '')));
  v_team_stock_center_id uuid;
  v_transfer_id uuid;
  v_save_result jsonb;
begin
  if v_operation_kind not in ('REQUISITION', 'RETURN') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TEAM_OPERATION_KIND',
      'message', 'Operacao de equipe deve ser REQUISITION ou RETURN.'
    );
  end if;

  if p_stock_center_id is null or p_team_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TEAM_OPERATION_REQUIRED_FIELDS',
      'message', 'Centro de estoque e equipe sao obrigatorios para a operacao.'
    );
  end if;

  select t.stock_center_id
  into v_team_stock_center_id
  from public.teams t
  where t.id = p_team_id
    and t.tenant_id = p_tenant_id
    and t.ativo = true;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_NOT_FOUND',
      'message', 'Equipe nao encontrada ou inativa para este tenant.'
    );
  end if;

  if v_team_stock_center_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_NOT_LINKED',
      'message', 'A equipe selecionada nao possui centro de estoque proprio vinculado.'
    );
  end if;

  perform 1
  from public.stock_centers sc
  where sc.id = p_stock_center_id
    and sc.tenant_id = p_tenant_id
    and sc.is_active = true
    and sc.center_type = 'OWN';

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'STOCK_CENTER_NOT_FOUND',
      'message', 'Centro de estoque proprio nao encontrado ou inativo para este tenant.'
    );
  end if;

  if p_stock_center_id = v_team_stock_center_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_STOCK_CENTER',
      'message', 'Centro de estoque e centro vinculado da equipe devem ser diferentes.'
    );
  end if;

  perform 1
  from public.stock_centers sc
  where sc.id = v_team_stock_center_id
    and sc.tenant_id = p_tenant_id
    and sc.is_active = true
    and sc.center_type = 'OWN';

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_INVALID',
      'message', 'O centro de estoque proprio vinculado a equipe esta inativo ou invalido.'
    );
  end if;

  v_save_result := public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => 'TRANSFER',
    p_from_stock_center_id => case when v_operation_kind = 'REQUISITION' then p_stock_center_id else v_team_stock_center_id end,
    p_to_stock_center_id => case when v_operation_kind = 'REQUISITION' then v_team_stock_center_id else p_stock_center_id end,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => p_entry_type,
    p_notes => p_notes,
    p_items => p_items
  );

  if coalesce((v_save_result ->> 'success')::boolean, false) is not true then
    return v_save_result;
  end if;

  begin
    v_transfer_id := nullif(v_save_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_transfer_id := null;
  end;

  if v_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'TRANSFER_ID_MISSING',
      'message', 'Falha ao obter id da operacao de equipe salva.'
    );
  end if;

  insert into public.stock_transfer_team_operations (
    transfer_id,
    tenant_id,
    team_id,
    created_by,
    updated_by
  ) values (
    v_transfer_id,
    p_tenant_id,
    p_team_id,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_transfer_id,
    'message', case
      when v_operation_kind = 'REQUISITION' then 'Requisicao salva com sucesso.'
      else 'Devolucao salva com sucesso.'
    end
  );
end;
$$;

create or replace function public.reverse_team_stock_operation_record_v2(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_operation public.stock_transfer_team_operations%rowtype;
  v_reversal_result jsonb;
  v_reversal_transfer_id uuid;
begin
  select *
  into v_team_operation
  from public.stock_transfer_team_operations sto
  where sto.transfer_id = p_original_stock_transfer_id
    and sto.tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TEAM_OPERATION_NOT_FOUND',
      'message', 'Operacao de equipe original nao encontrada para este tenant.'
    );
  end if;

  v_reversal_result := public.reverse_stock_transfer_record_v2(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_original_stock_transfer_id => p_original_stock_transfer_id,
    p_reversal_reason_code => p_reversal_reason_code,
    p_reversal_reason_notes => p_reversal_reason_notes,
    p_reversal_date => p_reversal_date
  );

  if coalesce((v_reversal_result ->> 'success')::boolean, false) is not true then
    return v_reversal_result;
  end if;

  begin
    v_reversal_transfer_id := nullif(v_reversal_result ->> 'transfer_id', '')::uuid;
  exception
    when others then
      v_reversal_transfer_id := null;
  end;

  if v_reversal_transfer_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'REVERSAL_TRANSFER_ID_MISSING',
      'message', 'Falha ao obter id da operacao de equipe estornada.'
    );
  end if;

  insert into public.stock_transfer_team_operations (
    transfer_id,
    tenant_id,
    team_id,
    created_by,
    updated_by
  ) values (
    v_reversal_transfer_id,
    p_tenant_id,
    v_team_operation.team_id,
    p_actor_user_id,
    p_actor_user_id
  );

  return v_reversal_result;
end;
$$;

drop function if exists public.reverse_team_stock_operation_record(uuid, uuid, uuid, text, date);

create or replace function public.reverse_team_stock_operation_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_original_stock_transfer_id uuid,
  p_reversal_reason text,
  p_reversal_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.reverse_team_stock_operation_record_v2(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_original_stock_transfer_id => p_original_stock_transfer_id,
    p_reversal_reason_code => 'OTHER',
    p_reversal_reason_notes => nullif(btrim(coalesce(p_reversal_reason, '')), ''),
    p_reversal_date => p_reversal_date
  );
end;
$$;

revoke all on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz) from public;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz) to service_role;

revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;

revoke all on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) to service_role;

revoke all on function public.reverse_team_stock_operation_record(uuid, uuid, uuid, text, date) from public;
grant execute on function public.reverse_team_stock_operation_record(uuid, uuid, uuid, text, date) to authenticated;
grant execute on function public.reverse_team_stock_operation_record(uuid, uuid, uuid, text, date) to service_role;
