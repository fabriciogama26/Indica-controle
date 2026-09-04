-- 415_team_categories_and_commercial_measurement.sql
-- Tipo de Equipe (TECNICA/COMERCIAL) e a tela Medicao Comercial.
--
-- CONTEXTO
-- ---------------------------------------------------------------------------
-- Ate aqui toda equipe era, na pratica, tecnica: `teams.foreman_person_id` era
-- NOT NULL e a Medicao lia o encarregado da equipe para o snapshot. A operacao
-- comercial nao tem encarregado -- tem supervisor e dois eletricistas que mudam
-- a cada execucao. Sem separar as duas naturezas, cadastrar equipe comercial
-- exigiria inventar um encarregado so para satisfazer a coluna.
--
-- O QUE ESTA MIGRATION FAZ
-- ---------------------------------------------------------------------------
-- 1. Catalogo `team_categories` por tenant, semeado com TECNICA e COMERCIAL.
--    E catalogo fechado (nao tem tela de cadastro): as duas linhas sao criadas
--    aqui e o `code` e restrito por check.
-- 2. `teams.team_category_id` obrigatorio, com backfill TECNICA para tudo que
--    ja existe -- nenhuma equipe atual muda de comportamento.
-- 3. `teams.foreman_person_id` passa a aceitar NULL, com a regra por categoria
--    aplicada em trigger (check constraint nao pode consultar outra tabela):
--    TECNICA exige encarregado, COMERCIAL exige supervisor.
-- 4. `save_team_record` ganha `p_team_category_id` e aplica as mesmas regras
--    antes de gravar. A assinatura antiga e derrubada para nao sobrar overload
--    ambiguo no PostgREST.
-- 5. Campos proprios da ordem comercial:
--    - `Projeto` deixa de ser obrigatorio, inclusive em `COM_PRODUCAO`;
--    - `commercial_order_ref` (campo `Ordem`, texto livre e opcional);
--    - `Processo` (catalogo proprio `measurement_commercial_processes`),
--      `Hora inicio` e `Hora termino`, os tres OBRIGATORIOS na ordem comercial.
--    As colunas sao anulaveis porque a ordem TECNICA nao tem esses campos: a
--    obrigatoriedade depende da categoria da equipe e por isso vive no mesmo
--    trigger da regra de Projeto, pelo motivo do item 3 -- CHECK nao consulta
--    outra tabela. Medicao TECNICA nao muda em nada.
-- 6. `project_commercial_measurement_order_members` guarda os DOIS integrantes
--    da ordem comercial, com snapshot do nome, e
--    `save_project_commercial_measurement_order` grava ordem + integrantes na
--    mesma transacao, delegando o cabecalho para a RPC ja existente da Medicao
--    em vez de duplica-la.
-- 7. Pagina `medicao-comercial` em `app_pages`, liberada so para administrador
--    (padrao da 245), para o administrador distribuir depois em Permissoes.
--
-- O QUE ESTA MIGRATION NAO FAZ
-- ---------------------------------------------------------------------------
-- Nao altera nenhuma ordem de medicao existente, nao mexe em permissao de
-- `medicao` e nao cria tela de cadastro para o catalogo de categorias.

-- =============================================================================
-- 1) Catalogo `team_categories`
-- =============================================================================
create table if not exists public.team_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint team_categories_code_allowed_check
    check (code in ('TECNICA', 'COMERCIAL')),
  constraint team_categories_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint team_categories_tenant_code_key
    unique (tenant_id, code),
  constraint team_categories_id_tenant_key
    unique (id, tenant_id)
);

create index if not exists idx_team_categories_tenant_active_order
  on public.team_categories (tenant_id, ativo, sort_order, name);

alter table if exists public.team_categories enable row level security;

-- Somente SELECT para `authenticated`, no padrao fixado pela 393: escrita passa
-- por Route Handler com `service_role`, nunca pelo JWT do usuario.
drop policy if exists team_categories_tenant_select on public.team_categories;
create policy team_categories_tenant_select on public.team_categories
for select
to authenticated
using (public.user_can_access_tenant(team_categories.tenant_id));

revoke insert, update, delete on public.team_categories from public, anon, authenticated;

drop trigger if exists trg_team_categories_audit on public.team_categories;
create trigger trg_team_categories_audit
before insert or update on public.team_categories
for each row execute function public.apply_audit_fields();

with tenant_sources as (
  select tenant_id
  from public.app_users
  where tenant_id is not null
  union
  select tenant_id
  from public.teams
  where tenant_id is not null
  union
  select id as tenant_id
  from public.tenants
),
seed as (
  select * from (values
    ('TECNICA', 'Tecnica', 1),
    ('COMERCIAL', 'Comercial', 2)
  ) as v(code, name, sort_order)
)
insert into public.team_categories (tenant_id, code, name, sort_order, ativo)
select tenant_sources.tenant_id, seed.code, seed.name, seed.sort_order, true
from tenant_sources
cross join seed
on conflict (tenant_id, code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  ativo = true,
  updated_at = now();

-- =============================================================================
-- 2) `teams.team_category_id` com backfill TECNICA
-- =============================================================================
alter table if exists public.teams
  add column if not exists team_category_id uuid null;

