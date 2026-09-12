-- 424_create_blocked_dates_page_and_rpcs.sql
-- Cria a tela de Cadastro Base `Datas Bloqueadas` (`/datas-bloqueadas`), que
-- registra as datas em que a operacao nao deveria programar (feriado nacional,
-- feriado municipal, ponto facultativo ou bloqueio administrativo).
--
-- ESCOPO DELIBERADO: AVISO, NAO TRAVA
-- ---------------------------------------------------------------------------
-- Nenhuma RPC de escrita da Programacao e alterada aqui. `save_project_programming_stage`,
-- `postpone_project_programming_stage`, `postpone_project_programming_team` e
-- `correct_project_programming_stage_date` continuam aceitando qualquer data.
-- O catalogo desta migration alimenta APENAS sinalizacao visual em tres telas:
-- o alerta no formulario da Programacao, o painel do mes vigente no Mapa de
-- Programacao e o cartao vermelho no Calendario Semanal da Visualizacao.
-- Transformar isso em trava e uma decisao de negocio separada, que exigiria
-- alterar aquelas quatro funcoes e definir a excecao para emergencia.
--
-- ABRANGENCIA
-- ---------------------------------------------------------------------------
-- `scope` = NACIONAL vale para todo o tenant. `scope` = MUNICIPAL exige
-- `municipality_id` e so afeta projeto daquele municipio. `kind` e descritivo
-- (FERIADO / PONTO_FACULTATIVO / OUTRO) e nao muda nenhuma regra: existe para o
-- usuario distinguir feriado de bloqueio administrativo na listagem.
--
-- SEM RECORRENCIA ANUAL: cada linha e uma data exata. Natal de 2027 exige um
-- cadastro novo. A checagem por dia/mes foi descartada de proposito porque
-- tornaria ambigua a leitura por janela de datas das tres telas consumidoras.

-- =============================================================================
-- 1) Chave composta em `project_municipalities` para a FK multi-tenant
-- =============================================================================
-- A tabela nasceu na 031 apenas com PK em `id`. Sem `unique (id, tenant_id)` nao
-- da para amarrar a FK abaixo ao tenant, e uma data do tenant A poderia apontar
-- para um municipio do tenant B.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_municipalities_id_tenant_key'
      and conrelid = 'public.project_municipalities'::regclass
  ) then
    alter table public.project_municipalities
      add constraint project_municipalities_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

-- =============================================================================
-- 2) Tabela `programming_blocked_dates`
-- =============================================================================
create table if not exists public.programming_blocked_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  blocked_date date not null,
  description text not null,
  scope text not null default 'NACIONAL',
  municipality_id uuid null,
  kind text not null default 'FERIADO',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_blocked_dates_description_not_blank_check
    check (nullif(btrim(coalesce(description, '')), '') is not null),
  constraint programming_blocked_dates_scope_check
    check (scope in ('NACIONAL', 'MUNICIPAL')),
  constraint programming_blocked_dates_kind_check
    check (kind in ('FERIADO', 'PONTO_FACULTATIVO', 'OUTRO')),
  -- NACIONAL nao pode carregar municipio e MUNICIPAL nao pode ficar sem: sem
  -- isso o filtro por municipio do projeto teria linha ambigua para resolver.
  constraint programming_blocked_dates_scope_municipality_check
    check (
      (scope = 'MUNICIPAL' and municipality_id is not null)
      or (scope = 'NACIONAL' and municipality_id is null)
    ),
  constraint programming_blocked_dates_municipality_tenant_fk
    foreign key (municipality_id, tenant_id)
    references public.project_municipalities(id, tenant_id),
  constraint programming_blocked_dates_id_tenant_key unique (id, tenant_id)
);

-- Unicidade por abrangencia. Sao dois indices parciais porque `municipality_id`
-- e null em NACIONAL e um unique comum trataria cada null como distinto,
-- deixando a mesma data nacional entrar N vezes.
--
-- NAO filtram por `is_active` de proposito: uma data inativada mantem o lugar,
-- e recadastrar a mesma data se faz reativando o registro. Isso preserva o
-- historico daquela data em vez de espalha-lo por varias linhas.
create unique index if not exists programming_blocked_dates_national_unique
  on public.programming_blocked_dates (tenant_id, blocked_date)
  where scope = 'NACIONAL';

