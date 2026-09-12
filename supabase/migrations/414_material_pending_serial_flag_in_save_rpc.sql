-- 414_material_pending_serial_flag_in_save_rpc.sql
-- Expoe materials.allow_pending_serial_identification no cadastro de Materiais e
-- protege o saldo pendente ja registrado contra mudanca de configuracao.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- A coluna allow_pending_serial_identification existe desde a 247, mas nenhuma
-- tela le ou grava esse valor e save_material_record nunca recebeu o parametro.
-- O valor vinha apenas do backfill da propria 247, que marcou `true` para os
-- RELIGADOR/CHAVE existentes naquele momento. Como o default da coluna e
-- `false`, todo material rastreado por serial cadastrado depois nasce exigindo
-- serial em Entrada, Saida e Transferencia, sem forma de mudar pela aplicacao.
--
-- Junto com o parametro entram duas travas que a coluna nao tinha e que passam
-- a ser obrigatorias no momento em que a flag vira editavel:
--
-- 1. DESLIGAR A FLAG COM SALDO PENDENTE EM ABERTO PRENDE O SALDO.
--    identify_pending_serial_tracked_unit (319, linha 73) recusa a identificacao
--    quando `allow_pending_serial_identification is not true`. Ou seja, o saldo
--    ja acumulado em stock_serial_pending_balances so pode ser liquidado
--    enquanto a flag continuar ligada. Desligar com saldo > 0 deixaria unidades
--    fisicas no estoque sem nenhum caminho de identificacao -- o saldo agregado
--    continua contando, mas ninguem consegue mais dizer qual serial e qual.
--
-- 2. TROCAR serial_tracking_type COM SALDO PENDENTE EM ABERTO ORFANA O SALDO.
--    A checagem de uso que ja existia olha trafo_instances e
--    stock_transfer_items com serial preenchido, mas nao olha
--    stock_serial_pending_balances. Um material com pendencia aberta e nenhuma
--    unidade identificada passava por ela, e a troca de tipo deixava linhas de
--    saldo pendente apontando para um material que nao e mais rastreado.
--
-- Nenhuma das duas travas altera dado existente: elas so recusam a transicao.

drop function if exists public.save_material_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  boolean,
  numeric,
  text,
  jsonb,
  timestamptz,
  numeric,
  numeric
);

create or replace function public.save_material_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_material_id uuid default null,
  p_codigo text default null,
  p_descricao text default null,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_umb text default null,
  p_tipo text default null,
  p_is_transformer boolean default false,
  p_unit_price numeric default null,
  p_serial_tracking_type text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_stock_minimum numeric default 0,
  p_stock_maximum numeric default null,
  p_allow_pending_serial_identification boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.materials%rowtype;
  v_material_id uuid;
  v_updated_at timestamptz;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_umb text := upper(btrim(coalesce(p_umb, '')));
  v_unit_price numeric := coalesce(p_unit_price, 0);
  v_stock_minimum numeric := coalesce(p_stock_minimum, 0);
  v_stock_maximum numeric := p_stock_maximum;
  v_serial_tracking_type text := upper(btrim(coalesce(
    p_serial_tracking_type,
    case when coalesce(p_is_transformer, false) then 'TRAFO' else 'NONE' end
  )));
  v_current_serial_tracking_type text;
  v_is_transformer boolean;
  v_has_serial_tracking_usage boolean := false;
  v_allow_pending boolean;
  v_current_allow_pending boolean;
  v_pending_balance numeric := 0;
