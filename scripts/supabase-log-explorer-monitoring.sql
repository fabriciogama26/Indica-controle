-- supabase-log-explorer-monitoring.sql
-- Este arquivo e seguro para rodar no SQL Editor/Postgres.
--
-- Para criar o relatorio no Supabase Reports, use:
--   scripts/supabase-report-indica-controle-saude-io-performance.txt
--
-- As consultas reais de API/PostgREST e Edge Functions usam o Logs Explorer,
-- nao o SQL Editor. Para evitar o erro:
--   ERROR: 42601: syntax error at or near ")"
-- elas foram movidas para:
--   scripts/supabase-log-explorer-monitoring.txt
--
-- Como usar:
-- 1. Abra Supabase Dashboard > Logs > Logs Explorer.
-- 2. Abra scripts/supabase-log-explorer-monitoring.txt.
-- 3. Copie e rode um bloco por vez no Logs Explorer.

select
  'Use scripts/supabase-monitoring-readonly.sql no SQL Editor/Postgres.' as sql_editor,
  'Use scripts/supabase-log-explorer-monitoring.txt no Supabase Logs Explorer.' as logs_explorer;
