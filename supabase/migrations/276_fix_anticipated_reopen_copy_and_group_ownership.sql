-- 276_fix_anticipated_reopen_copy_and_group_ownership.sql
-- Corrige rastreio de ANTECIPADO, conclusao global do projeto e propriedade de programming_group_id.
--
-- Regras:
-- - CONCLUIDO e global do projeto: pode existir no maximo um CONCLUIDO ativo por
--   tenant_id + project_id;
-- - ao reabrir um CONCLUIDO, uma linha ANTECIPADO vinculada a ele so volta ao
--   estado anterior se nao houver outro CONCLUIDO anterior valido;
-- - se houver outro CONCLUIDO anterior valido, a linha continua ANTECIPADO e o
--   anticipated_by_programming_id passa para a conclusao valida mais proxima
--   apenas como tolerancia a dado legado inconsistente;
-- - ANTECIPADO encerra operacionalmente a linha como ANTICIPADA para liberar a
--   agenda da equipe;
-- - copy_project_programming_to_dates bloqueia projeto CONCLUIDO sem excecao para
--   origem ANTECIPADO;
-- - copy_project_programming_to_dates bloqueia data destino anterior/igual a origem;
-- - programming_group_id e controlado pelo banco e nao pode ser alterado diretamente.

alter table if exists public.project_programming
  add column if not exists previous_operational_status text;

alter table if exists public.project_programming
  drop constraint if exists project_programming_previous_operational_status_check;

alter table if exists public.project_programming
  add constraint project_programming_previous_operational_status_check
  check (
    previous_operational_status is null
    or previous_operational_status in ('PROGRAMADA', 'REPROGRAMADA')
  );

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_check;

alter table if exists public.project_programming
  add constraint project_programming_status_check
  check (status in ('PROGRAMADA', 'REPROGRAMADA', 'ADIADA', 'CANCELADA', 'ANTECIPADA'));

alter table if exists public.project_programming
  drop constraint if exists project_programming_status_fields_check;

