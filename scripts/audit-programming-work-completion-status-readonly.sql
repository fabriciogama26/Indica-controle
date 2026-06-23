-- audit-programming-work-completion-status-readonly.sql
-- Auditoria read-only de regras de Estado Trabalho na Programacao.
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
  coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
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
left join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
group by pp.tenant_id, coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]')
having count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) > 0
order by ativas_branco desc, total_branco desc, pp.tenant_id, projeto;

-- 4) Detalhe dos registros com Estado Trabalho em branco e sugestao read-only.
with blank_rows as (
  select
    pp.*,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    t.name as equipe
  from public.project_programming pp
  left join public.project p
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
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto
  from public.project_programming pp
  left join public.project p
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
  coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
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
left join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
group by pp.tenant_id, coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]'), pp.project_id
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
order by ativos_sem_estado_trabalho desc, etapas_posteriores_a_concluido_nao_antecipadas desc, projeto;

-- 7) Catalogo obrigatorio por tenant: PARCIAL, CONCLUIDO e ANTECIPADO precisam existir ativos.
with required_codes(code) as (
  values ('PARCIAL'), ('CONCLUIDO'), ('ANTECIPADO')
),
tenant_codes as (
  select distinct tenant_id
  from public.programming_work_completion_catalog
)
select
  tc.tenant_id,
  rc.code as required_code,
  c.id as catalog_id,
  c.label_pt,
  coalesce(c.is_active, false) as is_active,
  case
    when c.id is null then 'AUSENTE'
    when c.is_active = false then 'INATIVO'
    else 'OK'
  end as rule_status
from tenant_codes tc
cross join required_codes rc
left join public.programming_work_completion_catalog c
  on c.tenant_id = tc.tenant_id
 and c.code = rc.code
order by tc.tenant_id, rc.code;

-- 8) Valores preenchidos em project_programming que nao batem com catalogo ativo do tenant.
select
  pp.tenant_id,
  coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
  pp.id as programming_id,
  pp.project_id,
  pp.team_id,
  t.name as equipe,
  pp.execution_date,
  pp.status,
  pp.etapa_number,
  pp.etapa_unica,
  pp.etapa_final,
  pp.work_completion_status,
  public.normalize_programming_work_completion_code(pp.work_completion_status) as normalized_work_completion_status,
  c.code as active_catalog_code,
  case
    when nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null then
      'BRANCO'
    when c.code is null then
      'FORA_DO_CATALOGO_ATIVO'
    else
      'OK'
  end as rule_status
from public.project_programming pp
left join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
left join public.teams t
  on t.tenant_id = pp.tenant_id
 and t.id = pp.team_id
left join public.programming_work_completion_catalog c
  on c.tenant_id = pp.tenant_id
 and c.code = public.normalize_programming_work_completion_code(pp.work_completion_status)
 and c.is_active = true
where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is not null
  and c.code is null
order by pp.tenant_id, projeto, pp.execution_date, t.name, pp.id;

-- 9) Grupos ativos por Projeto + Data com branco ou divergencia de Estado Trabalho entre equipes.
with active_group as (
  select
    pp.tenant_id,
    pp.project_id,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    pp.execution_date,
    count(*) as total_ativas,
    count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as total_branco,
    count(distinct public.normalize_programming_work_completion_code(pp.work_completion_status))
      filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is not null) as estados_distintos,
    string_agg(
      distinct coalesce(public.normalize_programming_work_completion_code(pp.work_completion_status), 'BRANCO'),
      ' | '
      order by coalesce(public.normalize_programming_work_completion_code(pp.work_completion_status), 'BRANCO')
    ) as estados_no_grupo,
    string_agg(
      coalesce(t.name, pp.team_id::text) || ':' || coalesce(public.normalize_programming_work_completion_code(pp.work_completion_status), 'BRANCO'),
      ' | '
      order by coalesce(t.name, pp.team_id::text)
    ) as equipes_e_estados
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  group by pp.tenant_id, pp.project_id, coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]'), pp.execution_date
)
select
  tenant_id,
  projeto,
  project_id,
  execution_date,
  total_ativas,
  total_branco,
  estados_distintos,
  estados_no_grupo,
  equipes_e_estados,
  case
    when total_branco > 0 and estados_distintos > 0 then 'HERDAR_ESTADO_DO_GRUPO'
    when total_branco > 0 then 'GRUPO_ATIVO_SEM_ESTADO'
    when estados_distintos > 1 then 'DIVERGENCIA_ENTRE_EQUIPES'
    else 'OK'
  end as rule_status
