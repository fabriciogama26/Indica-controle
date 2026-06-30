-- audit-programming-completed-group-transition-279-readonly.sql
-- Diagnostico read-only antes de aplicar a migration 279.
--
-- Objetivo:
-- - verificar se as obras alvo possuem divergencia entre work_completion_status
--   e work_completion_status_id;
-- - identificar linhas tecnicamente CONCLUIDO por texto ou UUID;
-- - listar grupos operacionais com mais de uma linha ativa que podem acionar
--   enforce_completed_work_status_group_integrity na regra antiga;
-- - apoiar decisao antes de aplicar a migration 279.
--
-- Este script nao altera dados.

with target_codes(code) as (
  values
    ('RC0323603639'),
    ('RC0323603633')
),
target_projects as (
  select
    p.tenant_id,
    p.id as project_id,
    p.sob as project_code
  from public.project p
  join target_codes tc
    on tc.code = p.sob
),
rows_base as (
  select
    pp.tenant_id,
    tp.project_code,
    pp.project_id,
    pp.id,
    pp.execution_date,
    pp.status,
    coalesce(pp.is_active, pp.status in ('PROGRAMADA', 'REPROGRAMADA')) as is_active,
    pp.team_id,
    coalesce(t.name, '[EQUIPE_NAO_ENCONTRADA]') as team_name,
    pp.etapa_number,
    coalesce(pp.etapa_unica, false) as etapa_unica,
    coalesce(pp.etapa_final, false) as etapa_final,
    pp.programming_group_id,
    pp.work_completion_status,
    pp.work_completion_status_id,
    c.code as catalog_code,
    c.label_pt as catalog_label,
    public.normalize_programming_work_completion_code(pp.work_completion_status) as text_code,
    public.normalize_programming_work_completion_code(c.code) as uuid_code,
    pp.updated_at,
    pp.created_at
  from public.project_programming pp
  join target_projects tp
    on tp.tenant_id = pp.tenant_id
   and tp.project_id = pp.project_id
  left join public.programming_work_completion_catalog c
    on c.tenant_id = pp.tenant_id
   and c.id = pp.work_completion_status_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
),
diagnostic as (
  select
    rb.*,
    (
      rb.text_code in ('CONCLUIDO', 'COMPLETO')
      or rb.text_code like 'CONCLUIDO%'
    ) as is_completed_by_text,
    (
      rb.uuid_code in ('CONCLUIDO', 'COMPLETO')
      or rb.uuid_code like 'CONCLUIDO%'
    ) as is_completed_by_uuid,
    count(*) filter (
      where sibling.id is not null
        and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
    ) as active_sibling_count,
    string_agg(
      format(
        'id=%s equipe=%s status=%s data=%s etapa=%s',
        sibling.id,
        coalesce(sibling_team.name, '[EQUIPE_NAO_ENCONTRADA]'),
        sibling.status,
        sibling.execution_date,
        coalesce(sibling.etapa_number::text, case
          when sibling.etapa_unica then 'ETAPA_UNICA'
          when sibling.etapa_final then 'ETAPA_FINAL'
          else 'SEM_ETAPA'
        end)
      ),
      ' | '
      order by sibling.execution_date, sibling.id
    ) filter (
      where sibling.id is not null
        and sibling.status in ('PROGRAMADA', 'REPROGRAMADA')
    ) as active_siblings
  from rows_base rb
  left join public.project_programming sibling
    on sibling.tenant_id = rb.tenant_id
   and sibling.programming_group_id = rb.programming_group_id
   and sibling.id <> rb.id
  left join public.teams sibling_team
    on sibling_team.tenant_id = sibling.tenant_id
   and sibling_team.id = sibling.team_id
  group by
    rb.tenant_id,
    rb.project_code,
    rb.project_id,
    rb.id,
    rb.execution_date,
    rb.status,
    rb.is_active,
    rb.team_id,
    rb.team_name,
    rb.etapa_number,
    rb.etapa_unica,
    rb.etapa_final,
    rb.programming_group_id,
    rb.work_completion_status,
    rb.work_completion_status_id,
    rb.catalog_code,
    rb.catalog_label,
    rb.text_code,
    rb.uuid_code,
    rb.updated_at,
    rb.created_at
)
select
  '01_DETALHE_LINHAS_ALVO' as section,
  project_code,
  id,
  execution_date,
  status,
  is_active,
  team_name,
  etapa_number,
  etapa_unica,
  etapa_final,
  programming_group_id,
  work_completion_status,
  work_completion_status_id,
  catalog_code,
  catalog_label,
  text_code,
  uuid_code,
  is_completed_by_text,
  is_completed_by_uuid,
  active_sibling_count,
  active_siblings,
  case
    when work_completion_status is null and uuid_code = 'CONCLUIDO' then
      'RISCO_TELA_VAZIA_UUID_CONCLUIDO'
    when text_code = 'CONCLUIDO' and uuid_code is null then
      'RISCO_TEXTO_CONCLUIDO_UUID_NULO'
    when text_code is distinct from uuid_code and work_completion_status is not null and work_completion_status_id is not null then
      'RISCO_TEXTO_UUID_DIVERGENTES'
    when (is_completed_by_text or is_completed_by_uuid) and status in ('PROGRAMADA', 'REPROGRAMADA') and active_sibling_count > 0 then
      'RISCO_277_BLOQUEIA_EDICAO_OPERACIONAL'
    else
      'OK'
  end as diagnostic_status,
  updated_at
