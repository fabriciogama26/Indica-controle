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
37. 037_project_activation_history_rules.sql
38. 038_project_lookup_uuid_columns.sql
39. 039_backfill_operation_page_permissions.sql
40. 040_reorganize_menu_sections_and_page_permissions.sql
41. 041_create_project_material_forecast.sql
42. 042_materials_price_status_and_history.sql
43. 043_project_forecast_import_guards.sql
44. 044_material_code_precheck_rpc.sql
45. 045_create_tenants_and_user_tenant_access.sql
46. 046_add_tenant_fk_to_all_tenant_tables.sql
47. 047_create_job_title_types_and_people_type_link.sql
48. 048_create_job_levels_and_people_level_link.sql
49. 049_create_service_activities_and_page_permissions.sql
50. 050_activity_code_precheck_and_optional_fields.sql
51. 051_create_app_entity_history_and_activity_status.sql
52. 052_create_teams_and_page_permissions.sql
53. 053_create_team_types_and_link_teams.sql
54. 054_enforce_team_unique_by_name_foreman_plate.sql
55. 055_add_people_status_and_cancellation_fields.sql
56. 056_prevent_people_duplicate_identity.sql
57. 057_add_team_type_to_service_activities.sql
58. 058_enforce_rls_no_all_no_delete.sql
59. 059_create_location_planning.sql
60. 060_add_project_has_locacao.sql
61. 061_create_location_risks.sql
62. 062_create_location_execution_support_items.sql
63. 063_create_location_save_rpcs.sql
64. 064_create_project_activity_forecast.sql
65. 065_project_forecast_manual_and_activity_import.sql
66. 066_harden_location_and_project_forecast_rpcs.sql
67. 067_create_project_programming.sql
68. 068_link_teams_service_center_and_harden_programming_rpc.sql
69. 069_add_programming_cancellation.sql
70. 070_add_programming_status_and_project_guard.sql
71. 071_programming_week_summary_and_support_catalog.sql
72. 072_create_programming_support_items.sql
73. 073_add_project_fob.sql
74. 074_create_programming_copy_batches.sql
75. 075_allow_team_period_copy_batches.sql
76. 076_create_copy_team_programming_period_rpc.sql
77. 077_create_admin_write_rpcs.sql
78. 078_create_programming_history_append_rpc.sql
79. 079_create_people_and_invite_write_rpcs.sql
80. 080_seed_location_risks_on_initialize.sql
81. 081_add_jsonb_object_length_compat.sql
82. 082_create_programming_batch_create_rpc.sql
83. 083_add_programacao_simples_page_permissions.sql
84. 084_deactivate_legacy_programacao_page.sql

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

037_project_activation_history_rules.sql
- Permite evento `ACTIVATE` em `project_history` e adiciona `action_type` em `project_cancellation_history`.

038_project_lookup_uuid_columns.sql
- Migra `project` para usar UUID nas colunas de dominio (lookups), remove redundancia `*_text` da tabela e cria `project_with_labels` para exibicao textual.

039_backfill_operation_page_permissions.sql
- Garante `projetos`, `locacao` e `programacao` em `app_pages` e faz backfill de permissoes faltantes em `role_page_permissions` e `app_user_page_permissions`.

040_reorganize_menu_sections_and_page_permissions.sql
- Reorganiza secoes do menu (`Operacao`, `Almoxarifado`, `Cadastros` e `Cadastro Base`) e faz backfill de permissoes para novas telas (`medicao`, `cargo` e cadastros base).

041_create_project_material_forecast.sql
- Cria `project_material_forecast` para materiais previstos por projeto, com RLS, auditoria e RPC transacional para substituir lista importada.

042_materials_price_status_and_history.sql
- Evolui `materials` com `unit_price`, status ativo, cancelamento/ativacao e historicos (`material_history` e `material_cancellation_history`), removendo `lp` e `serial` do cadastro base.

043_project_forecast_import_guards.sql
- Adiciona RPCs para importacao protegida de `project_material_forecast`, bloqueando codigo duplicado no arquivo e codigo ja importado no projeto.

