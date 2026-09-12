-- 383_create_stock_reversal_request_flow.sql
-- Introduz fila de solicitacao -> atendimento para estornos de Movimentacao de Estoque
-- e Operacoes de Equipe. A execucao real continua usando as RPCs de estorno existentes.

create table if not exists public.stock_reversal_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  source text not null,
  mode text not null,
  original_stock_transfer_id uuid not null references public.stock_transfers(id),
  original_stock_transfer_item_id uuid null references public.stock_transfer_items(id),
  status text not null default 'PENDENTE',
  requested_by uuid not null,
  requested_by_name_snapshot text null,
  requested_at timestamptz not null default now(),
  claimed_by uuid null,
  claimed_by_name_snapshot text null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  reversal_reason_code text not null references public.stock_transfer_reversal_reason_catalog(code),
  reversal_reason_notes text null,
  reversal_date date not null default current_date,
  request_notes text null,
  decision_notes text null,
  decided_by uuid null,
  decided_at timestamptz null,
  executed_by uuid null,
  executed_at timestamptz null,
  reversal_stock_transfer_id uuid null references public.stock_transfers(id),
  reversed_item_count integer not null default 0,
  result_payload jsonb null,
  failure_reason text null,
  failure_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint stock_reversal_requests_id_tenant_key unique (id, tenant_id),
  constraint stock_reversal_requests_source_check
    check (source in ('STOCK_TRANSFER', 'TEAM_OPERATION')),
  constraint stock_reversal_requests_mode_check
    check (mode in ('ITEM', 'BATCH', 'FULL')),
  constraint stock_reversal_requests_status_check
    check (status in ('PENDENTE', 'EM_ANALISE', 'EXECUTADO', 'RECUSADO', 'CANCELADO', 'FALHA_EXECUCAO')),
  constraint stock_reversal_requests_item_mode_check
    check ((mode = 'ITEM' and original_stock_transfer_item_id is not null) or mode <> 'ITEM'),
  constraint stock_reversal_requests_reason_notes_not_blank_check
    check (reversal_reason_notes is null or nullif(btrim(reversal_reason_notes), '') is not null),
  constraint stock_reversal_requests_decision_notes_not_blank_check
    check (decision_notes is null or nullif(btrim(decision_notes), '') is not null),
  constraint stock_reversal_requests_request_notes_not_blank_check
    check (request_notes is null or nullif(btrim(request_notes), '') is not null),
  constraint stock_reversal_requests_reversed_item_count_check
    check (reversed_item_count >= 0)
);

create table if not exists public.stock_reversal_request_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  request_id uuid not null,
  original_stock_transfer_id uuid not null references public.stock_transfers(id),
  original_stock_transfer_item_id uuid not null references public.stock_transfer_items(id),
  request_status text not null default 'PENDENTE',
  reversal_stock_transfer_id uuid null references public.stock_transfers(id),
  reversal_stock_transfer_item_id uuid null references public.stock_transfer_items(id),
  result_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint stock_reversal_request_items_request_fk
    foreign key (request_id, tenant_id)
    references public.stock_reversal_requests(id, tenant_id)
    on delete cascade,
  constraint stock_reversal_request_items_status_check
    check (request_status in ('PENDENTE', 'EM_ANALISE', 'EXECUTADO', 'RECUSADO', 'CANCELADO', 'FALHA_EXECUCAO'))
);

create index if not exists idx_stock_reversal_requests_tenant_status
  on public.stock_reversal_requests (tenant_id, status, requested_at desc);

create index if not exists idx_stock_reversal_requests_tenant_transfer
  on public.stock_reversal_requests (tenant_id, original_stock_transfer_id, requested_at desc);

create index if not exists idx_stock_reversal_request_items_request
  on public.stock_reversal_request_items (tenant_id, request_id);

create index if not exists idx_stock_reversal_request_items_original_transfer
  on public.stock_reversal_request_items (tenant_id, original_stock_transfer_id);

