-- 330_list_project_page_sem_retorno_chip.sql
-- Chip "Pendencias sem retorno" (SEM_RETORNO).
--
-- NAO cria status novo nem coluna persistida: e uma condicao DERIVADA, avaliada
-- na consulta:
--
--   is_pendencia = true
--   AND status IN ('PROGRAMADA', 'REPROGRAMADA')
--   AND execution_date < p_today
--   AND work_completion_status IS NULL
--
-- A etapa deixa de ser "sem retorno" sozinha quando qualquer uma destas coisas
-- acontecer (nenhuma escrita nova e necessaria):
--   - Estado do Trabalho for preenchido  -> work_completion_status deixa de ser null;
--   - pendencia for desmarcada           -> is_pendencia = false;
--   - etapa for adiada/cancelada/antecipada -> sai de PROGRAMADA/REPROGRAMADA
--                                             (e o "em espera" ainda zera a data);
--   - data for corrigida para hoje/futuro -> execution_date >= p_today.
--
-- Pendencia recem-criada com Estado do Trabalho vazio NAO e "sem retorno":
-- so entra depois que a data de execucao passa. Isso preserva a separacao entre
-- "por que a etapa existe" (is_pendencia) e "o que aconteceu na execucao"
-- (work_completion_status) — ver 329.
--
-- PERIODO: o chip IGNORA o intervalo de data selecionado, igual ao "Em espera"
-- (327). Se respeitasse o periodo, uma pendencia sem retorno de meses anteriores
-- continuaria escondida — justamente a que precisa de cobranca.
--
-- p_today vem do SERVIDOR (route.ts), nunca do relogio do navegador, para nao
-- divergir perto da meia-noite.
--
-- Escopo desta migration: SOMENTE o filtro/listagem e o indice. Nenhuma regra de
-- escrita e alterada aqui.

-- =============================================================================
-- 1) Indice parcial de apoio ao filtro
-- =============================================================================
create index if not exists programming_pending_without_return_idx
  on public.programming (tenant_id, execution_date, project_id)
  where is_pendencia = true
    and status in ('PROGRAMADA', 'REPROGRAMADA')
    and work_completion_status is null;

-- =============================================================================
-- 2) programming_list_project_page — aceita o chip SEM_RETORNO
-- =============================================================================
-- Recria a funcao (a 327 ja esta aplicada; migration aplicada nao se edita).
-- Mantem a paginacao POR PROJETO dos demais filtros.
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
        -- "Pendencias sem retorno": condicao derivada; tambem IGNORA o periodo.
        or (p_status_chip = 'SEM_RETORNO'
            and p.is_pendencia
            and p.status in ('PROGRAMADA', 'REPROGRAMADA')
            and p.execution_date is not null
            and p.execution_date < p_today
            and p.work_completion_status is null)
        or (
          p_status_chip not in ('EM_ESPERA', 'SEM_RETORNO')
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
      raise exception '330: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
