-- 342_create_programming_legacy_map.sql
-- Cria e popula o mapeamento do ID legado de `project_programming` (tela
-- programacao-simples, congelada em somente leitura pelo corte) para a etapa
-- correspondente em `programming` e, quando existir, para a linha de equipe em
-- `programming_team` (tela programacao-normalizada).
--
-- POR QUE ISSO E NECESSARIO
-- ---------------------------------------------------------------------------
-- As migrations 315 (foto de 2026-07-19) e 335 (delta de corte de 2026-07-28)
-- migraram o dado legado gerando UUIDs NOVOS e sem guardar a origem — nao existe
-- hoje caminho de volta do ID legado para a etapa nova. Tres tabelas ainda
-- referenciam a linha legada por FK e dependem desse caminho para migrar:
--   - project_measurement_orders.programming_id  (migration 112) — Medicao
--   - project_apr_controls.programming_id        (migration 226) — Controle APR
--   - cronograma_solicitacoes.programacao_id     (migration 304) — Cronograma
--
-- POR QUE TABELA E NAO COLUNA EM `programming`
-- ---------------------------------------------------------------------------
-- O modelo legado tem UMA LINHA POR EQUIPE (unique tenant+projeto+equipe+data,
-- migration 067); o normalizado tem UMA ETAPA por projeto+data (unique
-- programming_tenant_project_date_key, migration 310) com as equipes em
-- `programming_team`. A relacao e N:1 — N linhas legadas nao cabem em uma coluna
-- da etapa. A PK do mapa e o ID legado; `programming_id` repete.
--
-- CHAVE DE RESOLUCAO
-- ---------------------------------------------------------------------------
-- Etapa: (tenant_id, project_id, execution_date) — a unica chave comum aos dois
-- modelos, e exatamente a chave unica do destino. Os geradores da 315/335 usaram
-- esse mesmo agrupamento, entao o mapeamento reproduz a fusao que eles fizeram
-- (varios grupos legados colidindo no mesmo projeto+data viraram uma etapa so).
-- Equipe: `programming_team` da etapa resolvida com o mesmo team_id, preferindo
-- ATIVA. Pode ficar nula: o merge conservador da 335 nunca removeu equipe do
-- destino, mas tambem nao garante que toda equipe legada tenha chegado la.
--
-- ESCOPO
-- ---------------------------------------------------------------------------
-- - `project_programming` e `project_programming_history` sao SOMENTE LEITURA
--   aqui: nenhum update, delete ou alter de dado. O unico ALTER e a garantia
--   idempotente da unique (id, tenant_id), no mesmo padrao da migration 226.
-- - Nenhuma RPC, trigger ou consumidor muda de comportamento nesta migration.
--   Quem le a tabela legada hoje continua lendo.
-- - Re-executavel: `on conflict do nothing` na carga.

begin;

-- =============================================================================
-- 1) Pre-requisito: unique (id, tenant_id) na tabela legada, para a FK composta
--    por tenant do mapa. As migrations 226 e 231 ja criam essa constraint; o
--    bloco fica por seguranca e e idempotente (mesmo padrao das duas).
-- =============================================================================
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'project_programming'
      and constraint_name = 'project_programming_id_tenant_key'
  ) then
    alter table public.project_programming
      add constraint project_programming_id_tenant_key unique (id, tenant_id);
  end if;
end
$$;

-- =============================================================================
-- 2) Tabela de mapeamento
-- =============================================================================
create table if not exists public.programming_legacy_map (
  legacy_programming_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  programming_id uuid not null,
  legacy_team_id uuid not null,
  programming_team_id uuid null,
  created_at timestamptz not null default now(),

  -- Etapa nova sumiu: o vinculo perde sentido, a linha do mapa vai junto.
  constraint programming_legacy_map_programming_tenant_fk
    foreign key (programming_id, tenant_id) references public.programming (id, tenant_id)
    on delete cascade,

  -- Linha de equipe nova sumiu: a etapa continua valendo, so o detalhe de equipe
  -- e perdido.
  constraint programming_legacy_map_team_tenant_fk
    foreign key (programming_team_id, tenant_id) references public.programming_team (id, tenant_id)
    on delete set null (programming_team_id),

  -- SEM cascade de proposito: apagar a fonte legada nao pode levar o mapa junto
  -- enquanto as tres FKs de Medicao/APR/Cronograma ainda dependerem dele.
  constraint programming_legacy_map_legacy_tenant_fk
    foreign key (legacy_programming_id, tenant_id) references public.project_programming (id, tenant_id),

  -- Seguro contra falha na carga: `pp_team_tenant_fk` (migration 231, ja
  -- validada) garante que todo (team_id, tenant_id) legado e consistente.
  constraint programming_legacy_map_team_tenant_source_fk
    foreign key (legacy_team_id, tenant_id) references public.teams (id, tenant_id)
);

create index if not exists idx_programming_legacy_map_tenant_programming
  on public.programming_legacy_map (tenant_id, programming_id);