create unique index if not exists idx_stock_reversal_request_items_open_original_item
  on public.stock_reversal_request_items (tenant_id, original_stock_transfer_item_id)
  where request_status in ('PENDENTE', 'EM_ANALISE');

alter table public.stock_reversal_requests enable row level security;
alter table public.stock_reversal_request_items enable row level security;

drop policy if exists stock_reversal_requests_select on public.stock_reversal_requests;
create policy stock_reversal_requests_select
  on public.stock_reversal_requests
  for select
  to authenticated
  using (public.user_can_access_tenant(stock_reversal_requests.tenant_id));

drop policy if exists stock_reversal_request_items_select on public.stock_reversal_request_items;
create policy stock_reversal_request_items_select
  on public.stock_reversal_request_items
  for select
  to authenticated
  using (public.user_can_access_tenant(stock_reversal_request_items.tenant_id));

drop trigger if exists trg_stock_reversal_requests_audit on public.stock_reversal_requests;
create trigger trg_stock_reversal_requests_audit
before insert or update on public.stock_reversal_requests
for each row execute function public.apply_audit_fields();

drop trigger if exists trg_stock_reversal_request_items_audit on public.stock_reversal_request_items;
create trigger trg_stock_reversal_request_items_audit
before insert or update on public.stock_reversal_request_items
for each row execute function public.apply_audit_fields();

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'estorno-atendimento',
  '/estorno-atendimento',
  'Atendimento de Estornos',
  'Almoxarifado',
  'Fila de pedidos de estorno para analise, aprovacao, recusa e execucao controlada.',
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

insert into public.role_page_permissions (tenant_id, role_id, page_key, can_access, can_create, can_update, can_cancel, can_reverse, can_import, can_export)
select
  tenants.tenant_id,
  roles.id,
  'estorno-atendimento',
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  false,
  coalesce(roles.is_admin, false)
from (
  select distinct tenant_id
  from public.app_users
  where tenant_id is not null
) tenants
join public.app_roles roles
  on roles.ativo = true
on conflict (tenant_id, role_id, page_key) do update
set
  can_access = excluded.can_access,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_cancel = excluded.can_cancel,
  can_reverse = excluded.can_reverse,
  can_import = excluded.can_import,
  can_export = excluded.can_export,
  updated_at = now();

insert into public.app_user_page_permissions (
  tenant_id,
  user_id,
  page_key,
  can_access,
  can_create,
  can_update,
  can_cancel,
  can_reverse,
  can_import,
  can_export,
  created_by,
  updated_by
)
select
  users.tenant_id,
  users.id,
  'estorno-atendimento',
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  false,
  coalesce(roles.is_admin, false),
  null,
  null
from public.app_users users
left join public.app_roles roles
  on roles.id = users.role_id
 and roles.ativo = true
where users.tenant_id is not null
on conflict (tenant_id, user_id, page_key) do update
set
  can_access = excluded.can_access,
  can_create = excluded.can_create,
  can_update = excluded.can_update,
  can_cancel = excluded.can_cancel,
  can_reverse = excluded.can_reverse,
  can_import = excluded.can_import,
  can_export = excluded.can_export,
  updated_at = now();

create or replace function public.stock_reversal_request_actor_allowed(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users actor
    where actor.id = p_actor_user_id
      and actor.ativo = true
      and (
        actor.tenant_id = p_tenant_id
        or exists (
          select 1
          from public.app_user_tenants tenant_access
          where tenant_access.user_id = actor.id
            and tenant_access.tenant_id = p_tenant_id
            and tenant_access.ativo = true
        )
      )
  );
$$;

create or replace function public.create_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_source text,
  p_mode text,
  p_original_stock_transfer_id uuid,
  p_original_stock_transfer_item_id uuid,
  p_reversal_reason_code text,
  p_reversal_reason_notes text default null,
  p_reversal_date date default current_date,
  p_item_ids jsonb default '[]'::jsonb,
  p_request_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := upper(btrim(coalesce(p_source, '')));
  v_mode text := upper(btrim(coalesce(p_mode, '')));
  v_reason_code text := upper(btrim(coalesce(p_reversal_reason_code, '')));
  v_reason_notes text := nullif(btrim(coalesce(p_reversal_reason_notes, '')), '');
  v_request_notes text := nullif(btrim(coalesce(p_request_notes, '')), '');
  v_reversal_date date := coalesce(p_reversal_date, current_date);
  v_reason_label text;
  v_requires_notes boolean;
  v_request_id uuid;
  v_item_count integer;
  v_is_team_operation boolean;
