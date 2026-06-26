-- 272_harden_anticipated_work_completion_status.sql
-- Blinda Estado Trabalho ANTECIPADO com rastreio da conclusao que o justificou.

alter table public.project_programming
  add column if not exists anticipated_by_programming_id uuid,
  add column if not exists anticipated_at timestamptz,
  add column if not exists previous_work_completion_status text;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_programming'
      and tc.constraint_name = 'project_programming_anticipated_by_programming_id_fk'
  ) then
    alter table public.project_programming
      add constraint project_programming_anticipated_by_programming_id_fk
      foreign key (anticipated_by_programming_id)
      references public.project_programming(id);
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints tc
    where tc.table_schema = 'public'
      and tc.table_name = 'project_programming'
      and tc.constraint_name = 'project_programming_previous_work_completion_status_fkey'
  ) then
    alter table public.project_programming
      add constraint project_programming_previous_work_completion_status_fkey
      foreign key (tenant_id, previous_work_completion_status)
      references public.programming_work_completion_catalog(tenant_id, code);
  end if;
end;
$$;

create index if not exists idx_project_programming_tenant_anticipated_by
  on public.project_programming (tenant_id, anticipated_by_programming_id)
  where anticipated_by_programming_id is not null;

create index if not exists idx_project_programming_tenant_project_stage_work
  on public.project_programming (tenant_id, project_id, etapa_number, work_completion_status)
  where etapa_number is not null;

