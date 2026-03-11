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
20. 020_harden_rls_auth_uid_active.sql
21. 021_rls_to_authenticated.sql
22. 022_create_page_permissions.sql
23. 023_normalize_roles_to_app_roles.sql
24. 024_create_user_page_permissions.sql
25. 025_app_users_admin_tenant_select.sql
26. 026_simplify_user_page_permissions.sql
27. 027_create_permission_change_history.sql
28. 028_add_operation_menu_pages.sql
29. 029_create_project_table.sql
30. 030_project_sob_priority_rules.sql
31. 031_create_project_lookup_tables.sql
32. 032_create_contrato_table.sql
33. 033_rename_contrato_to_contract.sql
34. 034_use_people_for_project_contractor_responsible.sql
35. 035_add_matriculation_to_people.sql
36. 036_create_project_history_and_cancellation.sql

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

020_harden_rls_auth_uid_active.sql
- Reforca as policies RLS multi-tenant para usar auth.uid() com app_users.ativo = true.

021_rls_to_authenticated.sql
- Restringe as policies multi-tenant ao role authenticated no Supabase.

022_create_page_permissions.sql
- Cria `app_pages` e `role_page_permissions` para a futura matriz de acesso por pagina.

023_normalize_roles_to_app_roles.sql
- Cria `app_roles` e migra `app_users` e `role_page_permissions` de `role` texto para `role_id`.

024_create_user_page_permissions.sql
- Cria `app_user_page_permissions` e a funcao `user_has_page_action(text, text)` para a matriz por usuario e por tela, sem `delete`.

025_app_users_admin_tenant_select.sql
- Cria policy em `app_users` para liberar leitura de usuarios do mesmo tenant apenas a perfis administrativos autenticados.

026_simplify_user_page_permissions.sql
- Simplifica `app_user_page_permissions` para permissao unica por tela, usando apenas `can_access`.

027_create_permission_change_history.sql
- Cria `app_user_permission_history` para auditar mudancas de role, status, telas liberadas e envio de convite.

028_add_operation_menu_pages.sql
- Inclui telas de Operacao (`projetos`, `locacao`, `programacao`) no catalogo de paginas e ajusta labels de estoque.

029_create_project_table.sql
- Cria a tabela `project` com campos de cadastro da tela Projetos, RLS por tenant e trigger de auditoria.

030_project_sob_priority_rules.sql
- Aplica validacao de formato do SOB por prioridade e unicidade case-insensitive de SOB por tenant.

031_create_project_lookup_tables.sql
- Cria tabelas de dominio de Projetos por tenant (prioridade, centro, tipo, tensao, porte, municipio e responsaveis) e vincula `project` por chaves estrangeiras.

032_create_contrato_table.sql
- Cria a tabela `contrato` por tenant, com coluna `name`, `valor` derivado do `tenant_id`, RLS e auditoria.

033_rename_contrato_to_contract.sql
- Renomeia a tabela `contrato` para `contract` e padroniza policy, trigger e indice com o novo nome.

034_use_people_for_project_contractor_responsible.sql
- Remove `project_contractor_responsibles` e passa `project.contractor_responsible_id` a referenciar `people` (cargo `SUPERVISOR`).

035_add_matriculation_to_people.sql
- Adiciona a coluna `matriculation` em `people` com validacao de nao vazio (quando informada) e indice por tenant.

036_create_project_history_and_cancellation.sql
- Adiciona status ativo/inativo em `project` e cria historicos `project_history` e `project_cancellation_history` com RLS e auditoria.

Lacunas ainda nao versionadas
- integracao de auditoria adicional para expiracao de sessao, se necessario alem do `login_audit`

Observacao
- As migrations acima suportam o app atual.
- A modelagem de `project` ja existe e pode evoluir com novos relacionamentos.
