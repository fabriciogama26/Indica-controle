-- 327_list_project_page_em_espera_chip.sql
-- Achado 9: etapas "em espera" (ADIADA com execution_date NULL, criadas pelo
-- Adiar > Deixar em espera) sumiam da lista cross-projeto, porque a lista filtra
-- por intervalo de data e elas nao tem data. So apareciam abrindo o plano do
-- projeto — risco de esquecimento/duplicidade.
--
-- Correcao: novo chip 'EM_ESPERA'. Para ele, o filtro de DATA e ignorado de
-- proposito (nao ha data) e o recorte passa a ser status = 'ADIADA' AND
-- execution_date IS NULL. Os demais chips seguem exatamente como antes.
--
-- Recria programming_list_project_page (a 323 ja esta aplicada; migration
-- aplicada nao se edita).

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
      and (p_project_ids is null or p.project_id = any (p_project_ids))
      and (p_stage_ids is null or p.id = any (p_stage_ids))
      and (
        -- "Em espera": sem data, entao o intervalo de data NAO se aplica.
        (p_status_chip = 'EM_ESPERA'
         and p.status = 'ADIADA'
         and p.execution_date is null)
        or (
          p_status_chip <> 'EM_ESPERA'
          and p.execution_date is not null
          and p.execution_date >= p_date_from
          and p.execution_date <= p_date_to
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
        )
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

-- Hardening de grants: service_role apenas.
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
      raise exception '327: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
