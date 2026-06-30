-- audit-completed-group-reprogram-280-readonly.sql
--
-- Diagnostico read-only para identificar registros CONCLUIDO que seriam
-- bloqueados ao REPROGRAMAR para uma nova data com irmaos ativos.
--
-- Bug investigado (migration 280):
--   trg_project_programming_assign_group_id recalcula programming_group_id
--   quando execution_date muda. O trigger de integridade dispara para 'status'
--   no SET e ve CONCLUIDO + group diferente + irmaos no novo grupo -> excecao.
--
-- Este script nao altera dados.

-- ============================================================
-- SECAO 01: Registros CONCLUIDO ativos com irmaos ativos
-- ============================================================
select
  '01_CONCLUIDO_COM_IRMAOS' as section,
  p.sob as project_code,
  pp.id,
  pp.execution_date,
  pp.status,
  pp.programming_group_id,
  pp.work_completion_status,
  pp.work_completion_status_id,
  public.normalize_programming_work_completion_code(pp.work_completion_status) as text_code,
  coalesce(t.name, '[SEM_EQUIPE]') as team_name,
  pp.etapa_number,
  coalesce(pp.etapa_unica, false) as etapa_unica,
  coalesce(pp.etapa_final, false) as etapa_final,
  sibling_count.active_siblings,
  sibling_count.sibling_details,
  'RISCO_REPROGRAM_BLOQUEARIA' as diagnostic_status
from public.project_programming pp
join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
left join public.teams t
  on t.tenant_id = pp.tenant_id
 and t.id = pp.team_id
join lateral (
  select
    count(*) as active_siblings,
    string_agg(
      format('id=%s equipe=%s status=%s data=%s', s.id, coalesce(st.name, '?'), s.status, s.execution_date),
      ' | ' order by s.execution_date, s.id
    ) as sibling_details
  from public.project_programming s
  left join public.teams st on st.tenant_id = s.tenant_id and st.id = s.team_id
  where s.tenant_id = pp.tenant_id
    and s.programming_group_id = pp.programming_group_id
    and s.id <> pp.id
    and s.status in ('PROGRAMADA', 'REPROGRAMADA')
) sibling_count on true
where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  and (
    public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
    or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
  )
  and sibling_count.active_siblings > 0
order by p.sob, pp.execution_date desc, pp.id;

-- ============================================================
-- SECAO 02: Verificacao do estado dos triggers em project_programming
-- ============================================================
select
  '02_TRIGGERS_ESTADO' as section,
  t.tgname as trigger_name,
  case t.tgtype::integer & 66
    when 2 then 'BEFORE'
    when 64 then 'AFTER'
    else 'OTHER'
  end as timing,
  case t.tgtype::integer & 28
    when 4  then 'INSERT'
    when 8  then 'DELETE'
    when 16 then 'UPDATE'
    when 20 then 'INSERT OR UPDATE'
    when 28 then 'INSERT OR UPDATE OR DELETE'
    else t.tgtype::text
  end as event_type,
  p.proname as function_name,
  case
    when t.tgname = 'zz_trg_project_programming_completed_group_integrity' then
      case
        when pg_get_functiondef(p.oid) like '%coalesce(%v_new_is_completed%'
          or (pg_get_functiondef(p.oid) like '%v_old_canonical%' and pg_get_functiondef(p.oid) like '%coalesce(%')
        then '282_APLICADO'
        when pg_get_functiondef(p.oid) like '%v_old_canonical%'
          and pg_get_functiondef(p.oid) like '%v_new_canonical%'
        then '281_APLICADO_SEM_282'
        when pg_get_functiondef(p.oid) like '%v_was_same_active_completed_group%'
          and pg_get_functiondef(p.oid) like '%new.work_completion_status is not distinct from old.work_completion_status%'
        then '280_APLICADO_SEM_281'
        when pg_get_functiondef(p.oid) like '%v_was_same_active_completed_group%'
        then '279_APLICADO_SEM_280'
        else '277_SEM_BYPASS'
      end
    else 'N/A'
  end as migration_status
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'project_programming'
  and not t.tgisinternal
order by t.tgname;

-- ============================================================
-- SECAO 03: Contagem resumida por tenant
-- ============================================================
select
  '03_RESUMO_TENANT' as section,
  pp.tenant_id,
  count(*) as total_concluido_com_irmaos,
  string_agg(distinct p.sob, ', ' order by p.sob) as projects_afetados
from public.project_programming pp
join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  and (
    public.normalize_programming_work_completion_code(pp.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
    or public.normalize_programming_work_completion_code(pp.work_completion_status) like 'CONCLUIDO%'
  )
  and exists (
    select 1
    from public.project_programming s
    where s.tenant_id = pp.tenant_id
      and s.programming_group_id = pp.programming_group_id
      and s.id <> pp.id
      and s.status in ('PROGRAMADA', 'REPROGRAMADA')
  )
group by pp.tenant_id
order by total_concluido_com_irmaos desc;