create index if not exists idx_programming_legacy_map_tenant_team
  on public.programming_legacy_map (tenant_id, programming_team_id);

comment on table public.programming_legacy_map is
  'De/para do ID legado de project_programming (uma linha por equipe) para a etapa em programming (uma por projeto+data) e a linha de equipe em programming_team. Base do remapeamento das FKs de Medicao, Controle APR e Cronograma de Solicitacoes.';

comment on column public.programming_legacy_map.programming_team_id is
  'Pode ser nulo: equipe legada sem linha correspondente na etapa nova. Nao invalida o mapeamento da etapa.';

-- =============================================================================
-- 3) RLS — leitura pelo tenant; nenhuma policy de escrita (mesmo padrao da 310)
-- =============================================================================
alter table public.programming_legacy_map enable row level security;

drop policy if exists programming_legacy_map_select on public.programming_legacy_map;
create policy programming_legacy_map_select
  on public.programming_legacy_map
  for select
  to authenticated
  using (public.user_can_access_tenant(programming_legacy_map.tenant_id));

-- =============================================================================
-- 4) Carga — fonte e destino estao no mesmo banco, entao e insert...select puro
--    (nao precisa do script gerador que a 315/335 exigiram).
--
--    O lateral resolve a equipe preferindo ATIVA: `programming_team` so tem
--    unique parcial de (programming_id, team_id) WHERE status = 'ATIVA'
--    (migration 310), entao a mesma equipe pode ter linha REMOVIDA/TRANSFERIDA
--    convivendo com a ativa.
-- =============================================================================
insert into public.programming_legacy_map (
  legacy_programming_id, tenant_id, programming_id, legacy_team_id, programming_team_id
)
select
  pp.id,
  pp.tenant_id,
  p.id,
  pp.team_id,
  pt.id
from public.project_programming pp
join public.programming p
  on p.tenant_id = pp.tenant_id
 and p.project_id = pp.project_id
 and p.execution_date = pp.execution_date
left join lateral (
  select t.id
  from public.programming_team t
  where t.tenant_id = pp.tenant_id
    and t.programming_id = p.id
    and t.team_id = pp.team_id
  order by
    case t.status
      when 'ATIVA' then 0
      when 'TRANSFERIDA' then 1
      else 2
    end,
    t.created_at
  limit 1
) pt on true
on conflict (legacy_programming_id) do nothing;

-- =============================================================================
-- 5) Relatorio — nao bloqueia a migration, mas expoe o que ficou de fora e o
--    estado das tres FKs que a Fase 5 vai remapear.
-- =============================================================================
do $$
declare
  v_legacy_total bigint;
  v_mapped bigint;
  v_unmapped bigint;
  v_without_team bigint;
  v_sample text;
  v_orphan_measurement bigint;
  v_orphan_apr bigint;
  v_orphan_cronograma bigint;
begin
  select count(*) into v_legacy_total from public.project_programming;
  select count(*) into v_mapped from public.programming_legacy_map;
  v_unmapped := v_legacy_total - v_mapped;

  select count(*) into v_without_team
  from public.programming_legacy_map
  where programming_team_id is null;

  raise notice '342: linhas legadas=% | mapeadas=% | sem etapa correspondente=% | sem equipe resolvida=%',
    v_legacy_total, v_mapped, v_unmapped, v_without_team;

  if v_unmapped > 0 then
    select string_agg(format('%s @ %s', coalesce(pr.sob, orphan.project_id::text), orphan.execution_date), ' | ')
      into v_sample
    from (
      select pp.project_id, pp.tenant_id, pp.execution_date
      from public.project_programming pp
      where not exists (
        select 1 from public.programming_legacy_map m where m.legacy_programming_id = pp.id
      )
      order by pp.execution_date desc
      limit 10
    ) orphan
    left join public.project pr
      on pr.id = orphan.project_id
     and pr.tenant_id = orphan.tenant_id;

    raise notice '342: amostra sem etapa correspondente (ate 10): %', coalesce(v_sample, '(vazio)');
  end if;

  -- Criterio de aceite da Fase 1: os tres precisam ser 0, senao a Fase 5 nao
  -- tem como remapear as FKs.
  select count(*) into v_orphan_measurement
  from public.project_measurement_orders o
  left join public.programming_legacy_map m on m.legacy_programming_id = o.programming_id
  where o.programming_id is not null and m.legacy_programming_id is null;

  select count(*) into v_orphan_apr
  from public.project_apr_controls a
  left join public.programming_legacy_map m on m.legacy_programming_id = a.programming_id
  where a.programming_id is not null and m.legacy_programming_id is null;

  select count(*) into v_orphan_cronograma
  from public.cronograma_solicitacoes c
  left join public.programming_legacy_map m on m.legacy_programming_id = c.programacao_id
  where c.programacao_id is not null and m.legacy_programming_id is null;

  raise notice '342: FKs sem par no mapa — Medicao=% | Controle APR=% | Cronograma=% (esperado 0 nos tres)',
    v_orphan_measurement, v_orphan_apr, v_orphan_cronograma;
end
$$;

commit;
