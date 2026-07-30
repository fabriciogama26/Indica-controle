-- 344_cronograma_read_normalized_programming.sql
-- Fase 3a do corte: o Cronograma de Solicitacoes passa a ler a Programacao do
-- modelo normalizado (`programming`) em vez da tela congelada
-- (`project_programming`).
--
-- POR QUE FK E LEITURA ANDAM JUNTAS AQUI
-- ---------------------------------------------------------------------------
-- O plano original separava "trocar a leitura" (Fase 3) de "remapear as FKs"
-- (Fase 5). Para o Cronograma isso nao se sustenta: o mesmo valor que a leitura
-- devolve (`fetchLatestProgrammingState` -> `programmingId`) e gravado em
-- `cronograma_solicitacoes.programacao_id`. Trocar a fonte sem repontar a FK faria
-- todo cadastro novo violar a constraint. Entao o Cronograma sai da Fase 5 junto
-- com esta migration.
--
-- CUSTO REAL: ZERO LINHAS PARA MIGRAR
-- ---------------------------------------------------------------------------
-- Medido em producao em 2026-07-29: `cronograma_solicitacoes` tem 0 linhas com
-- `programacao_id` preenchido. Nao ha dado a remapear, so a constraint a mover.
-- O bloco 1 confirma isso em tempo de aplicacao e ABORTA se aparecer linha nao
-- mapeada — nunca apaga nem zera valor para conseguir aplicar.
--
-- A FK antiga era simples, por `id` apenas (migration 304). A nova e composta com
-- `tenant_id`, seguindo a regra 12 do guia_sql.md e o padrao das migrations
-- 231/310/342 — FK por `id` nao basta quando a tabela filha tem tenant proprio.

begin;

-- =============================================================================
-- 1) Guarda: nenhuma linha pode ficar orfa na virada da constraint.
-- =============================================================================
do $$
declare
  v_sem_par bigint;
begin
  select count(*)
    into v_sem_par
  from public.cronograma_solicitacoes c
  left join public.programming_legacy_map m
    on m.legacy_programming_id = c.programacao_id
  where c.programacao_id is not null
    and m.legacy_programming_id is null;

  if v_sem_par > 0 then
    raise exception
      'Migration 344 abortada: % solicitacao(oes) apontam para programacao legada sem par em programming_legacy_map. Rode scripts/audit-programming-legacy-map-readonly.mjs e trate os casos antes de repontar a FK.',
      v_sem_par
      using errcode = 'P0001';
  end if;
end
$$;

-- =============================================================================
-- 2) Remapear os valores existentes (legado -> etapa normalizada).
--    Em producao isso nao afeta nenhuma linha; existe para o caso de a migration
--    ser aplicada em ambiente onde a tela ja tenha vinculado programacao.
-- =============================================================================
update public.cronograma_solicitacoes c
set programacao_id = m.programming_id
from public.programming_legacy_map m
where c.programacao_id = m.legacy_programming_id
  and c.tenant_id = m.tenant_id
  and c.programacao_id is distinct from m.programming_id;

-- =============================================================================
-- 3) Trocar a constraint. O nome antigo e o gerado pelo Postgres na 304
--    (`<tabela>_<coluna>_fkey`); os drops sao tolerantes para a migration ser
--    re-executavel.
-- =============================================================================
alter table public.cronograma_solicitacoes
  drop constraint if exists cronograma_solicitacoes_programacao_id_fkey,
  drop constraint if exists cronograma_solicitacoes_programacao_tenant_fk;

alter table public.cronograma_solicitacoes
  add constraint cronograma_solicitacoes_programacao_tenant_fk
    foreign key (programacao_id, tenant_id)
    references public.programming (id, tenant_id)
    on delete set null (programacao_id);

create index if not exists idx_cronograma_solicitacoes_tenant_programacao
  on public.cronograma_solicitacoes (tenant_id, programacao_id);

-- =============================================================================
-- 4) Elegibilidade de As Built passa a ler `programming`.
--
--    Regras preservadas 1:1 da versao anterior (migration 305):
--    - ignora etapa CANCELADA (ANTECIPADA continua contando, como antes);
--    - exige Estado do Trabalho preenchido;
--    - "ultimo" = maior execution_date, desempate por updated_at, sem usar etapa;
--    - libera As Built em CONCLUIDO e PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO.
--
--    Muda a fonte e CORRIGE uma quebra que a troca de fonte causaria:
--    - `BENEFICIO_ATINGIDO` entra na lista de permitidos. E o MESMO estado de
--      negocio que `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO`, com o codigo corrigido
--      pela migration 310; as cargas 315/335 remapearam o typo legado
--      (`..._BENFICIO_...`) para ele ao migrar. Os dois codigos convivem ativos no
--      catalogo, porque o legado ainda descreve as linhas de
--      `project_programming`. Sem esta entrada, 7 projetos em producao perderiam
--      As Built na virada (medido em 2026-07-29) sem nenhuma regra ter mudado.
--      O mesmo ajuste foi feito em ASBUILT_ESTADOS_PERMITIDOS
--      (src/server/modules/cronograma-solicitacoes/normalizers.ts) — as duas
--      listas precisam andar juntas.
--    - o `replace` do typo fica como rede de seguranca para dado importado;
--    - 'PENDENCIA' nao precisa ser tratado: a migration 318 tirou o valor dos dois
--      eixos e transformou em `is_pendencia`. Pendencia NAO libera As Built, que e
--      exatamente o comportamento anterior (o valor legado 'PENDENCIA' tambem nao
--      estava na lista de permitidos).
-- =============================================================================
create or replace function public.get_cronograma_asbuilt_project_ids(p_tenant_id uuid)
returns table(project_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (p.project_id)
      p.project_id,
      upper(regexp_replace(btrim(coalesce(p.work_completion_status, '')), '\s+', '_', 'g')) as status_code
    from public.programming p
    where p.tenant_id = p_tenant_id
      and p.status <> 'CANCELADA'
      and nullif(btrim(coalesce(p.work_completion_status, '')), '') is not null
    order by p.project_id, p.execution_date desc, p.updated_at desc
  )
  select latest.project_id
  from latest
  where replace(latest.status_code, 'BENFICIO', 'BENEFICIO')
    in ('CONCLUIDO', 'CONCLUÍDO', 'PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO', 'BENEFICIO_ATINGIDO');
$$;

-- Grants repetidos conforme regras 16/17 do guia_sql.md: funcao SECURITY DEFINER
-- so executavel por service_role.
revoke all on function public.get_cronograma_asbuilt_project_ids(uuid)
from public, anon, authenticated;
grant execute on function public.get_cronograma_asbuilt_project_ids(uuid)
to service_role;

-- =============================================================================
-- 5) Relatorio
-- =============================================================================
do $$
declare
  v_com_fk bigint;
  v_elegiveis bigint;
begin
  select count(*) into v_com_fk
  from public.cronograma_solicitacoes
  where programacao_id is not null;

  select count(*) into v_elegiveis
  from public.tenants t,
       lateral public.get_cronograma_asbuilt_project_ids(t.id);

  raise notice '344: solicitacoes com programacao vinculada=% (agora apontando para programming)', v_com_fk;
  raise notice '344: projetos elegiveis a As Built somando todos os tenants=%', v_elegiveis;
end
$$;

commit;
