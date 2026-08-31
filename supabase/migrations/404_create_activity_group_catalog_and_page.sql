-- 404_create_activity_group_catalog_and_page.sql
-- Etapa 3 de 3: cria o catalogo de Grupo de Atividade, vincula em
-- `service_activities` e cadastra a tela `/grupo-atividade`.
--
-- O QUE MUDA NO MODELO
-- ---------------------------------------------------------------------------
-- Ate aqui `Grupo` era texto livre em `service_activities.group_name`. Passa a
-- ser um catalogo por tenant (`activity_groups`) referenciado por
-- `service_activities.group_id`.
--
-- `group_name` NAO e removida: continua gravada como SNAPSHOT do nome escolhido.
-- Isso e deliberado. A RPC `check_measurement_minimum_billing_unit_value` da
-- migration 212 casa o grupo por `normalize_minimum_billing_token(sa.group_name)`
-- para achar o valor do ponto da garantia de faturamento minimo, e
-- `/api/locacao/activities/catalog` e `/api/apuracao-fator-minimo` leem a coluna
-- direto. Trocar a coluna por FK exigiria reescrever calculo financeiro em
-- producao; manter o snapshot deixa esses leitores intactos.
--
-- `group_id` nasce NULLABLE, espelhando `group_name`: a migration 050 tirou o
-- NOT NULL da coluna de texto, entao pode haver linha legada sem grupo. A
-- obrigatoriedade continua sendo cobrada na RPC de escrita, como hoje.
--
-- SOBRE A NORMALIZACAO DE CAIXA
-- ---------------------------------------------------------------------------
-- O catalogo e semeado deduplicando por `upper(btrim(group_name))`, entao
-- "SOT AEREA" e "Sot Aerea" viram um grupo so. Isso e seguro para o faturamento
-- minimo: `normalize_minimum_billing_token` ja aplica upper, remove acento e
-- descarta tudo que nao e A-Z0-9, entao as duas formas sempre casaram com o
-- mesmo token. Os valores ja gravados em `group_name` NAO sao reescritos por
-- esta migration; apenas atividades salvas dali em diante recebem o nome
-- canonico do catalogo.

-- =============================================================================
-- 1) Catalogo `activity_groups`
-- =============================================================================
create table if not exists public.activity_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint activity_groups_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint activity_groups_tenant_name_key
    unique (tenant_id, name),
  constraint activity_groups_id_tenant_key
    unique (id, tenant_id)
);

create index if not exists idx_activity_groups_tenant_active_name
  on public.activity_groups (tenant_id, ativo, name);

alter table if exists public.activity_groups enable row level security;

-- Somente SELECT para `authenticated`, no padrao fixado pela 393: escrita passa
-- por Route Handler com `service_role` chamando RPC, nunca pelo JWT do usuario.
drop policy if exists activity_groups_tenant_select on public.activity_groups;
create policy activity_groups_tenant_select on public.activity_groups
for select
to authenticated
using (public.user_can_access_tenant(activity_groups.tenant_id));

-- A 393 ja fez `alter default privileges` revogando escrita de tabelas novas;
-- o revoke explicito abaixo torna a intencao visivel nesta migration e protege
-- contra default privileges divergente no ambiente.
revoke insert, update, delete on public.activity_groups from public, anon, authenticated;

drop trigger if exists trg_activity_groups_audit on public.activity_groups;
create trigger trg_activity_groups_audit
before insert or update on public.activity_groups
for each row execute function public.apply_audit_fields();

-- =============================================================================
-- 2) Semeia o catalogo a partir dos grupos ja usados em `service_activities`
-- =============================================================================
insert into public.activity_groups (tenant_id, name, ativo)
select distinct on (sa.tenant_id, upper(btrim(sa.group_name)))
  sa.tenant_id,
  btrim(sa.group_name),
  true
from public.service_activities sa
where nullif(btrim(coalesce(sa.group_name, '')), '') is not null
order by sa.tenant_id, upper(btrim(sa.group_name)), sa.created_at, sa.id
on conflict (tenant_id, name) do nothing;

