-- 127_sync_programming_documents_by_project_date_and_lv_window.sql
-- Sincroniza documentos (SGD/PI/PEP) por Projeto + Data e replica para equipes LV-xx em ate 7 dias.

create index if not exists idx_project_programming_tenant_project_status_execution_date
  on public.project_programming (tenant_id, project_id, status, execution_date);

drop function if exists public.sync_programming_documents_by_project_date_and_lv_window();

create or replace function public.sync_programming_documents_by_project_date_and_lv_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_source_sgd_number text := nullif(btrim(coalesce(new.sgd_number, '')), '');
  v_source_sgd_included_at date := new.sgd_included_at;
  v_source_sgd_delivered_at date := new.sgd_delivered_at;
  v_source_pi_number text := nullif(btrim(coalesce(new.pi_number, '')), '');
  v_source_pi_included_at date := new.pi_included_at;
  v_source_pi_delivered_at date := new.pi_delivered_at;
  v_source_pep_number text := nullif(btrim(coalesce(new.pep_number, '')), '');
  v_source_pep_included_at date := new.pep_included_at;
  v_source_pep_delivered_at date := new.pep_delivered_at;
  v_target record;
  v_changes jsonb;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_actor_user_id := coalesce(new.updated_by, new.created_by);
  else
    v_actor_user_id := coalesce(new.updated_by, new.created_by, old.updated_by, old.created_by);
  end if;

  -- Evita recursao quando a propria sincronizacao atualizar as demais linhas.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Regra vale somente para programacoes ativas.
  if coalesce(new.status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and nullif(btrim(coalesce(old.sgd_number, '')), '') is not distinct from v_source_sgd_number
    and old.sgd_included_at is not distinct from v_source_sgd_included_at
    and old.sgd_delivered_at is not distinct from v_source_sgd_delivered_at
    and nullif(btrim(coalesce(old.pi_number, '')), '') is not distinct from v_source_pi_number
    and old.pi_included_at is not distinct from v_source_pi_included_at
    and old.pi_delivered_at is not distinct from v_source_pi_delivered_at
    and nullif(btrim(coalesce(old.pep_number, '')), '') is not distinct from v_source_pep_number
    and old.pep_included_at is not distinct from v_source_pep_included_at
    and old.pep_delivered_at is not distinct from v_source_pep_delivered_at then
    return new;
  end if;

  for v_target in
    select
      pp.id,
      pp.project_id,
      pp.team_id,
      nullif(btrim(coalesce(pp.sgd_number, '')), '') as sgd_number_norm,
      pp.sgd_included_at,
      pp.sgd_delivered_at,
      nullif(btrim(coalesce(pp.pi_number, '')), '') as pi_number_norm,
      pp.pi_included_at,
      pp.pi_delivered_at,
      nullif(btrim(coalesce(pp.pep_number, '')), '') as pep_number_norm,
      pp.pep_included_at,
      pp.pep_delivered_at
    from public.project_programming pp
    join public.teams t
      on t.tenant_id = pp.tenant_id
     and t.id = pp.team_id
    where pp.tenant_id = new.tenant_id
      and pp.project_id = new.project_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.id <> new.id
      and (
        pp.execution_date = new.execution_date
        or (
          upper(btrim(coalesce(t.name, ''))) like 'LV-%'
          and pp.execution_date > new.execution_date
          and pp.execution_date <= (new.execution_date + 7)
        )
      )
      and (
        nullif(btrim(coalesce(pp.sgd_number, '')), '') is distinct from v_source_sgd_number
        or pp.sgd_included_at is distinct from v_source_sgd_included_at
        or pp.sgd_delivered_at is distinct from v_source_sgd_delivered_at
        or nullif(btrim(coalesce(pp.pi_number, '')), '') is distinct from v_source_pi_number
        or pp.pi_included_at is distinct from v_source_pi_included_at
        or pp.pi_delivered_at is distinct from v_source_pi_delivered_at
        or nullif(btrim(coalesce(pp.pep_number, '')), '') is distinct from v_source_pep_number
        or pp.pep_included_at is distinct from v_source_pep_included_at
        or pp.pep_delivered_at is distinct from v_source_pep_delivered_at
      )
    for update
  loop
    update public.project_programming
    set
      sgd_number = v_source_sgd_number,
      sgd_included_at = v_source_sgd_included_at,
      sgd_delivered_at = v_source_sgd_delivered_at,
      pi_number = v_source_pi_number,
      pi_included_at = v_source_pi_included_at,
      pi_delivered_at = v_source_pi_delivered_at,
      pep_number = v_source_pep_number,
      pep_included_at = v_source_pep_included_at,
      pep_delivered_at = v_source_pep_delivered_at,
      updated_by = v_actor_user_id
    where tenant_id = new.tenant_id
      and id = v_target.id;

    v_changes := '{}'::jsonb;

    if v_target.sgd_number_norm is distinct from v_source_sgd_number then
      v_changes := v_changes || jsonb_build_object(
        'sgdNumber',
        jsonb_build_object(
          'from', v_target.sgd_number_norm,
          'to', v_source_sgd_number
        )
      );
    end if;
    if v_target.sgd_included_at is distinct from v_source_sgd_included_at then
      v_changes := v_changes || jsonb_build_object(
        'sgdApprovedAt',
        jsonb_build_object(
          'from', v_target.sgd_included_at::text,
          'to', v_source_sgd_included_at::text
        )
      );
    end if;
    if v_target.sgd_delivered_at is distinct from v_source_sgd_delivered_at then
      v_changes := v_changes || jsonb_build_object(
        'sgdRequestedAt',
        jsonb_build_object(
          'from', v_target.sgd_delivered_at::text,
          'to', v_source_sgd_delivered_at::text
        )
      );
    end if;

    if v_target.pi_number_norm is distinct from v_source_pi_number then
      v_changes := v_changes || jsonb_build_object(
        'piNumber',
        jsonb_build_object(
          'from', v_target.pi_number_norm,
          'to', v_source_pi_number
        )
      );
    end if;
    if v_target.pi_included_at is distinct from v_source_pi_included_at then
      v_changes := v_changes || jsonb_build_object(
        'piApprovedAt',
        jsonb_build_object(
          'from', v_target.pi_included_at::text,
          'to', v_source_pi_included_at::text
        )
      );
    end if;
    if v_target.pi_delivered_at is distinct from v_source_pi_delivered_at then
      v_changes := v_changes || jsonb_build_object(
        'piRequestedAt',
        jsonb_build_object(
          'from', v_target.pi_delivered_at::text,
          'to', v_source_pi_delivered_at::text
        )
      );
    end if;

    if v_target.pep_number_norm is distinct from v_source_pep_number then
      v_changes := v_changes || jsonb_build_object(
        'pepNumber',
        jsonb_build_object(
          'from', v_target.pep_number_norm,
          'to', v_source_pep_number
        )
      );
    end if;
    if v_target.pep_included_at is distinct from v_source_pep_included_at then
      v_changes := v_changes || jsonb_build_object(
        'pepApprovedAt',
        jsonb_build_object(
          'from', v_target.pep_included_at::text,
          'to', v_source_pep_included_at::text
        )
      );
    end if;
    if v_target.pep_delivered_at is distinct from v_source_pep_delivered_at then
      v_changes := v_changes || jsonb_build_object(
        'pepRequestedAt',
        jsonb_build_object(
          'from', v_target.pep_delivered_at::text,
          'to', v_source_pep_delivered_at::text
        )
      );
    end if;

    if v_changes <> '{}'::jsonb then
      perform public.append_project_programming_history_record(
        p_tenant_id => new.tenant_id,
        p_actor_user_id => v_actor_user_id,
        p_programming_id => v_target.id,
        p_project_id => v_target.project_id,
        p_team_id => v_target.team_id,
        p_related_programming_id => new.id,
        p_action_type => 'UPDATE',
        p_reason => null,
        p_changes => v_changes,
        p_metadata => jsonb_build_object(
          'source', 'document-sync-project-date-lv-window',
          'syncSourceProgrammingId', new.id,
          'scope', 'project+execution_date+lv_7_days',
          'lvWindowDays', 7
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_project_programming_sync_documents on public.project_programming;

create trigger trg_project_programming_sync_documents
after insert or update of
  sgd_number,
  sgd_included_at,
  sgd_delivered_at,
  pi_number,
  pi_included_at,
  pi_delivered_at,
  pep_number,
  pep_included_at,
  pep_delivered_at
on public.project_programming
for each row
execute function public.sync_programming_documents_by_project_date_and_lv_window();