update public.teams t
set team_category_id = tc.id
from public.team_categories tc
where tc.tenant_id = t.tenant_id
  and tc.code = 'TECNICA'
  and t.team_category_id is null;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'teams'
      and tc.constraint_name = 'teams_team_category_tenant_fk'
  ) then
    alter table public.teams
      add constraint teams_team_category_tenant_fk
      foreign key (team_category_id, tenant_id)
      references public.team_categories(id, tenant_id);
  end if;
end;
$$;

alter table if exists public.teams
  alter column team_category_id set not null;

create index if not exists idx_teams_tenant_category_active_name
  on public.teams (tenant_id, team_category_id, ativo, name);

-- =============================================================================
-- 3) Encarregado opcional, com a regra por categoria em trigger
-- =============================================================================
-- Nao da para expressar em CHECK: a regra depende do `code` que vive em
-- `team_categories`, e CHECK nao consulta outra tabela.
alter table if exists public.teams
  alter column foreman_person_id drop not null;

create or replace function public.enforce_team_category_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select tc.code
  into v_code
  from public.team_categories tc
  where tc.id = new.team_category_id
    and tc.tenant_id = new.tenant_id;

  if v_code is null then
    raise exception using
      errcode = '23503',
      message = 'invalid_team_category: tipo de equipe invalido para o tenant atual.';
  end if;

  if v_code = 'TECNICA' and new.foreman_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_foreman: encarregado e obrigatorio para equipe tecnica.';
  end if;

  if v_code = 'COMERCIAL' and new.supervisor_person_id is null then
    raise exception using
      errcode = '23514',
      message = 'team_requires_supervisor: supervisor e obrigatorio para equipe comercial.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_team_category_links() from public;

drop trigger if exists trg_enforce_team_category_links on public.teams;
create trigger trg_enforce_team_category_links
before insert or update on public.teams
for each row execute function public.enforce_team_category_links();

-- Equipe sem encarregado nao abre periodo no historico de encarregado: sem este
-- ajuste, toda equipe comercial nasceria com um periodo aberto gravado como
-- 'Nao identificado', que depois viraria snapshot na ordem de medicao.
create or replace function public.sync_team_foreman_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_date date;
  v_foreman_name text;
  v_updated_existing_count integer := 0;
begin
  if tg_op = 'UPDATE' and new.foreman_person_id is not distinct from old.foreman_person_id then
    return new;
  end if;

  v_effective_date := coalesce(new.updated_at::date, new.created_at::date, current_date);

  if tg_op = 'UPDATE' then
    update public.team_foreman_history h
    set
      valid_to = v_effective_date - 1,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null
      and new.foreman_person_id is null;
  end if;

  if new.foreman_person_id is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_foreman_name
  from public.people p
  where p.tenant_id = new.tenant_id
    and p.id = new.foreman_person_id;

  v_foreman_name := coalesce(v_foreman_name, 'Nao identificado');

  if tg_op = 'UPDATE' then
    update public.team_foreman_history h
    set
      foreman_person_id = new.foreman_person_id,
      foreman_name_snapshot = v_foreman_name,
      valid_to = null,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null
      and h.valid_from >= v_effective_date;

    get diagnostics v_updated_existing_count = row_count;
    if v_updated_existing_count > 0 then
      return new;
    end if;

    update public.team_foreman_history h
    set
      valid_to = v_effective_date - 1,
      updated_at = now()
    where h.tenant_id = new.tenant_id
      and h.team_id = new.id
      and h.valid_to is null;
  end if;

  insert into public.team_foreman_history (
    tenant_id,
    team_id,
    foreman_person_id,
    foreman_name_snapshot,
    valid_from,
    valid_to
  ) values (
    new.tenant_id,
    new.id,
    new.foreman_person_id,
    v_foreman_name,
    v_effective_date,
    null
  )
  on conflict (tenant_id, team_id, valid_from) do update
  set
    foreman_person_id = excluded.foreman_person_id,
    foreman_name_snapshot = excluded.foreman_name_snapshot,
    valid_to = null,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_team_foreman_history() from public;