begin
  if p_tenant_id is null or p_actor_user_id is null or p_original_stock_transfer_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REQUIRED_FIELDS', 'message', 'Tenant, usuario e transferencia original sao obrigatorios.');
  end if;

  if not public.stock_reversal_request_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED', 'message', 'Usuario nao autorizado para solicitar estorno neste tenant.');
  end if;

  if v_source not in ('STOCK_TRANSFER', 'TEAM_OPERATION') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_SOURCE', 'message', 'Origem do estorno invalida.');
  end if;

  if v_mode not in ('ITEM', 'BATCH', 'FULL') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_MODE', 'message', 'Modo do estorno invalido.');
  end if;

  if v_mode = 'ITEM' and p_original_stock_transfer_item_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'ITEM_REQUIRED', 'message', 'Item original e obrigatorio para estorno por item.');
  end if;

  if v_reason_code = '' or v_reason_code in ('OPERATION_CANCELED', 'OTHER') then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REVERSAL_REASON_CODE', 'message', 'Motivo padrao do estorno invalido para este fluxo operacional.');
  end if;

  select label_pt, requires_notes
  into v_reason_label, v_requires_notes
  from public.stock_transfer_reversal_reason_catalog
  where code = v_reason_code
    and is_active = true;

  if not found then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_REVERSAL_REASON_CODE', 'message', 'Motivo padrao do estorno invalido ou inativo.');
  end if;

  if coalesce(v_requires_notes, false) and v_reason_notes is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REVERSAL_REASON_NOTES_REQUIRED', 'message', 'Observacao do motivo e obrigatoria para o motivo selecionado.');
  end if;

  if v_reversal_date > current_date then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'REVERSAL_DATE_IN_FUTURE', 'message', 'Data do estorno nao pode ser futura.');
  end if;

  perform 1
  from public.stock_transfers transfer
  where transfer.tenant_id = p_tenant_id
    and transfer.id = p_original_stock_transfer_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'ORIGINAL_TRANSFER_NOT_FOUND', 'message', 'Movimentacao original nao encontrada para este tenant.');
  end if;

  select exists (
    select 1
    from public.stock_transfer_team_operations team_operation
    where team_operation.tenant_id = p_tenant_id
      and team_operation.transfer_id = p_original_stock_transfer_id
  )
  into v_is_team_operation;

  if v_source = 'TEAM_OPERATION' and not coalesce(v_is_team_operation, false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_OPERATION_NOT_FOUND', 'message', 'A movimentacao informada nao pertence a Operacoes de Equipe.');
  end if;

  if v_source = 'STOCK_TRANSFER' and coalesce(v_is_team_operation, false) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'TEAM_OPERATION_REVERSAL_REQUIRES_TEAM_FLOW', 'message', 'Esta movimentacao pertence a Operacoes de Equipe.');
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = p_original_stock_transfer_id
  ) or exists (
    select 1
    from public.stock_transfer_item_reversals reversal
    where reversal.tenant_id = p_tenant_id
      and reversal.reversal_stock_transfer_id = p_original_stock_transfer_id
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REVERSAL_OF_REVERSAL_NOT_ALLOWED', 'message', 'Nao e permitido solicitar estorno de uma movimentacao que ja e estorno.');
  end if;

  create temporary table tmp_stock_reversal_allowed_transfers (
    stock_transfer_id uuid primary key
  ) on commit drop;

  insert into tmp_stock_reversal_allowed_transfers values (p_original_stock_transfer_id);

  if v_mode in ('BATCH', 'FULL') and v_source = 'TEAM_OPERATION' then
    insert into tmp_stock_reversal_allowed_transfers (stock_transfer_id)
    select grouped.transfer_id
    from public.stock_transfer_team_operations seed
    join public.stock_transfer_team_operations grouped
      on grouped.tenant_id = seed.tenant_id
     and (
       (seed.operation_batch_id is not null and grouped.operation_batch_id = seed.operation_batch_id)
       or (seed.operation_batch_id is null and grouped.transfer_id = seed.transfer_id)
     )
    where seed.tenant_id = p_tenant_id
      and seed.transfer_id = p_original_stock_transfer_id
    on conflict do nothing;
  elsif v_mode in ('BATCH', 'FULL') and v_source = 'STOCK_TRANSFER' then
    insert into tmp_stock_reversal_allowed_transfers (stock_transfer_id)
    select grouped.id
    from public.stock_transfers seed
    join public.stock_transfers grouped
      on grouped.tenant_id = seed.tenant_id
     and (
       (seed.operation_batch_id is not null and grouped.operation_batch_id = seed.operation_batch_id)
       or (seed.operation_batch_id is null and grouped.id = seed.id)
     )
    where seed.tenant_id = p_tenant_id
      and seed.id = p_original_stock_transfer_id
    on conflict do nothing;
  end if;

  create temporary table tmp_stock_reversal_request_items (
    original_stock_transfer_item_id uuid primary key
  ) on commit drop;

  if v_mode = 'ITEM' then
    insert into tmp_stock_reversal_request_items values (p_original_stock_transfer_item_id);
  elsif v_mode = 'BATCH' and jsonb_typeof(coalesce(p_item_ids, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_item_ids, '[]'::jsonb)) > 0 then
    insert into tmp_stock_reversal_request_items (original_stock_transfer_item_id)
    select distinct value::uuid
    from jsonb_array_elements_text(p_item_ids) as item_ids(value);
  else
    insert into tmp_stock_reversal_request_items (original_stock_transfer_item_id)
    select item.id
    from public.stock_transfer_items item
    join tmp_stock_reversal_allowed_transfers allowed
      on allowed.stock_transfer_id = item.stock_transfer_id
    where item.tenant_id = p_tenant_id
    order by item.id;
  end if;

  delete from tmp_stock_reversal_request_items tmp
  where not exists (
    select 1
    from public.stock_transfer_items item
    where item.tenant_id = p_tenant_id
      and item.id = tmp.original_stock_transfer_item_id
      and exists (
        select 1
        from tmp_stock_reversal_allowed_transfers allowed
        where allowed.stock_transfer_id = item.stock_transfer_id
      )
  );

  select count(*) into v_item_count from tmp_stock_reversal_request_items;
  if v_item_count = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'NO_ITEMS_SELECTED', 'message', 'Nenhum item valido foi selecionado para estorno.');
  end if;

  if exists (
    select 1
    from public.stock_transfer_reversals full_reversal
    join tmp_stock_reversal_allowed_transfers allowed
      on allowed.stock_transfer_id = full_reversal.original_stock_transfer_id
    where full_reversal.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'FULL_TRANSFER_ALREADY_REVERSED', 'message', 'Esta movimentacao ja foi estornada integralmente.');
  end if;

  if exists (
    select 1
    from public.stock_transfer_item_reversals item_reversal
    join tmp_stock_reversal_request_items tmp
      on tmp.original_stock_transfer_item_id = item_reversal.original_stock_transfer_item_id
    where item_reversal.tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'ITEM_ALREADY_REVERSED', 'message', 'Um ou mais itens selecionados ja foram estornados.');
  end if;

  begin
    insert into public.stock_reversal_requests (
      tenant_id,
      source,
      mode,
      original_stock_transfer_id,
      original_stock_transfer_item_id,
      requested_by,
      requested_by_name_snapshot,
      reversal_reason_code,
      reversal_reason_notes,
      reversal_date,
      request_notes,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      v_source,
      v_mode,
      p_original_stock_transfer_id,
      case when v_mode = 'ITEM' then p_original_stock_transfer_item_id else null end,
      p_actor_user_id,
      nullif(btrim(coalesce(p_actor_name, '')), ''),
      v_reason_code,
      v_reason_notes,
      v_reversal_date,
      v_request_notes,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_request_id;

    insert into public.stock_reversal_request_items (
      tenant_id,
      request_id,
      original_stock_transfer_id,
      original_stock_transfer_item_id,
      created_by,
      updated_by
    )
    select
      p_tenant_id,
      v_request_id,
      item.stock_transfer_id,
      tmp.original_stock_transfer_item_id,
      p_actor_user_id,
      p_actor_user_id
    from tmp_stock_reversal_request_items tmp
    join public.stock_transfer_items item
      on item.tenant_id = p_tenant_id
     and item.id = tmp.original_stock_transfer_item_id
    order by tmp.original_stock_transfer_item_id;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'OPEN_REQUEST_EXISTS', 'message', 'Ja existe pedido de estorno aberto para um ou mais itens selecionados.');
  end;

  return jsonb_build_object(
    'success', true,
    'status', 201,
    'request_id', v_request_id,
    'item_count', v_item_count,
    'message', format('Pedido de estorno enviado para atendimento com %s item(ns).', v_item_count)
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'INVALID_ITEM_ID', 'message', 'Lista de itens do estorno contem identificador invalido.');
end;
$$;