with anticipated as (
  select
    pp.id,
    pp.tenant_id,
    source.id as source_programming_id
  from public.project_programming pp
  cross join lateral (
    select previous_pp.id
    from public.project_programming previous_pp
    where previous_pp.tenant_id = pp.tenant_id
      and previous_pp.project_id = pp.project_id
      and previous_pp.id <> pp.id
      and previous_pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and previous_pp.etapa_number is not null
      and pp.etapa_number is not null
      and previous_pp.etapa_number < pp.etapa_number
      and (
        public.normalize_programming_work_completion_code(previous_pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(previous_pp.work_completion_status) like 'CONCLUIDO%'
      )
    order by previous_pp.etapa_number desc, previous_pp.updated_at desc, previous_pp.created_at desc
    limit 1
  ) source
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
    and pp.anticipated_by_programming_id is null
)
update public.project_programming pp
set
  anticipated_by_programming_id = anticipated.source_programming_id,
  anticipated_at = coalesce(pp.anticipated_at, pp.updated_at, now())
from anticipated
where pp.tenant_id = anticipated.tenant_id
  and pp.id = anticipated.id;

do $$
declare
  v_invalid_count integer;
  v_invalid_details text;
begin
  select count(*)
  into v_invalid_count
  from public.project_programming pp
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
    and pp.anticipated_by_programming_id is null;

  if v_invalid_count > 0 then
    select string_agg(
      format(
        'id=%s tenant_id=%s project_id=%s sob=%s etapa=%s status=%s execution_date=%s',
        invalid.id,
        invalid.tenant_id,
        invalid.project_id,
        invalid.projeto,
        coalesce(invalid.etapa_number::text, 'null'),
        coalesce(invalid.status, 'null'),
        coalesce(invalid.execution_date::text, 'null')
      ),
      '; '
      order by invalid.tenant_id, invalid.projeto, invalid.etapa_number nulls last, invalid.id
    )
    into v_invalid_details
    from (
      select
        pp.id,
        pp.tenant_id,
        pp.project_id,
        coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
        pp.etapa_number,
        pp.status,
        pp.execution_date
      from public.project_programming pp
      left join public.project p
        on p.tenant_id = pp.tenant_id
       and p.id = pp.project_id
      where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
        and pp.anticipated_by_programming_id is null
      order by pp.tenant_id, projeto, pp.etapa_number nulls last, pp.id
      limit 10
    ) invalid;

    raise exception 'Existem % programacoes ANTECIPADO sem CONCLUIDO anterior valido para preencher anticipated_by_programming_id. Corrija os dados antes de aplicar a migration 272. Detalhes: %', v_invalid_count, coalesce(v_invalid_details, '[sem detalhes]');
  end if;
end;
$$;

create or replace function public.enforce_project_programming_anticipated_work_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_previous_status text := public.normalize_programming_work_completion_code(new.previous_work_completion_status);
  v_source public.project_programming%rowtype;
  v_allow_automatic boolean := coalesce(current_setting('app.allow_anticipated_work_completion', true), '') = 'on';
  v_is_setting_anticipated boolean := false;
begin
  if v_status = 'ANTECIPADA' then
    raise exception 'Use Estado Trabalho ANTECIPADO. O valor legado ANTECIPADA nao pode ser salvo.';
  end if;

  if tg_op = 'INSERT' then
    v_is_setting_anticipated := v_status = 'ANTECIPADO';
  else
    v_is_setting_anticipated :=
      v_status = 'ANTECIPADO'
      and (
        public.normalize_programming_work_completion_code(old.work_completion_status) is distinct from v_status
        or old.anticipated_by_programming_id is distinct from new.anticipated_by_programming_id
        or old.previous_work_completion_status is distinct from new.previous_work_completion_status
      );
  end if;

  if v_status = 'ANTECIPADO' then
    if v_is_setting_anticipated and not v_allow_automatic then
      raise exception 'Estado Trabalho ANTECIPADO nao pode ser salvo diretamente; use a geracao automatica por CONCLUIDO anterior.';
    end if;

    if new.etapa_number is null or new.etapa_number < 1 or coalesce(new.etapa_unica, false) or coalesce(new.etapa_final, false) then
      raise exception 'Estado Trabalho ANTECIPADO exige ETAPA numerica.';
    end if;

    if new.anticipated_by_programming_id is null then
      raise exception 'Estado Trabalho ANTECIPADO exige anticipated_by_programming_id.';
    end if;

    if new.anticipated_at is null then
      raise exception 'Estado Trabalho ANTECIPADO exige anticipated_at.';
    end if;

    if v_previous_status = 'ANTECIPADO' then
      raise exception 'previous_work_completion_status nao pode ser ANTECIPADO.';
    end if;

    select *
    into v_source
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.id = new.anticipated_by_programming_id
      and pp.project_id = new.project_id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and pp.etapa_number < new.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
    limit 1;

    if not found then
      raise exception 'Estado Trabalho ANTECIPADO exige CONCLUIDO anterior valido no mesmo projeto e tenant.';
    end if;

    return new;
  end if;

  if new.anticipated_by_programming_id is not null
    or new.anticipated_at is not null
    or new.previous_work_completion_status is not null then
    raise exception 'Campos de antecipacao so podem ser preenchidos quando Estado Trabalho = ANTECIPADO.';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_trg_project_programming_anticipated_work_status on public.project_programming;
create trigger zz_trg_project_programming_anticipated_work_status
before insert or update of
  tenant_id,
  project_id,
  status,
  etapa_number,
  etapa_unica,
  etapa_final,
  work_completion_status,
  work_completion_status_id,
  anticipated_by_programming_id,
  anticipated_at,
  previous_work_completion_status
on public.project_programming
for each row
execute function public.enforce_project_programming_anticipated_work_status();

create or replace function public.restore_project_programming_anticipated_by_reopened_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_status text := public.normalize_programming_work_completion_code(old.work_completion_status);
  v_new_status text := public.normalize_programming_work_completion_code(new.work_completion_status);
  v_row public.project_programming%rowtype;
  v_history_result jsonb;
  v_actor_user_id uuid := coalesce(new.updated_by, old.updated_by);
begin
  if not (
    (
      v_old_status in ('CONCLUIDO', 'COMPLETO')
      or v_old_status like 'CONCLUIDO%'
    )
    and not (
      v_new_status in ('CONCLUIDO', 'COMPLETO')
      or v_new_status like 'CONCLUIDO%'
    )
  ) then
    return new;
  end if;

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.anticipated_by_programming_id = new.id
      and public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
    order by pp.etapa_number asc, pp.execution_date asc, pp.created_at asc
    for update
  loop
    update public.project_programming
    set
      work_completion_status = v_row.previous_work_completion_status,
      anticipated_by_programming_id = null,
      anticipated_at = null,
      previous_work_completion_status = null,
      updated_by = v_actor_user_id
    where tenant_id = new.tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => new.tenant_id,
      p_actor_user_id => v_actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => new.id,
      p_action_type => 'UPDATE',
      p_reason => 'Restauracao automatica por reabertura do CONCLUIDO que antecipou a etapa.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', 'ANTECIPADO',
          'to', nullif(v_row.previous_work_completion_status, '')
        ),
        'anticipatedByProgrammingId',
        jsonb_build_object(
          'from', new.id,
          'to', null
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'project-programming-trigger',
        'action', 'RESTORE_ANTICIPATED_BY_REOPENED_COMPLETION',
        'sourceProgrammingId', new.id,
        'previousWorkCompletionStatus', nullif(v_row.previous_work_completion_status, '')
      ),
      p_from_status => v_row.status,
      p_to_status => v_row.status,
      p_from_execution_date => v_row.execution_date,
      p_to_execution_date => v_row.execution_date,
      p_from_team_id => v_row.team_id,
      p_to_team_id => v_row.team_id,
      p_from_start_time => v_row.start_time,
      p_to_start_time => v_row.start_time,
      p_from_end_time => v_row.end_time,
      p_to_end_time => v_row.end_time,
      p_from_etapa_number => v_row.etapa_number,
      p_to_etapa_number => v_row.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da restauracao de ANTECIPADO.')
        )::text;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_project_programming_restore_anticipated_by_reopened_completion on public.project_programming;