-- Mesma razao: equipe sem encarregado devolve NULL, e nao 'Nao identificado'.
-- `apply_measurement_team_snapshot` so grava quando o valor nao e nulo, entao a
-- ordem comercial fica com `foreman_name_snapshot` vazio.
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
as $$
  select
    coalesce(nullif(btrim(coalesce(t.name, '')), ''), 'Nao informado') as team_name,
    case
      when t.foreman_person_id is null
        and nullif(btrim(coalesce(h.foreman_name_snapshot, '')), '') is null
        then null
      else coalesce(
        nullif(btrim(coalesce(h.foreman_name_snapshot, '')), ''),
        nullif(btrim(coalesce(p.nome, '')), ''),
        'Nao identificado'
      )
    end as foreman_name
  from public.teams t
  left join public.people p
    on p.id = t.foreman_person_id
   and p.tenant_id = t.tenant_id
  left join lateral (
    select fh.foreman_name_snapshot
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
$$;

revoke all on function public.resolve_team_foreman_snapshot(uuid, uuid, date) from public;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to authenticated;
grant execute on function public.resolve_team_foreman_snapshot(uuid, uuid, date) to service_role;

-- =============================================================================
-- 4) `save_team_record` com Tipo de Equipe
-- =============================================================================
drop function if exists public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid);

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
  p_expected_updated_at timestamptz default null,
  p_supervisor_person_id uuid default null,
  p_team_category_id uuid default null
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
  v_effective_stock_center_id uuid;
  v_team_category_code text;
begin
  select tc.code
  into v_team_category_code
  from public.team_categories tc
  where tc.id = p_team_category_id
    and tc.tenant_id = p_tenant_id
    and tc.ativo = true;

  if v_team_category_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_CATEGORY',
      'message', 'Tipo de equipe invalido para o tenant atual.'
    );
  end if;

  if v_team_category_code = 'TECNICA' and p_foreman_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_FOREMAN',
      'message', 'Encarregado e obrigatorio para equipe tecnica.'
    );
  end if;

  if v_team_category_code = 'COMERCIAL' and p_supervisor_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_SUPERVISOR',
      'message', 'Supervisor e obrigatorio para equipe comercial.'
    );
  end if;

  if p_foreman_person_id is not null then
    perform 1
    from public.people p
    where p.id = p_foreman_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true;

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_FOREMAN',
        'message', 'Encarregado invalido para o tenant atual.'
      );
    end if;
  end if;

  if p_supervisor_person_id is not null then
    perform 1
    from public.people p
    join public.job_titles jt
      on jt.id = p.job_title_id
     and jt.tenant_id = p.tenant_id
    where p.id = p_supervisor_person_id
      and p.tenant_id = p_tenant_id
      and p.ativo = true
      and jt.ativo = true
      and (
        jt.code ilike '%SUPERVISOR%'
        or jt.name ilike '%SUPERVISOR%'
      );

    if not found then
      return jsonb_build_object(
        'success', false,
        'status', 422,
        'reason', 'INVALID_SUPERVISOR',
        'message', 'Supervisor invalido para o tenant atual.'
      );
    end if;
  end if;

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
    -- A trava de "um encarregado, uma equipe ativa" so faz sentido quando ha
    -- encarregado: equipe comercial pode ter varias sem nenhum vinculo.
    if p_foreman_person_id is not null and exists (
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
      team_category_id,
      foreman_person_id,
      supervisor_person_id,
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
      p_team_category_id,
      p_foreman_person_id,
      p_supervisor_person_id,
      null,
      true,
      null,
      null,
      null,
      p_actor_user_id,
      p_actor_user_id
    )
    returning id, updated_at
    into v_team_id, v_updated_at;

    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => v_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => p_stock_center_id
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = v_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;

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

  if p_foreman_person_id is not null and exists (
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

  v_effective_stock_center_id := coalesce(p_stock_center_id, v_current.stock_center_id);

  update public.teams
  set
    name = p_name,
    vehicle_plate = p_vehicle_plate,
    service_center_id = p_service_center_id,
    team_type_id = p_team_type_id,
    team_category_id = p_team_category_id,
    foreman_person_id = p_foreman_person_id,
    supervisor_person_id = p_supervisor_person_id,
    stock_center_id = v_effective_stock_center_id,
    updated_by = p_actor_user_id
  where id = p_team_id
    and tenant_id = p_tenant_id
  returning id, updated_at
  into v_team_id, v_updated_at;

  if v_effective_stock_center_id is null then
    begin
      v_effective_stock_center_id := public.ensure_team_stock_center_record(
        p_tenant_id => p_tenant_id,
        p_actor_user_id => p_actor_user_id,
        p_team_id => p_team_id,
        p_team_name => p_name,
        p_existing_stock_center_id => null
      );
    exception
      when others then
        if lower(coalesce(sqlerrm, '')) like '%invalid_stock_center%' then
          return jsonb_build_object(
            'success', false,
            'status', 422,
            'reason', 'INVALID_STOCK_CENTER',
            'message', 'Centro de estoque proprio invalido para a equipe.'
          );
        end if;

        raise;
    end;

    update public.teams
    set
      stock_center_id = v_effective_stock_center_id,
      updated_by = p_actor_user_id,
      updated_at = now()
    where id = p_team_id
      and tenant_id = p_tenant_id
    returning updated_at
    into v_updated_at;
  end if;

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

revoke all on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid, uuid) to service_role;


