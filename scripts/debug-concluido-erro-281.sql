-- debug-concluido-erro-281.sql
-- Diagnostico pontual para identificar a causa raiz do erro persistente.
-- Execute cada secao separada para evitar timeout.

-- ============================================================
-- A) Estado da funcao: qual migration esta ativa?
-- ============================================================
select
  case
    when pg_get_functiondef(p.oid) like '%v_old_canonical%' then '281_APLICADO'
    when pg_get_functiondef(p.oid) like '%new.work_completion_status is not distinct from old.work_completion_status%' then '280_APLICADO_SEM_281'
    when pg_get_functiondef(p.oid) like '%v_was_same_active_completed_group%' then '279_APLICADO_SEM_280'
    else '277_SEM_BYPASS'
  end as migration_status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'enforce_completed_work_status_group_integrity';

-- ============================================================
-- B) Estado exato da linha 4d4fb667 (MK-08 que aparece na tela)
-- ============================================================
select
  pp.id,
  pp.status,
  pp.work_completion_status as wcs_texto,
  pp.work_completion_status_id as wcs_uuid,
  c.code as catalog_code,
  c.label_pt as catalog_label,
  pp.programming_group_id,
  pp.execution_date,
  pp.updated_at
from public.project_programming pp
left join public.programming_work_completion_catalog c
  on c.id = pp.work_completion_status_id
  and c.tenant_id = pp.tenant_id
where pp.id = '4d4fb667-4dc0-40f5-9a68-f3c47db36506';

-- ============================================================
-- C) Todas as linhas do grupo de909a1a (grupo do MK-08)
-- ============================================================
select
  pp.id,
  pp.status,
  pp.work_completion_status as wcs_texto,
  pp.work_completion_status_id as wcs_uuid,
  c.code as catalog_code,
  t.name as team_name,
  pp.execution_date,
  pp.updated_at
from public.project_programming pp
left join public.programming_work_completion_catalog c
  on c.id = pp.work_completion_status_id
  and c.tenant_id = pp.tenant_id
left join public.teams t
  on t.id = pp.team_id
  and t.tenant_id = pp.tenant_id
where pp.programming_group_id = 'de909a1a-9cc9-447e-9a13-a28b3e23a4c9'
  and pp.tenant_id = (
    select pp2.tenant_id from public.project_programming pp2
    where pp2.id = '4d4fb667-4dc0-40f5-9a68-f3c47db36506'
    limit 1
  )
order by pp.status, pp.updated_at desc;

-- ============================================================
-- D) O que e o UUID 11d82452 no catalogo?
-- ============================================================
select id, code, label_pt, is_active
from public.programming_work_completion_catalog
where id = '11d82452-5a85-4ef9-bece-676a1e96a9c7';

-- ============================================================
-- E) Todas as linhas para RC0323603639 que tem QUALQUER UUID ou texto
--    relacionado a CONCLUIDO (por texto OU por UUID no catalogo)
-- ============================================================
select
  pp.id,
  pp.status,
  pp.work_completion_status as wcs_texto,
  pp.work_completion_status_id as wcs_uuid,
  c.code as catalog_code,
  c.label_pt as catalog_label,
  t.name as team_name,
  pp.programming_group_id,
  pp.execution_date
from public.project_programming pp
join public.project p on p.id = pp.project_id and p.tenant_id = pp.tenant_id
left join public.programming_work_completion_catalog c
  on c.id = pp.work_completion_status_id
  and c.tenant_id = pp.tenant_id
left join public.teams t
  on t.id = pp.team_id
  and t.tenant_id = pp.tenant_id
where p.sob = 'RC0323603639'
  and (
    pp.work_completion_status ilike '%CONCLU%'
    or c.code ilike '%CONCLU%'
  )
order by pp.execution_date desc, pp.updated_at desc;