create trigger trg_project_programming_restore_anticipated_by_reopened_completion
after update of work_completion_status on public.project_programming
for each row
execute function public.restore_project_programming_anticipated_by_reopened_completion();

create or replace function public.mark_project_programming_future_stages_anticipated(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_source_programming_id uuid,
  p_source_etapa_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.project_programming%rowtype;
  v_catalog_code text;
  v_row public.project_programming%rowtype;
  v_updated_ids uuid[] := array[]::uuid[];
  v_affected_count integer := 0;
  v_history_result jsonb;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_source_programming_id is null
    or p_source_etapa_number is null
    or p_source_etapa_number < 1 then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ANTICIPATED_STAGES_PAYLOAD',
      'message', 'Informe tenant, usuario, programacao origem e ETAPA valida.'
    );
  end if;

  select c.code
  into v_catalog_code
  from public.programming_work_completion_catalog c
  where c.tenant_id = p_tenant_id
    and c.code = 'ANTECIPADO'
    and c.is_active = true
  limit 1;

  if v_catalog_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ANTICIPATED_WORK_COMPLETION_STATUS_NOT_ACTIVE',
      'message', 'Estado Trabalho ANTECIPADO nao esta ativo no catalogo do tenant atual.'
    );
  end if;

  select *
  into v_source
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_source_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'SOURCE_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao origem CONCLUIDO nao encontrada ou inativa.'
    );
  end if;

  if v_source.etapa_number is null or v_source.etapa_number <> p_source_etapa_number then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'SOURCE_STAGE_MISMATCH',
      'message', 'A programacao CONCLUIDO precisa ter ETAPA numerica valida.'
    );
  end if;

  if coalesce(public.normalize_programming_work_completion_code(v_source.work_completion_status), '') not in ('CONCLUIDO', 'COMPLETO')
    and coalesce(public.normalize_programming_work_completion_code(v_source.work_completion_status), '') not like 'CONCLUIDO%' then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'affected_count', 0,
      'updated_programming_ids', array[]::uuid[],
      'message', 'Programacao origem nao esta CONCLUIDO; nenhuma etapa futura foi alterada.'
    );
  end if;

  perform set_config('app.allow_anticipated_work_completion', 'on', true);

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.project_id = v_source.project_id
      and pp.id <> v_source.id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and pp.etapa_number > p_source_etapa_number
      and public.normalize_programming_work_completion_code(pp.work_completion_status) is distinct from v_catalog_code
    order by pp.etapa_number asc, pp.execution_date asc, pp.created_at asc
    for update
  loop
    update public.project_programming
    set
      previous_work_completion_status = nullif(v_row.work_completion_status, ''),
      anticipated_by_programming_id = v_source.id,
      anticipated_at = now(),
      work_completion_status = v_catalog_code,
      updated_by = p_actor_user_id
    where tenant_id = p_tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => p_tenant_id,
      p_actor_user_id => p_actor_user_id,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => v_source.id,
      p_action_type => 'UPDATE',
      p_reason => 'Atualizacao automatica por conclusao antecipada.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', nullif(v_row.work_completion_status, ''),
          'to', v_catalog_code
        ),
        'anticipatedByProgrammingId',
        jsonb_build_object(
          'from', null,
          'to', v_source.id
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'programacao-api',
        'action', 'MARK_FUTURE_STAGES_ANTICIPATED',
        'sourceProgrammingId', v_source.id,
        'sourceEtapaNumber', p_source_etapa_number,
        'previousWorkCompletionStatus', nullif(v_row.work_completion_status, ''),
        'scope', 'project+future_etapa'
      ),
      p_from_status => v_row.status,
      p_to_status => v_row.status,
      p_from_execution_date => v_row.execution_date,
      p_to_execution_date => v_row.execution_date,
      p_from_team_id => v_row.team_id,
      p_to_team_id => v_row.team_id,
      p_from_start_time => v_row.start_time,
      p_to_start_time => v_row.start_time,
      p_from_end_time => v_row.end_time,
      p_to_end_time => v_row.end_time,
      p_from_etapa_number => v_row.etapa_number,
      p_to_etapa_number => v_row.etapa_number
    );

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da etapa antecipada.')
        )::text;
    end if;

    v_affected_count := v_affected_count + 1;
    v_updated_ids := array_append(v_updated_ids, v_row.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'affected_count', v_affected_count,
    'updated_programming_ids', v_updated_ids,
    'message', case
      when v_affected_count = 0 then 'Nenhuma etapa futura ativa precisava ser marcada como ANTECIPADO.'
      else 'Etapas futuras marcadas como ANTECIPADO.'
    end
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'MARK_FUTURE_STAGES_ANTICIPATED_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao marcar etapas futuras como ANTECIPADO.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

create or replace function public.mark_project_programming_stage_anticipated(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_target_programming_id uuid,
  p_source_programming_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.project_programming%rowtype;
  v_source public.project_programming%rowtype;
  v_catalog_code text;
  v_history_result jsonb;
  v_structured_error jsonb;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_target_programming_id is null
    or p_source_programming_id is null then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'INVALID_ANTICIPATED_STAGE_PAYLOAD',
      'message', 'Informe tenant, usuario, programacao destino e CONCLUIDO de origem.'
    );
  end if;

  select c.code
  into v_catalog_code
  from public.programming_work_completion_catalog c
  where c.tenant_id = p_tenant_id
    and c.code = 'ANTECIPADO'
    and c.is_active = true
  limit 1;

  if v_catalog_code is null then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ANTICIPATED_WORK_COMPLETION_STATUS_NOT_ACTIVE',
      'message', 'Estado Trabalho ANTECIPADO nao esta ativo no catalogo do tenant atual.'
    );
  end if;

  select *
  into v_target
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_target_programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TARGET_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao destino nao encontrada ou inativa.'
    );
  end if;

  if v_target.etapa_number is null or v_target.etapa_number < 1 or coalesce(v_target.etapa_unica, false) or coalesce(v_target.etapa_final, false) then
    return jsonb_build_object(
      'success', false,
      'status', 400,
      'reason', 'TARGET_STAGE_REQUIRED',
      'message', 'ANTECIPADO exige programacao destino com ETAPA numerica.'
    );
  end if;

  select *
  into v_source
  from public.project_programming pp
  where pp.tenant_id = p_tenant_id
    and pp.id = p_source_programming_id
    and pp.project_id = v_target.project_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and pp.etapa_number is not null
    and pp.etapa_number < v_target.etapa_number
    and (
      public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
      or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
    )
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 409,
      'reason', 'ANTICIPATED_SOURCE_NOT_FOUND',
      'message', 'Nao existe CONCLUIDO anterior valido para justificar ANTECIPADO.'
    );
  end if;

  if public.normalize_programming_work_completion_code(v_target.work_completion_status) = 'ANTECIPADO'
    and v_target.anticipated_by_programming_id is not distinct from v_source.id then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'skipped', true,
      'programming_id', v_target.id,
      'updated_at', v_target.updated_at,
      'message', 'Programacao ja estava ANTECIPADO pela conclusao informada.'
    );
  end if;

  perform set_config('app.allow_anticipated_work_completion', 'on', true);

  update public.project_programming
  set
    previous_work_completion_status = nullif(v_target.work_completion_status, ''),
    anticipated_by_programming_id = v_source.id,
    anticipated_at = now(),
    work_completion_status = v_catalog_code,
    updated_by = p_actor_user_id
  where tenant_id = p_tenant_id
    and id = v_target.id
  returning *
  into v_target;

  v_history_result := public.append_project_programming_history_record(
    p_tenant_id => p_tenant_id,
    p_actor_user_id => p_actor_user_id,
    p_programming_id => v_target.id,
    p_project_id => v_target.project_id,
    p_team_id => v_target.team_id,
    p_related_programming_id => v_source.id,
    p_action_type => 'UPDATE',
    p_reason => 'Atualizacao automatica por copia de programacao antecipada.',
    p_changes => jsonb_build_object(
      'workCompletionStatus',
      jsonb_build_object(
        'from', nullif(v_target.previous_work_completion_status, ''),
        'to', v_catalog_code
      ),
      'anticipatedByProgrammingId',
      jsonb_build_object(
        'from', null,
        'to', v_source.id
      )
    ),
    p_metadata => jsonb_build_object(
      'source', 'programacao-api',
      'action', 'MARK_COPIED_STAGE_ANTICIPATED',
      'sourceProgrammingId', v_source.id,
      'sourceEtapaNumber', v_source.etapa_number,
      'targetProgrammingId', v_target.id,
      'previousWorkCompletionStatus', nullif(v_target.previous_work_completion_status, '')
    ),
    p_from_status => v_target.status,
    p_to_status => v_target.status,
    p_from_execution_date => v_target.execution_date,
    p_to_execution_date => v_target.execution_date,
    p_from_team_id => v_target.team_id,
    p_to_team_id => v_target.team_id,
    p_from_start_time => v_target.start_time,
    p_to_start_time => v_target.start_time,
    p_from_end_time => v_target.end_time,
    p_to_end_time => v_target.end_time,
    p_from_etapa_number => v_target.etapa_number,
    p_to_etapa_number => v_target.etapa_number
  );

  if coalesce((v_history_result ->> 'success')::boolean, false) = false then
    raise exception '%',
      jsonb_build_object(
        'success', false,
        'status', coalesce((v_history_result ->> 'status')::integer, 500),
        'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
        'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da copia antecipada.')
      )::text;
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 200,
    'skipped', false,
    'programming_id', v_target.id,
    'updated_at', v_target.updated_at,
    'message', 'Programacao marcada como ANTECIPADO com rastreio.'
  );
