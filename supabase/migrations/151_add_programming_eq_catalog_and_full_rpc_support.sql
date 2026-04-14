-- 151_add_programming_eq_catalog_and_full_rpc_support.sql
-- Cria catalogo de Nº EQ, adiciona coluna na Programacao e integra no fluxo full RPC.

create table if not exists public.programming_eq_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  label_pt text not null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  constraint programming_eq_catalog_code_not_blank_check
    check (nullif(btrim(coalesce(code, '')), '') is not null),
  constraint programming_eq_catalog_label_not_blank_check
    check (nullif(btrim(coalesce(label_pt, '')), '') is not null),
  constraint programming_eq_catalog_sort_order_check
    check (sort_order >= 0),
  constraint programming_eq_catalog_tenant_code_key
    unique (tenant_id, code)
);

create index if not exists idx_programming_eq_catalog_tenant_active_order
  on public.programming_eq_catalog (tenant_id, is_active, sort_order, label_pt);

alter table if exists public.programming_eq_catalog enable row level security;

drop policy if exists programming_eq_catalog_tenant_select on public.programming_eq_catalog;
create policy programming_eq_catalog_tenant_select on public.programming_eq_catalog
for select
to authenticated
using (public.user_can_access_tenant(programming_eq_catalog.tenant_id));

drop policy if exists programming_eq_catalog_tenant_insert on public.programming_eq_catalog;
create policy programming_eq_catalog_tenant_insert on public.programming_eq_catalog
for insert
to authenticated
with check (public.user_can_access_tenant(programming_eq_catalog.tenant_id));

drop policy if exists programming_eq_catalog_tenant_update on public.programming_eq_catalog;
create policy programming_eq_catalog_tenant_update on public.programming_eq_catalog
for update
to authenticated
using (public.user_can_access_tenant(programming_eq_catalog.tenant_id))
with check (public.user_can_access_tenant(programming_eq_catalog.tenant_id));

drop trigger if exists trg_programming_eq_catalog_audit on public.programming_eq_catalog;
create trigger trg_programming_eq_catalog_audit
before insert or update on public.programming_eq_catalog
for each row execute function public.apply_audit_fields();

insert into public.programming_eq_catalog (
  tenant_id,
  code,
  label_pt,
  is_active,
  sort_order
)
select
  t.id as tenant_id,
  base.code,
  base.label_pt,
  true as is_active,
  base.sort_order
from public.tenants t
cross join (
  values
    ('#CHAVE', '#CHAVE', 10),
    ('#RELIGADOR', '#RELIGADOR', 20),
    ('#FUSIVEL', '#FUSÍVEL', 30),
    ('#TRAFO', '#TRAFO', 40),
    ('#FACA', '#FACA', 50)
) as base(code, label_pt, sort_order)
on conflict (tenant_id, code) do update
set
  label_pt = excluded.label_pt,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table if exists public.project_programming
  add column if not exists electrical_eq_catalog_id uuid;

alter table if exists public.project_programming
  drop constraint if exists project_programming_electrical_eq_catalog_id_fkey;

alter table if exists public.project_programming
  add constraint project_programming_electrical_eq_catalog_id_fkey
  foreign key (electrical_eq_catalog_id)
  references public.programming_eq_catalog(id)
  on delete set null;

create index if not exists idx_project_programming_tenant_eq_catalog
  on public.project_programming (tenant_id, electrical_eq_catalog_id);

drop function if exists public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
);

