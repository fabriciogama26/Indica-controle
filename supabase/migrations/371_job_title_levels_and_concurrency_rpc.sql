-- 371_job_title_levels_and_concurrency_rpc.sql
-- Auditoria-Concorrencia/2026-08-15-relatorio.md, achados CRITICOS #1 e #2 (Cargos).
--
-- Achado #1: `job-titles/route.ts` PUT/PATCH eram o UNICO modulo do sistema sem RPC --
-- liam o cargo, comparavam `expectedUpdatedAt` EM MEMORIA, e gravavam com
-- `UPDATE ... WHERE id = X` sem `.eq("updated_at", ...)` nem `SELECT ... FOR UPDATE`.
-- Duas edicoes quase simultaneas do mesmo cargo passavam as duas no pre-check (nenhuma
-- ainda tinha escrito) e a segunda sobrescrevia a primeira sem erro para ninguem.
--
-- Achado #2: o campo "Niveis" do formulario de QUALQUER cargo editava
-- `public.job_levels`, um catalogo UNICO POR TENANT (chave `(tenant_id, level)`, sem
-- `job_title_id`) -- `syncJobLevels` reescrevia a lista inteira do tenant a cada save
-- de um cargo qualquer, podendo apagar niveis que outro cargo tinha acabado de
-- (re)ativar. Confirmado com o usuario que nivel pertence ao CARGO (ex.: Analista
-- Junior/Pleno/Senior), nao ao tenant como lista solta -- e que o modelo de `people`
-- ja tratava assim de fato (job_title_id + job_level juntos na mesma linha desde a
-- migration 014, com identidade duplicada por `(job_title_id, job_level)` desde
-- 056/197), so o catalogo `job_levels` estava desalinhado.
--
-- Correcao: nova tabela `job_title_levels` (chave `(tenant_id, job_title_id, level)`,
-- mesmo padrao de `job_title_types`, migration 047); backfill a partir de `people`
-- (unica fonte confiavel, porque o catalogo antigo nao registra a qual cargo cada
-- nivel pertence); FK de `people.job_level` trocada de `job_levels(tenant_id, level)`
-- para `job_title_levels(tenant_id, job_title_id, level)`; RPCs novas
-- `save_job_title_record`/`set_job_title_record_status` com `SELECT ... FOR UPDATE` +
-- `expectedUpdatedAt` obrigatorio, gravando cargo + tipos + niveis + historico na
-- MESMA transacao (guia_backend.md regra 11). `job_levels` (tabela antiga) e MANTIDA
-- intacta nesta migration -- so removida depois de confirmar em producao que o
-- backfill bate; nao ha `drop table` aqui.

-- =============================================================================
-- 1) Tabela job_title_levels (mesmo padrao de job_title_types, migration 047)
-- =============================================================================
create table if not exists public.job_title_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_title_id uuid not null,
  level text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  unique (tenant_id, job_title_id, level)
);

alter table if exists public.job_title_levels
  drop constraint if exists chk_job_title_levels_level_not_blank;
alter table if exists public.job_title_levels
  add constraint chk_job_title_levels_level_not_blank
  check (btrim(level) <> '');

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_title_levels'
      and tc.constraint_name = 'job_title_levels_tenant_id_fk'
  ) then
    alter table public.job_title_levels
      add constraint job_title_levels_tenant_id_fk
      foreign key (tenant_id) references public.tenants(id);
  end if;
end;
$$;

-- Reaproveita job_titles_id_tenant_key (unique(id, tenant_id), criada na migration 047)
-- -- ja existe, nao precisa recriar.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'job_title_levels'
      and tc.constraint_name = 'job_title_levels_job_title_tenant_fk'
  ) then
    alter table public.job_title_levels
      add constraint job_title_levels_job_title_tenant_fk
      foreign key (job_title_id, tenant_id)
      references public.job_titles(id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_job_title_levels_tenant_active
  on public.job_title_levels (tenant_id, job_title_id, ativo, level);

alter table if exists public.job_title_levels enable row level security;

drop policy if exists job_title_levels_tenant_select on public.job_title_levels;
create policy job_title_levels_tenant_select on public.job_title_levels
for select
to authenticated
using (public.user_can_access_tenant(job_title_levels.tenant_id));

drop policy if exists job_title_levels_tenant_write on public.job_title_levels;
create policy job_title_levels_tenant_write on public.job_title_levels
for all
to authenticated
using (public.user_can_access_tenant(job_title_levels.tenant_id))
with check (public.user_can_access_tenant(job_title_levels.tenant_id));

drop trigger if exists trg_job_title_levels_audit on public.job_title_levels;
create trigger trg_job_title_levels_audit before insert or update on public.job_title_levels
for each row execute function public.apply_audit_fields();

-- =============================================================================
-- 2) Backfill a partir de people (unica fonte confiavel de "qual cargo usa qual nivel")
-- =============================================================================
insert into public.job_title_levels (tenant_id, job_title_id, level, ativo)
select distinct p.tenant_id, p.job_title_id, p.job_level, true
from public.people p
where p.job_level is not null
on conflict (tenant_id, job_title_id, level) do nothing;