-- =============================================================================
-- 5) Campos proprios da ordem comercial
-- =============================================================================
-- A equipe comercial atende demanda que nem sempre tem projeto aberto. O campo
-- `Projeto` continua na tela e continua vindo do cadastro de Projetos, mas deixa
-- de ser obrigatorio; no lugar dele o usuario pode informar apenas a `Ordem`.
-- Os dois sao opcionais e independentes: a ordem comercial pode ter os dois, um
-- so ou nenhum.
--
-- Ja `Processo`, `Hora inicio` e `Hora termino` sao obrigatorios na ordem
-- comercial. Catalogo do Processo fica em tabela propria, sem tela de cadastro
-- por ora: nasce semeado e cresce por SQL.
create table if not exists public.measurement_commercial_processes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint measurement_commercial_processes_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint measurement_commercial_processes_name_not_blank_check
    check (nullif(btrim(coalesce(name, '')), '') is not null),
  constraint measurement_commercial_processes_tenant_code_key
    unique (tenant_id, code),
  constraint measurement_commercial_processes_id_tenant_key
    unique (id, tenant_id)
);

create index if not exists idx_measurement_commercial_processes_tenant_active
  on public.measurement_commercial_processes (tenant_id, ativo, sort_order, name);

alter table if exists public.measurement_commercial_processes enable row level security;

drop policy if exists measurement_commercial_processes_tenant_select
  on public.measurement_commercial_processes;
create policy measurement_commercial_processes_tenant_select
on public.measurement_commercial_processes
for select
to authenticated
using (public.user_can_access_tenant(measurement_commercial_processes.tenant_id));

revoke insert, update, delete
  on public.measurement_commercial_processes
  from public, anon, authenticated;

drop trigger if exists trg_measurement_commercial_processes_audit
  on public.measurement_commercial_processes;
create trigger trg_measurement_commercial_processes_audit
before insert or update on public.measurement_commercial_processes
for each row execute function public.apply_audit_fields();

with tenant_sources as (
  select tenant_id
  from public.app_users
  where tenant_id is not null
  union
  select id as tenant_id
  from public.tenants
),
seed as (
  select * from (values
    ('COBRANCAS', 'Cobrancas', 1),
    ('NOVAS_LIGACOES', 'Novas_Ligacoes', 2),
    ('PERDAS', 'Perdas', 3)
  ) as v(code, name, sort_order)
)
insert into public.measurement_commercial_processes (tenant_id, code, name, sort_order, ativo)
select tenant_sources.tenant_id, seed.code, seed.name, seed.sort_order, true
from tenant_sources
cross join seed
on conflict (tenant_id, code) do nothing;
alter table if exists public.project_measurement_orders
  add column if not exists commercial_order_ref text null;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_commercial_order_ref_not_blank_check;

alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_commercial_order_ref_not_blank_check
  check (commercial_order_ref is null or btrim(commercial_order_ref) <> '');

create index if not exists idx_project_measurement_orders_tenant_commercial_ref
  on public.project_measurement_orders (tenant_id, commercial_order_ref)
  where commercial_order_ref is not null;

alter table if exists public.project_measurement_orders
  add column if not exists commercial_process_id uuid null,
  add column if not exists commercial_process_name_snapshot text null,
  add column if not exists commercial_start_time time null,
  add column if not exists commercial_end_time time null;

do $do$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_measurement_orders'
      and tc.constraint_name = 'project_measurement_orders_commercial_process_tenant_fk'
  ) then
    alter table public.project_measurement_orders
      add constraint project_measurement_orders_commercial_process_tenant_fk
      foreign key (commercial_process_id, tenant_id)
      references public.measurement_commercial_processes(id, tenant_id);
  end if;
end;
$do$;

alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_commercial_time_range_check;

-- Turno que atravessa a meia-noite nao e suportado de proposito: a operacao
-- comercial e diurna e a ordem ja e amarrada a UMA data de execucao. Se isso
-- mudar, o par vira timestamptz em vez de virar check mais frouxo.
alter table if exists public.project_measurement_orders
  add constraint project_measurement_orders_commercial_time_range_check
  check (
    commercial_start_time is null
    or commercial_end_time is null
    or commercial_end_time > commercial_start_time
  );

create index if not exists idx_project_measurement_orders_tenant_commercial_process
  on public.project_measurement_orders (tenant_id, commercial_process_id)
  where commercial_process_id is not null;

-- Predicado unico de `equipe e comercial`, usado pelo trigger abaixo e pela RPC.
create or replace function public.is_commercial_team(
  p_tenant_id uuid,
  p_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    join public.team_categories tc
      on tc.id = t.team_category_id
     and tc.tenant_id = t.tenant_id
    where t.tenant_id = p_tenant_id
      and t.id = p_team_id
      and tc.code = 'COMERCIAL'
  );
$$;