create or replace function public.claim_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_request_id uuid,
  p_claim_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_reversal_requests%rowtype;
  v_minutes integer := greatest(coalesce(p_claim_minutes, 15), 1);
begin
  if not public.stock_reversal_request_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED', 'message', 'Usuario nao autorizado para atender estornos neste tenant.');
  end if;

  select *
  into v_request
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND', 'message', 'Pedido de estorno nao encontrado.');
  end if;

  if v_request.status not in ('PENDENTE', 'EM_ANALISE') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLOSED', 'message', 'Pedido de estorno ja esta encerrado.');
  end if;

  if v_request.claimed_by is not null
     and v_request.claimed_by <> p_actor_user_id
     and v_request.claim_expires_at is not null
     and v_request.claim_expires_at > now() then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLAIMED_BY_OTHER', 'message', 'Pedido em analise por ' || coalesce(v_request.claimed_by_name_snapshot, 'outro usuario') || '.');
  end if;

  update public.stock_reversal_requests
  set status = 'EM_ANALISE',
      claimed_by = p_actor_user_id,
      claimed_by_name_snapshot = nullif(btrim(coalesce(p_actor_name, '')), ''),
      claimed_at = now(),
      claim_expires_at = now() + make_interval(mins => v_minutes),
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_request_id;

  update public.stock_reversal_request_items
  set request_status = 'EM_ANALISE',
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and request_id = p_request_id;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id, 'claim_expires_at', to_char(now() + make_interval(mins => v_minutes), 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'message', 'Pedido de estorno assumido para analise.');
end;
$$;