create or replace function public.set_project_programming_electrical_eq_catalog(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_programming_id uuid,
  p_electrical_eq_catalog_id uuid default null,
  p_history_action text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := coalesce(upper(nullif(btrim(coalesce(p_history_action, '')), '')), 'UPDATE');
  v_history_metadata jsonb := case
    when jsonb_typeof(coalesce(p_history_metadata, '{}'::jsonb)) = 'object' then coalesce(p_history_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_previous_catalog_id uuid;
  v_previous_code text;
  v_next_code text;
  v_project_id uuid;
  v_team_id uuid;
  v_updated_at timestamptz;
  v_history_id uuid;
  v_changes jsonb;
  v_history_result jsonb;
begin
  if p_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'PROGRAMMING_ID_REQUIRED',
      'message', 'Programacao invalida para salvar Nº EQ.'
    );
  end if;

  if p_electrical_eq_catalog_id is not null then
    select c.code
    into v_next_code
    from public.programming_eq_catalog c
    where c.tenant_id = p_tenant_id
      and c.id = p_electrical_eq_catalog_id
      and c.is_active = true;

    if v_next_code is null then
      return jsonb_build_object(
        'success', false,
        'status', 400,
        'reason', 'INVALID_EQ_CATALOG',
        'message', 'Selecione um Nº EQ valido para o tenant atual.'
      );
    end if;
  end if;

  select
    pp.electrical_eq_catalog_id,
    prev.code,
    pp.project_id,
    pp.team_id
  into
    v_previous_catalog_id,
    v_previous_code,
    v_project_id,
    v_team_id
  from public.project_programming pp
  left join public.programming_eq_catalog prev
    on prev.id = pp.electrical_eq_catalog_id
   and prev.tenant_id = pp.tenant_id
  where pp.tenant_id = p_tenant_id
    and pp.id = p_programming_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'PROGRAMMING_NOT_FOUND',
      'message', 'Programacao nao encontrada para o tenant atual.'
    );
  end if;

  update public.project_programming
  set
    electrical_eq_catalog_id = p_electrical_eq_catalog_id,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = p_programming_id
  returning updated_at
  into v_updated_at;

  if v_previous_catalog_id is distinct from p_electrical_eq_catalog_id then
    v_changes := jsonb_build_object(
      'electricalEq',
      jsonb_build_object(
        'from', v_previous_code,
        'to', v_next_code
      )
    );

    select ph.id
    into v_history_id
    from public.project_programming_history ph
    where ph.tenant_id = p_tenant_id
      and ph.programming_id = p_programming_id
    order by ph.created_at desc
    limit 1;

    if v_history_id is not null then
      update public.project_programming_history
      set
        changes = coalesce(changes, '{}'::jsonb) || v_changes,
        metadata = coalesce(metadata, '{}'::jsonb) || v_history_metadata
      where id = v_history_id;
    else
      v_history_result := public.append_project_programming_history_record(
        p_tenant_id,
        p_actor_user_id,
        p_programming_id,
        v_project_id,
        v_team_id,
        null,
        v_action,
        nullif(btrim(coalesce(p_history_reason, '')), ''),
        v_changes,
        v_history_metadata,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      );

      if coalesce((v_history_result ->> 'success')::boolean, false) = false then
        return jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 400),
          'reason', coalesce(v_history_result ->> 'reason', 'PROGRAMMING_HISTORY_SAVE_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do Nº EQ.')
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'programming_id', p_programming_id,
    'electrical_eq_catalog_id', p_electrical_eq_catalog_id,
    'electrical_eq_code', coalesce(v_next_code, ''),
    'updated_at', v_updated_at,
    'message', 'Nº EQ salvo com sucesso.'
  );
end;
$$;

revoke all on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public;

grant execute on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) to authenticated;

grant execute on function public.set_project_programming_electrical_eq_catalog(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb
) to service_role;

drop function if exists public.save_project_programming_full(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
);

create or replace function public.save_project_programming_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_id uuid,
  p_execution_date date,
  p_period text,
  p_start_time time,
  p_end_time time,
  p_expected_minutes integer,
  p_feeder text default null,
  p_support text default null,
  p_note text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_programming_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null,
  p_history_action_override text default null,
  p_history_reason text default null,
  p_history_metadata jsonb default '{}'::jsonb,
  p_campo_eletrico text default null,
  p_electrical_eq_catalog_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_base_result jsonb;
  v_programming_id uuid;
  v_action text;
  v_electrical_result jsonb;
  v_eq_result jsonb;
  v_structured_error jsonb;