revoke all on function public.is_commercial_team(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_commercial_team(uuid, uuid) to service_role;

-- A regra de Projeto obrigatorio sai do CHECK da 382 e vira trigger: agora ela
-- depende da categoria da equipe, e CHECK nao consulta outra tabela. O conteudo
-- da regra para equipe TECNICA e identico ao da 382 -- so a excecao comercial e
-- nova.
--
-- Sao DOIS triggers de proposito, com tempos diferentes:
--
-- (1) `trg_enforce_measurement_project_rules` e BEFORE, imediato, exatamente como
--     o CHECK que ele substitui. A ordem TECNICA continua sendo reprovada na
--     propria instrucao, e nao no commit: mudar isso alteraria em silencio o
--     comportamento de erro de um fluxo que nao faz parte deste pedido.
--
-- (2) `trg_enforce_commercial_measurement_fields` e CONSTRAINT TRIGGER DEFERIDO,
--     porque a ordem comercial nasce em DOIS passos: a RPC comercial grava o
--     cabecalho pela RPC da Medicao (que nao conhece Processo, horarios nem
--     Ordem) e so depois preenche esses campos num UPDATE. Um trigger imediato
--     reprovaria o INSERT intermediario, que ainda esta incompleto. Diferido, a
--     checagem roda no fim da transacao, com a linha ja completa, e continua
--     valendo para escrita que venha de fora da RPC.
alter table if exists public.project_measurement_orders
  drop constraint if exists project_measurement_orders_project_required_by_kind_check;

create or replace function public.enforce_measurement_project_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.measurement_kind = 'COM_PRODUCAO' then
    if new.project_id is not null then
      if nullif(btrim(coalesce(new.project_code_snapshot, '')), '') is null then
        raise exception using
          errcode = '23514',
          message = 'measurement_project_snapshot_required: ordem com projeto precisa do codigo do projeto.';
      end if;

      return new;
    end if;

    if not public.is_commercial_team(new.tenant_id, new.team_id) then
      raise exception using
        errcode = '23514',
        message = 'measurement_project_required: Projeto e obrigatorio para medicao com producao.';
    end if;
  end if;

  -- Sem projeto, nenhum vestigio de projeto/programacao pode sobrar na linha.
  -- Vale para SEM_PRODUCAO (regra da 382) e para a nova COM_PRODUCAO comercial.
  if new.project_id is null and (
    new.programming_id is not null
    or new.project_code_snapshot is not null
    or new.programming_completion_status_snapshot is not null
    or new.programming_completion_status_snapshot_at is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'measurement_project_leftover: ordem sem projeto nao pode manter vinculo de projeto ou programacao.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_measurement_project_rules() from public;

-- Nome depois de `trg_apply_...` de proposito: triggers do mesmo evento disparam
-- em ordem alfabetica, e a validacao precisa ver os snapshots ja aplicados.
drop trigger if exists trg_enforce_measurement_project_by_kind on public.project_measurement_orders;
drop trigger if exists trg_enforce_measurement_context_rules on public.project_measurement_orders;
drop trigger if exists trg_enforce_measurement_project_rules on public.project_measurement_orders;
create trigger trg_enforce_measurement_project_rules
before insert or update on public.project_measurement_orders
for each row execute function public.enforce_measurement_project_rules();

create or replace function public.enforce_commercial_measurement_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Campos proprios da ordem comercial. As colunas sao anulaveis porque a ordem
  -- TECNICA nao os tem; a obrigatoriedade e por categoria e mora aqui.
  if public.is_commercial_team(new.tenant_id, new.team_id) then
    if new.commercial_process_id is null then
      raise exception using
        errcode = '23514',
        message = 'commercial_process_required: Processo e obrigatorio na medicao comercial.';
    end if;

    if new.commercial_start_time is null or new.commercial_end_time is null then
      raise exception using
        errcode = '23514',
        message = 'commercial_time_required: Hora inicio e Hora termino sao obrigatorias na medicao comercial.';
    end if;

    return new;
  end if;

  -- Ordem tecnica nao carrega campo comercial: evita lixo se alguem reaproveitar
  -- a linha trocando a equipe de comercial para tecnica.
  if new.commercial_process_id is not null
    or new.commercial_process_name_snapshot is not null
    or new.commercial_start_time is not null
    or new.commercial_end_time is not null
    or new.commercial_order_ref is not null
  then
    raise exception using
      errcode = '23514',
      message = 'commercial_fields_on_technical_order: ordem de equipe tecnica nao pode ter campos da medicao comercial.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_commercial_measurement_fields() from public;

drop trigger if exists trg_enforce_commercial_measurement_fields on public.project_measurement_orders;
create constraint trigger trg_enforce_commercial_measurement_fields
after insert or update on public.project_measurement_orders
deferrable initially deferred
for each row execute function public.enforce_commercial_measurement_fields();

-- A RPC da Medicao tambem exige projeto em COM_PRODUCAO desde a 382. Mesma
-- cirurgia de texto que a 382 usou, pelo mesmo motivo: o corpo da funcao foi
-- construido por patches sucessivos e nao existe versao integral em nenhuma
-- migration para recriar do zero sem risco de regressao.
do $$
declare
  v_signature regprocedure := 'public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz)'::regprocedure;
  v_definition text;
  v_step text;
begin
  select pg_get_functiondef(v_signature::oid)
  into v_definition;

  v_definition := replace(v_definition, chr(13) || chr(10), chr(10));

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios.' else 'Equipe e data de execucao sao obrigatorias.' end);$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null and not public.is_commercial_team(p_tenant_id, v_team_id)) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios.' else 'Equipe e data de execucao sao obrigatorias.' end);$new$, chr(13) || chr(10), chr(10))
  );

  if v_definition = v_step then
    raise exception '415: guarda de contexto (insert) nao encontrada em save_project_measurement_order';
  end if;

  v_step := v_definition;
  v_definition := replace(
    v_definition,
    replace($old$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios na edicao.' else 'Equipe e data de execucao sao obrigatorias na edicao.' end);$old$, chr(13) || chr(10), chr(10)),
    replace($new$    if v_team_id is null or v_execution_date is null or (v_measurement_kind = 'COM_PRODUCAO' and v_project_id is null and not public.is_commercial_team(p_tenant_id, v_team_id)) then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_MEASUREMENT_CONTEXT', 'message', case when v_measurement_kind = 'COM_PRODUCAO' then 'Projeto, equipe e data de execucao sao obrigatorios na edicao.' else 'Equipe e data de execucao sao obrigatorias na edicao.' end);$new$, chr(13) || chr(10), chr(10))
  );

  if v_definition = v_step then
    raise exception '415: guarda de contexto (update) nao encontrada em save_project_measurement_order';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_project_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz) to service_role;

-- =============================================================================
-- 6) Integrantes da ordem de medicao comercial
-- =============================================================================
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_measurement_orders'
      and tc.constraint_name = 'project_measurement_orders_id_tenant_key'
  ) then
    alter table public.project_measurement_orders
      add constraint project_measurement_orders_id_tenant_key
      unique (id, tenant_id);
  end if;