-- =============================================================================
-- 3) Vinculo `service_activities.group_id`
-- =============================================================================
alter table if exists public.service_activities
  add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'service_activities'
      and tc.constraint_name = 'service_activities_group_id_tenant_fk'
  ) then
    alter table public.service_activities
      add constraint service_activities_group_id_tenant_fk
      foreign key (group_id, tenant_id)
      references public.activity_groups(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_service_activities_tenant_group_id
  on public.service_activities (tenant_id, group_id, ativo, code);

update public.service_activities sa
set group_id = ag.id
from public.activity_groups ag
where sa.group_id is null
  and ag.tenant_id = sa.tenant_id
  and upper(btrim(ag.name)) = upper(btrim(sa.group_name))
  and nullif(btrim(coalesce(sa.group_name, '')), '') is not null;

-- Aborta se alguma atividade com grupo em texto tiver ficado sem vinculo: seria
-- registro que a tela nao conseguiria reeditar, ja que `Grupo` e obrigatorio.
do $$
declare
  v_orphans integer;
begin
  select count(*)
  into v_orphans
  from public.service_activities sa
  where nullif(btrim(coalesce(sa.group_name, '')), '') is not null
    and sa.group_id is null;

  if v_orphans > 0 then
    raise exception '404: % atividade(s) com group_name preenchido ficaram sem group_id apos o backfill', v_orphans;
  end if;
end;
$$;

-- =============================================================================
-- 4) RPCs da tela Grupo de Atividade
-- =============================================================================
create or replace function public.save_activity_group_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_group_id uuid default null,
  p_name text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.activity_groups%rowtype;
  v_activity_group_id uuid := p_activity_group_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_updated_at timestamptz;
  v_changes jsonb;
  v_duplicate_id uuid;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar grupo de atividade.'
    );
  end if;

  if v_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe o nome do grupo de atividade.'
    );
  end if;

  -- `activity_groups_tenant_name_key` e case-sensitive; a checagem abaixo
  -- bloqueia divergencia so de caixa/espaco, que o indice deixaria passar.
  select ag.id
  into v_duplicate_id
  from public.activity_groups ag
  where ag.tenant_id = p_tenant_id
    and upper(btrim(ag.name)) = upper(v_name)
    and (v_activity_group_id is null or ag.id <> v_activity_group_id)
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe grupo de atividade com este nome no tenant atual.'
    );
  end if;

  if v_activity_group_id is null then
    insert into public.activity_groups (
      tenant_id,
      name,
      ativo,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_name,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_group_id, v_updated_at;
  else
    select *
    into v_current
    from public.activity_groups
    where tenant_id = p_tenant_id
      and id = v_activity_group_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'ACTIVITY_GROUP_NOT_FOUND',
        'message', 'Grupo de atividade nao encontrado.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar o grupo de atividade.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O grupo de atividade %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative o grupo de atividade antes de editar.'
      );
    end if;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'activity_group_id', v_activity_group_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada no grupo de atividade %s.', v_current.name)
      );
    end if;

    update public.activity_groups
    set
      name = v_name,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_activity_group_id
    returning updated_at
    into v_updated_at;

    -- Renomear o grupo propaga para o snapshot das atividades vinculadas, senao
    -- `group_name` congelaria no nome antigo e a RPC de faturamento minimo
    -- passaria a casar por um token que nao existe mais no catalogo.
    update public.service_activities
    set
      group_name = v_name,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and group_id = v_activity_group_id
      and group_name is distinct from v_name;

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
    )
    values (
      p_tenant_id,
      'grupo-atividade',
      'activity_groups',
      v_activity_group_id,
      v_name,
      'UPDATE',
      null,
      v_changes,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'activity_group_id', v_activity_group_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_activity_group_id is null then format('Grupo de atividade %s cadastrado com sucesso.', v_name)
        else format('Grupo de atividade %s atualizado com sucesso.', v_name)
      end
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_NAME',
      'message', 'Ja existe grupo de atividade com este nome no tenant atual.'
    );
end;
$$;

