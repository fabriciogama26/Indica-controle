-- 353_sync_service_activities_code_idd.sql
-- Sincroniza no versionamento a coluna code_idd de public.service_activities, criada
-- diretamente no banco sem migration. Idempotente: no-op em ambientes que ja possuem a coluna.
-- Consumida pelo detalhe da ordem de medicao (modal "Detalhes da Ordem" e CSV de detalhamento).

alter table if exists public.service_activities
  add column if not exists code_idd text;

comment on column public.service_activities.code_idd is
  'Codigo IDD da atividade (identificador externo). Exibido como "Codigo IDD" na Medicao.';
