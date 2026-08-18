-- 375_stock_operation_foreman_from_composition.sql
-- Fecha a decisao "o estoque segue a composicao do dia": a operacao de equipe
-- deixa de gravar o encarregado do cadastro e passa a usar a mesma cadeia da 374.
--
-- Achado que motivou: a Saida ganhou o atalho "Encarregado do dia", que lista quem
-- respondeu por cada equipe segundo a Composicao. Como a RPC continuava resolvendo
-- por teams.foreman_person_id, o usuario escolhia por um criterio e o registro (e a
-- exportacao CSV) saia com outra pessoa quando havia encarregado emprestado.
--
-- A RPC ja recebia p_entry_date, entao a data da operacao estava disponivel e nao
-- foi preciso trigger nem novo parametro vindo do cliente.

begin;

-- Contrato completo da resolucao: devolve tambem o id do encarregado, que
-- resolve_team_foreman_snapshot nao expoe. As operacoes de estoque precisam do id
-- para gravar foreman_person_id_snapshot.
create or replace function public.resolve_team_foreman(
  p_tenant_id uuid,
  p_team_id uuid,
  p_execution_date date
)
returns table (
  team_name text,
  foreman_person_id uuid,
  foreman_name text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado') as team_name,
    coalesce(c.foreman_person_id, h.foreman_person_id, t.foreman_person_id) as foreman_person_id,
    coalesce(
      nullif(btrim(coalesce(c.foreman_name_snapshot, '')), ''),
      nullif(btrim(coalesce(h.foreman_name_snapshot, '')), ''),
      nullif(btrim(coalesce(p.nome, '')), ''),
      'Nao identificado'
    ) as foreman_name
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = t.tenant_id
  left join lateral (
    select tc.foreman_person_id, tc.foreman_name_snapshot
    from public.team_compositions tc
    where tc.tenant_id = t.tenant_id
      and tc.team_id = t.id
      and tc.composition_date = p_execution_date
      and tc.is_active = true
      and tc.work_status = 'WORKING'
      and tc.foreman_person_id is not null
    limit 1
  ) c on true
  left join lateral (
    select fh.foreman_person_id, fh.foreman_name_snapshot
    from public.team_foreman_history fh
    where fh.tenant_id = t.tenant_id
      and fh.team_id = t.id
      and fh.valid_from <= p_execution_date
      and (fh.valid_to is null or fh.valid_to >= p_execution_date)
    order by fh.valid_from desc, fh.created_at desc
    limit 1
  ) h on true
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id
  limit 1;
$fn$;

-- resolve_team_foreman_snapshot mantem assinatura e passa a delegar, para a cadeia
-- existir num lugar so. Os consumidores atuais (triggers da Medicao e da APR) nao mudam.
create or replace function public.resolve_team_foreman_snapshot(
  p_tenant_id uuid,
  p_team_id uuid,
  p_execution_date date
)
returns table (
  team_name text,
  foreman_name text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select f.team_name, f.foreman_name
  from public.resolve_team_foreman(p_tenant_id, p_team_id, p_execution_date) f;
$fn$;

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
  v_item jsonb;
  v_material_id uuid;
  v_quantity numeric;
  v_serial_number text;
  v_lot_code text;
  v_tracking_type text;
  v_material_code text;
  v_source_stock_center_id uuid;
  v_current_stock_center_id uuid;
  v_identify_result jsonb;
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

  -- Encarregado da operacao passa a sair da cadeia da migration 374
  -- (composicao do dia -> historico de nomeacao -> cadastro da equipe), e nao mais
  -- de um join direto em teams.foreman_person_id. Sem isso a Saida deixava escolher
  -- pelo encarregado do dia e gravava o do cadastro, e o CSV saia com outra pessoa.
  select
    t.stock_center_id,
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado')
  into
    v_team_stock_center_id,
    v_team_name_snapshot
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

  -- Depois da checagem da equipe de proposito: FOUND e por statement, e resolver o
  -- encarregado antes sobrescreveria o resultado do SELECT em teams.
  select
    f.foreman_person_id,
    coalesce(nullif(btrim(coalesce(f.foreman_name, '')), ''), 'Nao informado')
  into
    v_foreman_person_id_snapshot,
    v_foreman_name_snapshot
  from public.resolve_team_foreman(p_tenant_id, p_team_id, p_entry_date) f;

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

  for v_item in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    begin
      v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
    exception
      when others then
        v_material_id := null;
    end;

    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
    exception
      when others then
        v_quantity := null;
    end;

    v_serial_number := nullif(btrim(coalesce(v_item ->> 'serialNumber', '')), '');
    v_lot_code := nullif(btrim(coalesce(v_item ->> 'lotCode', '')), '');

    if v_material_id is null then
      continue;
    end if;

    select
      case
        when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
        when coalesce(m.is_transformer, false) then 'TRAFO'
        else 'NONE'
      end,
      m.codigo
    into v_tracking_type, v_material_code
    from public.materials m
    where m.id = v_material_id
      and m.tenant_id = p_tenant_id
      and m.is_active = true;

    if not found or v_tracking_type = 'NONE' then
      continue;
    end if;

    if v_quantity <> 1 then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'SERIAL_TRACKED_QUANTITY_MUST_BE_ONE',
        'message', format('Material rastreavel por serial permite somente quantidade 1 por movimentacao: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;

    if v_serial_number is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'SERIAL_TRACKED_SERIAL_REQUIRED',
        'message', format('Serial e obrigatorio para material rastreavel por serial: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;

    if v_tracking_type = 'TRAFO' and v_lot_code is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'TRANSFORMER_SERIAL_OR_LOT_REQUIRED',
        'message', format('Serial e LP sao obrigatorios para material TRAFO: %s.', coalesce(v_material_code, v_material_id::text))
      );
    end if;

  end loop;

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
  end if;

  begin
    for v_item in
      select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    loop
      begin
        v_material_id := nullif(btrim(coalesce(v_item ->> 'materialId', '')), '')::uuid;
      exception
        when others then
          v_material_id := null;
      end;

      v_serial_number := nullif(btrim(coalesce(v_item ->> 'serialNumber', '')), '');

      if v_material_id is null or v_serial_number is null or v_operation_kind not in ('REQUISITION', 'RETURN') then
        continue;
      end if;

      select
        case
          when coalesce(m.serial_tracking_type, '') <> '' then m.serial_tracking_type
          when coalesce(m.is_transformer, false) then 'TRAFO'
          else 'NONE'
        end,
        m.codigo
      into v_tracking_type, v_material_code
      from public.materials m
      where m.id = v_material_id
        and m.tenant_id = p_tenant_id
        and m.is_active = true;

      if not found or v_tracking_type in ('NONE', 'TRAFO') then
        continue;
      end if;

      v_source_stock_center_id := case
        when v_operation_kind = 'REQUISITION' then p_stock_center_id
        else v_team_stock_center_id
      end;

      select ti.current_stock_center_id
      into v_current_stock_center_id
      from public.trafo_instances ti
      where ti.tenant_id = p_tenant_id
        and ti.material_id = v_material_id
        and ti.serial_number = v_serial_number
        and ti.lot_code = '-'
      for update;

      if found and v_current_stock_center_id is not null and v_current_stock_center_id is distinct from v_source_stock_center_id then
        v_save_result := jsonb_build_object(
          'success', false,
          'status', 409,
          'reason', 'SERIAL_TRACKED_UNIT_NOT_IN_FROM_CENTER',
          'message', format('A unidade por serial informada nao esta disponivel no centro de origem: %s / Serial %s.', coalesce(v_material_code, v_material_id::text), v_serial_number)
        );
        raise exception 'TEAM_OPERATION_ROLLBACK';
      end if;

      if not found or v_current_stock_center_id is null then
        v_identify_result := public.identify_pending_serial_tracked_unit(
          p_tenant_id,
          p_actor_user_id,
          v_material_id,
          v_source_stock_center_id,
          p_project_id,
          v_effective_entry_type,
          v_serial_number
        );

        if coalesce((v_identify_result ->> 'success')::boolean, false) is not true then
          v_save_result := v_identify_result;
          raise exception 'TEAM_OPERATION_ROLLBACK';
        end if;
      end if;
    end loop;

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
      p_items => p_items,
      p_direct_purchase => false,
      p_operation_purpose => 'NORMAL',
      p_balance_correction_reason => null
    );

    if coalesce((v_save_result ->> 'success')::boolean, false) is not true then
      raise exception 'TEAM_OPERATION_ROLLBACK';
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'TEAM_OPERATION_ROLLBACK' then
        return coalesce(v_save_result, jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'TEAM_OPERATION_ROLLBACK',
          'message', 'Falha ao salvar operacao de equipe.'
        ));
      end if;
      raise;
  end;

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
revoke all on function public.resolve_team_foreman(uuid, uuid, date) from public;
revoke all on function public.resolve_team_foreman(uuid, uuid, date) from anon;
revoke all on function public.resolve_team_foreman(uuid, uuid, date) from authenticated;
grant execute on function public.resolve_team_foreman(uuid, uuid, date) to service_role;

revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from public;
revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from anon;
revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from authenticated;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to service_role;

revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from public;
revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from anon;
revoke all on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) from authenticated;
grant execute on function public.save_team_stock_operation_record(uuid, uuid, text, uuid, uuid, uuid, date, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
