-- 305_align_cronograma_asbuilt_state_with_medicao.sql
-- Alinha a resolucao do "estado atual" da Programacao usada pela elegibilidade de As Built
-- com a regra ja adotada na Medicao (dashboard-measurement):
--   - ignora linhas com status CANCELADA
--   - exige work_completion_status preenchido (nao-nulo/nao-vazio)
--   - "ultimo" = maior execution_date, desempate por updated_at (sem usar etapa)
-- Continua sendo apenas leitura e executavel somente por service_role.

create or replace function public.get_cronograma_asbuilt_project_ids(p_tenant_id uuid)
returns table(project_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (pp.project_id)
      pp.project_id,
      upper(regexp_replace(btrim(coalesce(pp.work_completion_status, '')), '\s+', '_', 'g')) as status_code
    from public.project_programming pp
    where pp.tenant_id = p_tenant_id
      and pp.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is not null
    order by pp.project_id, pp.execution_date desc, pp.updated_at desc
  )
  select latest.project_id
  from latest
  where replace(latest.status_code, 'BENFICIO', 'BENEFICIO')
    in ('CONCLUIDO', 'CONCLUÍDO', 'PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO');
$$;

revoke all on function public.get_cronograma_asbuilt_project_ids(uuid)
from public, anon, authenticated;
grant execute on function public.get_cronograma_asbuilt_project_ids(uuid)
to service_role;
