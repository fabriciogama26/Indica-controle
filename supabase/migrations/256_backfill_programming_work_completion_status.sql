-- 256_backfill_programming_work_completion_status.sql
-- Backfill automatico de Estado Trabalho em branco na Programacao.
--
-- Escopo:
-- - Somente programacoes ativas: PROGRAMADA ou REPROGRAMADA.
-- - Somente registros com work_completion_status em branco.
-- - Somente registros vinculados a projeto existente no mesmo tenant.
-- - Somente sugestoes resolvidas por regra automatica e presentes no catalogo ativo.
-- - Nao corrige casos operacionais como SEM_ETAPA_OU_FLAG ou projeto nao encontrado.

with blank_rows as (
  select pp.*
  from public.project_programming pp
  join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
),
diagnostic as (
  select
    br.*,
    same_day.any_same_day_status,
    source_programming.work_completion_status as source_programming_status,
    previous_project.work_completion_status as previous_project_status,
    concluded_before.id as concluded_before_id,
    partial_catalog.code as partial_catalog_code,
    anticipated_catalog.code as anticipated_catalog_code
  from blank_rows br
  left join lateral (
    select
      max(public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as any_same_day_status
    from public.project_programming pp_same
    where pp_same.tenant_id = br.tenant_id
      and pp_same.project_id = br.project_id
      and pp_same.execution_date = br.execution_date
      and pp_same.status in ('PROGRAMADA', 'REPROGRAMADA')
  ) same_day on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming pp_source
    where pp_source.tenant_id = br.tenant_id
      and pp_source.id = br.copied_from_programming_id
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    limit 1
  ) source_programming on true
  left join lateral (
    select pp_prev.work_completion_status
    from public.project_programming pp_prev
    join public.programming_work_completion_catalog c_prev
      on c_prev.tenant_id = pp_prev.tenant_id
     and c_prev.code = public.normalize_programming_work_completion_code(pp_prev.work_completion_status)
     and c_prev.is_active = true
    where pp_prev.tenant_id = br.tenant_id
      and pp_prev.project_id = br.project_id
      and pp_prev.id <> br.id
      and pp_prev.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp_prev.work_completion_status, '')), '') is not null
      and (
        pp_prev.execution_date < br.execution_date
        or (pp_prev.execution_date = br.execution_date and pp_prev.updated_at < br.updated_at)
      )
    order by pp_prev.execution_date desc, pp_prev.updated_at desc, pp_prev.created_at desc
    limit 1
  ) previous_project on true
  left join lateral (
    select pp_done.id
    from public.project_programming pp_done
    where pp_done.tenant_id = br.tenant_id
      and pp_done.project_id = br.project_id
      and pp_done.id <> br.id
      and pp_done.etapa_number is not null
      and br.etapa_number is not null
      and pp_done.etapa_number < br.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp_done.etapa_number desc, pp_done.execution_date desc, pp_done.updated_at desc
    limit 1
  ) concluded_before on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = br.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
  left join public.programming_work_completion_catalog anticipated_catalog
    on anticipated_catalog.tenant_id = br.tenant_id
   and anticipated_catalog.code = 'ANTECIPADO'
   and anticipated_catalog.is_active = true
),
candidates as (
  select
    d.tenant_id,
    d.id as programming_id,
    d.project_id,
    d.team_id,
    d.status,
    d.execution_date,
    d.start_time,
    d.end_time,
    d.etapa_number,
    d.copied_from_programming_id,
    case
      when d.any_same_day_status is not null then
        'HERDAR_MESMO_PROJETO_DATA'
      when d.source_programming_status is not null then
        'HERDAR_PROGRAMACAO_ORIGEM'
      when d.concluded_before_id is not null and d.anticipated_catalog_code is not null then
        'ETAPA_POSTERIOR_A_CONCLUIDO'
      when d.previous_project_status is not null then
        'HERDAR_ULTIMO_ESTADO_DO_PROJETO'
      when d.partial_catalog_code is not null then
        'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
      else
        null
    end as backfill_rule,
    case
      when d.any_same_day_status is not null then
        d.any_same_day_status
      when d.source_programming_status is not null then
        public.normalize_programming_work_completion_code(d.source_programming_status)
      when d.concluded_before_id is not null and d.anticipated_catalog_code is not null then
        'ANTECIPADO'
      when d.previous_project_status is not null then
        public.normalize_programming_work_completion_code(d.previous_project_status)
      when d.partial_catalog_code is not null then
        'PARCIAL'
      else
        null
    end as suggested_work_completion_status
  from diagnostic d
),
validated as (
  select
    candidates.*,
    catalog.id as suggested_work_completion_status_id,
    catalog.code as target_work_completion_status
  from candidates
  join public.programming_work_completion_catalog catalog
    on catalog.tenant_id = candidates.tenant_id
   and catalog.code = candidates.suggested_work_completion_status
   and catalog.is_active = true
  where candidates.backfill_rule in (
      'HERDAR_MESMO_PROJETO_DATA',
      'HERDAR_PROGRAMACAO_ORIGEM',
      'ETAPA_POSTERIOR_A_CONCLUIDO',
      'HERDAR_ULTIMO_ESTADO_DO_PROJETO',
      'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
    )
    and candidates.suggested_work_completion_status is not null
),
updated as (
  update public.project_programming pp
  set
    work_completion_status = validated.target_work_completion_status,
    work_completion_status_id = validated.suggested_work_completion_status_id,
    updated_at = now()
  from validated
  where pp.tenant_id = validated.tenant_id
    and pp.id = validated.programming_id
    and pp.status in ('PROGRAMADA', 'REPROGRAMADA')
    and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
  returning
    validated.tenant_id,
    validated.programming_id,
    validated.project_id,
    validated.team_id,
    validated.status,
    validated.execution_date,
    validated.start_time,
    validated.end_time,
    validated.etapa_number,
    validated.copied_from_programming_id,
    validated.backfill_rule,
    validated.target_work_completion_status
)
insert into public.project_programming_history (
  tenant_id,
  programming_id,
  project_id,
  team_id,
  related_programming_id,
  action_type,
  from_status,
  to_status,
  from_execution_date,
  to_execution_date,
  from_team_id,
  to_team_id,
  from_start_time,
  to_start_time,
  from_end_time,
  to_end_time,
  from_etapa_number,
  to_etapa_number,
  reason,
  changes,
  metadata,
  created_by
)
select
  updated.tenant_id,
  updated.programming_id,
  updated.project_id,
  updated.team_id,
  updated.copied_from_programming_id,
  'UPDATE',
  updated.status,
  updated.status,
  updated.execution_date,
  updated.execution_date,
  updated.team_id,
  updated.team_id,
  updated.start_time,
  updated.start_time,
  updated.end_time,
  updated.end_time,
  updated.etapa_number,
  updated.etapa_number,
  'Backfill automatico de Estado Trabalho em branco.',
  jsonb_build_object(
    'workCompletionStatus',
    jsonb_build_object(
      'from', null,
      'to', updated.target_work_completion_status
    )
  ),
  jsonb_build_object(
    'source', 'migration',
    'migration', '256_backfill_programming_work_completion_status',
    'rule', updated.backfill_rule,
    'scope', 'active_blank_programming_work_completion_status'
  ),
  null
from updated;
