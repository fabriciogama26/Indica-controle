-- fix-programming-anticipated-migration-272-canceled-stage1.sql
-- Saneia dados legados que bloqueiam a migration 272.
--
-- Caso tratado:
-- - programacoes CANCELADA;
-- - ETAPA = 1;
-- - Estado Trabalho = ANTECIPADO;
-- - sem possibilidade de CONCLUIDO anterior valido.
--
-- A correcao limpa somente o Estado Trabalho desses registros especificos.
-- Execute em transacao no SQL Editor antes de reaplicar a migration 272.

begin;

do $$
declare
  v_target_count integer;
begin
  select count(*)
  into v_target_count
  from public.project_programming pp
  where pp.tenant_id = '7e65b733-1fe1-4137-93af-ee41f0ffc242'::uuid
    and pp.id in (
      'daa3756d-3d48-4829-8b30-6a67bab4c8a6'::uuid,
      'cc1c2c88-ffb7-4042-b121-772e68e49b29'::uuid
    )
    and pp.status = 'CANCELADA'
    and pp.etapa_number = 1
    and public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO';

  if v_target_count <> 2 then
    raise exception 'Saneamento abortado: esperado encontrar 2 registros CANCELADA/ETAPA 1/ANTECIPADO, encontrados %.', v_target_count;
  end if;
end;
$$;

with target as (
  select
    pp.tenant_id,
    pp.id as programming_id,
    pp.project_id,
    pp.team_id,
    pp.status,
    pp.execution_date,
    pp.start_time,
    pp.end_time,
    pp.etapa_number,
    pp.work_completion_status as previous_work_completion_status
  from public.project_programming pp
  where pp.tenant_id = '7e65b733-1fe1-4137-93af-ee41f0ffc242'::uuid
    and pp.id in (
      'daa3756d-3d48-4829-8b30-6a67bab4c8a6'::uuid,
      'cc1c2c88-ffb7-4042-b121-772e68e49b29'::uuid
    )
    and pp.status = 'CANCELADA'
    and pp.etapa_number = 1
    and public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
),
updated as (
  update public.project_programming pp
  set
    work_completion_status = null,
    work_completion_status_id = null,
    updated_at = now()
  from target
  where pp.tenant_id = target.tenant_id
    and pp.id = target.programming_id
  returning
    target.tenant_id,
    target.programming_id,
    target.project_id,
    target.team_id,
    target.status,
    target.execution_date,
    target.start_time,
    target.end_time,
    target.etapa_number,
    target.previous_work_completion_status
)
insert into public.project_programming_history (
  tenant_id,
  programming_id,
  project_id,
  team_id,
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
  'Saneamento de Estado Trabalho ANTECIPADO invalido em programacao cancelada ETAPA 1 antes da migration 272.',
  jsonb_build_object(
    'workCompletionStatus',
    jsonb_build_object(
      'from', updated.previous_work_completion_status,
      'to', null
    )
  ),
  jsonb_build_object(
    'source', 'manual_sql',
    'script', 'fix-programming-anticipated-migration-272-canceled-stage1',
    'reason', 'CANCELADA_ETAPA_1_NAO_PODE_SER_ANTECIPADO',
    'migration_blocked', '272_harden_anticipated_work_completion_status'
  ),
  null
from updated;

commit;

-- Validacao esperada apos o commit: deve retornar 0.
select count(*) as invalid_anticipated_without_valid_source
from public.project_programming pp
where public.normalize_programming_work_completion_code(pp.work_completion_status) = 'ANTECIPADO'
  and not exists (
    select 1
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
  );
