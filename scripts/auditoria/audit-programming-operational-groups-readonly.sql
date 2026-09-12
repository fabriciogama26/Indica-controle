-- audit-programming-operational-groups-readonly.sql
-- Auditoria read-only para mapear grupos operacionais da Programacao.
--
-- Objetivo:
-- - identificar projetos com mesma data e multiplas ETAPAs ativas;
-- - mostrar a diferenca entre agrupar por Projeto + Data e por Projeto + Data + ETAPA;
-- - apoiar a migration de programming_group_id.
--
-- Este script nao altera dados.

with active_rows as (
  select
    pp.tenant_id,
    pp.project_id,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    pp.execution_date,
    pp.id,
    pp.team_id,
    pp.status,
    pp.etapa_number,
    coalesce(pp.etapa_unica, false) as etapa_unica,
    coalesce(pp.etapa_final, false) as etapa_final,
    case
      when pp.etapa_number is not null and pp.etapa_number >= 1 and not coalesce(pp.etapa_unica, false) and not coalesce(pp.etapa_final, false) then
        'ETAPA_NUMERICA:' || pp.etapa_number::text
      when coalesce(pp.etapa_unica, false) then
        'ETAPA_UNICA'
      when coalesce(pp.etapa_final, false) then
        'ETAPA_FINAL'
      else
        'SEM_ETAPA'
    end as etapa_group_key
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
)
select
  tenant_id,
  projeto,
  project_id,
  execution_date,
  count(*) as active_rows,
  count(distinct etapa_group_key) as active_stage_groups,
  string_agg(distinct etapa_group_key, ' | ' order by etapa_group_key) as stage_groups,
  string_agg(id::text, ' | ' order by etapa_group_key, id) as programming_ids,
  case
    when count(distinct etapa_group_key) > 1 then
      'MULTIPLAS_ETAPAS_MESMO_PROJETO_DATA'
    else
      'OK_GRUPO_UNICO_POR_PROJETO_DATA'
  end as diagnostic_status
from active_rows
group by tenant_id, projeto, project_id, execution_date
having count(distinct etapa_group_key) > 1
order by tenant_id, projeto, execution_date;

with all_rows as (
  select
    pp.tenant_id,
    pp.project_id,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    pp.execution_date,
    pp.status,
    case
      when pp.etapa_number is not null and pp.etapa_number >= 1 and not coalesce(pp.etapa_unica, false) and not coalesce(pp.etapa_final, false) then
        'ETAPA_NUMERICA:' || pp.etapa_number::text
      when coalesce(pp.etapa_unica, false) then
        'ETAPA_UNICA'
      when coalesce(pp.etapa_final, false) then
        'ETAPA_FINAL'
      else
        'SEM_ETAPA'
    end as etapa_group_key
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
)
select
  tenant_id,
  status,
  etapa_group_key,
  count(*) as total_rows,
  count(distinct project_id || '|' || execution_date::text) as project_date_groups,
  count(distinct project_id || '|' || execution_date::text || '|' || etapa_group_key) as project_date_stage_groups
from all_rows
group by tenant_id, status, etapa_group_key
order by tenant_id, status, etapa_group_key;