create unique index if not exists programming_blocked_dates_municipal_unique
  on public.programming_blocked_dates (tenant_id, blocked_date, municipality_id)
  where scope = 'MUNICIPAL';

-- Leitura das tres telas consumidoras: janela de datas dentro do tenant.
create index if not exists idx_programming_blocked_dates_tenant_date
  on public.programming_blocked_dates (tenant_id, blocked_date);

create index if not exists idx_programming_blocked_dates_tenant_municipality
  on public.programming_blocked_dates (tenant_id, municipality_id)
  where municipality_id is not null;

alter table if exists public.programming_blocked_dates enable row level security;

-- Somente SELECT para `authenticated`, no padrao fixado pela 393: escrita passa
-- por Route Handler com `service_role` chamando RPC, nunca pelo JWT do usuario.
drop policy if exists programming_blocked_dates_tenant_select on public.programming_blocked_dates;
create policy programming_blocked_dates_tenant_select on public.programming_blocked_dates
for select
to authenticated
using (public.user_can_access_tenant(programming_blocked_dates.tenant_id));

revoke insert, update, delete on public.programming_blocked_dates from public, anon, authenticated;

drop trigger if exists trg_programming_blocked_dates_audit on public.programming_blocked_dates;
create trigger trg_programming_blocked_dates_audit
before insert or update on public.programming_blocked_dates
for each row execute function public.apply_audit_fields();

