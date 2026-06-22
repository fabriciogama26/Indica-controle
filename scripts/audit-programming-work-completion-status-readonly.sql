-- audit-programming-work-completion-status-readonly.sql
-- Auditoria read-only de Estado Trabalho em branco na Programacao.
-- Nao possui INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE ou chamadas RPC.
--
-- Uso:
-- 1. Execute em ambiente Supabase/Postgres com acesso de leitura.
-- 2. Analise as abas de resultado na ordem.
-- 3. Use a coluna `suggested_work_completion_status` apenas como diagnostico para uma migration/backfill futura.

-- 1) Catalogo disponivel por tenant.
select
  c.tenant_id,
  c.code,
  c.label_pt,
  c.is_active,
  c.sort_order
from public.programming_work_completion_catalog c
where c.code in ('PARCIAL', 'CONCLUIDO', 'ANTECIPADO')
order by c.tenant_id, c.sort_order, c.code;

-- 1.1) Catalogo completo por tenant para revisar o que aparece no select da tela.
select
  c.tenant_id,
  c.id,
  c.code,
  c.label_pt,
  public.normalize_programming_work_completion_code(c.code) as normalized_code,
  public.normalize_programming_work_completion_code(c.label_pt) as normalized_label,
  c.is_active,
  c.sort_order,
  c.created_at,
  c.updated_at
from public.programming_work_completion_catalog c
order by c.tenant_id, c.is_active desc, c.sort_order, c.label_pt, c.code;

-- 1.2) Duplicidade tecnica: mesmo codigo normalizado cadastrado mais de uma vez no tenant.
select
  c.tenant_id,
  public.normalize_programming_work_completion_code(c.code) as normalized_code,
  count(*) as total,
  string_agg(c.code, ' | ' order by c.sort_order, c.code) as codes,
  string_agg(c.label_pt, ' | ' order by c.sort_order, c.label_pt) as labels,
  count(*) filter (where c.is_active = true) as ativos
from public.programming_work_completion_catalog c
group by c.tenant_id, public.normalize_programming_work_completion_code(c.code)
having count(*) > 1
order by c.tenant_id, total desc, normalized_code;

-- 1.3) Duplicidade visual: labels normalizados iguais com codigos diferentes.
select
  c.tenant_id,
  public.normalize_programming_work_completion_code(c.label_pt) as normalized_label,
  count(*) as total,
  string_agg(c.code, ' | ' order by c.sort_order, c.code) as codes,
  string_agg(c.label_pt, ' | ' order by c.sort_order, c.label_pt) as labels,
  count(*) filter (where c.is_active = true) as ativos
from public.programming_work_completion_catalog c
group by c.tenant_id, public.normalize_programming_work_completion_code(c.label_pt)
having count(*) > 1
order by c.tenant_id, total desc, normalized_label;

-- 1.4) Valores parecidos/suspeitos que podem confundir o usuario no select.
select
  c.tenant_id,
  c.code,
  c.label_pt,
  public.normalize_programming_work_completion_code(c.code) as normalized_code,
  public.normalize_programming_work_completion_code(c.label_pt) as normalized_label,
  c.is_active,
  c.sort_order,
  case
    when public.normalize_programming_work_completion_code(c.code) in ('ANTECIPADO', 'ANTECIPADA') then
      'ANTECIPADO_OFICIAL_E_ANTECIPADA_LEGADO'
    when public.normalize_programming_work_completion_code(c.code) like 'SUSPEN%' then
      'SUSPENSAO_VERIFICAR_GRAFIA'
    when public.normalize_programming_work_completion_code(c.code) like 'PENDEN%' then
      'PENDENCIA_VERIFICAR_PADRAO'
    when public.normalize_programming_work_completion_code(c.code) like 'PARCIAL_PLANEJADO%' then
      'PARCIAL_PLANEJADO_VERIFICAR_SE_SAO_ESTADOS_DISTINTOS'
    else
      'OUTRO'
  end as catalog_review_reason