-- Niveis do catalogo antigo sem nenhuma pessoa usando: nao tem job_title_id conhecido,
-- por isso nao entram no backfill automatico. Reportados aqui, nao escondidos --
-- cada tenant precisa reconfigurar manualmente o nivel certo no(s) cargo(s) apos o
-- deploy, se ainda fizer sentido.
do $$
declare
  v_orphan record;
  v_orphan_count integer := 0;
begin
  for v_orphan in
    select jl.tenant_id, jl.level
    from public.job_levels jl
    where jl.ativo = true
      and not exists (
        select 1
        from public.people p
        where p.tenant_id = jl.tenant_id
          and p.job_level = jl.level
      )
    order by jl.tenant_id, jl.level
  loop
    v_orphan_count := v_orphan_count + 1;
    raise notice 'Migration 371: nivel orfao nao migrado automaticamente -- tenant=%, level=%. Nenhuma pessoa usa esse nivel hoje, entao nao ha job_title_id conhecido para associar. Reconfigure manualmente no cargo correto apos o deploy, se ainda for necessario.',
      v_orphan.tenant_id, v_orphan.level;
  end loop;

  if v_orphan_count > 0 then
    raise notice 'Migration 371: total de % nivel(is) orfao(s) do catalogo antigo job_levels nao migrado(s) automaticamente (ver mensagens acima).', v_orphan_count;
  else
    raise notice 'Migration 371: nenhum nivel orfao encontrado -- todo o catalogo antigo estava em uso por pelo menos uma pessoa.';
  end if;
end;
$$;

-- =============================================================================
-- 3) people.job_level: FK trocada de job_levels(tenant_id, level) para
--    job_title_levels(tenant_id, job_title_id, level)
-- =============================================================================
alter table public.people
  drop constraint if exists people_job_level_tenant_fk;

alter table public.people
  add constraint people_job_level_job_title_tenant_fk
  foreign key (tenant_id, job_title_id, job_level)
  references public.job_title_levels (tenant_id, job_title_id, level);