end;
$$;

create table if not exists public.project_commercial_measurement_order_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- O FK do pedido e composto (id + tenant_id) mais abaixo: garante de uma vez o
  -- vinculo com a ordem E que a linha nao atravesse tenant.
  measurement_order_id uuid not null,
  person_id uuid not null,
  person_name_snapshot text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint project_commercial_members_sort_order_check
    check (sort_order in (1, 2)),
  constraint project_commercial_members_name_not_blank_check
    check (nullif(btrim(coalesce(person_name_snapshot, '')), '') is not null),
  constraint project_commercial_members_order_tenant_fk
    foreign key (measurement_order_id, tenant_id)
    references public.project_measurement_orders(id, tenant_id) on delete cascade,
  constraint project_commercial_members_person_tenant_fk
    foreign key (person_id, tenant_id)
    references public.people(id, tenant_id),
  constraint project_commercial_members_order_slot_key
    unique (tenant_id, measurement_order_id, sort_order),
  constraint project_commercial_members_order_person_key
    unique (tenant_id, measurement_order_id, person_id)
);

create index if not exists idx_project_commercial_members_tenant_order
  on public.project_commercial_measurement_order_members (tenant_id, measurement_order_id, sort_order);

create index if not exists idx_project_commercial_members_tenant_person
  on public.project_commercial_measurement_order_members (tenant_id, person_id);

alter table if exists public.project_commercial_measurement_order_members enable row level security;

drop policy if exists project_commercial_members_tenant_select
  on public.project_commercial_measurement_order_members;
create policy project_commercial_members_tenant_select
on public.project_commercial_measurement_order_members
for select
to authenticated
using (public.user_can_access_tenant(project_commercial_measurement_order_members.tenant_id));

revoke insert, update, delete
  on public.project_commercial_measurement_order_members
  from public, anon, authenticated;

drop trigger if exists trg_project_commercial_members_audit
  on public.project_commercial_measurement_order_members;
create trigger trg_project_commercial_members_audit
before insert or update on public.project_commercial_measurement_order_members
for each row execute function public.apply_audit_fields();