-- =============================================================================
-- 3) RPC de escrita
-- =============================================================================
create or replace function public.save_blocked_date_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_blocked_date_id uuid default null,
  p_blocked_date date default null,
  p_description text default null,
  p_scope text default null,
  p_municipality_id uuid default null,
  p_kind text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.programming_blocked_dates%rowtype;
  v_blocked_date_id uuid := p_blocked_date_id;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_scope text := upper(nullif(btrim(coalesce(p_scope, '')), ''));
  v_kind text := upper(nullif(btrim(coalesce(p_kind, '')), ''));
  v_municipality_id uuid := p_municipality_id;
  v_municipality_name text;
  v_current_municipality_name text;
  v_updated_at timestamptz;
  v_changes jsonb;
  v_constraint_name text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para salvar data bloqueada.'
    );
  end if;

  if p_blocked_date is null or v_description is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_REQUIRED_FIELDS',
      'message', 'Informe data e descricao da data bloqueada.'
    );
  end if;

  if v_scope is null or v_scope not in ('NACIONAL', 'MUNICIPAL') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_SCOPE',
      'message', 'Abrangencia da data bloqueada deve ser NACIONAL ou MUNICIPAL.'
    );
  end if;

  v_kind := coalesce(v_kind, 'FERIADO');
  if v_kind not in ('FERIADO', 'PONTO_FACULTATIVO', 'OUTRO') then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_KIND',
      'message', 'Tipo da data bloqueada deve ser FERIADO, PONTO_FACULTATIVO ou OUTRO.'
    );
  end if;

  -- NACIONAL descarta o municipio que a tela porventura tenha mandado, em vez de
  -- recusar: o usuario que troca a abrangencia depois de escolher o municipio
  -- nao deve ver erro.
  if v_scope = 'NACIONAL' then
    v_municipality_id := null;
  end if;

  if v_scope = 'MUNICIPAL' then
    if v_municipality_id is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MUNICIPALITY_REQUIRED',
        'message', 'Informe o municipio da data bloqueada com abrangencia MUNICIPAL.'
      );
    end if;

    select municipality.name
    into v_municipality_name
    from public.project_municipalities municipality
    where municipality.tenant_id = p_tenant_id
      and municipality.id = v_municipality_id
      and municipality.ativo = true;

    if v_municipality_name is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'MUNICIPALITY_NOT_FOUND',
        'message', 'Municipio nao encontrado ou inativo neste tenant.'
      );
    end if;
  end if;

  if v_blocked_date_id is null then
    insert into public.programming_blocked_dates (
      tenant_id,
      blocked_date,
      description,
      scope,
      municipality_id,
      kind,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_tenant_id,
      p_blocked_date,
      v_description,
      v_scope,
      v_municipality_id,
      v_kind,
      true,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_blocked_date_id, v_updated_at;
  else
    select *
    into v_current
    from public.programming_blocked_dates
    where tenant_id = p_tenant_id
      and id = v_blocked_date_id
    for update;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 404,
        'reason', 'BLOCKED_DATE_NOT_FOUND',
        'message', 'Data bloqueada nao encontrada.'
      );
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
        'message', 'Atualize a lista antes de editar a data bloqueada.'
      );
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('A data bloqueada %s foi alterada por outro usuario. Recarregue os dados antes de salvar novamente.', to_char(v_current.blocked_date, 'DD/MM/YYYY'))
      );
    end if;

    if not v_current.is_active then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'RECORD_INACTIVE',
        'message', 'Ative a data bloqueada antes de editar.'
      );
    end if;

    select municipality.name
    into v_current_municipality_name
    from public.project_municipalities municipality
    where municipality.tenant_id = p_tenant_id
      and municipality.id = v_current.municipality_id;

    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'blockedDate', case when v_current.blocked_date is distinct from p_blocked_date
        then jsonb_build_object('from', to_char(v_current.blocked_date, 'DD/MM/YYYY'), 'to', to_char(p_blocked_date, 'DD/MM/YYYY')) end,
      'description', case when v_current.description is distinct from v_description
        then jsonb_build_object('from', v_current.description, 'to', v_description) end,
      'scope', case when v_current.scope is distinct from v_scope
        then jsonb_build_object('from', v_current.scope, 'to', v_scope) end,
      'municipality', case when v_current.municipality_id is distinct from v_municipality_id
        then jsonb_build_object('from', coalesce(v_current_municipality_name, 'Sem municipio'), 'to', coalesce(v_municipality_name, 'Sem municipio')) end,
      'kind', case when v_current.kind is distinct from v_kind
        then jsonb_build_object('from', v_current.kind, 'to', v_kind) end
    ));

    if v_changes = '{}'::jsonb then
      return jsonb_build_object(
        'success', true,
        'status', 200,
        'blocked_date_id', v_blocked_date_id,
        'updated_at', v_current.updated_at,
        'message', format('Nenhuma alteracao detectada na data bloqueada %s.', to_char(v_current.blocked_date, 'DD/MM/YYYY'))
      );
    end if;

    update public.programming_blocked_dates
    set
      blocked_date = p_blocked_date,
      description = v_description,
      scope = v_scope,
      municipality_id = v_municipality_id,
      kind = v_kind,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_blocked_date_id
    returning updated_at
    into v_updated_at;

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
      'datas-bloqueadas',
      'programming_blocked_dates',
      v_blocked_date_id,
      to_char(p_blocked_date, 'YYYY-MM-DD'),
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
    'blocked_date_id', v_blocked_date_id,
    'updated_at', v_updated_at,
    'message',
      case
        when p_blocked_date_id is null then format('Data bloqueada %s cadastrada com sucesso.', to_char(p_blocked_date, 'DD/MM/YYYY'))
        else format('Data bloqueada %s atualizada com sucesso.', to_char(p_blocked_date, 'DD/MM/YYYY'))
      end
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'programming_blocked_dates_national_unique' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_NATIONAL_DATE',
        'message', format('Ja existe data bloqueada nacional em %s neste tenant.', to_char(p_blocked_date, 'DD/MM/YYYY'))
      );
    end if;
    if v_constraint_name = 'programming_blocked_dates_municipal_unique' then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'DUPLICATE_MUNICIPAL_DATE',
        'message', format('Ja existe data bloqueada em %s para este municipio.', to_char(p_blocked_date, 'DD/MM/YYYY'))
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'DUPLICATE_VALUE',
      'message', 'Registro duplicado ao salvar a data bloqueada.'
    );
end;
$$;

