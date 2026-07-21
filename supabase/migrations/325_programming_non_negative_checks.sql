-- 325_programming_non_negative_checks.sql
-- Achado 11 (parcial): reforca no banco as validacoes numericas que hoje so o
-- handler garante. Adiciona CHECK de nao-negatividade para affected_customers e
-- expected_minutes (poste/estrutura/trafo/rede ja tem
-- programming_quantities_non_negative_check desde a 310).
--
-- Usa NOT VALID de proposito: aplica a novos INSERT/UPDATE sem revalidar o dado
-- legado (evita falha da migration por linhas antigas fora do padrao). Se quiser
-- validar o historico depois: ALTER TABLE ... VALIDATE CONSTRAINT ....
--
-- DELIBERADAMENTE NAO ADICIONADOS (decisao documentada, nao esquecimento):
--   - outage_end_time > outage_start_time: desligamento pode virar a meia-noite
--     (22:00 -> 02:00), entao end < start e VALIDO. Um CHECK simples quebraria
--     dado legitimo. Validacao de coerencia de desligamento fica no app/UX.
--   - support sem support_item_id: 'support' e texto livre e 'support_item_id' e
--     selecao de catalogo; a relacao entre eles nao e uma invariante rigida.
--   - poste/rede etc. decimais: numeric(14,2) permite decimal de proposito
--     (ex.: rede em km). Nao e erro.

alter table public.programming
  add constraint programming_affected_customers_non_negative_check
  check (affected_customers is null or affected_customers >= 0) not valid;

alter table public.programming
  add constraint programming_expected_minutes_non_negative_check
  check (expected_minutes is null or expected_minutes >= 0) not valid;