-- =============================================================================
-- 7) RPC da ordem comercial
-- =============================================================================
-- Delega o cabecalho e os itens para `save_project_measurement_order` em vez de
-- duplicar 400 linhas de regra que ja existem e continuam evoluindo. O que esta
-- funcao acrescenta e a validacao da categoria da equipe, a validacao dos dois
-- eletricistas e a gravacao dos integrantes -- tudo na mesma transacao, porque
-- uma chamada de funcao e uma transacao so.
create or replace function public.save_project_commercial_measurement_order(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_measurement_order_id uuid default null,
  p_programming_id uuid default null,
  p_project_id uuid default null,
  p_team_id uuid default null,
  p_execution_date date default null,
  p_measurement_date date default null,
  p_voice_point numeric default null,
  p_manual_rate numeric default null,
  p_notes text default null,
  p_measurement_kind text default 'COM_PRODUCAO',
  p_no_production_reason_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_commercial_employee_1_person_id uuid default null,
  p_commercial_employee_2_person_id uuid default null,
  p_commercial_order_ref text default null,
  p_commercial_process_id uuid default null,
  p_commercial_start_time time default null,
  p_commercial_end_time time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_team_category_code text;
  v_employee_1_name text;
  v_employee_2_name text;
  v_commercial_order_ref text := nullif(btrim(coalesce(p_commercial_order_ref, '')), '');
  v_commercial_process_name text;
begin
  if p_commercial_employee_1_person_id is null or p_commercial_employee_2_person_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_COMMERCIAL_MEMBERS',
      'message', 'Selecione os dois eletricistas da medicao comercial.'
    );
  end if;

  if p_commercial_employee_1_person_id = p_commercial_employee_2_person_id then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'DUPLICATE_COMMERCIAL_MEMBER',
      'message', 'Os dois integrantes da medicao comercial devem ser diferentes.'
    );
  end if;

  if p_commercial_start_time is null or p_commercial_end_time is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'MISSING_COMMERCIAL_TIME',
      'message', 'Informe Hora inicio e Hora termino da medicao comercial.'
    );
  end if;

  if p_commercial_end_time <= p_commercial_start_time then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_COMMERCIAL_TIME_RANGE',
      'message', 'Hora termino deve ser maior que Hora inicio.'
    );
  end if;

  select nullif(btrim(coalesce(cp.name, '')), '')
  into v_commercial_process_name
  from public.measurement_commercial_processes cp
  where cp.id = p_commercial_process_id
    and cp.tenant_id = p_tenant_id
    and cp.ativo = true;

  if v_commercial_process_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_COMMERCIAL_PROCESS',
      'message', 'Processo invalido para o tenant atual.'
    );
  end if;

  select tc.code
  into v_team_category_code
  from public.teams t
  join public.team_categories tc
    on tc.id = t.team_category_id
   and tc.tenant_id = t.tenant_id
  where t.tenant_id = p_tenant_id
    and t.id = p_team_id;

  if v_team_category_code is distinct from 'COMERCIAL' then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_TEAM_CATEGORY',
      'message', 'Selecione uma equipe comercial.'
    );
  end if;

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_employee_1_name
  from public.people p
  join public.job_titles jt
    on jt.id = p.job_title_id
   and jt.tenant_id = p.tenant_id
  where p.id = p_commercial_employee_1_person_id
    and p.tenant_id = p_tenant_id
    and p.ativo = true
    and jt.ativo = true
    and (jt.code ilike '%ELETRICISTA%' or jt.name ilike '%ELETRICISTA%');

  select nullif(btrim(coalesce(p.nome, '')), '')
  into v_employee_2_name
  from public.people p
  join public.job_titles jt
    on jt.id = p.job_title_id
   and jt.tenant_id = p.tenant_id
  where p.id = p_commercial_employee_2_person_id
    and p.tenant_id = p_tenant_id
    and p.ativo = true
    and jt.ativo = true
    and (jt.code ilike '%ELETRICISTA%' or jt.name ilike '%ELETRICISTA%');

  if v_employee_1_name is null or v_employee_2_name is null then
    return jsonb_build_object(
      'success', false,
      'status', 422,
      'reason', 'INVALID_COMMERCIAL_MEMBER',
      'message', 'Integrante invalido: selecione eletricistas ativos do tenant atual.'
    );
  end if;

  v_result := public.save_project_measurement_order(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_measurement_order_id => p_measurement_order_id,
    p_programming_id => p_programming_id,
    p_project_id => p_project_id,
    p_team_id => p_team_id,
    p_execution_date => p_execution_date,
    p_measurement_date => p_measurement_date,
    p_voice_point => p_voice_point,
    p_manual_rate => p_manual_rate,
    p_notes => p_notes,
    p_measurement_kind => p_measurement_kind,
    p_no_production_reason_id => p_no_production_reason_id,
    p_items => p_items,
    p_expected_updated_at => p_expected_updated_at
  );

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    return v_result;
  end if;

  v_order_id := nullif(v_result ->> 'measurement_order_id', '')::uuid;
  if v_order_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 500,
      'reason', 'MISSING_MEASUREMENT_ORDER_ID',
      'message', 'Ordem salva, mas nao foi possivel vincular os integrantes.'
    );
  end if;

  -- `Ordem` e campo da tela comercial: a RPC tecnica nao a conhece, entao ela e
  -- gravada aqui, depois do save do cabecalho. O UPDATE nao dispara
  -- `apply_measurement_team_snapshot`, que so escuta as colunas de contexto.
  update public.project_measurement_orders
  set
    commercial_order_ref = v_commercial_order_ref,
    commercial_process_id = p_commercial_process_id,
    commercial_process_name_snapshot = v_commercial_process_name,
    commercial_start_time = p_commercial_start_time,
    commercial_end_time = p_commercial_end_time
  where tenant_id = p_tenant_id
    and id = v_order_id;

  delete from public.project_commercial_measurement_order_members
  where tenant_id = p_tenant_id
    and measurement_order_id = v_order_id;

  insert into public.project_commercial_measurement_order_members (
    tenant_id,
    measurement_order_id,
    person_id,
    person_name_snapshot,
    sort_order,
    created_by,
    updated_by
  ) values
    (p_tenant_id, v_order_id, p_commercial_employee_1_person_id, v_employee_1_name, 1, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, v_order_id, p_commercial_employee_2_person_id, v_employee_2_name, 2, p_actor_user_id, p_actor_user_id);

  return v_result;