from active_group
where total_branco > 0
   or estados_distintos > 1
order by total_branco desc, estados_distintos desc, tenant_id, projeto, execution_date;

-- 10) Matriz por registro ativo: todas as regras principais em uma linha.
with active_rows as (
  select
    pp.*,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    (p.id is null) as projeto_nao_encontrado,
    t.name as equipe
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
),
diagnostic as (
  select
    ar.*,
    catalog.code as active_catalog_code,
    same_day.total_ativas_same_day,
    same_day.total_branco_same_day,
    same_day.estados_distintos_same_day,
    same_day.any_same_day_status,
    previous_project.work_completion_status as previous_project_status,
    source_programming.work_completion_status as source_programming_status,
    concluded_before.id as concluded_before_id,
    concluded_before.etapa_number as concluded_before_etapa_number,
    partial_catalog.code as partial_catalog_code,
    anticipated_catalog.code as anticipated_catalog_code
  from active_rows ar
  left join public.programming_work_completion_catalog catalog
    on catalog.tenant_id = ar.tenant_id
   and catalog.code = public.normalize_programming_work_completion_code(ar.work_completion_status)
   and catalog.is_active = true
  left join lateral (
    select
      count(*) as total_ativas_same_day,
      count(*) filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is null) as total_branco_same_day,
      count(distinct public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as estados_distintos_same_day,
      max(public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as any_same_day_status
    from public.project_programming pp_same
    where pp_same.tenant_id = ar.tenant_id
      and pp_same.project_id = ar.project_id
      and pp_same.execution_date = ar.execution_date
      and pp_same.status in ('PROGRAMADA', 'REPROGRAMADA')
  ) same_day on true
  left join lateral (
    select pp_prev.work_completion_status
    from public.project_programming pp_prev
    join public.programming_work_completion_catalog c_prev
      on c_prev.tenant_id = pp_prev.tenant_id
     and c_prev.code = public.normalize_programming_work_completion_code(pp_prev.work_completion_status)
     and c_prev.is_active = true
    where pp_prev.tenant_id = ar.tenant_id
      and pp_prev.project_id = ar.project_id
      and pp_prev.id <> ar.id
      and pp_prev.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp_prev.work_completion_status, '')), '') is not null
      and (
        pp_prev.execution_date < ar.execution_date
        or (pp_prev.execution_date = ar.execution_date and pp_prev.updated_at < ar.updated_at)
      )
    order by pp_prev.execution_date desc, pp_prev.updated_at desc, pp_prev.created_at desc
    limit 1
  ) previous_project on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming pp_source
    where pp_source.tenant_id = ar.tenant_id
      and pp_source.id = ar.copied_from_programming_id
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    limit 1
  ) source_programming on true
  left join lateral (
    select pp_done.id, pp_done.etapa_number
    from public.project_programming pp_done
    where pp_done.tenant_id = ar.tenant_id
      and pp_done.project_id = ar.project_id
      and pp_done.id <> ar.id
      and pp_done.etapa_number is not null
      and ar.etapa_number is not null
      and pp_done.etapa_number < ar.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp_done.etapa_number desc, pp_done.execution_date desc, pp_done.updated_at desc
    limit 1
  ) concluded_before on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = ar.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
  left join public.programming_work_completion_catalog anticipated_catalog
    on anticipated_catalog.tenant_id = ar.tenant_id
   and anticipated_catalog.code = 'ANTECIPADO'
   and anticipated_catalog.is_active = true
)
select
  tenant_id,
  projeto,
  id as programming_id,
  project_id,
  projeto_nao_encontrado,
  coalesce(equipe, team_id::text) as equipe,
  team_id,
  execution_date,
  status,
  etapa_number,
  etapa_unica,
  etapa_final,
  work_completion_status,
  public.normalize_programming_work_completion_code(work_completion_status) as normalized_work_completion_status,
  copied_from_programming_id,
  created_at,
  updated_at,
  case
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null then true
    else false
  end as regra_ativo_sem_estado_trabalho,
  case
    when projeto_nao_encontrado then true
    else false
  end as regra_projeto_nao_encontrado,
  case
    when nullif(btrim(coalesce(work_completion_status, '')), '') is not null
      and active_catalog_code is null then true
    else false
  end as regra_estado_fora_catalogo_ativo,
  case
    when etapa_number is null
      and coalesce(etapa_unica, false) = false
      and coalesce(etapa_final, false) = false then true
    else false
  end as regra_sem_etapa_ou_flag,
  case
    when total_branco_same_day > 0 and estados_distintos_same_day > 0 then true
    else false
  end as regra_deveria_herdar_mesmo_projeto_data,
  case
    when estados_distintos_same_day > 1 then true
    else false
  end as regra_divergencia_mesmo_projeto_data,
  case
    when copied_from_programming_id is not null
      and nullif(btrim(coalesce(work_completion_status, '')), '') is null
      and source_programming_status is not null then true
    else false
  end as regra_copia_sem_herdar_estado_origem,
  case
    when concluded_before_id is not null
      and public.normalize_programming_work_completion_code(work_completion_status) is distinct from 'ANTECIPADO' then true
    else false
  end as regra_posterior_concluido_nao_antecipado,
  case
    when nullif(btrim(coalesce(work_completion_status, '')), '') is not null then
      public.normalize_programming_work_completion_code(work_completion_status)
    when any_same_day_status is not null then
      any_same_day_status
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
  end as suggested_work_completion_status,
  case
    when projeto_nao_encontrado then
      'PROJETO_NAO_ENCONTRADO'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null and any_same_day_status is not null then
      'HERDAR_MESMO_PROJETO_DATA'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null and source_programming_status is not null then
      'HERDAR_PROGRAMACAO_ORIGEM'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null and concluded_before_id is not null then
      'ETAPA_POSTERIOR_A_CONCLUIDO'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null and previous_project_status is not null then
      'HERDAR_ULTIMO_ESTADO_DO_PROJETO'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null and partial_catalog_code is not null then
      'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is not null and active_catalog_code is null then
      'ESTADO_FORA_CATALOGO_ATIVO'
    when etapa_number is null and coalesce(etapa_unica, false) = false and coalesce(etapa_final, false) = false then
      'SEM_ETAPA_OU_FLAG'
    when estados_distintos_same_day > 1 then
      'DIVERGENCIA_MESMO_PROJETO_DATA'
    when concluded_before_id is not null
      and public.normalize_programming_work_completion_code(work_completion_status) is distinct from 'ANTECIPADO' then
      'POSTERIOR_A_CONCLUIDO_NAO_ANTECIPADO'
    when nullif(btrim(coalesce(work_completion_status, '')), '') is null then
      'ATIVO_SEM_ESTADO_SEM_SUGESTAO'
    else
      'OK'
  end as primary_rule_status
