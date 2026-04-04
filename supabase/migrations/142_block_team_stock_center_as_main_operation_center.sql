-- 142_block_team_stock_center_as_main_operation_center.sql
-- Bloqueia uso de centro vinculado a equipe como centro principal das operacoes de equipe.

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
  v_team_name_snapshot text;
  v_foreman_person_id_snapshot uuid;
  v_foreman_name_snapshot text;
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
    team_name_snapshot,
    foreman_person_id_snapshot,
    foreman_name_snapshot,
    created_by,
    updated_by
  ) values (
    v_transfer_id,
    p_tenant_id,
    p_team_id,
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
      else 'Devolucao salva com sucesso.'
    end
  );
end;
$$;

revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;