exception
  when others then
    if left(ltrim(sqlerrm), 1) = '{' then
      begin
        v_structured_error := sqlerrm::jsonb;
      exception
        when others then
          v_structured_error := null;
      end;
    else
      v_structured_error := null;
    end if;

    return jsonb_build_object(
      'success', false,
      'status', coalesce((v_structured_error ->> 'status')::integer, 500),
      'reason', coalesce(v_structured_error ->> 'reason', 'MARK_STAGE_ANTICIPATED_FAILED'),
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao marcar programacao como ANTECIPADO.'),
      'detail', case
        when v_structured_error is null then sqlerrm
        else coalesce(v_structured_error ->> 'detail', v_structured_error ->> 'message')
      end
    );
end;
$$;

revoke all on function public.enforce_project_programming_anticipated_work_status() from public, anon, authenticated;
revoke all on function public.restore_project_programming_anticipated_by_reopened_completion() from public, anon, authenticated;

revoke all on function public.mark_project_programming_future_stages_anticipated(
  uuid,
  uuid,
  uuid,
  integer
) from public, anon, authenticated;

grant execute on function public.mark_project_programming_future_stages_anticipated(
  uuid,
  uuid,
  uuid,
  integer
) to service_role;

revoke all on function public.mark_project_programming_stage_anticipated(
  uuid,
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.mark_project_programming_stage_anticipated(
  uuid,
  uuid,
  uuid,
  uuid
) to service_role;