from diagnostic
where nullif(btrim(coalesce(work_completion_status, '')), '') is null
   or projeto_nao_encontrado
   or (
      nullif(btrim(coalesce(work_completion_status, '')), '') is not null
      and active_catalog_code is null
   )
   or (
      etapa_number is null
      and coalesce(etapa_unica, false) = false
      and coalesce(etapa_final, false) = false
   )
   or (total_branco_same_day > 0 and estados_distintos_same_day > 0)
   or estados_distintos_same_day > 1
   or (
      copied_from_programming_id is not null
      and nullif(btrim(coalesce(work_completion_status, '')), '') is null
      and source_programming_status is not null
   )
   or (
      concluded_before_id is not null
      and public.normalize_programming_work_completion_code(work_completion_status) is distinct from 'ANTECIPADO'
   )
order by tenant_id, projeto, execution_date, etapa_number nulls last, equipe;

-- 11) Registros criados por copia/adicao/reprogramacao com Estado Trabalho branco ou divergente da origem.
select
  pp.tenant_id,
  coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
  pp.id as programming_id,
  pp.project_id,
  (p.id is null) as projeto_nao_encontrado,
  coalesce(t.name, pp.team_id::text) as equipe,
  pp.team_id,
  pp.execution_date,
  pp.status,
  pp.etapa_number,
  pp.work_completion_status,
  pp.copied_from_programming_id,
  source_pp.work_completion_status as source_work_completion_status,
  ph.related_programming_id as last_history_related_programming_id,
  related_pp.work_completion_status as related_history_work_completion_status,
  ph.action_type as last_history_action_type,
  ph.metadata as last_history_metadata,
  case
    when nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
      and source_pp.work_completion_status is not null then
      'COPIA_COM_ORIGEM_PREENCHIDA_E_DESTINO_BRANCO'
    when nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
      and related_pp.work_completion_status is not null then
      'HISTORICO_COM_ORIGEM_PREENCHIDA_E_DESTINO_BRANCO'
    when pp.status = 'REPROGRAMADA'
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null then
      'REPROGRAMADA_COM_ESTADO_BRANCO'
    when p.id is null then
      'PROJETO_NAO_ENCONTRADO'
    when pp.copied_from_programming_id is not null
      and source_pp.id is null then
      'COPIA_COM_ORIGEM_NAO_ENCONTRADA'
    else
      'REVISAR'
  end as rule_status,
  coalesce(
    public.normalize_programming_work_completion_code(source_pp.work_completion_status),
    public.normalize_programming_work_completion_code(related_pp.work_completion_status)
  ) as suggested_work_completion_status
