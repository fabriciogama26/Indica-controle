-- 336_list_project_page_work_completion_filter.sql
-- Filtro por Estado do Trabalho (work_completion_status) na listagem da
-- Programacao Normalizada.
--
-- POR QUE PRECISA DE MIGRATION
-- ---------------------------------------------------------------------------
-- A listagem pagina POR PROJETO (323): a RPC programming_list_project_page
-- devolve a pagina de projetos e o total, e so depois o backend busca as etapas
-- desses projetos. Se o filtro fosse aplicado somente na busca das etapas
-- (passo 2), um projeto cujas etapas TODAS falham o filtro ainda ocuparia uma
-- vaga na pagina e apareceria vazio na tela, e o contador de total continuaria
-- contando projetos que nao tem nada a mostrar. O filtro tem que entrar tambem
-- no passo 1 — por isso a funcao e recriada aqui.
--
-- CONTRATO DO PARAMETRO
-- ---------------------------------------------------------------------------
-- p_work_completion_status text[] default null
--   - null ou array vazio => sem filtro (comportamento atual, inalterado).
--   - array com codigos   => etapa precisa ter work_completion_status em um deles.
--   - o sentinela '__EM_BRANCO__' representa "a fazer" (work_completion_status
--     IS NULL). Em branco e um estado REAL de negocio (etapa ainda nao executada,
--     ver 329), entao precisa ser filtravel — e NULL nao entra em `= any(array)`.
--     Um sentinela textual evita um segundo parametro booleano so para isso.
--   - combinacao: '__EM_BRANCO__' junto com codigos normais funciona como OU
--     (ex.: "em branco OU PARCIAL_PLANEJADO").
--
-- O parametro entra por ULTIMO e com default null, entao a assinatura continua
-- compativel com qualquer chamada existente que nao o informe.
--
-- INTERACAO COM OS CHIPS: o filtro e ORTOGONAL ao chip de status. Ele restringe
-- o conjunto que o chip ja selecionou (AND), inclusive nos chips que ignoram o
-- periodo (EM_ESPERA e SEM_RETORNO). Nota: o chip SEM_RETORNO ja exige
-- work_completion_status IS NULL por definicao, entao combina-lo com um Estado
-- do Trabalho preenchido devolve vazio — isso e correto, nao e bug.
--
-- Escopo: SOMENTE leitura/listagem e indice de apoio. Nenhuma regra de escrita
-- alterada, nenhuma coluna nova.

-- =============================================================================
-- 1) Indice de apoio ao filtro
-- =============================================================================
-- Cobre a combinacao real da consulta (tenant + estado + data), que e como o
-- filtro sempre chega: nunca se filtra Estado do Trabalho sem tenant.
create index if not exists programming_tenant_work_completion_idx
  on public.programming (tenant_id, work_completion_status, execution_date);

-- =============================================================================
-- 2) programming_list_project_page — ganha p_work_completion_status
-- =============================================================================
-- Recria a funcao (a 330 ja esta aplicada; migration aplicada nao se edita).
-- O corpo dos chips e identico ao da 330 — a unica adicao e a clausula final de
-- Estado do Trabalho, aplicada em AND sobre o resultado dos chips.
create or replace function public.programming_list_project_page(
  p_tenant_id uuid,
  p_date_from date,
  p_date_to date,
  p_project_ids uuid[] default null,
  p_stage_ids uuid[] default null,
  p_status_chip text default 'TODAS',
  p_today date default current_date,
  p_page integer default 1,
  p_page_size integer default 50,
  p_work_completion_status text[] default null
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
      -- Estado do Trabalho (ortogonal ao chip). Sem valores = sem filtro.
      and (
        p_work_completion_status is null
        or cardinality(p_work_completion_status) = 0
        or p.work_completion_status = any (p_work_completion_status)
        or ('__EM_BRANCO__' = any (p_work_completion_status)
            and p.work_completion_status is null)
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

-- =============================================================================
-- 3) Hardening de grants: service_role apenas
-- =============================================================================
-- Recriar a funcao com assinatura NOVA cria uma SOBRECARGA: a versao de 9
-- parametros da 330 continua existindo ao lado da nova de 10. O loop abaixo
-- percorre TODAS as sobrecargas do nome, entao ambas ficam restritas a
-- service_role. A sobrecarga antiga e inofensiva (o backend passa o parametro
-- novo por nome) e nao e dropada aqui de proposito: dropar quebraria qualquer
-- chamada em voo durante o deploy.
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
      raise exception '336: funcao % ainda executavel por anon/authenticated', v_fn;
    end if;
  end loop;
end;
$$;