create or replace function public.reject_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.stock_reversal_requests%rowtype;
  v_notes text := nullif(btrim(coalesce(p_decision_notes, '')), '');
begin
  if v_notes is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'DECISION_NOTES_REQUIRED', 'message', 'Informe o motivo da recusa.');
  end if;

  if not public.stock_reversal_request_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED', 'message', 'Usuario nao autorizado para recusar estornos neste tenant.');
  end if;

  select *
  into v_request
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND', 'message', 'Pedido de estorno nao encontrado.');
  end if;

  if v_request.status not in ('PENDENTE', 'EM_ANALISE') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLOSED', 'message', 'Pedido de estorno ja esta encerrado.');
  end if;

  if v_request.claimed_by is not null
     and v_request.claimed_by <> p_actor_user_id
     and v_request.claim_expires_at is not null
     and v_request.claim_expires_at > now() then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLAIMED_BY_OTHER', 'message', 'Pedido em analise por outro usuario.');
  end if;

  update public.stock_reversal_requests
  set status = 'RECUSADO',
      decision_notes = v_notes,
      decided_by = p_actor_user_id,
      decided_at = now(),
      claimed_by = null,
      claimed_by_name_snapshot = null,
      claimed_at = null,
      claim_expires_at = null,
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_request_id;

  update public.stock_reversal_request_items
  set request_status = 'RECUSADO',
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and request_id = p_request_id;

  return jsonb_build_object('success', true, 'status', 200, 'request_id', p_request_id, 'message', 'Pedido de estorno recusado.');