from public.project_programming pp
left join public.project p
  on p.tenant_id = pp.tenant_id
 and p.id = pp.project_id
left join public.teams t
  on t.tenant_id = pp.tenant_id
 and t.id = pp.team_id
left join public.project_programming source_pp
  on source_pp.tenant_id = pp.tenant_id
 and source_pp.id = pp.copied_from_programming_id
left join lateral (
  select ph_inner.*
  from public.project_programming_history ph_inner
  where ph_inner.tenant_id = pp.tenant_id
    and ph_inner.programming_id = pp.id
    and ph_inner.related_programming_id is not null
  order by ph_inner.created_at desc
  limit 1
) ph on true
left join public.project_programming related_pp
  on related_pp.tenant_id = ph.tenant_id
 and related_pp.id = ph.related_programming_id
where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
  and (
    (
      pp.copied_from_programming_id is not null
      and (
        source_pp.id is null
        or (
          nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
          and source_pp.work_completion_status is not null
        )
      )
    )
    or (
      ph.related_programming_id is not null
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
      and related_pp.work_completion_status is not null
    )
    or (
      pp.status = 'REPROGRAMADA'
      and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
    )
  )
order by pp.tenant_id, projeto, pp.execution_date, equipe;

-- 12) Resumo executivo por regra de negocio.
with active_rows as (
  select pp.*
  from public.project_programming pp
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
),
same_day_groups as (
  select
    pp.tenant_id,
    pp.project_id,
    pp.execution_date,
    count(*) filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null) as total_branco,
    count(distinct public.normalize_programming_work_completion_code(pp.work_completion_status))
      filter (where nullif(btrim(coalesce(pp.work_completion_status, '')), '') is not null) as estados_distintos
  from active_rows pp
  group by pp.tenant_id, pp.project_id, pp.execution_date
),
rule_counts as (
  select
    ar.tenant_id,
    'ATIVO_COM_PROJETO_NAO_ENCONTRADO' as rule_code,
    count(*) as total
  from active_rows ar
  left join public.project p
    on p.tenant_id = ar.tenant_id
   and p.id = ar.project_id
  where p.id is null
  group by ar.tenant_id
  union all
  select
    ar.tenant_id,
    'ATIVO_SEM_ESTADO_TRABALHO' as rule_code,
    count(*) as total
  from active_rows ar
  where nullif(btrim(coalesce(ar.work_completion_status, '')), '') is null
  group by ar.tenant_id
  union all
  select
    ar.tenant_id,
    'ATIVO_COM_ESTADO_FORA_CATALOGO_ATIVO' as rule_code,
    count(*) as total
  from active_rows ar
  left join public.programming_work_completion_catalog c
    on c.tenant_id = ar.tenant_id
   and c.code = public.normalize_programming_work_completion_code(ar.work_completion_status)
   and c.is_active = true
  where nullif(btrim(coalesce(ar.work_completion_status, '')), '') is not null
    and c.code is null
  group by ar.tenant_id
  union all
  select
    ar.tenant_id,
    'ATIVO_SEM_ETAPA_NUMERICA_OU_FLAG' as rule_code,
    count(*) as total
  from active_rows ar
  where ar.etapa_number is null
    and coalesce(ar.etapa_unica, false) = false
    and coalesce(ar.etapa_final, false) = false
  group by ar.tenant_id
  union all
  select
    sdg.tenant_id,
    'GRUPO_PROJETO_DATA_COM_BRANCO_E_PREENCHIDO' as rule_code,
    count(*) as total
  from same_day_groups sdg
  where sdg.total_branco > 0
    and sdg.estados_distintos > 0
  group by sdg.tenant_id
  union all
  select
    sdg.tenant_id,
    'GRUPO_PROJETO_DATA_COM_ESTADOS_DIVERGENTES' as rule_code,
    count(*) as total
  from same_day_groups sdg
  where sdg.estados_distintos > 1
  group by sdg.tenant_id
  union all
  select
    ar.tenant_id,
    'COPIA_OU_ADICAO_COM_ORIGEM_PREENCHIDA_E_DESTINO_BRANCO' as rule_code,
    count(*) as total
  from active_rows ar
  join public.project_programming source_pp
    on source_pp.tenant_id = ar.tenant_id
   and source_pp.id = ar.copied_from_programming_id
  where nullif(btrim(coalesce(ar.work_completion_status, '')), '') is null
    and nullif(btrim(coalesce(source_pp.work_completion_status, '')), '') is not null
  group by ar.tenant_id
  union all
  select
    ar.tenant_id,
    'POSTERIOR_A_CONCLUIDO_NAO_ANTECIPADO' as rule_code,
    count(*) as total
  from active_rows ar
  where ar.etapa_number is not null
    and exists (
      select 1
      from public.project_programming pp_done
      where pp_done.tenant_id = ar.tenant_id
        and pp_done.project_id = ar.project_id
        and pp_done.etapa_number < ar.etapa_number
        and (
          public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
          or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
        )
    )
    and public.normalize_programming_work_completion_code(ar.work_completion_status) is distinct from 'ANTECIPADO'
  group by ar.tenant_id
)
select
  tenant_id,
  rule_code,
  total,
  case
    when rule_code in (
      'ATIVO_SEM_ESTADO_TRABALHO',
      'GRUPO_PROJETO_DATA_COM_BRANCO_E_PREENCHIDO',
      'COPIA_OU_ADICAO_COM_ORIGEM_PREENCHIDA_E_DESTINO_BRANCO'
    ) then 'BACKFILL_PROVAVEL'
    when rule_code in (
      'ATIVO_SEM_ETAPA_NUMERICA_OU_FLAG',
      'GRUPO_PROJETO_DATA_COM_ESTADOS_DIVERGENTES',
      'ATIVO_COM_PROJETO_NAO_ENCONTRADO'
    ) then 'REVISAO_OPERACIONAL'
    when rule_code = 'ATIVO_COM_ESTADO_FORA_CATALOGO_ATIVO' then 'CORRIGIR_CATALOGO_OU_VALOR'
    when rule_code = 'POSTERIOR_A_CONCLUIDO_NAO_ANTECIPADO' then 'CORRIGIR_REGRA_ANTECIPADO'
    else 'REVISAR'
  end as recommended_action