revoke all on function public.save_blocked_date_record(
  uuid,
  uuid,
  uuid,
  date,
  text,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_blocked_date_record(
  uuid,
  uuid,
  uuid,
  date,
  text,
  text,
  uuid,
  text,
  timestamptz
) to service_role;

-- =============================================================================
-- 4) RPC de ativacao / cancelamento
-- =============================================================================
-- Sem checagem de uso: o catalogo e apenas sinalizacao visual e nenhuma tabela
-- referencia `programming_blocked_dates`. Inativar uma data so faz o aviso
-- sumir das tres telas consumidoras, nunca invalida etapa ja gravada.
create or replace function public.set_blocked_date_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_blocked_date_id uuid,
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
  v_current public.programming_blocked_dates%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_updated_at timestamptz;
  v_next_active boolean;
  v_changes jsonb;
  v_label text;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TENANT_OR_ACTOR_REQUIRED',
      'message', 'Tenant e usuario sao obrigatorios para alterar data bloqueada.'
    );
  end if;

  if p_blocked_date_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'BLOCKED_DATE_REQUIRED',
      'message', 'Data bloqueada invalida para atualizar status.'
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
  from public.programming_blocked_dates
  where tenant_id = p_tenant_id
    and id = p_blocked_date_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'BLOCKED_DATE_NOT_FOUND',
      'message', 'Data bloqueada nao encontrada.'
    );
  end if;

  v_label := to_char(v_current.blocked_date, 'DD/MM/YYYY');

  if p_expected_updated_at is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'EXPECTED_UPDATED_AT_REQUIRED',
      'message', 'Atualize a lista antes de alterar o status da data bloqueada.'
    );
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('A data bloqueada %s foi alterada por outro usuario. Recarregue os dados antes de alterar o status.', v_label)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Data bloqueada %s ja esta inativa.', v_label)
    );
  end if;

  if v_action = 'ACTIVATE' and v_current.is_active then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'STATUS_ALREADY_CHANGED',
      'message', format('Data bloqueada %s ja esta ativa.', v_label)
    );
  end if;

  v_next_active := v_action = 'ACTIVATE';

  update public.programming_blocked_dates
  set
    is_active = v_next_active,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_blocked_date_id
  returning updated_at
  into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive',
    jsonb_build_object('from', v_current.is_active::text, 'to', v_next_active::text)
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
    'datas-bloqueadas',
    'programming_blocked_dates',
    p_blocked_date_id,
    to_char(v_current.blocked_date, 'YYYY-MM-DD'),
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
    'blocked_date_id', p_blocked_date_id,
    'updated_at', v_updated_at,
    'message',
      case
        when v_action = 'ACTIVATE' then format('Data bloqueada %s ativada com sucesso.', v_label)
        else format('Data bloqueada %s cancelada com sucesso.', v_label)
      end
  );
end;
$$;

revoke all on function public.set_blocked_date_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.set_blocked_date_record_status(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;

-- =============================================================================
-- 5) Tela em `app_pages` e propagacao de permissao
-- =============================================================================
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'datas-bloqueadas',
  '/datas-bloqueadas',
  'Datas Bloqueadas',
  'Cadastro Base',
  'Cadastro base das datas em que a operacao nao deve programar.',
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
  'datas-bloqueadas',
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
 and existing.page_key = 'datas-bloqueadas'
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
  'datas-bloqueadas',
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
 and existing.page_key = 'datas-bloqueadas'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- 6) Verificacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_blocked_date_record(uuid, uuid, uuid, date, text, text, uuid, text, timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_blocked_date_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '424: save_blocked_date_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '424: set_blocked_date_record_status ainda executavel por anon/authenticated';
  end if;

  if has_table_privilege('anon', 'public.programming_blocked_dates', 'insert')
     or has_table_privilege('authenticated', 'public.programming_blocked_dates', 'insert')
     or has_table_privilege('authenticated', 'public.programming_blocked_dates', 'update')
     or has_table_privilege('authenticated', 'public.programming_blocked_dates', 'delete') then
    raise exception '424: programming_blocked_dates ainda aceita escrita por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'datas-bloqueadas'
      and ativo = true
      and default_user_access = false
  ) then
    raise exception '424: pagina datas-bloqueadas nao foi cadastrada corretamente em app_pages';
  end if;
end;
$$;