from public.programming_work_completion_catalog c
where c.is_active = true
  and (
    public.normalize_programming_work_completion_code(c.code) in ('ANTECIPADO', 'ANTECIPADA')
    or public.normalize_programming_work_completion_code(c.code) like 'SUSPEN%'
    or public.normalize_programming_work_completion_code(c.code) like 'PENDEN%'
    or public.normalize_programming_work_completion_code(c.code) like 'PARCIAL_PLANEJADO%'
  )
order by c.tenant_id, catalog_review_reason, c.sort_order, c.label_pt;

-- 2) Resumo geral por tenant e status operacional.
select
  pp.tenant_id,
  pp.status,
  count(*) as total_programacoes,
  count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as estado_trabalho_branco,
  count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is not null) as estado_trabalho_preenchido,
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
  ) as ativos_com_estado_trabalho_branco
from public.project_programming pp
group by pp.tenant_id, pp.status
order by pp.tenant_id, pp.status;

-- 3) Resumo por projeto para localizar maiores focos de Estado Trabalho em branco.
select
  pp.tenant_id,
  p.sob as projeto,
  count(*) as total_programacoes,
  count(*) filter (where pp.status in ('PROGRAMADA', 'REPROGRAMADA')) as total_ativas,
  count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as total_branco,
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
  ) as ativas_branco,
  min(pp.execution_date) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as primeira_data_branco,
  max(pp.execution_date) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as ultima_data_branco
from public.project_programming pp
join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
group by pp.tenant_id, p.sob
having count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) > 0
order by ativas_branco desc, total_branco desc, pp.tenant_id, p.sob;

-- 4) Detalhe dos registros com Estado Trabalho em branco e sugestao read-only.
with blank_rows as (
  select
    pp.*,
    p.sob as projeto,
    t.name as equipe
  from public.project_programming pp
  join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
  where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
),
diagnostic as (
  select
    br.*,
    same_day_status.work_completion_status as same_project_date_status,
    source_status.work_completion_status as source_programming_status,
    previous_status.work_completion_status as previous_project_status,
    concluded_before.id as concluded_before_id,
    concluded_before.etapa_number as concluded_before_etapa_number,
    concluded_before.execution_date as concluded_before_execution_date,
    concluded_before.work_completion_status as concluded_before_status,
    partial_catalog.code as partial_catalog_code,
    anticipated_catalog.code as anticipated_catalog_code
  from blank_rows br
  left join lateral (
    select pp_same.work_completion_status
    from public.project_programming pp_same
    where pp_same.tenant_id = br.tenant_id
      and pp_same.project_id = br.project_id
      and pp_same.execution_date = br.execution_date
      and pp_same.id <> br.id
      and pp_same.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null
    order by pp_same.updated_at desc, pp_same.created_at desc
    limit 1
  ) same_day_status on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming_history ph
    join public.project_programming pp_source
      on pp_source.tenant_id = ph.tenant_id
     and pp_source.id = ph.related_programming_id
    where ph.tenant_id = br.tenant_id
      and ph.programming_id = br.id
      and ph.related_programming_id is not null
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    order by ph.created_at desc
    limit 1
  ) source_status on true
  left join lateral (
    select pp_prev.work_completion_status
    from public.project_programming pp_prev
    join public.programming_work_completion_catalog c_prev
      on c_prev.tenant_id = pp_prev.tenant_id
     and c_prev.code = public.normalize_programming_work_completion_code(pp_prev.work_completion_status)
     and c_prev.is_active = true
    where pp_prev.tenant_id = br.tenant_id
      and pp_prev.project_id = br.project_id
      and pp_prev.id <> br.id
      and pp_prev.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp_prev.work_completion_status, '')), '') is not null
      and (
        pp_prev.execution_date < br.execution_date
        or (pp_prev.execution_date = br.execution_date and pp_prev.updated_at < br.updated_at)
      )
    order by pp_prev.execution_date desc, pp_prev.updated_at desc, pp_prev.created_at desc
    limit 1
  ) previous_status on true
  left join lateral (
    select pp_done.id, pp_done.etapa_number, pp_done.execution_date, pp_done.work_completion_status
    from public.project_programming pp_done
    where pp_done.tenant_id = br.tenant_id
      and pp_done.project_id = br.project_id
      and pp_done.id <> br.id
      and pp_done.etapa_number is not null
      and br.etapa_number is not null
      and pp_done.etapa_number < br.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp_done.etapa_number desc, pp_done.execution_date desc, pp_done.updated_at desc
    limit 1
  ) concluded_before on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = br.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
  left join public.programming_work_completion_catalog anticipated_catalog
    on anticipated_catalog.tenant_id = br.tenant_id
   and anticipated_catalog.code = 'ANTECIPADO'
   and anticipated_catalog.is_active = true
)
select
  tenant_id,
  id as programming_id,
  projeto,
  project_id,
  coalesce(equipe, team_id::text) as equipe,
  team_id,
  execution_date,
  status,
  is_active,
  etapa_number,
  etapa_unica,
  etapa_final,
  created_at,
  updated_at,
  cancellation_reason,
  copied_from_programming_id,
  same_project_date_status,
  source_programming_status,
  previous_project_status,
  concluded_before_id,
  concluded_before_etapa_number,
  concluded_before_execution_date,
  case
    when status not in ('PROGRAMADA', 'REPROGRAMADA') then
      'SEM_BACKFILL_AUTOMATICO_INATIVA'
    when same_project_date_status is not null then
      'HERDAR_MESMO_PROJETO_DATA'
    when source_programming_status is not null then
      'HERDAR_PROGRAMACAO_ORIGEM'
    when concluded_before_id is not null and anticipated_catalog_code is not null then
      'ETAPA_POSTERIOR_A_CONCLUIDO'
    when previous_project_status is not null then
      'HERDAR_ULTIMO_ESTADO_DO_PROJETO'
    when partial_catalog_code is not null then
      'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
    else
      'CATALOGO_INCOMPLETO'
  end as probable_cause,
  case
    when status not in ('PROGRAMADA', 'REPROGRAMADA') then
      null
    when same_project_date_status is not null then
      public.normalize_programming_work_completion_code(same_project_date_status)
    when source_programming_status is not null then
      public.normalize_programming_work_completion_code(source_programming_status)
    when concluded_before_id is not null and anticipated_catalog_code is not null then
      'ANTECIPADO'
    when previous_project_status is not null then
      public.normalize_programming_work_completion_code(previous_project_status)
    when partial_catalog_code is not null then
      'PARCIAL'
    else
      null
  end as suggested_work_completion_status