from rule_counts
where total > 0
order by tenant_id, recommended_action, total desc, rule_code;

-- 13) Agrupamento da matriz por status da regra e sugestao de Estado Trabalho.
with active_rows as (
  select
    pp.*,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    (p.id is null) as projeto_nao_encontrado,
    t.name as equipe
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  left join public.teams t
    on t.tenant_id = pp.tenant_id
   and t.id = pp.team_id
  where pp.status in ('PROGRAMADA', 'REPROGRAMADA')
),
diagnostic as (
  select
    ar.*,
    catalog.code as active_catalog_code,
    same_day.total_branco_same_day,
    same_day.estados_distintos_same_day,
    same_day.any_same_day_status,
    previous_project.work_completion_status as previous_project_status,
    source_programming.work_completion_status as source_programming_status,
    concluded_before.id as concluded_before_id,
    partial_catalog.code as partial_catalog_code,
    anticipated_catalog.code as anticipated_catalog_code
  from active_rows ar
  left join public.programming_work_completion_catalog catalog
    on catalog.tenant_id = ar.tenant_id
   and catalog.code = public.normalize_programming_work_completion_code(ar.work_completion_status)
   and catalog.is_active = true
  left join lateral (
    select
      count(*) filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is null) as total_branco_same_day,
      count(distinct public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as estados_distintos_same_day,
      max(public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as any_same_day_status
    from public.project_programming pp_same
    where pp_same.tenant_id = ar.tenant_id
      and pp_same.project_id = ar.project_id
      and pp_same.execution_date = ar.execution_date
      and pp_same.status in ('PROGRAMADA', 'REPROGRAMADA')
  ) same_day on true
  left join lateral (
    select pp_prev.work_completion_status
    from public.project_programming pp_prev
    join public.programming_work_completion_catalog c_prev
      on c_prev.tenant_id = pp_prev.tenant_id
     and c_prev.code = public.normalize_programming_work_completion_code(pp_prev.work_completion_status)
     and c_prev.is_active = true
    where pp_prev.tenant_id = ar.tenant_id
      and pp_prev.project_id = ar.project_id
      and pp_prev.id <> ar.id
      and pp_prev.status <> 'CANCELADA'
      and nullif(btrim(coalesce(pp_prev.work_completion_status, '')), '') is not null
      and (
        pp_prev.execution_date < ar.execution_date
        or (pp_prev.execution_date = ar.execution_date and pp_prev.updated_at < ar.updated_at)
      )
    order by pp_prev.execution_date desc, pp_prev.updated_at desc, pp_prev.created_at desc
    limit 1
  ) previous_project on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming pp_source
    where pp_source.tenant_id = ar.tenant_id
      and pp_source.id = ar.copied_from_programming_id
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    limit 1
  ) source_programming on true
  left join lateral (
    select pp_done.id
    from public.project_programming pp_done
    where pp_done.tenant_id = ar.tenant_id
      and pp_done.project_id = ar.project_id
      and pp_done.id <> ar.id
      and pp_done.etapa_number is not null
      and ar.etapa_number is not null
      and pp_done.etapa_number < ar.etapa_number
      and (
        public.normalize_programming_work_completion_code(pp_done.work_completion_status) in ('CONCLUIDO', 'COMPLETO')
        or public.normalize_programming_work_completion_code(pp_done.work_completion_status) like 'CONCLUIDO%'
      )
    order by pp_done.etapa_number desc, pp_done.execution_date desc, pp_done.updated_at desc
    limit 1
  ) concluded_before on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = ar.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
  left join public.programming_work_completion_catalog anticipated_catalog
    on anticipated_catalog.tenant_id = ar.tenant_id
   and anticipated_catalog.code = 'ANTECIPADO'
   and anticipated_catalog.is_active = true
),
classified as (
  select
    tenant_id,
    projeto,
    project_id,
    projeto_nao_encontrado,
    execution_date,
    case
      when projeto_nao_encontrado then
        'PROJETO_NAO_ENCONTRADO'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null and any_same_day_status is not null then
        'HERDAR_MESMO_PROJETO_DATA'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null and source_programming_status is not null then
        'HERDAR_PROGRAMACAO_ORIGEM'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null and concluded_before_id is not null then
        'ETAPA_POSTERIOR_A_CONCLUIDO'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null and previous_project_status is not null then
        'HERDAR_ULTIMO_ESTADO_DO_PROJETO'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null and partial_catalog_code is not null then
        'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is not null and active_catalog_code is null then
        'ESTADO_FORA_CATALOGO_ATIVO'
      when etapa_number is null and coalesce(etapa_unica, false) = false and coalesce(etapa_final, false) = false then
        'SEM_ETAPA_OU_FLAG'
      when estados_distintos_same_day > 1 then
        'DIVERGENCIA_MESMO_PROJETO_DATA'
      when concluded_before_id is not null
        and public.normalize_programming_work_completion_code(work_completion_status) is distinct from 'ANTECIPADO' then
        'POSTERIOR_A_CONCLUIDO_NAO_ANTECIPADO'
      when nullif(btrim(coalesce(work_completion_status, '')), '') is null then
        'ATIVO_SEM_ESTADO_SEM_SUGESTAO'
      else
        'OK'
    end as primary_rule_status,
    case
      when nullif(btrim(coalesce(work_completion_status, '')), '') is not null then
        public.normalize_programming_work_completion_code(work_completion_status)
      when any_same_day_status is not null then
        any_same_day_status
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
  where nullif(btrim(coalesce(work_completion_status, '')), '') is null
     or projeto_nao_encontrado
     or (
        nullif(btrim(coalesce(work_completion_status, '')), '') is not null
        and active_catalog_code is null
     )
     or (
        etapa_number is null
        and coalesce(etapa_unica, false) = false
        and coalesce(etapa_final, false) = false
     )
     or (total_branco_same_day > 0 and estados_distintos_same_day > 0)
     or estados_distintos_same_day > 1
     or (
        copied_from_programming_id is not null
        and nullif(btrim(coalesce(work_completion_status, '')), '') is null
        and source_programming_status is not null
     )
     or (
        concluded_before_id is not null
        and public.normalize_programming_work_completion_code(work_completion_status) is distinct from 'ANTECIPADO'
     )
)
select
  tenant_id,
  primary_rule_status,
  suggested_work_completion_status,
  count(*) as total_registros,
  count(distinct project_id) as total_projetos,
  min(execution_date) as primeira_data,
  max(execution_date) as ultima_data,
  string_agg(distinct projeto, ' | ' order by projeto) as projetos,
  case
    when primary_rule_status in (
      'HERDAR_MESMO_PROJETO_DATA',
      'HERDAR_PROGRAMACAO_ORIGEM',
      'ETAPA_POSTERIOR_A_CONCLUIDO',
      'HERDAR_ULTIMO_ESTADO_DO_PROJETO',
      'PRIMEIRO_ESTADO_ATIVO_DO_PROJETO'
    ) and suggested_work_completion_status is not null then
      'BACKFILL_AUTOMATICO_POSSIVEL'
    when primary_rule_status = 'SEM_ETAPA_OU_FLAG' then
      'REVISAO_OPERACIONAL_ANTES_DO_BACKFILL'
    when primary_rule_status = 'DIVERGENCIA_MESMO_PROJETO_DATA' then
      'REVISAO_OPERACIONAL_DE_DIVERGENCIA'
    when primary_rule_status = 'ESTADO_FORA_CATALOGO_ATIVO' then
      'CORRIGIR_CATALOGO_OU_VALOR'
    when primary_rule_status = 'POSTERIOR_A_CONCLUIDO_NAO_ANTECIPADO' then
      'BACKFILL_ANTECIPADO'
    when primary_rule_status = 'ATIVO_SEM_ESTADO_SEM_SUGESTAO' then
      'REVISAR_MANUALMENTE_SEM_SUGESTAO'
    when primary_rule_status = 'PROJETO_NAO_ENCONTRADO' then
      'REVISAO_OPERACIONAL_PROJETO_NAO_ENCONTRADO'
    else
      'REVISAR_MANUALMENTE'
  end as recommended_action
