-- audit-programming-anticipated-migration-272-blockers-readonly.sql
-- Diagnostico read-only para destravar a migration 272.
--
-- Objetivo:
-- - listar programacoes com Estado Trabalho ANTECIPADO antes da coluna
--   anticipated_by_programming_id existir;
-- - separar os casos que a migration 272 consegue preencher automaticamente dos
--   casos que exigem revisao/correcao operacional antes do deploy.
--
-- Este script nao altera dados.

with anticipated_rows as (
  select
    pp.id,
    pp.tenant_id,
    pp.project_id,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    pp.team_id,
    pp.status,
    pp.execution_date,
    pp.etapa_number,
    pp.etapa_unica,
    pp.etapa_final,
    pp.work_completion_status,
    pp.updated_at,
    pp.created_at
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
),
diagnostic as (
  select
    ar.*,
    valid_source.id as valid_source_programming_id,
    valid_source.etapa_number as valid_source_etapa_number,
    valid_source.execution_date as valid_source_execution_date,
    valid_source.updated_at as valid_source_updated_at,
    inactive_source.id as inactive_concluded_source_id,
    inactive_source.status as inactive_concluded_source_status,
    lower_stage.id as lower_stage_programming_id,
    lower_stage.work_completion_status as lower_stage_work_completion_status,
    case
      when ar.etapa_number is null
        or ar.etapa_number < 1
        or coalesce(ar.etapa_unica, false)
        or coalesce(ar.etapa_final, false) then
        'ANTECIPADO_SEM_ETAPA_NUMERICA_VALIDA'
      when valid_source.id is not null then
        'OK_BACKFILL_MIGRATION_272'
      when inactive_source.id is not null then
        'CONCLUIDO_ANTERIOR_EXISTE_MAS_INATIVO'
      when lower_stage.id is not null then
        'ETAPA_ANTERIOR_EXISTE_SEM_CONCLUIDO'
      else
        'SEM_CONCLUIDO_ANTERIOR_VALIDO'
    end as migration_272_status,
    case
      when valid_source.id is not null then
        'A migration 272 consegue preencher anticipated_by_programming_id automaticamente.'
      else
        'Corrigir o Estado Trabalho ou a origem CONCLUIDO antes de reaplicar a migration 272.'
    end as recommended_action
  from anticipated_rows ar
  left join lateral (
    select previous_pp.id, previous_pp.etapa_number, previous_pp.execution_date, previous_pp.updated_at
    from public.project_programming previous_pp
    where previous_pp.tenant_id = ar.tenant_id
      and previous_pp.project_id = ar.project_id
      and previous_pp.id <> ar.id
      and previous_pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and previous_pp.etapa_number is not null
      and ar.etapa_number is not null
      and previous_pp.etapa_number < ar.etapa_number
      and (
        public.normalize_programming_work_completion_code(previous_pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(previous_pp.work_completion_status) like 'CONCLUIDO%'
      )
    order by previous_pp.etapa_number desc, previous_pp.updated_at desc, previous_pp.created_at desc
    limit 1
  ) valid_source on true
  left join lateral (
    select previous_pp.id, previous_pp.status
    from public.project_programming previous_pp
    where previous_pp.tenant_id = ar.tenant_id
      and previous_pp.project_id = ar.project_id
      and previous_pp.id <> ar.id
      and previous_pp.status not in ('PROGRAMADA', 'REPROGRAMADA')
      and previous_pp.etapa_number is not null
      and ar.etapa_number is not null
      and previous_pp.etapa_number < ar.etapa_number
      and (
        public.normalize_programming_work_completion_code(previous_pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(previous_pp.work_completion_status) like 'CONCLUIDO%'
      )
    order by previous_pp.etapa_number desc, previous_pp.updated_at desc, previous_pp.created_at desc
    limit 1
  ) inactive_source on true
  left join lateral (
    select previous_pp.id, previous_pp.work_completion_status
    from public.project_programming previous_pp
    where previous_pp.tenant_id = ar.tenant_id
      and previous_pp.project_id = ar.project_id
      and previous_pp.id <> ar.id
      and previous_pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and previous_pp.etapa_number is not null
      and ar.etapa_number is not null
      and previous_pp.etapa_number < ar.etapa_number
    order by previous_pp.etapa_number desc, previous_pp.updated_at desc, previous_pp.created_at desc
    limit 1
  ) lower_stage on true
)
select
  tenant_id,
  projeto,
  project_id,
  id as programming_id,
  team_id,
  status,
  execution_date,
  etapa_number,
  work_completion_status,
  valid_source_programming_id,
  valid_source_etapa_number,
  valid_source_execution_date,
  inactive_concluded_source_id,
  inactive_concluded_source_status,
  lower_stage_programming_id,
  lower_stage_work_completion_status,
  migration_272_status,
  recommended_action
from diagnostic
order by
  case when migration_272_status = 'OK_BACKFILL_MIGRATION_272' then 1 else 0 end,
  tenant_id,
  projeto,
  etapa_number nulls last,
  execution_date nulls last,
  programming_id;

with anticipated_rows as (
  select pp.*
  from public.project_programming pp
  where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
),
diagnostic as (
  select
    ar.id,
    case
      when ar.etapa_number is null
        or ar.etapa_number < 1
        or coalesce(ar.etapa_unica, false)
        or coalesce(ar.etapa_final, false) then
        'ANTECIPADO_SEM_ETAPA_NUMERICA_VALIDA'
      when exists (
        select 1
        from public.project_programming previous_pp
        where previous_pp.tenant_id = ar.tenant_id
          and previous_pp.project_id = ar.project_id
          and previous_pp.id <> ar.id
          and previous_pp.status in ('PROGRAMADA', 'REPROGRAMADA')
          and previous_pp.etapa_number is not null
          and ar.etapa_number is not null
          and previous_pp.etapa_number < ar.etapa_number
          and (
            public.normalize_programming_work_completion_code(previous_pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(previous_pp.work_completion_status) like 'CONCLUIDO%'
          )
      ) then
        'OK_BACKFILL_MIGRATION_272'
      when exists (
        select 1
        from public.project_programming previous_pp
        where previous_pp.tenant_id = ar.tenant_id
          and previous_pp.project_id = ar.project_id
          and previous_pp.id <> ar.id
          and previous_pp.status not in ('PROGRAMADA', 'REPROGRAMADA')
          and previous_pp.etapa_number is not null
          and ar.etapa_number is not null
          and previous_pp.etapa_number < ar.etapa_number
          and (
            public.normalize_programming_work_completion_code(previous_pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(previous_pp.work_completion_status) like 'CONCLUIDO%'
          )
      ) then
        'CONCLUIDO_ANTERIOR_EXISTE_MAS_INATIVO'
      when exists (
        select 1
        from public.project_programming previous_pp
        where previous_pp.tenant_id = ar.tenant_id
          and previous_pp.project_id = ar.project_id
          and previous_pp.id <> ar.id
          and previous_pp.status in ('PROGRAMADA', 'REPROGRAMADA')
          and previous_pp.etapa_number is not null
          and ar.etapa_number is not null
          and previous_pp.etapa_number < ar.etapa_number
      ) then
        'ETAPA_ANTERIOR_EXISTE_SEM_CONCLUIDO'
      else
        'SEM_CONCLUIDO_ANTERIOR_VALIDO'
    end as migration_272_status
  from anticipated_rows ar
)
select
  migration_272_status,
  count(*) as total_registros
from diagnostic
group by migration_272_status
order by migration_272_status;