end;
$$;

create or replace function public.approve_stock_reversal_request(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_decision_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.stock_reversal_requests%rowtype;
  v_item record;
  v_item_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_reversal_transfer_id uuid;
  v_reversal_item_id uuid;
  v_first_reversal_transfer_id uuid;
  v_failure_detail text;
  v_notes text := nullif(btrim(coalesce(p_decision_notes, '')), '');
begin
  if not public.stock_reversal_request_actor_allowed(p_tenant_id, p_actor_user_id) then
    return jsonb_build_object('success', false, 'status', 403, 'reason', 'ACTOR_NOT_ALLOWED', 'message', 'Usuario nao autorizado para aprovar estornos neste tenant.');
  end if;

  select *
  into v_request
  from public.stock_reversal_requests
  where tenant_id = p_tenant_id
    and id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'REQUEST_NOT_FOUND', 'message', 'Pedido de estorno nao encontrado.');
  end if;

  if v_request.status not in ('PENDENTE', 'EM_ANALISE') then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLOSED', 'message', 'Pedido de estorno ja esta encerrado.');
  end if;

  if v_request.claimed_by is not null
     and v_request.claimed_by <> p_actor_user_id
     and v_request.claim_expires_at is not null
     and v_request.claim_expires_at > now() then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'REQUEST_CLAIMED_BY_OTHER', 'message', 'Pedido em analise por outro usuario.');
  end if;

  update public.stock_reversal_requests
  set status = 'EM_ANALISE',
      claimed_by = p_actor_user_id,
      claimed_at = coalesce(claimed_at, now()),
      claim_expires_at = now() + interval '15 minutes',
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_request_id;

  update public.stock_reversal_request_items
  set request_status = 'EM_ANALISE',
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and request_id = p_request_id;

  begin
    for v_item in
      select original_stock_transfer_item_id
      from public.stock_reversal_request_items
      where tenant_id = p_tenant_id
        and request_id = p_request_id
      order by original_stock_transfer_item_id
    loop
      if v_request.source = 'TEAM_OPERATION' then
        v_item_result := public.reverse_team_stock_operation_item_record_v1(
          p_tenant_id => p_tenant_id,
          p_actor_user_id => p_actor_user_id,
          p_original_stock_transfer_item_id => v_item.original_stock_transfer_item_id,
          p_reversal_reason_code => v_request.reversal_reason_code,
          p_reversal_reason_notes => v_request.reversal_reason_notes,
          p_reversal_date => v_request.reversal_date
        );
      else
        v_item_result := public.reverse_stock_transfer_item_record_v1(
          p_tenant_id => p_tenant_id,
          p_actor_user_id => p_actor_user_id,
          p_original_stock_transfer_item_id => v_item.original_stock_transfer_item_id,
          p_reversal_reason_code => v_request.reversal_reason_code,
          p_reversal_reason_notes => v_request.reversal_reason_notes,
          p_reversal_date => v_request.reversal_date
        );
      end if;

      if coalesce((v_item_result ->> 'success')::boolean, false) is not true then
        raise exception using
          errcode = 'P0001',
          message = 'STOCK_REVERSAL_REQUEST_APPROVAL_FAILED',
          detail = v_item_result::text;
      end if;

      v_reversal_transfer_id := nullif(v_item_result ->> 'transfer_id', '')::uuid;
      v_reversal_item_id := nullif(v_item_result ->> 'reversal_item_id', '')::uuid;

      if v_reversal_transfer_id is null then
        raise exception using
          errcode = 'P0001',
          message = 'STOCK_REVERSAL_REQUEST_APPROVAL_FAILED',
          detail = jsonb_build_object('success', false, 'status', 500, 'reason', 'REVERSAL_TRANSFER_ID_MISSING', 'message', 'O estorno foi processado sem retornar a movimentacao inversa.')::text;
      end if;

      v_first_reversal_transfer_id := coalesce(v_first_reversal_transfer_id, v_reversal_transfer_id);

      update public.stock_reversal_request_items
      set reversal_stock_transfer_id = v_reversal_transfer_id,
          reversal_stock_transfer_item_id = v_reversal_item_id,
          result_payload = v_item_result,
          updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and request_id = p_request_id
        and original_stock_transfer_item_id = v_item.original_stock_transfer_item_id;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item.original_stock_transfer_item_id,
          'reversal_transfer_id', v_reversal_transfer_id,
          'reversal_item_id', v_reversal_item_id
        )
      );
    end loop;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_failure_detail = pg_exception_detail;

      if sqlerrm <> 'STOCK_REVERSAL_REQUEST_APPROVAL_FAILED' then
        raise;
      end if;

      update public.stock_reversal_requests
      set status = 'FALHA_EXECUCAO',
          failure_reason = coalesce((v_failure_detail::jsonb ->> 'reason'), 'APPROVAL_FAILED'),
          failure_payload = v_failure_detail::jsonb,
          decision_notes = v_notes,
          decided_by = p_actor_user_id,
          decided_at = now(),
          claimed_by = null,
          claimed_by_name_snapshot = null,
          claimed_at = null,
          claim_expires_at = null,
          updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and id = p_request_id;

      update public.stock_reversal_request_items
      set request_status = 'FALHA_EXECUCAO',
          updated_by = p_actor_user_id
      where tenant_id = p_tenant_id
        and request_id = p_request_id;

      return v_failure_detail::jsonb;
  end;

  update public.stock_reversal_requests
  set status = 'EXECUTADO',
      decision_notes = v_notes,
      decided_by = p_actor_user_id,
      decided_at = now(),
      executed_by = p_actor_user_id,
      executed_at = now(),
      claimed_by = null,
      claimed_by_name_snapshot = null,
      claimed_at = null,
      claim_expires_at = null,
      reversal_stock_transfer_id = v_first_reversal_transfer_id,
      reversed_item_count = jsonb_array_length(v_results),
      result_payload = jsonb_build_object('results', v_results),
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_request_id;

  update public.stock_reversal_request_items
  set request_status = 'EXECUTADO',
      updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and request_id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'request_id', p_request_id,
    'transfer_id', v_first_reversal_transfer_id,
    'reversed_item_count', jsonb_array_length(v_results),
    'results', v_results,
    'message', format('Pedido aprovado e %s item(ns) estornado(s).', jsonb_array_length(v_results))
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('success', false, 'status', 500, 'reason', 'INVALID_REVERSAL_RESULT', 'message', 'A RPC de estorno retornou identificador invalido.');
end;
$$;

revoke all on function public.stock_reversal_request_actor_allowed(uuid, uuid) from public;
revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from public;
revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from public;
revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from public;
revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from public;

revoke all on function public.stock_reversal_request_actor_allowed(uuid, uuid) from anon;
revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from anon;
revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from anon;
revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from anon;
revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from anon;

revoke all on function public.stock_reversal_request_actor_allowed(uuid, uuid) from authenticated;
revoke all on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) from authenticated;
revoke all on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) from authenticated;
revoke all on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) from authenticated;
revoke all on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) from authenticated;

grant execute on function public.create_stock_reversal_request(uuid, uuid, text, text, text, uuid, uuid, text, text, date, jsonb, text) to service_role;
grant execute on function public.claim_stock_reversal_request(uuid, uuid, text, uuid, integer) to service_role;
grant execute on function public.reject_stock_reversal_request(uuid, uuid, uuid, text) to service_role;
grant execute on function public.approve_stock_reversal_request(uuid, uuid, uuid, text) to service_role;