from classified
where primary_rule_status <> 'OK'
group by tenant_id, primary_rule_status, suggested_work_completion_status
order by tenant_id, recommended_action, total_registros desc, primary_rule_status, suggested_work_completion_status;

-- 14) Programacoes inativas com Estado Trabalho em branco e sugestao de backfill.
with blank_rows as (
  select
    pp.*,
    coalesce(p.sob, '[PROJETO_NAO_ENCONTRADO]') as projeto,
    (p.id is null) as projeto_nao_encontrado
  from public.project_programming pp
  left join public.project p
    on p.tenant_id = pp.tenant_id
   and p.id = pp.project_id
  where pp.status in ('ADIADA', 'CANCELADA')
    and nullif(btrim(coalesce(pp.work_completion_status, '')), '') is null
),
diagnostic as (
  select
    br.*,
    same_day.any_same_day_status,
    source_programming.work_completion_status as source_programming_status,
    history_related.work_completion_status as history_related_status,
    previous_project.work_completion_status as previous_project_status,
    partial_catalog.code as partial_catalog_code
  from blank_rows br
  left join lateral (
    select
      max(public.normalize_programming_work_completion_code(pp_same.work_completion_status))
        filter (where nullif(btrim(coalesce(pp_same.work_completion_status, '')), '') is not null) as any_same_day_status
    from public.project_programming pp_same
    where pp_same.tenant_id = br.tenant_id
      and pp_same.project_id = br.project_id
      and pp_same.execution_date = br.execution_date
      and pp_same.id <> br.id
  ) same_day on true
  left join lateral (
    select pp_source.work_completion_status
    from public.project_programming pp_source
    where pp_source.tenant_id = br.tenant_id
      and pp_source.id = br.copied_from_programming_id
      and nullif(btrim(coalesce(pp_source.work_completion_status, '')), '') is not null
    limit 1
  ) source_programming on true
  left join lateral (
    select pp_related.work_completion_status
    from public.project_programming_history ph
    join public.project_programming pp_related
      on pp_related.tenant_id = ph.tenant_id
     and pp_related.id = ph.related_programming_id
    where ph.tenant_id = br.tenant_id
      and ph.programming_id = br.id
      and ph.related_programming_id is not null
      and nullif(btrim(coalesce(pp_related.work_completion_status, '')), '') is not null
    order by ph.created_at desc
    limit 1
  ) history_related on true
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
  ) previous_project on true
  left join public.programming_work_completion_catalog partial_catalog
    on partial_catalog.tenant_id = br.tenant_id
   and partial_catalog.code = 'PARCIAL'
   and partial_catalog.is_active = true
),
classified as (
  select
    tenant_id,
    status,
    projeto,
    project_id,
    execution_date,
    case
      when projeto_nao_encontrado then
        'PROJETO_NAO_ENCONTRADO'
      when any_same_day_status is not null then
        'INATIVA_HERDAR_MESMO_PROJETO_DATA'
      when source_programming_status is not null then
        'INATIVA_HERDAR_PROGRAMACAO_ORIGEM'
      when history_related_status is not null then
        'INATIVA_HERDAR_HISTORICO_RELACIONADO'
      when previous_project_status is not null then
        'INATIVA_HERDAR_ULTIMO_ESTADO_DO_PROJETO'
      when partial_catalog_code is not null then
        'INATIVA_PRIMEIRO_ESTADO_DO_PROJETO'
      else
        'INATIVA_SEM_SUGESTAO'
    end as primary_rule_status,
    case
      when any_same_day_status is not null then
        any_same_day_status
      when source_programming_status is not null then
        public.normalize_programming_work_completion_code(source_programming_status)
      when history_related_status is not null then
        public.normalize_programming_work_completion_code(history_related_status)
      when previous_project_status is not null then
        public.normalize_programming_work_completion_code(previous_project_status)
      when partial_catalog_code is not null then
        'PARCIAL'
      else
        null
    end as suggested_work_completion_status
  from diagnostic
)
select
  tenant_id,
  status,
  primary_rule_status,
  suggested_work_completion_status,
  count(*) as total_registros,
  count(distinct project_id) as total_projetos,
  min(execution_date) as primeira_data,
  max(execution_date) as ultima_data,
  string_agg(distinct projeto, ' | ' order by projeto) as projetos,
  case
    when primary_rule_status = 'PROJETO_NAO_ENCONTRADO' then
      'REVISAO_OPERACIONAL_PROJETO_NAO_ENCONTRADO'
    when suggested_work_completion_status is not null then
      'BACKFILL_INATIVO_AUTOMATICO_POSSIVEL'
    else
      'REVISAR_MANUALMENTE_SEM_SUGESTAO'
  end as recommended_action
from classified
group by tenant_id, status, primary_rule_status, suggested_work_completion_status
order by tenant_id, recommended_action, total_registros desc, status, primary_rule_status;