alter table if exists public.project_programming
  add constraint project_programming_status_fields_check
  check (
    (
      status in ('PROGRAMADA', 'REPROGRAMADA')
      and is_active = true
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
    or (
      status in ('ADIADA', 'CANCELADA')
      and is_active = false
      and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null
      and canceled_at is not null
      and canceled_by is not null
    )
    or (
      status = 'ANTECIPADA'
      and is_active = false
      and cancellation_reason is null
      and canceled_at is null
      and canceled_by is null
    )
  );

create or replace function public.assign_project_programming_group_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_group_fields_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.programming_group_id := public.resolve_project_programming_group_id(
      new.tenant_id,
      new.project_id,
      new.execution_date,
      new.etapa_number,
      coalesce(new.etapa_unica, false),
      coalesce(new.etapa_final, false),
      new.id
    );
    return new;
  end if;

  v_group_fields_changed :=
    old.tenant_id is distinct from new.tenant_id
    or old.project_id is distinct from new.project_id
    or old.execution_date is distinct from new.execution_date
    or old.etapa_number is distinct from new.etapa_number
    or coalesce(old.etapa_unica, false) is distinct from coalesce(new.etapa_unica, false)
    or coalesce(old.etapa_final, false) is distinct from coalesce(new.etapa_final, false);

  if not v_group_fields_changed then
    new.programming_group_id := old.programming_group_id;
    return new;
  end if;

  new.programming_group_id := public.resolve_project_programming_group_id(
    new.tenant_id,
    new.project_id,
    new.execution_date,
    new.etapa_number,
    coalesce(new.etapa_unica, false),
    coalesce(new.etapa_final, false),
    new.id
  );

  return new;
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

    if new.status in ('PROGRAMADA', 'REPROGRAMADA') then
      new.previous_operational_status := new.status;
    elsif coalesce(new.previous_operational_status, '') not in ('PROGRAMADA', 'REPROGRAMADA') then
      new.previous_operational_status := 'PROGRAMADA';
    end if;

    new.status := 'ANTECIPADA';
    new.is_active := false;
    new.cancellation_reason := null;
    new.canceled_at := null;
    new.canceled_by := null;

    return new;
  end if;

  new.previous_operational_status := null;

  if new.anticipated_by_programming_id is not null
    or new.anticipated_at is not null
    or new.previous_work_completion_status is not null then
    raise exception 'Campos de antecipacao so podem ser preenchidos quando Estado Trabalho = ANTECIPADO.';
  end if;

  return new;
end;
$$;

do $close_existing_anticipated$
begin
  perform set_config('app.allow_anticipated_work_completion', 'on', true);

  update public.project_programming pp
  set
    previous_operational_status = coalesce(
      nullif(pp.previous_operational_status, ''),
      case when pp.status in ('PROGRAMADA', 'REPROGRAMADA') then pp.status end,
      'PROGRAMADA'
    ),
    status = 'ANTECIPADA',
    is_active = false,
    cancellation_reason = null,
    canceled_at = null,
    canceled_by = null
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO';
end;
$close_existing_anticipated$;

set constraints all immediate;

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
  v_replacement public.project_programming%rowtype;
  v_history_result jsonb;
  v_actor_user_id uuid := coalesce(new.updated_by, old.updated_by);
  v_restore_status text;
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

  perform set_config('app.allow_anticipated_work_completion', 'on', true);

  for v_row in
    select *
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.anticipated_by_programming_id = new.id
      and public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
    order by pp.etapa_number asc, pp.execution_date asc, pp.created_at asc
    for update
  loop
    select *
    into v_replacement
    from public.project_programming pp
    where pp.tenant_id = new.tenant_id
      and pp.project_id = v_row.project_id
      and pp.id <> new.id
      and pp.id <> v_row.id
      and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and v_row.etapa_number is not null
      and pp.etapa_number < v_row.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp.etapa_number desc, pp.updated_at desc, pp.created_at desc
    limit 1
    for update;

    if found then
      update public.project_programming
      set
        status = 'ANTECIPADA',
        is_active = false,
        previous_operational_status = coalesce(
          nullif(v_row.previous_operational_status, ''),
          case when v_row.status in ('PROGRAMADA', 'REPROGRAMADA') then v_row.status end,
          'PROGRAMADA'
        ),
        cancellation_reason = null,
        canceled_at = null,
        canceled_by = null,
        anticipated_by_programming_id = v_replacement.id,
        anticipated_at = now(),
        updated_by = v_actor_user_id
      where tenant_id = new.tenant_id
        and id = v_row.id;

      v_history_result := public.append_project_programming_history_record(
        p_tenant_id => new.tenant_id,
        p_actor_user_id => v_actor_user_id,
        p_programming_id => v_row.id,
        p_project_id => v_row.project_id,
        p_team_id => v_row.team_id,
        p_related_programming_id => v_replacement.id,
        p_action_type => 'UPDATE',
        p_reason => 'Reatribuicao automatica de ANTECIPADO por reabertura de CONCLUIDO anterior.',
        p_changes => jsonb_build_object(
          'anticipatedByProgrammingId',
          jsonb_build_object(
            'from', new.id,
            'to', v_replacement.id
          ),
          'workCompletionStatus',
          jsonb_build_object(
            'from', 'ANTECIPADO',
            'to', 'ANTECIPADO'
          )
        ),
        p_metadata => jsonb_build_object(
          'source', 'project-programming-trigger',
          'action', 'REASSIGN_ANTICIPATED_BY_REOPENED_COMPLETION',
          'reopenedProgrammingId', new.id,
          'replacementProgrammingId', v_replacement.id,
          'replacementEtapaNumber', v_replacement.etapa_number,
          'previousWorkCompletionStatus', nullif(v_row.previous_work_completion_status, '')
        ),
        p_from_status => v_row.status,
        p_to_status => 'ANTECIPADA',
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
    else
      v_restore_status := coalesce(
        nullif(v_row.previous_operational_status, ''),
        case when v_row.status in ('PROGRAMADA', 'REPROGRAMADA') then v_row.status end,
        'PROGRAMADA'
      );

      update public.project_programming
      set
        status = v_restore_status,
        is_active = true,
        cancellation_reason = null,
        canceled_at = null,
        canceled_by = null,
        work_completion_status = v_row.previous_work_completion_status,
        anticipated_by_programming_id = null,
        anticipated_at = null,
        previous_work_completion_status = null,
        previous_operational_status = null,
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
        p_to_status => v_restore_status,
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
    end if;

    if coalesce((v_history_result ->> 'success')::boolean, false) = false then
      raise exception '%',
        jsonb_build_object(
          'success', false,
          'status', coalesce((v_history_result ->> 'status')::integer, 500),
          'reason', coalesce(v_history_result ->> 'reason', 'APPEND_PROGRAMMING_HISTORY_FAILED'),
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico da revalidacao de ANTECIPADO.')
        )::text;
    end if;
  end loop;

  return new;
end;
$$;

do $deduplicate_completed_projects$
declare
  v_row record;
  v_history_result jsonb;
begin
  for v_row in
    with completed_rows as (
      select
        pp.*,
        row_number() over (
          partition by pp.tenant_id, pp.project_id
          order by
            pp.updated_at desc nulls last,
            pp.execution_date desc nulls last,
            pp.etapa_number desc nulls last,
            pp.created_at desc nulls last,
            pp.id desc
        ) as rn
      from public.project_programming pp
      where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and pp.work_completion_status is not null
        and (
          public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
        )
    )
    select *
    from completed_rows
    where rn > 1
    order by tenant_id, project_id, rn
  loop
    update public.project_programming
    set
      work_completion_status = null,
      work_completion_status_id = null,
      updated_by = v_row.updated_by
    where tenant_id = v_row.tenant_id
      and id = v_row.id;

    v_history_result := public.append_project_programming_history_record(
      p_tenant_id => v_row.tenant_id,
      p_actor_user_id => v_row.updated_by,
      p_programming_id => v_row.id,
      p_project_id => v_row.project_id,
      p_team_id => v_row.team_id,
      p_related_programming_id => null,
      p_action_type => 'UPDATE',
      p_reason => 'Saneamento automatico da migration 276: CONCLUIDO e global do projeto e apenas uma programacao ativa pode manter esse Estado Trabalho.',
      p_changes => jsonb_build_object(
        'workCompletionStatus',
        jsonb_build_object(
          'from', v_row.work_completion_status,
          'to', null
        ),
        'workCompletionStatusId',
        jsonb_build_object(
          'from', v_row.work_completion_status_id,
          'to', null
        )
      ),
      p_metadata => jsonb_build_object(
        'source', 'supabase-migration',
        'migration', '276_fix_anticipated_reopen_copy_and_group_ownership',
        'action', 'DEDUPLICATE_ACTIVE_PROJECT_COMPLETED_WORK_STATUS',
        'canonicalRule', 'keep latest updated_at, execution_date, etapa_number, created_at, id per tenant/project',
        'tenantId', v_row.tenant_id,
        'projectId', v_row.project_id
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
          'message', coalesce(v_history_result ->> 'message', 'Falha ao registrar historico do saneamento de CONCLUIDO duplicado.')
        )::text;
    end if;
  end loop;

  if exists (
    select 1
    from (
      select tenant_id, project_id
      from public.project_programming
      where status in ('PROGRAMADA', 'REPROGRAMADA')
        and work_completion_status is not null
        and (
          public.normalize_programming_work_completion_code(work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(work_completion_status) like 'CONCLUIDO%'
        )
      group by tenant_id, project_id
      having count(*) > 1
    ) remaining_duplicates
  ) then
    raise exception 'Ainda existem projetos com mais de uma programacao ativa CONCLUIDO apos saneamento automatico da migration 276.';
  end if;
end;
$deduplicate_completed_projects$;

set constraints all immediate;

create unique index if not exists idx_project_programming_one_active_completed_per_project
  on public.project_programming (tenant_id, project_id)
  where status in ('PROGRAMADA', 'REPROGRAMADA')
    and work_completion_status is not null
    and (
      public.normalize_programming_work_completion_code(work_completion_status) in ('CONCLUIDO', 'COMPLETO')
      or public.normalize_programming_work_completion_code(work_completion_status) like 'CONCLUIDO%'
    );

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
      previous_operational_status = v_row.status,
      anticipated_by_programming_id = v_source.id,
      anticipated_at = now(),
      status = 'ANTECIPADA',
      is_active = false,
      cancellation_reason = null,
      canceled_at = null,
      canceled_by = null,
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
      p_reason => 'Encerramento operacional automatico por conclusao antecipada.',
      p_changes => jsonb_build_object(
        'status',
        jsonb_build_object(
          'from', v_row.status,
          'to', 'ANTECIPADA'
        ),
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
        'previousOperationalStatus', v_row.status,
        'scope', 'project+future_etapa'
      ),
      p_from_status => v_row.status,
      p_to_status => 'ANTECIPADA',
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
      when v_affected_count = 0 then 'Nenhuma etapa futura ativa precisava ser encerrada como ANTECIPADO.'
      else 'Etapas futuras encerradas operacionalmente como ANTECIPADO.'
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
      'message', coalesce(v_structured_error ->> 'message', 'Falha ao encerrar etapas futuras como ANTECIPADO.'),
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
  v_previous_status text;
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
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA', 'ANTECIPADA')
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 404,
      'reason', 'TARGET_PROGRAMMING_NOT_FOUND',
      'message', 'Programacao destino nao encontrada.'
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
    and v_target.anticipated_by_programming_id is not distinct from v_source.id
    and v_target.status = 'ANTECIPADA' then
    return jsonb_build_object(
      'success', true,
      'status', 200,
      'skipped', true,
      'programming_id', v_target.id,
      'updated_at', v_target.updated_at,
      'message', 'Programacao ja estava encerrada como ANTECIPADO pela conclusao informada.'
    );
  end if;

  v_previous_status := case
    when v_target.previous_operational_status in ('PROGRAMADA', 'REPROGRAMADA') then v_target.previous_operational_status
    when v_target.status in ('PROGRAMADA', 'REPROGRAMADA') then v_target.status
    else 'PROGRAMADA'
  end;

  perform set_config('app.allow_anticipated_work_completion', 'on', true);

  update public.project_programming
  set
    previous_work_completion_status = nullif(v_target.work_completion_status, ''),
    previous_operational_status = case
      when v_target.status in ('PROGRAMADA', 'REPROGRAMADA') then v_target.status
      when v_target.previous_operational_status in ('PROGRAMADA', 'REPROGRAMADA') then v_target.previous_operational_status
      else 'PROGRAMADA'
    end,
    anticipated_by_programming_id = v_source.id,
    anticipated_at = now(),
    status = 'ANTECIPADA',
    is_active = false,
    cancellation_reason = null,
    canceled_at = null,
    canceled_by = null,
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
    p_reason => 'Encerramento operacional automatico por copia/correcao antecipada.',
    p_changes => jsonb_build_object(
      'status',
      jsonb_build_object(
        'from', v_previous_status,
        'to', 'ANTECIPADA'
      ),
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
      'previousWorkCompletionStatus', nullif(v_target.previous_work_completion_status, ''),
      'previousOperationalStatus', v_previous_status
    ),
    p_from_status => v_previous_status,
    p_to_status => 'ANTECIPADA',
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
    'programming_id', v_target.id,
    'updated_at', v_target.updated_at,
    'work_completion_status', v_catalog_code,
    'message', 'Programacao encerrada operacionalmente como ANTECIPADO.'
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

do $migration$
declare
  v_function_signature text := 'public.copy_project_programming_to_dates(uuid,uuid,uuid,timestamp with time zone,jsonb)';
  v_function_oid oid;
  v_function_definition text;
  v_original_function_definition text;
  v_old_fragment text;
  v_new_fragment text;
begin
  select p.oid
  into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'copy_project_programming_to_dates'
    and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_actor_user_id uuid, p_source_programming_id uuid, p_expected_updated_at timestamp with time zone, p_targets jsonb';

  if v_function_oid is null then
    raise exception 'copy_project_programming_to_dates nao encontrada. Aplique a migration 274 antes da 276.';
  end if;

  v_function_definition := pg_get_functiondef(v_function_oid);
  v_original_function_definition := v_function_definition;

  if position('TARGET_NOT_AFTER_SOURCE_DATE' in v_function_definition) > 0 then
    return;
  end if;

  v_old_fragment := $$if v_target_date = v_source.execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'TARGET_EQUALS_SOURCE_DATE', 'message', 'A data original da programacao nao pode ser selecionada como destino da copia.');
    end if;$$;
  v_new_fragment := $$if v_target_date <= v_source.execution_date then
      return jsonb_build_object('success', false, 'status', 400, 'reason', 'TARGET_NOT_AFTER_SOURCE_DATE', 'message', 'A data destino da copia deve ser posterior a data original da programacao.');
    end if;$$;

  if position(v_old_fragment in v_function_definition) > 0 then
    v_function_definition := replace(v_function_definition, v_old_fragment, v_new_fragment);
  else
    v_function_definition := regexp_replace(
      v_function_definition,
      $pattern$if[[:space:]]+v_target_date[[:space:]]*=[[:space:]]*v_source\.execution_date[[:space:]]+then[[:space:]]+return[[:space:]]+jsonb_build_object\('success',[[:space:]]*false,[[:space:]]*'status',[[:space:]]*400,[[:space:]]*'reason',[[:space:]]*'TARGET_EQUALS_SOURCE_DATE',[[:space:]]*'message',[[:space:]]*'[^']*'\);[[:space:]]+end[[:space:]]+if;$pattern$,
      v_new_fragment
    );
  end if;

  if v_function_definition = v_original_function_definition then
    raise exception 'Nao foi possivel localizar a validacao de data destino em copy_project_programming_to_dates.';
  end if;

  execute v_function_definition;
end;
$migration$;

revoke all on function public.assign_project_programming_group_id() from public, anon, authenticated;
revoke all on function public.enforce_project_programming_anticipated_work_status() from public, anon, authenticated;
revoke all on function public.restore_project_programming_anticipated_by_reopened_completion() from public, anon, authenticated;
revoke all on function public.mark_project_programming_future_stages_anticipated(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_project_programming_stage_anticipated(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;

grant execute on function public.mark_project_programming_future_stages_anticipated(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.mark_project_programming_stage_anticipated(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.copy_project_programming_to_dates(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