-- =============================================================================
-- 4) save_job_title_record: RPC com SELECT ... FOR UPDATE + expectedUpdatedAt
--    obrigatorio, gravando cargo + tipos + niveis + historico na mesma transacao.
--    Normalizacao de codigo (job title e tipos) continua em JS (normalizeCode em
--    job-titles/route.ts) -- p_types ja chega com {code, name} prontos, para nao
--    reimplementar NFD/regex de normalizacao em PL/pgSQL.
-- =============================================================================
create or replace function public.save_job_title_record(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_job_title_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_types jsonb default '[]'::jsonb,
  p_levels text[] default array[]::text[],
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.job_titles%rowtype;
  v_job_title_id uuid := p_job_title_id;
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_levels text[] := coalesce(p_levels, array[]::text[]);
  v_old_types_text text;
  v_old_levels_text text;
  v_new_types_text text;
  v_new_levels_text text;
  v_changes jsonb;
  v_updated_at timestamptz;
  v_constraint_name text;
begin
  if v_code is null or v_name is null or jsonb_array_length(coalesce(p_types, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'MISSING_REQUIRED_FIELDS', 'message', 'Preencha codigo, nome e ao menos um tipo do cargo.');
  end if;

  select string_agg(elem ->> 'name', ', ' order by elem ->> 'name')
  into v_new_types_text
  from jsonb_array_elements(p_types) as elem;

  select string_agg(lvl, ', ' order by lvl)
  into v_new_levels_text
  from unnest(v_levels) as lvl;

  if v_job_title_id is null then
    insert into public.job_titles (tenant_id, code, name, ativo, created_by, updated_by)
    values (p_tenant_id, v_code, v_name, true, p_actor_user_id, p_actor_user_id)
    returning id, updated_at into v_job_title_id, v_updated_at;
  else
    select * into v_current
    from public.job_titles
    where tenant_id = p_tenant_id and id = v_job_title_id
    for update;

    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'reason', 'JOB_TITLE_NOT_FOUND', 'message', 'Cargo nao encontrado.');
    end if;

    if p_expected_updated_at is null then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de editar o cargo.');
    end if;

    if v_current.updated_at <> p_expected_updated_at then
      return jsonb_build_object(
        'success', false,
        'status', 409,
        'reason', 'CONCURRENT_MODIFICATION',
        'message', format('O cargo %s foi alterado por outro usuario. Recarregue os dados antes de salvar novamente.', v_current.name)
      );
    end if;

    if not v_current.ativo then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'RECORD_INACTIVE', 'message', 'Ative o cargo antes de editar.');
    end if;

    select string_agg(name, ', ' order by name)
    into v_old_types_text
    from public.job_title_types
    where tenant_id = p_tenant_id and job_title_id = v_job_title_id and ativo = true;

    select string_agg(level, ', ' order by level)
    into v_old_levels_text
    from public.job_title_levels
    where tenant_id = p_tenant_id and job_title_id = v_job_title_id and ativo = true;

    update public.job_titles
    set code = v_code, name = v_name, updated_by = p_actor_user_id
    where tenant_id = p_tenant_id and id = v_job_title_id
    returning updated_at into v_updated_at;
  end if;

  -- Sync tipos (upsert + desativar o que sair da lista) -- mesma logica de
  -- syncJobTitleTypes, agora dentro da mesma transacao do cargo.
  insert into public.job_title_types (tenant_id, job_title_id, code, name, ativo, updated_by)
  select p_tenant_id, v_job_title_id, (elem ->> 'code'), (elem ->> 'name'), true, p_actor_user_id
  from jsonb_array_elements(p_types) as elem
  on conflict (tenant_id, job_title_id, code) do update
    set name = excluded.name, ativo = true, updated_by = excluded.updated_by;

  update public.job_title_types
  set ativo = false, updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and job_title_id = v_job_title_id
    and ativo = true
    and not exists (
      select 1 from jsonb_array_elements(p_types) as elem2
      where (elem2 ->> 'code') = job_title_types.code
    );

  -- Sync niveis (upsert + desativar o que sair da lista), escopado por job_title_id --
  -- resolve o achado CRITICO #2: cada cargo so mexe nos proprios niveis.
  insert into public.job_title_levels (tenant_id, job_title_id, level, ativo, updated_by)
  select p_tenant_id, v_job_title_id, lvl, true, p_actor_user_id
  from unnest(v_levels) as lvl
  on conflict (tenant_id, job_title_id, level) do update
    set ativo = true, updated_by = excluded.updated_by;

  update public.job_title_levels
  set ativo = false, updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and job_title_id = v_job_title_id
    and ativo = true
    and level <> all(v_levels);

  if p_job_title_id is not null then
    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'code', case when v_current.code is distinct from v_code then jsonb_build_object('from', v_current.code, 'to', v_code) end,
      'name', case when v_current.name is distinct from v_name then jsonb_build_object('from', v_current.name, 'to', v_name) end,
      'types', case when v_old_types_text is distinct from v_new_types_text then jsonb_build_object('from', v_old_types_text, 'to', v_new_types_text) end,
      'levels', case when v_old_levels_text is distinct from v_new_levels_text then jsonb_build_object('from', v_old_levels_text, 'to', v_new_levels_text) end
    ));

    if v_changes <> '{}'::jsonb then
      insert into public.app_entity_history (
        tenant_id, module_key, entity_table, entity_id, entity_code, change_type, reason, changes, metadata, created_by, updated_by
      ) values (
        p_tenant_id, 'cargo', 'job_titles', v_job_title_id, v_code, 'UPDATE', null, v_changes, '{}'::jsonb, p_actor_user_id, p_actor_user_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'job_title_id', v_job_title_id,
    'updated_at', v_updated_at,
    'message', case when p_job_title_id is null then format('Cargo %s cadastrado com sucesso.', v_name) else format('Cargo %s atualizado com sucesso.', v_name) end
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'job_titles_tenant_id_code_key' then
      return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_CODE', 'message', 'Ja existe cargo com este codigo no tenant atual.');
    end if;
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'DUPLICATE_VALUE', 'message', 'Registro duplicado ao salvar o cargo.');
end;
$$;

revoke all on function public.save_job_title_record(
  uuid, uuid, uuid, text, text, jsonb, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.save_job_title_record(
  uuid, uuid, uuid, text, text, jsonb, text[], timestamptz
) to service_role;

-- =============================================================================
-- 5) set_job_title_record_status: cancelar/ativar, mesmo padrao de FOR UPDATE +
--    expectedUpdatedAt obrigatorio.
-- =============================================================================
create or replace function public.set_job_title_record_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_job_title_id uuid,
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
  v_current public.job_titles%rowtype;
  v_action text := case when upper(coalesce(p_action, '')) = 'ACTIVATE' then 'ACTIVATE' else 'CANCEL' end;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_event_timestamp timestamptz := now();
  v_updated_at timestamptz;
  v_changes jsonb;