begin
  if p_category_id is null or p_subcategory_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'CATEGORY_REQUIRED', 'message', 'Categoria e subcategoria sao obrigatorias para cadastro de material.');
  end if;

  if not exists (
    select 1
    from public.material_subcategories subcategories
    join public.material_categories categories
      on categories.id = subcategories.category_id
     and categories.tenant_id = subcategories.tenant_id
    where categories.tenant_id = p_tenant_id
      and categories.id = p_category_id
      and categories.is_active = true
      and subcategories.id = p_subcategory_id
      and subcategories.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_CATEGORY', 'message', 'Categoria ou subcategoria invalida para o tenant atual.');
  end if;

  if v_umb = '' then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'UMB_REQUIRED', 'message', 'UMB obrigatorio para cadastro de material.');
  end if;

  if not exists (
    select 1
    from public.material_umb_options options
    where options.tenant_id = p_tenant_id
      and options.code = v_umb
      and options.is_active = true
  ) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UMB', 'message', 'UMB invalida. Selecione M, KG ou UN.');
  end if;

  if v_tipo not in ('NOVO', 'SUCATA') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_TYPE', 'message', 'Tipo invalido. Selecione NOVO ou SUCATA.');
  end if;

  if v_unit_price < 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_UNIT_PRICE', 'message', 'Preco invalido. Informe valor maior ou igual a zero.');
  end if;

  if v_stock_minimum < 0 or (v_stock_maximum is not null and v_stock_maximum < v_stock_minimum) then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_STOCK_LIMITS', 'message', 'Limites de estoque invalidos. O maximo deve ser vazio ou maior/igual ao minimo.');
  end if;

  if v_serial_tracking_type not in ('NONE', 'TRAFO', 'RELIGADOR', 'CHAVE') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SERIAL_TRACKING_TYPE', 'message', 'Tipo de rastreio por serial invalido.');
  end if;

  v_is_transformer := v_serial_tracking_type = 'TRAFO';

  if p_material_id is null then
    v_allow_pending := coalesce(p_allow_pending_serial_identification, false);

    if v_allow_pending and v_serial_tracking_type not in ('RELIGADOR', 'CHAVE') then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'PENDING_SERIAL_NOT_ALLOWED_FOR_TYPE',
        'message', case
          when v_serial_tracking_type = 'TRAFO'
            then 'Material TRAFO exige Serial e LP em qualquer movimentacao e nao aceita pendencia de identificacao.'
          else 'Pendencia de identificacao de serial so se aplica a material rastreado por serial (RELIGADOR ou CHAVE).'
        end
      );
    end if;

    insert into public.materials (
      tenant_id,
      codigo,
      descricao,
      category_id,
      subcategory_id,
      umb,
      tipo,
      is_transformer,
      serial_tracking_type,
      allow_pending_serial_identification,
      unit_price,
      stock_minimum,
      stock_maximum,
      is_active,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_codigo,
      p_descricao,
      p_category_id,
      p_subcategory_id,
      v_umb,
      v_tipo,
      v_is_transformer,
      v_serial_tracking_type,
      v_allow_pending,
      v_unit_price,
      v_stock_minimum,
      v_stock_maximum,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_material_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
  end if;

  select *
  into v_current
  from public.materials
  where id = p_material_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'MATERIAL_NOT_FOUND', 'message', 'Material nao encontrado para edicao.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o material.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'CONCURRENT_MODIFICATION', 'message', format('O material %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.codigo));
  end if;

  if not v_current.is_active then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o material antes de editar.');
  end if;

  v_current_serial_tracking_type := upper(btrim(coalesce(
    v_current.serial_tracking_type,
    case when coalesce(v_current.is_transformer, false) then 'TRAFO' else 'NONE' end
  )));

  -- `null` preserva o valor atual: chamada que nao conhece o parametro nao pode
  -- zerar em silencio a configuracao de pendencia do material.
  v_current_allow_pending := coalesce(v_current.allow_pending_serial_identification, false);
  v_allow_pending := coalesce(p_allow_pending_serial_identification, v_current_allow_pending);

  if v_allow_pending and v_serial_tracking_type not in ('RELIGADOR', 'CHAVE') then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'PENDING_SERIAL_NOT_ALLOWED_FOR_TYPE',
      'message', case
        when v_serial_tracking_type = 'TRAFO'
          then 'Material TRAFO exige Serial e LP em qualquer movimentacao e nao aceita pendencia de identificacao.'
        else 'Pendencia de identificacao de serial so se aplica a material rastreado por serial (RELIGADOR ou CHAVE).'
      end
    );
  end if;

  if v_current_serial_tracking_type <> v_serial_tracking_type
    or (v_current_allow_pending and not v_allow_pending)
  then
    select coalesce(sum(pending.quantity), 0)
    into v_pending_balance
    from public.stock_serial_pending_balances pending
    where pending.tenant_id = p_tenant_id
      and pending.material_id = p_material_id
      and pending.quantity > 0;

    if coalesce(v_pending_balance, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'PENDING_SERIAL_BALANCE_OPEN',
        'message', format(
          'O material %s possui %s unidade(s) pendente(s) de identificacao de serial. Identifique o serial dessas unidades antes de alterar o rastreio ou desativar a pendencia.',
          v_current.codigo,
          trim(to_char(v_pending_balance, 'FM999999990'))
        )
      );
    end if;
  end if;

  if v_current_serial_tracking_type in ('TRAFO', 'RELIGADOR', 'CHAVE')
    and v_current_serial_tracking_type <> v_serial_tracking_type
  then
    select (
      exists (
        select 1
        from public.trafo_instances ti
        where ti.tenant_id = p_tenant_id
          and ti.material_id = p_material_id
        limit 1
      )
      or exists (
        select 1
        from public.stock_transfer_items sti
        where sti.tenant_id = p_tenant_id
          and sti.material_id = p_material_id
          and nullif(btrim(coalesce(sti.serial_number, '')), '') is not null
        limit 1
      )
    )
    into v_has_serial_tracking_usage;

    if coalesce(v_has_serial_tracking_usage, false) then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'SERIAL_TRACKING_IN_USE', 'message', 'Este material possui rastreio por serial em uso. Para alterar ou remover o rastreio, execute uma rotina de encerramento/reconciliacao.');
    end if;
  end if;

  update public.materials
  set
    codigo = p_codigo,
    descricao = p_descricao,
    category_id = p_category_id,
    subcategory_id = p_subcategory_id,
    umb = v_umb,
    tipo = v_tipo,
    is_transformer = v_is_transformer,
    serial_tracking_type = v_serial_tracking_type,
    allow_pending_serial_identification = v_allow_pending,
    unit_price = v_unit_price,
    stock_minimum = v_stock_minimum,
    stock_maximum = v_stock_maximum,
    updated_by = p_actor_user_id
  where id = p_material_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_material_id, v_updated_at;

  if coalesce(jsonb_object_length(coalesce(p_changes, '{}'::jsonb)), 0) > 0 then
    insert into public.material_history (
      tenant_id,
      material_id,
      change_type,
      changes,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_material_id,
      'UPDATE',
      coalesce(p_changes, '{}'::jsonb),
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object('success', true, 'status', 200, 'material_id', v_material_id, 'updated_at', v_updated_at);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_MATERIAL_CODE', 'message', 'Ja existe material com este codigo no tenant atual.');
end;
$$;

revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric, boolean) from public;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric, boolean) from anon;
revoke all on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric, boolean) from authenticated;
grant execute on function public.save_material_record(uuid, uuid, uuid, text, text, uuid, uuid, text, text, boolean, numeric, text, jsonb, timestamptz, numeric, numeric, boolean) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_proc proc
    join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = 'save_material_record'
      and proc.pronargs = 17
  ) then
    raise exception '414: save_material_record com 17 parametros nao foi criada.';
  end if;

  if exists (
    select 1
    from pg_proc proc
    join pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.proname = 'save_material_record'
      and proc.pronargs <> 17
  ) then
    raise exception '414: sobrou overload antigo de save_material_record; a chamada por nome ficaria ambigua.';
  end if;
end $$;