revoke all on function public.save_activity_group_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_activity_group_record(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

create or replace function public.set_activity_group_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_group_id uuid,
  p_action text,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.activity_groups%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_linked_activities integer;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar grupo de atividade.'
    );
  end if;

  if p_activity_group_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'ACTIVITY_GROUP_REQUIRED',
      'message', 'Grupo de atividade invalido para atualizar status.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', case when v_action = 'ACTIVATE' then 'ACTIVATION_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ACTIVATE' then 'Informe o motivo da ativacao.' else 'Informe o motivo do cancelamento.' end
    );
  end if;

  select *
  into v_current
  from public.activity_groups
  where tenant_id = p_tenant_id
    and id = p_activity_group_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ACTIVITY_GROUP_NOT_FOUND',
      'message', 'Grupo de atividade nao encontrado.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status do grupo de atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O grupo de atividade %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Grupo de atividade %s ja esta inativo.', v_current.name)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Grupo de atividade %s ja esta ativo.', v_current.name)
    );
  end if;

  -- `Grupo` e obrigatorio no formulario de Atividades e o meta so lista grupo
  -- ativo. Inativar um grupo em uso tiraria a opcao do select sem tocar nas
  -- atividades gravadas, deixando cadastro antigo impossivel de reeditar.
  if v_action = 'CANCEL' then
    select count(*)
    into v_linked_activities
    from public.service_activities sa
    where sa.tenant_id = p_tenant_id
      and sa.group_id = p_activity_group_id
      and sa.ativo = true;

    if coalesce(v_linked_activities, 0) > 0 then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'ACTIVITY_GROUP_IN_USE',
        'message', format(
          'Grupo de atividade %s esta em uso por %s atividade(s) ativa(s). Realoque os registros antes de cancelar.',
          v_current.name,
          coalesce(v_linked_activities, 0)
        )
      );
    end if;
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.activity_groups
  set
    ativo = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_activity_group_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.ativo::text, 'to', v_next_active::text)
  ) || case
    when v_action = 'ACTIVATE' then jsonb_build_object('activationReason', jsonb_build_object('from', null, 'to', v_reason))
    else jsonb_build_object('cancellationReason', jsonb_build_object('from', null, 'to', v_reason))
  end;

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
  )
  values (
    p_tenant_id,
    'grupo-atividade',
    'activity_groups',
    p_activity_group_id,
    v_current.name,
    v_action,
    v_reason,
    v_changes,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'activity_group_id', p_activity_group_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Grupo de atividade %s ativado com sucesso.', v_current.name)
        else format('Grupo de atividade %s cancelado com sucesso.', v_current.name)
      end
  );
end;
$$;

revoke all on function public.set_activity_group_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_activity_group_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- =============================================================================
-- 5) `save_service_activity_record` passa a receber o GRUPO por id
-- =============================================================================
-- A assinatura muda (`p_group_name text` -> `p_group_id uuid`), entao a versao
-- da 372 precisa ser derrubada: manter as duas criaria overload e o PostgREST
-- nao saberia qual chamar.
--
-- A RPC resolve o nome no catalogo e grava as duas colunas: `group_id` como
-- vinculo e `group_name` como snapshot. O caller nao envia mais o texto, o que
-- torna impossivel gravar um par id/nome inconsistente.
--
-- O drop e DINAMICO, e nao um `drop function if exists <assinatura>`: a funcao
-- teve varias assinaturas ao longo do tempo (077, 146, 171, 180, 372) e cada
-- migration derrubou so a que conhecia. Em banco vivo sobrou pelo menos uma
-- versao antiga que o drop fixo da 372 nao pegou -- foi o que a validacao final
-- desta migration acusou na primeira tentativa de aplicacao. Varrer `pg_proc`
-- remove qualquer overload existente, independente do historico do ambiente.
--
-- E seguro derrubar todos: `save_service_activity_record` tem um unico chamador,
-- `saveActivityViaRpc` em `src/app/api/activities/route.ts`, e a versao correta
-- e recriada logo abaixo com os grants reaplicados.
do $$
declare
  v_signature text;
  v_dropped integer := 0;