from diagnostic
order by
  project_code,
  execution_date desc,
  updated_at desc,
  id;

with target_codes(code) as (
  values
    ('RC0323603639'),
    ('RC0323603633')
),
target_projects as (
  select
    p.tenant_id,
    p.id as project_id,
    p.sob as project_code
  from public.project p
  join target_codes tc
    on tc.code = p.sob
),
group_summary as (
  select
    tp.project_code,
    pp.tenant_id,
    pp.programming_group_id,
    min(pp.execution_date) as first_execution_date,
    max(pp.execution_date) as last_execution_date,
    count(*) as total_rows,
    count(*) filter (where pp.status in ('PROGRAMADA', 'REPROGRAMADA')) as active_rows,
    count(*) filter (
      where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
        and (
          public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
          or public.normalize_programming_work_completion_code(c.code) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(c.code) like 'CONCLUIDO%'
        )
    ) as active_completed_rows,
    string_agg(
      format(
        'id=%s equipe=%s status=%s data=%s estado_texto=%s estado_uuid=%s',
        pp.id,
        coalesce(t.name, '[EQUIPE_NAO_ENCONTRADA]'),
        pp.status,
        pp.execution_date,
        coalesce(pp.work_completion_status, 'NULL'),
        coalesce(c.code, 'NULL')
      ),
      ' | '
      order by pp.execution_date, pp.id
    ) as rows_detail
  from public.project_programming pp
  join target_projects tp
    on tp.tenant_id = pp.tenant_id
   and tp.project_id = pp.project_id
  left join public.programming_work_completion_catalog c
    on c.tenant_id = pp.tenant_id
   and c.id = pp.work_completion_status_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
  group by
    tp.project_code,
    pp.tenant_id,
    pp.programming_group_id
)
select
  '02_RESUMO_GRUPOS_OPERACIONAIS' as section,
  project_code,
  programming_group_id,
  first_execution_date,
  last_execution_date,
  total_rows,
  active_rows,
  active_completed_rows,
  case
    when active_completed_rows > 0 and active_rows > active_completed_rows then
      'RISCO_CONCLUIDO_COM_OUTRAS_LINHAS_ATIVAS_NO_GRUPO'
    when active_completed_rows > 1 then
      'RISCO_MULTIPLOS_CONCLUIDO_ATIVOS_NO_GRUPO'
    else
      'OK'
  end as diagnostic_status,
  rows_detail
from group_summary
order by
  project_code,
  diagnostic_status desc,
  last_execution_date desc,
  programming_group_id;

with target_codes(code) as (
  values
    ('RC0323603639'),
    ('RC0323603633')
),
target_projects as (
  select
    p.tenant_id,
    p.id as project_id,
    p.sob as project_code
  from public.project p
  join target_codes tc
    on tc.code = p.sob
),
missing_targets as (
  select tc.code
  from target_codes tc
  left join target_projects tp
    on tp.project_code = tc.code
  where tp.project_id is null
)
select
  '03_OBRAS_NAO_ENCONTRADAS' as section,
  code as project_code,
  case
    when code is not null then 'OBRA_NAO_ENCONTRADA_EM_PUBLIC_PROJECT'
    else 'OK'
  end as diagnostic_status
from missing_targets
order by project_code;
