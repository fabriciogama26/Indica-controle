-- 323_paginate_programming_list_by_project.sql
-- Achado 14: a lista cross-projeto paginava por ETAPA (.range em programming) e
-- so agrupava por projeto no frontend. Um projeto que cruzava a fronteira de
-- pagina aparecia partido em duas paginas, com contadores (etapas/equipes)
-- parciais.
--
-- Correcao: paginar por PROJETO. Esta RPC retorna os project_id DISTINTOS que
-- batem nos filtros, ordenados e ja paginados, junto do total de projetos
-- (count over()). O servidor entao busca TODAS as etapas (matching) dos projetos
-- daquela pagina — nunca parte um projeto.
--
-- Os filtros de busca (SOB/municipio -> p_project_ids) e de equipe (-> p_stage_ids
-- OU p_team_ids) sao resolvidos no servidor e passados aqui. O chip de status usa
-- a mesma semantica da tela (inclusive "pendencias abertas" do achado 8).

create or replace function public.programming_list_project_page(
  p_tenant_id uuid,
  p_date_from date,
  p_date_to date,
  p_project_ids uuid[] default null,
  p_stage_ids uuid[] default null,
  p_status_chip text default 'TODAS',
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (project_id uuid, total_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with matched as (
    select distinct p.project_id
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.execution_date is not null
      and p.execution_date >= p_date_from
      and p.execution_date <= p_date_to
      and (p_project_ids is null or p.project_id = any (p_project_ids))
      and (p_stage_ids is null or p.id = any (p_stage_ids))
      and (
        p_status_chip = 'TODAS'
        or (p_status_chip = 'PROGRAMADAS'
            and p.status in ('PROGRAMADA', 'REPROGRAMADA'))
        or (p_status_chip = 'PENDENCIAS'
            and p.is_pendencia
            and p.status in ('PROGRAMADA', 'REPROGRAMADA')
            and p.work_completion_status is distinct from 'CONCLUIDO')
        or (p_status_chip = 'ATRASADAS'
            and p.status in ('PROGRAMADA', 'REPROGRAMADA')
            and p.execution_date < p_today)
        or (p_status_chip = 'ADIADAS'
            and p.status = 'ADIADA')
      )
  ),
  ordered as (
    select project_id, count(*) over () as total_count
    from matched
    order by project_id
  )
  select project_id, total_count
  from ordered
  limit greatest(p_page_size, 0)
  offset greatest((p_page - 1) * p_page_size, 0);
$$;

-- Hardening de grants: service_role apenas (mesmo padrao das demais RPCs).
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'programming_list_project_page'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);

    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '323: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