begin
  v_base_result := public.save_project_programming_full(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_id,
    p_execution_date,
    p_period,
    p_start_time,
    p_end_time,
    p_expected_minutes,
    p_feeder,
    p_support,
    p_note,
    p_documents,
    p_activities,
    p_programming_id,
    p_expected_updated_at,
    p_support_item_id,
    p_poste_qty,
    p_estrutura_qty,
    p_trafo_qty,
    p_rede_qty,
    p_affected_customers,
    p_sgd_type_id,
    p_outage_start_time,
    p_outage_end_time,
    p_service_description,
    p_etapa_number,
    p_work_completion_status,
    p_history_action_override,
    p_history_reason,
    p_history_metadata
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return v_base_result;
  end if;

  v_programming_id := nullif(v_base_result ->> 'programming_id', '')::uuid;
  if v_programming_id is null then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', 500,
        'reason', 'SAVE_PROGRAMMING_FULL_INVALID_RESULT',
        'message', 'Falha ao recuperar o ID da programacao salva.'
      )::text;
  end if;

  v_action := coalesce(
    nullif(upper(btrim(coalesce(p_history_action_override, ''))), ''),
    case
      when upper(coalesce(v_base_result ->> 'action', 'UPDATE')) = 'INSERT' then 'CREATE'
      else 'UPDATE'
    end
  );

  if v_campo_eletrico is not null then
    v_electrical_result := public.set_project_programming_campo_eletrico(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      v_campo_eletrico,
      v_action,
      p_history_reason,
      p_history_metadata
    );

    if coalesce((v_electrical_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_electrical_result ->> 'status')::integer, 400),
          'reason', coalesce(v_electrical_result ->> 'reason', 'SET_ELECTRICAL_FIELD_FAILED'),
          'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Ponto eletrico da programacao.')
        )::text;
    end if;
  end if;

  if p_electrical_eq_catalog_id is not null then
    v_eq_result := public.set_project_programming_electrical_eq_catalog(
      p_tenant_id,
      p_actor_user_id,
      v_programming_id,
      p_electrical_eq_catalog_id,
      v_action,
      p_history_reason,
      p_history_metadata
    );

    if coalesce((v_eq_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_eq_result ->> 'status')::integer, 400),
          'reason', coalesce(v_eq_result ->> 'reason', 'SET_EQ_CATALOG_FAILED'),
          'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar Nº EQ da programacao.')
        )::text;
    end if;
  end if;

  return v_base_result || jsonb_build_object(
    'updated_at',
    coalesce(
      v_eq_result ->> 'updated_at',
      v_electrical_result ->> 'updated_at',
      v_base_result ->> 'updated_at'
    )
  );
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'SAVE_PROGRAMMING_FULL_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao salvar programacao em transacao unica.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'SAVE_PROGRAMMING_FULL_FAILED',
          'message', 'Falha ao salvar programacao em transacao unica.'
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_full(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) from public;

grant execute on function public.save_project_programming_full(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) to authenticated;

grant execute on function public.save_project_programming_full(
  uuid,
  uuid,
  uuid,
  uuid,
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  timestamptz,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  text,
  jsonb,
  text,
  uuid
) to service_role;

drop function if exists public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  uuid
);