044_material_code_precheck_rpc.sql
- Adiciona RPC de pre-check (`precheck_material_code_conflict`) para bloquear cadastro/edicao de material com codigo duplicado no mesmo tenant.

045_create_tenants_and_user_tenant_access.sql
- Cria `tenants` como entidade de isolamento, cria `app_user_tenants` para vincular usuario a multiplos tenants/contratos, faz backfill e atualiza `user_can_access_tenant`.

046_add_tenant_fk_to_all_tenant_tables.sql
- Varre tabelas publicas com `tenant_id`, faz backfill de `tenants` com IDs faltantes e cria FK `tenant_id -> tenants(id)` onde ainda nao existir.

047_create_job_title_types_and_people_type_link.sql
- Cria `job_title_types` (tipos permitidos por cargo), adiciona `people.job_title_type_id` e aplica FK composta para garantir consistencia de tenant + cargo + tipo.

048_create_job_levels_and_people_level_link.sql
- Cria `job_levels` com nivel (`text`) livre por tenant e adiciona `people.job_level` com FK composta (`tenant_id`, `job_level`) para consumo seguro do catalogo.

049_create_service_activities_and_page_permissions.sql
- Cria `service_activities` (codigo, descricao, grupo, valor, unidade, alcance) com RLS multi-tenant e adiciona a pagina `atividades` em `app_pages`, `role_page_permissions` e `app_user_page_permissions`.

050_activity_code_precheck_and_optional_fields.sql
- Torna `service_activities.group_name` e `service_activities.scope` opcionais, mantendo validacao de nao-vazio quando informado, e cria RPC `precheck_activity_code_conflict` para bloquear codigo duplicado por tenant em cadastro/edicao.

051_create_app_entity_history_and_activity_status.sql
- Cria `app_entity_history` como historico generico para entidades da aplicacao (reutilizavel por telas) e adiciona em `service_activities` os campos de cancelamento/ativacao com consistencia de status.

052_create_teams_and_page_permissions.sql
- Cria `teams` (nome da equipe, placa do veiculo e encarregado) com RLS multi-tenant, cancelamento/ativacao e adiciona a pagina `equipes` em `app_pages`, `role_page_permissions` e `app_user_page_permissions`.

053_create_team_types_and_link_teams.sql
- Cria `team_types`, faz backfill de tipo padrao por tenant, adiciona `teams.team_type_id` obrigatorio e inclui a pagina `tipo-equipe` em `app_pages`, `role_page_permissions` e `app_user_page_permissions`.

054_enforce_team_unique_by_name_foreman_plate.sql
- Remove unicidades isoladas de nome/placa em `teams` e passa a exigir unicidade pela combinacao `tenant_id + foreman_person_id + name + vehicle_plate`.

055_add_people_status_and_cancellation_fields.sql
- Adiciona status ativo/inativo e campos de cancelamento/ativacao em `people`, com consistencia para o fluxo de bloqueio e reativacao.

056_prevent_people_duplicate_identity.sql
- Adiciona protecao extra contra duplicidade de identidade em `people` por tenant.

057_add_team_type_to_service_activities.sql
- Vincula `service_activities` ao catalogo `team_types` por tenant com backfill e FK composta.

058_enforce_rls_no_all_no_delete.sql
- Revisa policies RLS das tabelas tenantizadas para remover `FOR ALL` e `DELETE`, padronizando `SELECT`, `INSERT` e `UPDATE`.

059_create_location_planning.sql
- Cria a base da `Locacao` por projeto (`project_location_plans`, `project_location_materials`, `project_location_activities`) e a RPC `initialize_project_location_plan`.

060_add_project_has_locacao.sql
- Adiciona o flag operacional `project.has_locacao`, faz backfill e atualiza a view `project_with_labels`.

061_create_location_risks.sql
- Cria `project_location_risks` para registrar riscos da `Locacao` por projeto, com `description`, `is_active`, RLS e auditoria.

062_create_location_execution_support_items.sql
- Cria `location_execution_support_items` para registrar o catalogo de apoio de execucao da `Locacao` por tenant, com `description`, `is_active`, RLS e auditoria.