begin
  for v_signature in
    select pg_get_function_identity_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_service_activity_record'
  loop
    execute format('drop function public.save_service_activity_record(%s)', v_signature);
    v_dropped := v_dropped + 1;
    raise notice '404: removida versao anterior save_service_activity_record(%)', v_signature;
  end loop;

  raise notice '404: % versao(oes) anterior(es) de save_service_activity_record removida(s)', v_dropped;
end;
$$;

create or replace function public.save_service_activity_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_activity_id uuid default null,
  p_code text default null,
  p_code_idd text default null,
  p_description text default null,
  p_team_type_id uuid default null,
  p_type_service uuid default null,
  p_group_id uuid default null,
  p_unit_value numeric default null,
  p_voice_point numeric default null,
  p_unit text default null,
  p_scope text default null,
  p_changes jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.service_activities%rowtype;
  v_activity_id uuid;
  v_updated_at timestamptz;
  v_group_name text;
begin
  if p_type_service is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'CATEGORY_REQUIRED',
      'message', 'Categoria obrigatoria para salvar atividade.'
    );
  end if;

  if coalesce(p_voice_point, 0) <= 0 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'VOICE_POINT_REQUIRED',
      'message', 'Pontos obrigatorio para salvar atividade.'
    );
  end if;

  if p_group_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'GROUP_REQUIRED',
      'message', 'Grupo obrigatorio para salvar atividade.'
    );
  end if;

  if not exists (
    select 1
    from public.types_service_activities tsa
    where tsa.tenant_id = p_tenant_id
      and tsa.id = p_type_service
      and tsa.ativo = true
  ) then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_CATEGORY',
      'message', 'Categoria invalida para o tenant atual.'
    );
  end if;

  select ag.name
  into v_group_name
  from public.activity_groups ag
  where ag.tenant_id = p_tenant_id
    and ag.id = p_group_id
    and ag.ativo = true;

  if v_group_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_GROUP',
      'message', 'Grupo invalido para o tenant atual.'
    );
  end if;

  if p_activity_id is null then
    insert into public.service_activities (
      tenant_id,
      code,
      code_idd,
      description,
      team_type_id,
      type_service,
      group_id,
      group_name,
      unit_value,
      voice_point,
      unit,
      scope,
      ativo,
      cancellation_reason,
      canceled_at,
      canceled_by,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_code,
      nullif(btrim(coalesce(p_code_idd, '')), ''),
      p_description,
      p_team_type_id,
      p_type_service,
      p_group_id,
      v_group_name,
      p_unit_value,
      p_voice_point,
      p_unit,
      nullif(btrim(coalesce(p_scope, '')), ''),
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_activity_id, v_updated_at;

    return jsonb_build_object(
      'success', true,
      'status', 200,
      'activity_id', v_activity_id,
      'updated_at', v_updated_at
    );
  end if;

  select *
  into v_current
  from public.service_activities
  where id = p_activity_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'ACTIVITY_NOT_FOUND',
      'message', 'Atividade nao encontrada.'
    );
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de editar a atividade.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A atividade %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.code)
    );
  end if;

  if not v_current.ativo then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'RECORD_INACTIVE',
      'message', 'Ative a atividade antes de editar.'
    );
  end if;

  update public.service_activities
  set
    code = p_code,
    code_idd = nullif(btrim(coalesce(p_code_idd, '')), ''),
    description = p_description,
    team_type_id = p_team_type_id,
    type_service = p_type_service,
    group_id = p_group_id,
    group_name = v_group_name,
    unit_value = p_unit_value,
    voice_point = p_voice_point,
    unit = p_unit,
    scope = nullif(btrim(coalesce(p_scope, '')), ''),
    updated_by = p_actor_user_id
  where id = p_activity_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_activity_id, v_updated_at;

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
      'atividades',
      'service_activities',
      p_activity_id,
      p_code,
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
    'activity_id', v_activity_id,
    'updated_at', v_updated_at
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_ACTIVITY_CODE',
      'message', 'Ja existe atividade com este codigo no tenant atual.'
    );
