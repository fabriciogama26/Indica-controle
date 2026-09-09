-- 421_create_tenant_stock_serial_policy.sql
-- Politica de pendencia de identificacao de serial por contrato (tenant).
--
-- POR QUE ESTA MIGRATION EXISTE
-- ---------------------------------------------------------------------------
-- Ate aqui, em quais movimentos um material rastreado por serial podia entrar sem
-- Serial informado era decisao fixa no codigo, replicada em quatro lugares:
--
--   ENTRY e TRANSFER aceitam pendencia; EXIT nao.
--
-- A migration 414 tornou configuravel QUAIS materiais aceitam pendencia
-- (materials.allow_pending_serial_identification). Esta migration torna
-- configuravel, por contrato, EM QUAIS MOVIMENTOS a pendencia pode ser criada.
--
-- As duas camadas valem em AND: a pendencia so e aceita quando o material permite
-- E o contrato permite aquele movimento. Um contrato mais rigido nunca e furado por
-- material mal cadastrado, e um contrato permissivo nao afrouxa material critico.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- 1. Nao muda o comportamento de nenhum contrato hoje. O backfill grava exatamente
--    a regra que estava fixa no codigo (entry=true, transfer=true, exit=false), e a
--    leitura na aplicacao usa esse mesmo trio como default quando nao houver linha.
--
-- 2. Nao alcanca a identificacao/liquidacao de pendencia. A politica governa a
--    CRIACAO de pendencia; identify_pending_serial_tracked_unit continua fora dela.
--    Se um contrato apertar a regra, o saldo ja acumulado precisa continuar
--    liquidavel -- caso contrario o saldo fica preso, que e o mesmo defeito que a
--    414 fechou no nivel do material.
--
-- 3. Nao alcanca o estorno. O estorno reproduz um fato ja ocorrido e roda pela RPC
--    propria (reverse_stock_transfer_item / batch), sem passar pelo caminho de
--    criacao de movimento da aplicacao. Aplicar a regra de hoje a um movimento de
--    ontem quebraria o estorno de pendencia legitima.
--
-- 4. Nao alcanca Operacoes de Equipe nem Requisicao: esses fluxos exigem Serial
--    sempre (375 e 295), entao pendencia nunca chega a ser criada por eles.

create table if not exists public.tenant_stock_serial_policy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  allow_pending_on_entry boolean not null default true,
  allow_pending_on_transfer boolean not null default true,
  allow_pending_on_exit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint tenant_stock_serial_policy_tenant_unique unique (tenant_id)
);

create index if not exists idx_tenant_stock_serial_policy_tenant
  on public.tenant_stock_serial_policy (tenant_id);

alter table if exists public.tenant_stock_serial_policy enable row level security;

drop policy if exists tenant_stock_serial_policy_tenant_select on public.tenant_stock_serial_policy;
create policy tenant_stock_serial_policy_tenant_select on public.tenant_stock_serial_policy
for select
to authenticated
using (public.user_can_access_tenant(tenant_stock_serial_policy.tenant_id));

drop trigger if exists trg_tenant_stock_serial_policy_audit on public.tenant_stock_serial_policy;
create trigger trg_tenant_stock_serial_policy_audit
before insert or update on public.tenant_stock_serial_policy
for each row execute function public.apply_audit_fields();

-- Backfill: grava a regra que ja estava fixa no codigo, para que nenhum contrato
-- mude de comportamento no deploy.
insert into public.tenant_stock_serial_policy (
  tenant_id,
  allow_pending_on_entry,
  allow_pending_on_transfer,
  allow_pending_on_exit
)
select
  tenants.id,
  true,
  true,
  false
from public.tenants tenants
on conflict (tenant_id) do nothing;