from diagnostic
order by
  tenant_id,
  case when status in ('PROGRAMADA', 'REPROGRAMADA') then 0 else 1 end,
  projeto,
  execution_date,
  etapa_number nulls last,
  equipe;

-- 5) Totais por causa provavel, para decidir a ordem do backfill.
with blank_rows as (
  select
    pp.*,
    p.sob as projeto
  from public.project_programming pp
  join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
),
diagnostic as (
  select
    br.*,
    same_day_status.work_completion_status as same_project_date_status,
    source_status.work_completion_status as source_programming_status,
    previous_status.work_completion_status as previous_project_status,
    concluded_before.id as concluded_before_id,
    partial_catalog.code as partial_catalog_code,
    anticipated_catalog.code as anticipated_catalog_code
  from blank_rows br
  left join lateral (
    select pp_same.work_completion_status
    from public.project_programming pp_same
    where pp_same.tenant_id = br.tenant_id
      and pp_same.project_id = br.project_id
      and pp_same.execution_date = br.execution_date
      and pp_same.id <> br.id
      and pp_same.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null
    order by pp_same.updated_at desc, pp_same.created_at desc
    limit 1
  ) same_day_status on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming_history ph
    join public.project_programming pp_source
      on pp_source.tenant_id = ph.tenant_id
     and pp_source.id = ph.related_programming_id
    where ph.tenant_id = br.tenant_id
      and ph.programming_id = br.id
      and ph.related_programming_id is not null
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    order by ph.created_at desc
    limit 1
  ) source_status on true
  left join lateral (
    select pp_prev.work_completion_status
    from public.project_programming pp_prev
    join public.programming_work_completion_catalog c_prev
      on c_prev.tenant_id = pp_prev.tenant_id
     and c_prev.code = public.normalize_programming_work_completion_code(pp_prev.work_completion_status)
     and c_prev.is_active = true
    where pp_prev.tenant_id = br.tenant_id
      and pp_prev.project_id = br.project_id
      and pp_prev.id <> br.id
      and pp_prev.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp_prev.work_completion_status, '')), '') is not null
      and (
        pp_prev.execution_date < br.execution_date
        or (pp_prev.execution_date = br.execution_date and pp_prev.updated_at < br.updated_at)
      )
    order by pp_prev.execution_date desc, pp_prev.updated_at desc, pp_prev.created_at desc
    limit 1
  ) previous_status on true
  left join lateral (
    select pp_done.id
    from public.project_programming pp_done
    where pp_done.tenant_id = br.tenant_id
      and pp_done.project_id = br.project_id
      and pp_done.id <> br.id
      and pp_done.etapa_number is not null
      and br.etapa_number is not null
      and pp_done.etapa_number < br.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp_done.etapa_number desc, pp_done.execution_date desc, pp_done.updated_at desc
    limit 1
  ) concluded_before on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = br.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
  left join public.programming_work_completion_catalog anticipated_catalog
    on anticipated_catalog.tenant_id = br.tenant_id
   and anticipated_catalog.code = 'ANTECIPADO'
   and anticipated_catalog.is_active = true
)
select
  tenant_id,
  case
    when status not in ('PROGRAMADA', 'REPROGRAMADA') then
      'SEM_BACKFILL_AUTOMATICO_INATIVA'
    when same_project_date_status is not null then
      'HERDAR_MESMO_PROJETO_DATA'
    when source_programming_status is not null then
      'HERDAR_PROGRAMACAO_ORIGEM'
    when concluded_before_id is not null and anticipated_catalog_code is not null then
      'ETAPA_POSTERIOR_A_CONCLUIDO'
    when previous_project_status is not null then
      'HERDAR_ULTIMO_ESTADO_DO_PROJETO'
    when partial_catalog_code is not null then
      'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
    else
      'CATALOGO_INCOMPLETO'
  end as probable_cause,
  status,
  count(*) as total