063_create_location_save_rpcs.sql
- Cria RPCs para centralizar o salvamento validado da `Locacao`, `Materiais previstos` e `Atividades previstas`, mantendo as regras de bloqueio no banco.

064_create_project_activity_forecast.sql
- Cria `project_activity_forecast`, a RPC `save_project_activity_forecast` e ajusta o bootstrap da `Locacao` para seedar atividades previstas a partir do projeto.

065_project_forecast_manual_and_activity_import.sql
- Cria a RPC `save_project_material_forecast` para inclusao/edicao manual de `project_material_forecast` e adiciona RPCs protegidas para importacao em massa de `project_activity_forecast`.

066_harden_location_and_project_forecast_rpcs.sql
- Endurece as RPCs de `Locacao` e dos previstos de `Projetos` com controle de concorrencia por `updated_at`, limites maximos de quantidade e obrigatoriedade condicional de observacoes.

067_create_project_programming.sql
- Cria a base multi-tenant da `Programacao` com agenda, atividades, RLS, indices e auditoria.

068_link_teams_service_center_and_harden_programming_rpc.sql
- Vincula `teams` a `project_service_centers` e cria a RPC transacional `save_project_programming` com protecoes operacionais.

069_add_programming_cancellation.sql
- Adiciona cancelamento persistente na `Programacao`, com soft cancel, motivo e auditoria.

070_add_programming_status_and_project_guard.sql
- Separa `ADIADA` de `CANCELADA` na `Programacao` e bloqueia inativacao de projeto com agenda pendente.

071_programming_week_summary_and_support_catalog.sql
- Cria resumo semanal por equipe e conecta a `Programacao` ao apoio derivado da `Locacao`.

072_create_programming_support_items.sql
- Cria o catalogo proprio de apoio da `Programacao` e ajusta a agenda para consumir esse catalogo.

073_add_project_fob.sql
- Adiciona `project.fob`, aplica `check` de exatamente `10` caracteres quando preenchido e republica `project_with_labels`.

074_create_programming_copy_batches.sql
- Cria base para rastrear lotes de copia da `Programacao`.

075_allow_team_period_copy_batches.sql
- Ajusta schema/permissoes para permitir lotes de copia por periodo/equipe.

076_create_copy_team_programming_period_rpc.sql
- Cria RPC transacional para copiar a linha de programacao por periodo/equipe.

077_create_admin_write_rpcs.sql
- Centraliza escritas administrativas/cadastrais em RPCs transacionais com concorrencia e historico.

078_create_programming_history_append_rpc.sql
- Cria RPC dedicada para append de historico da `Programacao`.

079_create_people_and_invite_write_rpcs.sql
- Cria RPCs transacionais para escrita de `Pessoas` e auditoria de `Invite`.

080_seed_location_risks_on_initialize.sql
- Atualiza `initialize_project_location_plan` para seedar riscos de `Pre APR` em novos planos com base no historico de riscos do tenant.

081_add_jsonb_object_length_compat.sql
- Adiciona funcao de compatibilidade `public.jsonb_object_length(jsonb)` para ambientes Postgres sem essa funcao nativa, preservando execucao das RPCs administrativas.

082_create_programming_batch_create_rpc.sql
- Cria a RPC `save_project_programming_batch` para cadastro transacional da Programacao em lote (multiplas equipes).

083_add_programacao_simples_page_permissions.sql
- Inclui a nova `Programacao` em `app_pages` (page_key `programacao-simples`) e faz backfill em `role_page_permissions` e `app_user_page_permissions`.

084_deactivate_legacy_programacao_page.sql
- Desativa a tela legada `programacao` em `app_pages` e bloqueia acesso em `role_page_permissions` e `app_user_page_permissions`.
 
Lacunas ainda nao versionadas
- integracao de auditoria adicional para expiracao de sessao, se necessario alem do `login_audit`

Observacao
- As migrations acima suportam o app atual.
- A modelagem de `project` ja existe e pode evoluir com novos relacionamentos.