create or replace function public.save_project_programming_batch_full(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_team_ids uuid[],
  p_execution_date date,
  p_period text,
  p_start_time time,
  p_end_time time,
  p_expected_minutes integer,
  p_feeder text default null,
  p_support text default null,
  p_note text default null,
  p_documents jsonb default '{}'::jsonb,
  p_activities jsonb default '[]'::jsonb,
  p_support_item_id uuid default null,
  p_poste_qty integer default 0,
  p_estrutura_qty integer default 0,
  p_trafo_qty integer default 0,
  p_rede_qty integer default 0,
  p_affected_customers integer default 0,
  p_sgd_type_id uuid default null,
  p_outage_start_time time default null,
  p_outage_end_time time default null,
  p_service_description text default null,
  p_etapa_number integer default null,
  p_work_completion_status text default null,
  p_campo_eletrico text default null,
  p_electrical_eq_catalog_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo_eletrico text := nullif(btrim(coalesce(p_campo_eletrico, '')), '');
  v_base_result jsonb;
  v_item jsonb;
  v_programming_id uuid;
  v_electrical_result jsonb;
  v_eq_result jsonb;
  v_structured_error jsonb;
begin
  v_base_result := public.save_project_programming_batch_full(
    p_tenant_id,
    p_actor_user_id,
    p_project_id,
    p_team_ids,
    p_execution_date,
    p_period,
    p_start_time,
    p_end_time,
    p_expected_minutes,
    p_feeder,
    p_support,
    p_note,
    p_documents,
    p_activities,
    p_support_item_id,
    p_poste_qty,
    p_estrutura_qty,
    p_trafo_qty,
    p_rede_qty,
    p_affected_customers,
    p_sgd_type_id,
    p_outage_start_time,
    p_outage_end_time,
    p_service_description,
    p_etapa_number,
    p_work_completion_status
  );

  if coalesce((v_base_result ->> 'success')::boolean, false) = false then
    return v_base_result;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_base_result -> 'items', '[]'::jsonb))
  loop
    v_programming_id := nullif(v_item ->> 'programmingId', '')::uuid;

    if v_programming_id is null then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_INVALID_RESULT',
          'message', 'Falha ao recuperar o ID da programacao cadastrada.'
        )::text;
    end if;

    if v_campo_eletrico is not null then
      v_electrical_result := public.set_project_programming_campo_eletrico(
        p_tenant_id,
        p_actor_user_id,
        v_programming_id,
        v_campo_eletrico,
        'BATCH_CREATE',
        null,
        jsonb_build_object('source', 'programacao-simples', 'mode', 'batch')
      );

      if coalesce((v_electrical_result ->> 'success')::boolean, false) = false then
        raise exception '%',
          jsonb_build_object(
            'success', false,
            'status', coalesce((v_electrical_result ->> 'status')::integer, 400),
            'reason', coalesce(v_electrical_result ->> 'reason', 'SET_ELECTRICAL_FIELD_FAILED'),
            'message', coalesce(v_electrical_result ->> 'message', 'Falha ao salvar Ponto eletrico em uma das equipes.')
          )::text;
      end if;
    end if;

    if p_electrical_eq_catalog_id is not null then
      v_eq_result := public.set_project_programming_electrical_eq_catalog(
        p_tenant_id,
        p_actor_user_id,
        v_programming_id,
        p_electrical_eq_catalog_id,
        'BATCH_CREATE',
        null,
        jsonb_build_object('source', 'programacao-simples', 'mode', 'batch')
      );

      if coalesce((v_eq_result ->> 'success')::boolean, false) = false then
        raise exception '%',
          jsonb_build_object(
            'success', false,
            'status', coalesce((v_eq_result ->> 'status')::integer, 400),
            'reason', coalesce(v_eq_result ->> 'reason', 'SET_EQ_CATALOG_FAILED'),
            'message', coalesce(v_eq_result ->> 'message', 'Falha ao salvar Nº EQ em uma das equipes.')
          )::text;
      end if;
    end if;
  end loop;

  return v_base_result;
exception
  when others then
    begin
      v_structured_error := nullif(sqlerrm, '')::jsonb;
      return jsonb_build_object(
        'success', false,
        'status', coalesce((v_structured_error ->> 'status')::integer, 500),
        'reason', coalesce(v_structured_error ->> 'reason', 'BATCH_FULL_CREATE_FAILED'),
        'message', coalesce(v_structured_error ->> 'message', 'Falha ao cadastrar programacao em lote.')
      );
    exception
      when others then
        return jsonb_build_object(
          'success', false,
          'status', 500,
          'reason', 'BATCH_FULL_CREATE_FAILED',
          'message', 'Falha ao cadastrar programacao em lote.'
        );
    end;
end;
$$;

revoke all on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  uuid
) from public;

grant execute on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  uuid
) to authenticated;

grant execute on function public.save_project_programming_batch_full(
  uuid,
  uuid,
  uuid,
  uuid[],
  date,
  text,
  time,
  time,
  integer,
  text,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  integer,
  integer,
  integer,
  integer,
  integer,
  uuid,
  time,
  time,
  text,
  integer,
  text,
  text,
  uuid
) to service_role;
