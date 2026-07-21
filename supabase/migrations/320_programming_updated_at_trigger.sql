-- 320_programming_updated_at_trigger.sql
-- Corrige a concorrencia otimista quebrada do modulo programacao-normalizada.
--
-- PROBLEMA
-- ---------------------------------------------------------------------------
-- As RPCs exigem `expectedUpdatedAt` e prometem 409 quando outro usuario alterou
-- a etapa. Mas nenhum trigger e nenhuma RPC atualizava `programming.updated_at`
-- (nem `programming_team.updated_at`) no UPDATE — os UPDATEs setavam so
-- `updated_by`. Assim `updated_at` ficava congelado no valor do INSERT e o
-- `expectedUpdatedAt` sempre batia: o 409 nunca disparava e uma escrita podia
-- sobrescrever outra silenciosamente (last-write-wins).
--
-- Simulacao:
--   A e B abrem a etapa com updated_at = 08:00.
--   A altera o horario -> banco NAO muda updated_at.
--   B salva enviando expectedUpdatedAt = 08:00 -> validacao aceita -> A e perdido.
--
-- SOLUCAO
-- ---------------------------------------------------------------------------
-- Trigger BEFORE UPDATE que carimba `updated_at = now()` em toda alteracao,
-- incluindo as alteracoes INDIRETAS feitas por reclassify_project_programming_
-- stages (renumeracao). Detalhes de correcao:
--   - Dentro de uma mesma transacao, now() (= transaction_timestamp()) e estavel;
--     multiplos UPDATEs da mesma linha no mesmo commit recebem o mesmo carimbo,
--     entao nao ha "ruido" de concorrencia dentro da propria acao.
--   - reclassify so faz UPDATE das linhas cuja classificacao REALMENTE muda (os
--     UPDATEs tem guarda `... is distinct from ...`); irmas inalteradas nao sao
--     tocadas e nao tem updated_at bumpado. Uma irma que teve etapa_number
--     alterado por outra acao passa a retornar 409 na proxima escrita de quem a
--     tinha aberta antes — que e o comportamento correto (a linha mudou de fato).
--   - INSERT nao dispara o trigger (BEFORE UPDATE), entao created_at = updated_at
--     no cadastro, como esperado.
--
-- Aplica-se as tabelas do modulo que tem updated_at. As duas primeiras
-- (programming, programming_team) sao as que usam expectedUpdatedAt; as outras
-- duas entram para que updated_at seja sempre verdadeiro.

create or replace function public.tg_programming_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_programming_set_updated_at on public.programming;
create trigger trg_programming_set_updated_at
  before update on public.programming
  for each row
  execute function public.tg_programming_set_updated_at();

drop trigger if exists trg_programming_team_set_updated_at on public.programming_team;
create trigger trg_programming_team_set_updated_at
  before update on public.programming_team
  for each row
  execute function public.tg_programming_set_updated_at();

drop trigger if exists trg_programming_activity_set_updated_at on public.programming_activity;
create trigger trg_programming_activity_set_updated_at
  before update on public.programming_activity
  for each row
  execute function public.tg_programming_set_updated_at();

drop trigger if exists trg_programming_document_set_updated_at on public.programming_document;
create trigger trg_programming_document_set_updated_at
  before update on public.programming_document
  for each row
  execute function public.tg_programming_set_updated_at();