begin
  if p_job_title_id is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'JOB_TITLE_NOT_FOUND', 'message', 'Cargo invalido para atualizar status.');
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'success', false, 'status', 400,
      'reason', case when v_action = 'ACTIVATE' then 'ACTIVATION_REASON_REQUIRED' else 'CANCELLATION_REASON_REQUIRED' end,
      'message', case when v_action = 'ACTIVATE' then 'Informe o motivo da ativacao.' else 'Informe o motivo do cancelamento.' end
    );
  end if;

  select * into v_current
  from public.job_titles
  where tenant_id = p_tenant_id and id = p_job_title_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'reason', 'JOB_TITLE_NOT_FOUND', 'message', 'Cargo nao encontrado.');
  end if;

  if p_expected_updated_at is null then
    return jsonb_build_object('success', false, 'status', 400, 'reason', 'EXPECTED_UPDATED_AT_REQUIRED', 'message', 'Atualize a lista antes de alterar o status do cargo.');
  end if;

  if v_current.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'CONCURRENT_MODIFICATION',
      'message', format('O cargo %s foi alterado por outro usuario. Recarregue os dados antes de alterar o status.', v_current.name)
    );
  end if;

  if v_action = 'CANCEL' and not v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Cargo %s ja esta inativo.', v_current.name));
  end if;

  if v_action = 'ACTIVATE' and v_current.ativo then
    return jsonb_build_object('success', false, 'status', 409, 'reason', 'STATUS_ALREADY_CHANGED', 'message', format('Cargo %s ja esta ativo.', v_current.name));
  end if;

  update public.job_titles
  set
    ativo = case when v_action = 'ACTIVATE' then true else false end,
    cancellation_reason = case when v_action = 'ACTIVATE' then null else v_reason end,
    canceled_at = case when v_action = 'ACTIVATE' then null else v_event_timestamp end,
    canceled_by = case when v_action = 'ACTIVATE' then null else p_actor_user_id end,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id and id = p_job_title_id
  returning updated_at into v_updated_at;

  v_changes := jsonb_build_object(
    'isActive', jsonb_build_object('from', v_current.ativo::text, 'to', (v_action = 'ACTIVATE')::text),
    'cancellationReason', jsonb_build_object('from', v_current.cancellation_reason, 'to', case when v_action = 'ACTIVATE' then null else v_reason end),
    'canceledAt', jsonb_build_object('from', v_current.canceled_at, 'to', case when v_action = 'ACTIVATE' then null else v_event_timestamp end)
  ) || case when v_action = 'ACTIVATE' then jsonb_build_object('activationReason', jsonb_build_object('from', null, 'to', v_reason)) else '{}'::jsonb end;

  insert into public.app_entity_history (
    tenant_id, module_key, entity_table, entity_id, entity_code, change_type, reason, changes, metadata, created_by, updated_by
  ) values (
    p_tenant_id, 'cargo', 'job_titles', p_job_title_id, v_current.code, v_action, v_reason, v_changes, '{}'::jsonb, p_actor_user_id, p_actor_user_id
  );

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'job_title_id', p_job_title_id,
    'updated_at', v_updated_at,
    'message', case when v_action = 'ACTIVATE' then format('Cargo %s ativado com sucesso.', v_current.name) else format('Cargo %s cancelado com sucesso.', v_current.name) end
  );
end;
$$;

revoke all on function public.set_job_title_record_status(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.set_job_title_record_status(
  uuid, uuid, uuid, text, text, timestamptz
) to service_role;

-- =============================================================================
-- 6) Validacao pos-aplicacao
-- =============================================================================
do $$
declare
  v_save_fn regprocedure := 'public.save_job_title_record(uuid, uuid, uuid, text, text, jsonb, text[], timestamptz)'::regprocedure;
  v_status_fn regprocedure := 'public.set_job_title_record_status(uuid, uuid, uuid, text, text, timestamptz)'::regprocedure;
  v_people_sem_backfill bigint;
begin
  if has_function_privilege('anon', v_save_fn, 'execute')
     or has_function_privilege('authenticated', v_save_fn, 'execute') then
    raise exception '371: save_job_title_record ainda executavel por anon/authenticated';
  end if;

  if has_function_privilege('anon', v_status_fn, 'execute')
     or has_function_privilege('authenticated', v_status_fn, 'execute') then
    raise exception '371: set_job_title_record_status ainda executavel por anon/authenticated';
  end if;

  select count(*)
  into v_people_sem_backfill
  from public.people p
  where p.job_level is not null
    and not exists (
      select 1 from public.job_title_levels jtl
      where jtl.tenant_id = p.tenant_id
        and jtl.job_title_id = p.job_title_id
        and jtl.level = p.job_level
    );

  if v_people_sem_backfill > 0 then
    raise exception '371: % linha(s) de people com job_level sem job_title_levels correspondente -- backfill incompleto, FK teria falhado.', v_people_sem_backfill;
  end if;

  raise notice '371: backfill de job_title_levels concluido, FK de people.job_level revalidada com sucesso.';
end
$$;
