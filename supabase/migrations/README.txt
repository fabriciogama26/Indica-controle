Migracoes Supabase

Ordem de aplicacao
0. 000_create_auth_and_audit_tables.sql
1. 001_create_core_tables.sql
2. 002_create_stock_conflicts.sql
3. 003_create_rpc_submit_requisicao.sql
4. 004_create_rpc_resolve_conflict.sql
5. 005_normalize_tipo_operacao.sql
6. 006_rls_tenant.sql
7. 007_views_conflicts.sql
8. 008_timestamptz_data.sql
9. 009_create_sync_runs.sql
10. 010_create_sync_run_details.sql
11. 011_create_rate_limit.sql
12. 012_create_project_material_balance.sql
13. 013_update_material_rpcs.sql
14. 014_create_people_job_titles.sql
15. 015_add_audit_columns.sql
16. 016_add_login_name_to_auth_tables.sql
17. 017_sync_auth_users_to_app_users.sql
18. 018_make_auth_user_sync_fail_open.sql
19. 019_login_audit_event_log.sql

Resumo por arquivo
000_create_auth_and_audit_tables.sql
- app_users, imei_whitelist, login_audit e app_error_logs.

001_create_core_tables.sql
- Materiais, estoque fisico, requisicoes, itens e movimentos.

002_create_stock_conflicts.sql
- Conflitos de estoque e itens do conflito.

003_create_rpc_submit_requisicao.sql
- RPC base de submissao de requisicao.

004_create_rpc_resolve_conflict.sql
- RPC base para resolver conflito.

005_normalize_tipo_operacao.sql
- Padroniza REQ e DEV.

006_rls_tenant.sql
- Politicas RLS multi-tenant por app_users.auth_user_id.

007_views_conflicts.sql
- Views para consumo do SaaS na tela de conflitos.

008_timestamptz_data.sql
- Ajuste de datas para timestamptz.

009_create_sync_runs.sql
- Resumo de sincronizacao do app.

010_create_sync_run_details.sql
- Etapas e alertas da sincronizacao.

011_create_rate_limit.sql
- Infra de rate limit para Edge Functions.

012_create_project_material_balance.sql
- Saldo liquido por projeto/material.

013_update_material_rpcs.sql
- Regras finais de materiais: saldo fisico + saldo do projeto.

014_create_people_job_titles.sql
- Cadastro base de cargos e pessoas para o campo Responsavel.

015_add_audit_columns.sql
- Padroniza created_by, updated_by, created_at e updated_at nas tabelas do SaaS.

016_add_login_name_to_auth_tables.sql
- Adiciona login_name em app_users, login_audit e app_error_logs para suportar login web.

017_sync_auth_users_to_app_users.sql
- Sincroniza auth.users com app_users por e-mail unico ou metadata minima do tenant.

018_make_auth_user_sync_fail_open.sql
- Evita que falhas da sincronizacao auth.users -> app_users bloqueiem o Invite User do Supabase Auth.

019_login_audit_event_log.sql
- Converte login_audit para log de eventos com uma linha por login e outra por logout.

Lacunas ainda nao versionadas
- modelagem final de projects

Observacao
- As migrations acima suportam o app atual.
- A tabela de projetos ainda depende da decisao final de modelagem.