from diagnostic
group by tenant_id, probable_cause, status
order by tenant_id, total desc, probable_cause, status;

-- 6) Buracos de regra ainda possiveis em registros ativos.
select
  pp.tenant_id,
  p.sob as projeto,
  pp.project_id,
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
  ) as ativos_sem_estado_trabalho,
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is null
      and coalesce(pp.etapa_unica, false) = false
      and coalesce(pp.etapa_final, false) = false
  ) as ativos_sem_etapa_numerica_ou_flag,
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and exists (
        select 1
        from public.project_programming pp_done
        where pp_done.tenant_id = pp.tenant_id
          and pp_done.project_id = pp.project_id
          and pp_done.etapa_number < pp.etapa_number
          and (
            public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
          )
      )
      and public.normalize_programming_work_completion_code(pp.work_completion_status) is distinct from 'ANTECIPADO'
  ) as etapas_posteriores_a_concluido_nao_antecipadas
from public.project_programming pp
join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
group by pp.tenant_id, p.sob, pp.project_id
having
  count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
  ) > 0
  or count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is null
      and coalesce(pp.etapa_unica, false) = false
      and coalesce(pp.etapa_final, false) = false
  ) > 0
  or count(*) filter (
    where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
      and pp.etapa_number is not null
      and exists (
        select 1
        from public.project_programming pp_done
        where pp_done.tenant_id = pp.tenant_id
          and pp_done.project_id = pp.project_id
          and pp_done.etapa_number < pp.etapa_number
          and (
            public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
            or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
          )
      )
      and public.normalize_programming_work_completion_code(pp.work_completion_status) is distinct from 'ANTECIPADO'
  ) > 0
order by ativos_sem_estado_trabalho desc, etapas_posteriores_a_concluido_nao_antecipadas desc, p.sob;