end;
$$;

revoke all on function public.save_project_commercial_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time
) from public, anon, authenticated;

grant execute on function public.save_project_commercial_measurement_order(
  uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time
) to service_role;

-- =============================================================================
-- 8) Pagina Medicao Comercial
-- =============================================================================
-- `default_user_access = false`, conforme a 245: tela nova nasce liberada so
-- para administrador. Por isso a chave NAO entra em `DEFAULT_USER_PAGE_ACCESS`.
insert into public.app_pages (page_key, path, name, section, description, default_user_access)
values (
  'medicao-comercial',
  '/medicao-comercial',
  'Medicao Comercial',
  'Operacao',
  'Ordens de medicao das equipes comerciais, com os dois eletricistas da execucao.',
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
  'medicao-comercial',
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
 and existing.page_key = 'medicao-comercial'
where existing.role_id is null
on conflict (tenant_id, role_id, page_key) do nothing;

-- As 7 colunas de acao andam juntas desde a 253: o toggle da tela de Permissoes
-- liga/desliga todas. Gravar so `can_access` deixaria `can_export`/`can_create`
-- em false e a propria tela responderia 403 para o administrador.
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
  'medicao-comercial',
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
  coalesce(roles.is_admin, false),
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
 and existing.page_key = 'medicao-comercial'
where users.tenant_id is not null
  and existing.user_id is null
on conflict (tenant_id, user_id, page_key) do nothing;

-- =============================================================================
-- Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_team_fn regprocedure := 'public.save_team_record(uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, uuid, uuid)'::regprocedure;
  v_commercial_fn regprocedure := 'public.save_project_commercial_measurement_order(uuid, uuid, uuid, uuid, uuid, uuid, date, date, numeric, numeric, text, text, uuid, jsonb, timestamptz, uuid, uuid, text, uuid, time, time)'::regprocedure;
  v_missing integer;
  v_old_overloads integer;
  v_old_signatures text;
begin
  -- Nenhum tenant pode ficar sem as duas categorias.
  select count(*)
  into v_missing
  from (
    select distinct tenant_id from public.app_users where tenant_id is not null
  ) t
  where not exists (
    select 1 from public.team_categories tc
    where tc.tenant_id = t.tenant_id and tc.code = 'TECNICA' and tc.ativo = true
  )
  or not exists (
    select 1 from public.team_categories tc
    where tc.tenant_id = t.tenant_id and tc.code = 'COMERCIAL' and tc.ativo = true
  );

  if v_missing > 0 then
    raise exception '415: % tenant(s) ficaram sem TECNICA/COMERCIAL em team_categories.', v_missing;
  end if;

  -- Nenhuma equipe existente pode ter ficado sem categoria.
  select count(*)
  into v_missing
  from public.teams
  where team_category_id is null;

  if v_missing > 0 then
    raise exception '415: % equipe(s) ficaram sem team_category_id.', v_missing;
  end if;

  -- O overload antigo de save_team_record nao pode sobrar: com as duas versoes
  -- publicadas o PostgREST nao resolveria a chamada por nome de parametro.
  select count(*), coalesce(string_agg(sig, ' | '), '(nenhuma)')
  into v_old_overloads, v_old_signatures
  from (
    select pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_team_record'
      and p.oid <> v_save_team_fn::oid
  ) leftovers;

  if v_old_overloads > 0 then
    raise exception '415: % versao(oes) antiga(s) de save_team_record ainda publicada(s): %',
      v_old_overloads, v_old_signatures;
  end if;

  if has_function_privilege('anon', v_save_team_fn, 'execute')
     or has_function_privilege('authenticated', v_save_team_fn, 'execute') then
    raise exception '415: save_team_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_commercial_fn, 'execute')
     or has_function_privilege('authenticated', v_commercial_fn, 'execute') then
    raise exception '415: save_project_commercial_measurement_order ainda executavel por anon/authenticated';
  end if;

  if not exists (
    select 1
    from public.app_pages
    where page_key = 'medicao-comercial'
      and ativo = true
  ) then
    raise exception '415: pagina medicao-comercial nao foi cadastrada em app_pages';
  end if;

  -- Catalogo de Processo semeado em todo tenant: sem tela de cadastro, um tenant
  -- sem linha aqui nao conseguiria salvar NENHUMA ordem comercial.
  select count(*)
  into v_missing
  from (
    select distinct tenant_id from public.app_users where tenant_id is not null
  ) t
  where not exists (
    select 1 from public.measurement_commercial_processes cp
    where cp.tenant_id = t.tenant_id and cp.ativo = true
  );

  if v_missing > 0 then
    raise exception '415: % tenant(s) ficaram sem processo comercial semeado.', v_missing;
  end if;
end;
$$;