create or replace function public.save_tenant_stock_serial_policy(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_allow_pending_on_entry boolean,
  p_allow_pending_on_transfer boolean,
  p_allow_pending_on_exit boolean,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.tenant_stock_serial_policy%rowtype;
  v_policy_id uuid;
  v_updated_at timestamptz;
  v_entry boolean := coalesce(p_allow_pending_on_entry, false);
  v_transfer boolean := coalesce(p_allow_pending_on_transfer, false);
  v_exit boolean := coalesce(p_allow_pending_on_exit, false);
  v_changes jsonb := '{}'::jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'POLICY_REQUIRED_FIELDS',
      'message', 'Contrato e usuario sao obrigatorios para salvar a politica.'
    );
  end if;

  select *
  into v_current
  from public.tenant_stock_serial_policy
  where tenant_id = p_tenant_id
  for update;

  if not found then
    insert into public.tenant_stock_serial_policy (
      tenant_id,
      allow_pending_on_entry,
      allow_pending_on_transfer,
      allow_pending_on_exit,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      v_entry,
      v_transfer,
      v_exit,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_policy_id, v_updated_at;

    return jsonb_build_object('success', true, 'status', 200, 'policy_id', v_policy_id, 'updated_at', v_updated_at);
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a tela antes de salvar a politica.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', 'A politica foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.'
    );
  end if;

  if v_current.allow_pending_on_entry is distinct from v_entry then
    v_changes := v_changes || jsonb_build_object(
      'allowPendingOnEntry',
      jsonb_build_object('from', v_current.allow_pending_on_entry::text, 'to', v_entry::text)
    );
  end if;

  if v_current.allow_pending_on_transfer is distinct from v_transfer then
    v_changes := v_changes || jsonb_build_object(
      'allowPendingOnTransfer',
      jsonb_build_object('from', v_current.allow_pending_on_transfer::text, 'to', v_transfer::text)
    );
  end if;

  if v_current.allow_pending_on_exit is distinct from v_exit then
    v_changes := v_changes || jsonb_build_object(
      'allowPendingOnExit',
      jsonb_build_object('from', v_current.allow_pending_on_exit::text, 'to', v_exit::text)
    );
  end if;

  if coalesce(jsonb_object_length(v_changes), 0) = 0 then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'policy_id', v_current.id,
      'updated_at', v_current.updated_at,
      'unchanged', true
    );
  end if;

  update public.tenant_stock_serial_policy
  set
    allow_pending_on_entry = v_entry,
    allow_pending_on_transfer = v_transfer,
    allow_pending_on_exit = v_exit,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
  returning id, updated_at
  into v_policy_id, v_updated_at;

  -- Mudanca de regra de rastreabilidade precisa ter autor e data.
  insert into public.app_entity_history (
    tenant_id,
    module_key,
    entity_table,
    entity_id,
    entity_code,
    change_type,
    changes,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    'politica-serial',
    'tenant_stock_serial_policy',
    v_policy_id,
    'POLITICA_SERIAL',
    'UPDATE',
    v_changes,
    p_actor_user_id,
    p_actor_user_id
  );

  return jsonb_build_object('success', true, 'status', 200, 'policy_id', v_policy_id, 'updated_at', v_updated_at);
end;
$$;

revoke all on function public.save_tenant_stock_serial_policy(uuid, uuid, boolean, boolean, boolean, timestamptz) from public;
revoke all on function public.save_tenant_stock_serial_policy(uuid, uuid, boolean, boolean, boolean, timestamptz) from anon;
revoke all on function public.save_tenant_stock_serial_policy(uuid, uuid, boolean, boolean, boolean, timestamptz) from authenticated;
grant execute on function public.save_tenant_stock_serial_policy(uuid, uuid, boolean, boolean, boolean, timestamptz) to service_role;

insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'politica-serial',
  '/politica-serial',
  'Politica de Serial',
  'Cadastro Base',
  'Define, por contrato, em quais movimentos o material rastreado por serial pode entrar sem Serial informado.',
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
  'politica-serial',
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
 and existing.page_key = 'politica-serial'
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
  'politica-serial',
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
 and existing.page_key = 'politica-serial'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

do $$
declare
  v_save_fn regprocedure := 'public.save_tenant_stock_serial_policy(uuid, uuid, boolean, boolean, boolean, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '421: save_tenant_stock_serial_policy ainda executavel por anon/authenticated';
  end if;

  if has_table_privilege('anon', 'public.tenant_stock_serial_policy', 'insert')
     or has_table_privilege('anon', 'public.tenant_stock_serial_policy', 'update')
     or has_table_privilege('authenticated', 'public.tenant_stock_serial_policy', 'insert')
     or has_table_privilege('authenticated', 'public.tenant_stock_serial_policy', 'update') then
    raise exception '421: tenant_stock_serial_policy ainda permite escrita direta por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'politica-serial'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '421: pagina politica-serial nao foi cadastrada corretamente em app_pages';
  end if;

  if exists (
    select 1
    from public.tenants tenants
    left join public.tenant_stock_serial_policy policy
      on policy.tenant_id = tenants.id
    where policy.tenant_id is null
  ) then
    raise exception '421: existe tenant sem linha de politica apos o backfill';
  end if;
end;
$$;
