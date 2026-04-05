-- 144_add_field_return_team_operations.sql
-- Adiciona Retorno de campo nas operacoes de equipe com centro tecnico CAMPO / INSTALADO.

alter table if exists public.stock_transfer_team_operations
  add column if not exists operation_kind text;

alter table if exists public.stock_transfer_team_operations
  add column if not exists technical_origin_stock_center_id uuid null references public.stock_centers(id);

update public.stock_transfer_team_operations sto
set operation_kind = case
  when transfer.to_stock_center_id = team.stock_center_id then 'REQUISITION'
  else 'RETURN'
end
from public.stock_transfers transfer,
     public.teams team
where sto.transfer_id = transfer.id
  and team.id = sto.team_id
  and team.tenant_id = sto.tenant_id
  and transfer.tenant_id = sto.tenant_id
  and coalesce(nullif(btrim(coalesce(sto.operation_kind, '')), ''), '') = '';

alter table if exists public.stock_transfer_team_operations
  alter column operation_kind set not null;

alter table if exists public.stock_transfer_team_operations
  drop constraint if exists stock_transfer_team_operations_operation_kind_check;

alter table if exists public.stock_transfer_team_operations
  add constraint stock_transfer_team_operations_operation_kind_check
  check (operation_kind in ('REQUISITION', 'RETURN', 'FIELD_RETURN'));

create index if not exists idx_stock_transfer_team_operations_tenant_operation_kind
  on public.stock_transfer_team_operations (tenant_id, operation_kind, created_at desc);

create or replace function public.ensure_team_operation_field_origin_center(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock_center_id uuid;
begin
  select sc.id
  into v_stock_center_id
  from public.stock_centers sc
  where sc.tenant_id = p_tenant_id
    and upper(btrim(coalesce(sc.name, ''))) = 'CAMPO / INSTALADO'
    and sc.center_type = 'THIRD_PARTY'
  order by sc.is_active desc, sc.updated_at desc nulls last, sc.created_at desc
  limit 1;

  if v_stock_center_id is not null then
    update public.stock_centers
    set
      is_active = true,
      center_type = 'THIRD_PARTY',
      controls_balance = false,
      updated_by = p_actor_user_id
    where id = v_stock_center_id
      and tenant_id = p_tenant_id;

    return v_stock_center_id;
  end if;

  insert into public.stock_centers (
    tenant_id,
    name,
    center_type,
    controls_balance,
    is_active,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    'CAMPO / INSTALADO',
    'THIRD_PARTY',
    false,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_stock_center_id;

  return v_stock_center_id;
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
  v_effective_entry_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_team_stock_center_id uuid;
  v_team_name_snapshot text;
  v_foreman_person_id_snapshot uuid;
  v_foreman_name_snapshot text;
  v_transfer_id uuid;
  v_save_result jsonb;
  v_field_origin_stock_center_id uuid;
begin
  if v_operation_kind not in ('REQUISITION', 'RETURN', 'FIELD_RETURN') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_TEAM_OPERATION_KIND',
      'message', 'Operacao de equipe deve ser REQUISITION, RETURN ou FIELD_RETURN.'
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

  select
    t.stock_center_id,
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado'),
    t.foreman_person_id,
    coalesce(nullif(btrim(coalesce(p.nome, '')), ''), 'Nao informado')
  into
    v_team_stock_center_id,
    v_team_name_snapshot,
    v_foreman_person_id_snapshot,
    v_foreman_name_snapshot
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = p_tenant_id
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

  if exists (
    select 1
    from public.teams t
    where t.tenant_id = p_tenant_id
      and t.stock_center_id = p_stock_center_id
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'TEAM_STOCK_CENTER_AS_MAIN_NOT_ALLOWED',
      'message', 'Centro de estoque principal nao pode ser um centro vinculado a equipe.'
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

  if v_operation_kind = 'FIELD_RETURN' then
    v_field_origin_stock_center_id := public.ensure_team_operation_field_origin_center(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id
    );

    if v_field_origin_stock_center_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'FIELD_RETURN_CENTER_UNAVAILABLE',
        'message', 'Nao foi possivel preparar o centro tecnico CAMPO / INSTALADO.'
      );
    end if;

    v_effective_entry_type := 'SUCATA';
  end if;

  v_save_result := public.save_stock_transfer_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_movement_type => case when v_operation_kind = 'FIELD_RETURN' then 'ENTRY' else 'TRANSFER' end,
    p_from_stock_center_id => case
      when v_operation_kind = 'REQUISITION' then p_stock_center_id
      when v_operation_kind = 'RETURN' then v_team_stock_center_id
      else v_field_origin_stock_center_id
    end,
    p_to_stock_center_id => case
      when v_operation_kind = 'REQUISITION' then v_team_stock_center_id
      else p_stock_center_id
    end,
    p_project_id => p_project_id,
    p_entry_date => p_entry_date,
    p_entry_type => v_effective_entry_type,
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
    operation_kind,
    technical_origin_stock_center_id,
    team_name_snapshot,
    foreman_person_id_snapshot,
    foreman_name_snapshot,
    created_by,
    updated_by
  ) values (
    v_transfer_id,
    p_tenant_id,
    p_team_id,
    v_operation_kind,
    case when v_operation_kind = 'FIELD_RETURN' then v_field_origin_stock_center_id else null end,
    v_team_name_snapshot,
    v_foreman_person_id_snapshot,
    v_foreman_name_snapshot,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'transfer_id', v_transfer_id,
    'message', case
      when v_operation_kind = 'REQUISITION' then 'Requisicao salva com sucesso.'
      when v_operation_kind = 'RETURN' then 'Devolucao salva com sucesso.'
      else 'Retorno de campo salvo com sucesso.'
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
    operation_kind,
    technical_origin_stock_center_id,
    team_name_snapshot,
    foreman_person_id_snapshot,
    foreman_name_snapshot,
    created_by,
    updated_by
  ) values (
    v_reversal_transfer_id,
    p_tenant_id,
    v_team_operation.team_id,
    v_team_operation.operation_kind,
    v_team_operation.technical_origin_stock_center_id,
    v_team_operation.team_name_snapshot,
    v_team_operation.foreman_person_id_snapshot,
    v_team_operation.foreman_name_snapshot,
    p_actor_user_id,
    p_actor_user_id
  );

  return v_reversal_result;
end;
$$;

revoke all on function public.ensure_team_operation_field_origin_center(uuid, uuid) from public;
grant execute on function public.ensure_team_operation_field_origin_center(uuid, uuid) to authenticated;
grant execute on function public.ensure_team_operation_field_origin_center(uuid, uuid) to service_role;

revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;

revoke all on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) from public;
grant execute on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function public.reverse_team_stock_operation_record_v2(uuid, uuid, uuid, text, text, date) to service_role;