end;
$$;

revoke all on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_service_activity_record(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  numeric,
  numeric,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;

-- =============================================================================
-- 6) Pagina Grupo de Atividade na secao Cadastro Base
-- =============================================================================
-- `default_user_access = false`, conforme a 245: tela nova nasce liberada so
-- para administrador. Por isso a chave NAO entra em `DEFAULT_USER_PAGE_ACCESS`.
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'grupo-atividade',
  '/grupo-atividade',
  'Grupo de Atividade',
  'Cadastro Base',
  'Cadastro base dos grupos que alimentam o campo Grupo em Atividades.',
  false
)
on conflict (page_key) do update
set
  path = excluded.path,
  name = excluded.name,
  section = excluded.section,
  description = excluded.description,
  default_user_access = false,
  ativo = true,
  updated_at = now();

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access)
select
  tenants.tenant_id,
  roles.id,
  'grupo-atividade',
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
left join public.role_page_permissions existing
  on existing.tenant_id = tenants.tenant_id
 and existing.role_id = roles.id
 and existing.page_key = 'grupo-atividade'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  created_by,
  updated_by
)
select
  users.tenant_id,
  users.id,
  'grupo-atividade',
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
left join public.app_user_page_permissions existing
  on existing.tenant_id = users.tenant_id
 and existing.user_id = users.id
 and existing.page_key = 'grupo-atividade'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_group_fn regprocedure := 'public.save_activity_group_record(uuid, uuid, uuid, text, timestamptz)'::regprocedure;
  v_status_group_fn regprocedure := 'public.set_activity_group_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
  v_save_activity_fn regprocedure := 'public.save_service_activity_record(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid, numeric, numeric, text, text, jsonb, timestamptz)'::regprocedure;
  v_old_overloads integer;
  v_old_signatures text;
  v_orphans integer;
begin
  if has_function_privilege('anon', v_save_group_fn, 'execute')
     or has_function_privilege('authenticated', v_save_group_fn, 'execute') then
    raise exception '404: save_activity_group_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_group_fn, 'execute')
     or has_function_privilege('authenticated', v_status_group_fn, 'execute') then
    raise exception '404: set_activity_group_record_status ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_save_activity_fn, 'execute')
     or has_function_privilege('authenticated', v_save_activity_fn, 'execute') then
    raise exception '404: save_service_activity_record ainda executavel por anon/authenticated';
  end if;

  -- Overload antigo (p_group_name text) nao pode ter sobrado: com as duas
  -- versoes publicadas o PostgREST nao resolveria a chamada.
  --
  -- A comparacao e por OID, e nao por texto da assinatura: uma primeira versao
  -- desta validacao confrontava `pg_get_function_identity_arguments` com uma
  -- lista so de tipos ("uuid, uuid, ...") e acusava sobra sempre, porque aquela
  -- funcao devolve NOMES e tipos ("p_tenant_id uuid, ..."). O OID nao tem essa
  -- ambiguidade de formatacao.
  select count(*), coalesce(string_agg(sig, ' | '), '(nenhuma)')
  into v_old_overloads, v_old_signatures
  from (
    select pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_service_activity_record'
      and p.oid <> v_save_activity_fn::oid
  ) leftovers;

  if v_old_overloads > 0 then
    raise exception '404: % versao(oes) antiga(s) de save_service_activity_record ainda publicada(s): %',
      v_old_overloads, v_old_signatures;
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'grupo-atividade'
      and ativo = true
  ) then
    raise exception '404: pagina grupo-atividade nao foi cadastrada em app_pages';
  end if;

  -- Nenhuma atividade ativa pode ter ficado sem grupo vinculado.
  select count(*)
  into v_orphans
  from public.service_activities sa
  where sa.ativo = true
    and sa.group_id is null
    and nullif(btrim(coalesce(sa.group_name, '')), '') is not null;

  if v_orphans > 0 then
    raise exception '404: % atividade(s) ativa(s) ficaram sem group_id', v_orphans;
  end if;
end;
$$;
