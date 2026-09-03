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
85. 085_add_programming_structure_fields_and_actions_support.sql
86. 086_add_service_activities_is_active_compat.sql
171. 171_update_service_activity_voice_point_rpc.sql
175. 175_add_team_supervisor_link.sql
182. 182_create_operational_billing_dashboard_page.sql
195. 195_create_job_titles_page.sql
197. 197_enforce_people_unique_matriculation.sql
198. 198_add_people_cpf_optional.sql
199. 199_people_cpf_unique_phone_and_conditional_type.sql
205. 205_swap_active_team_foremen.sql
206. 206_add_stock_transfer_operation_purpose.sql
210. 210_harden_function_search_path_and_rpc_execute.sql
211. 211_block_duplicate_asbuilt_measurement_project.sql
266. 266_allow_multiple_projects_team_composition.sql
267. 267_sync_programming_operational_fields_by_project_date.sql
268. 268_backfill_no_production_measurement_rates.sql
269. 269_guard_programming_stage_on_active_records.sql
270. 270_defer_active_programming_stage_guard.sql
271. 271_fix_deferred_programming_stage_guard_current_row.sql
272. 272_harden_anticipated_work_completion_status.sql
273. 273_define_programming_group_id.sql
274. 274_transactional_copy_programming_to_dates_selected_teams.sql
275. 275_harden_programming_stage_state_integrity.sql
276. 276_fix_anticipated_reopen_copy_and_group_ownership.sql
277. 277_normalize_partial_and_completed_work_status.sql
278. 278_harden_security_advisor_warnings.sql
279. 279_harden_completed_group_integrity_transition.sql
280. 280_fix_completed_group_integrity_on_reprogram.sql
281. 281_fix_completed_group_bypass_canonical_code.sql
282. 282_fix_completed_group_integrity_null_boolean.sql
283. 283_sync_completed_work_status_by_programming_group.sql
284. 284_clear_interrupted_programming_work_completion_status.sql
366. 366_create_material_umb_options.sql
367. 367_update_materials_umb_cjt_to_un.sql
387. 387_programming_history_tenant_created_index.sql
388. 388_harden_project_billing_rpc_grants.sql
389. 389_project_billing_unique_semantic_key.sql
390. 390_create_service_center_rpcs.sql
391. 391_create_municipality_rpcs.sql
392. 392_advisor_tenant_first_performance_indexes.sql
393. 393_close_authenticated_write_surface.sql
394. 394_harden_function_search_path_post_210.sql
395. 395_harden_admin_pin_storage.sql
396. 396_drop_legacy_admin_pin_hash.sql
397. 397_fix_admin_pin_search_path.sql
398. 398_stock_requisition_requested_by_date_index.sql
399. 399_create_missing_foreign_key_indexes_post_301.sql
400. 400_programming_team_programmed_foreman_snapshot.sql
401. 401_create_activity_type_page_and_team_type_rpcs.sql
402. 402_move_team_type_screen_to_tipo_equipe.sql
403. 403_create_activity_category_page_and_rpcs.sql
404. 404_create_activity_group_catalog_and_page.sql
405. 405_allow_not_working_composition_with_optional_project.sql
406. 406_fix_service_activities_code_idd_text.sql
407. 407_create_no_production_reason_page_and_rpcs.sql
408. 408_create_stock_center_page_and_rpcs.sql
409. 409_contract_control_fields_and_rpc.sql
410. 410_create_utility_distributor_contact_page.sql
411. 411_activity_groups_unit_value_source.sql

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

085_add_programming_structure_fields_and_actions_support.sql
- Adiciona colunas `poste_qty`, `estrutura_qty`, `trafo_qty` e `rede_qty` em `project_programming`, cria RPC para salvar essas quantidades e atualiza a RPC de lote `save_project_programming_batch`.

086_add_service_activities_is_active_compat.sql
- Adiciona coluna de compatibilidade `service_activities.is_active`, sincroniza com `ativo` e cria trigger/check para manter ambas alinhadas.

150_add_project_is_test_and_status_filters.sql
- Adiciona `project.is_test`, republica a view `project_with_labels` com o novo campo e evolui a RPC `save_project_record` para persistir o marcador de obra de teste.

171_update_service_activity_voice_point_rpc.sql
- Atualiza `save_service_activity_record` para persistir `service_activities.voice_point` no cadastro/edicao de Atividades e manter historico via `app_entity_history`.

173_harden_public_rls_no_delete.sql
- Liga RLS em todas as tabelas `public`, remove policies `FOR ALL`/`FOR DELETE`, recria acessos nao destrutivos equivalentes para policies antigas `FOR ALL` e falha a migration se ainda restar policy com DELETE/ALL ou tabela publica sem RLS.

174_add_project_is_withdrawn.sql
- Adiciona `project.is_withdrawn`, republica a view `project_with_labels` com o novo campo e evolui a RPC `save_project_record` para persistir o marcador `RETIRADO DA CARTEIRA`.

175_add_team_supervisor_link.sql
- Adiciona `teams.supervisor_person_id`, FK por tenant para `people`, indice por supervisor e republica `save_team_record` com validacao de cargo `SUPERVISOR`.

176_create_project_billing_module.sql
- Cria o modulo `Faturamento` com tabelas `project_billing_orders`, `project_billing_order_items`, `project_billing_order_history`, RLS, RPCs transacionais de save/status/lote parcial, cadastro da pagina `faturamento` em permissoes, itens com valor calculado por `voice_point * quantity * rate * unit_value` e snapshot `activity_active_snapshot` para registrar codigo de atividade inativo quando recebido de fonte externa.

177_create_measurement_asbuilt_page.sql
- Cria o modulo `Medicao Asbuilt` com tabelas `project_asbuilt_measurement_orders`, `project_asbuilt_measurement_order_items`, `project_asbuilt_measurement_order_history`, RLS, RPCs transacionais de save/status/lote parcial, cadastro da pagina `medicao-asbuilt` em permissoes, itens com valor calculado por `voice_point * quantity * rate * unit_value` e snapshot `activity_active_snapshot` para registrar codigo de atividade inativo quando recebido de fonte externa.

178_patch_billing_asbuilt_mass_import_items.sql
- Atualiza ambientes que ja aplicaram `176`/`177`, garantindo `activity_active_snapshot` nos itens e recompilando as RPCs de save/lote parcial de `Faturamento` e `Medicao Asbuilt` para preservar atividades importadas em massa no detalhe e na edicao.

180_require_service_activity_group_in_rpc.sql
- Atualiza `save_service_activity_record` para exigir `group_name` no cadastro/edicao de Atividades, mantendo `scope` opcional e preservando validacoes por tenant/categoria.

182_create_operational_billing_dashboard_page.sql
- Cadastra a pagina `dash-operacional-faturamento` em `app_pages`, cria permissoes por role e faz backfill em `app_user_page_permissions` para liberar a tela conforme a matriz multi-tenant.

184_enforce_active_project_for_asbuilt_measurement.sql
- Adiciona trigger em `project_asbuilt_measurement_orders` para impedir novas Medicoes Asbuilt com projeto inexistente ou inativo, inclusive em cadastro em massa/RPC.

186_create_stock_dashboard_page.sql
- Cadastra a pagina `dash-estoque` em `app_pages`, cria permissoes por role e faz backfill em `app_user_page_permissions` para liberar o Dashboard Estoque na matriz multi-tenant.

187_update_stock_dashboard_labels.sql
- Atualiza rotulos de `home` para `Home` e de `dash-estoque` para `Dashboard Estoque` em `app_pages`.

188_create_team_type_history_for_measurement_goals.sql
- Cria `team_type_history` com RLS por tenant, backfill por `app_entity_history` de Equipes e trigger para sincronizar alteracoes de `teams.team_type_id`, permitindo que o Dashboard Medicao calcule metas por tipo vigente da equipe no periodo real.

191_create_project_consumption_page.sql
- Cadastra a pagina `consumo-projeto` em `app_pages`, cria permissoes por role e faz backfill em `app_user_page_permissions` para liberar a tela Consumo por Projeto na matriz multi-tenant.

193_allow_direct_purchase_stock_entry.sql
- Adiciona `stock_transfers.direct_purchase`, permite `stock_transfers.project_id` nulo e ajusta `save_stock_transfer_record` para aceitar `Entrada` de compra direta sem projeto, mantendo escopo por tenant e estorno transacional.

195_create_job_titles_page.sql
- Adiciona cancelamento/ativacao em `job_titles`, checks obrigatorios de codigo/nome e indices de apoio para a tela Cargo manter `job_titles`, `job_title_types` e `job_levels`.

196_fix_team_stock_operation_direct_purchase_rpc_call.sql
- Republica `save_team_stock_operation_record` para chamar `save_stock_transfer_record` com `p_direct_purchase => false`, preservando o fluxo de requisicao/devolucao de equipe apos a assinatura de compra direta.

197_enforce_people_unique_matriculation.sql
- Garante `people.matriculation` unica por tenant, valida duplicidades legadas antes do indice unico e atualiza a RPC `save_person_record` para retornar conflito especifico de matricula.

198_add_people_cpf_optional.sql
- Adiciona `people.cpf` opcional com validacao de 11 digitos, indice por tenant e republica `save_person_record` para salvar CPF normalizado.

199_people_cpf_unique_phone_and_conditional_type.sql
- Garante `people.cpf` unico por tenant, adiciona trava composta `CPF + Matricula`, cria `people.phone` opcional e republica `save_person_record` com telefone.

200_create_team_composition_page.sql
- Cria `team_compositions` e `team_composition_members` com RLS por tenant, snapshots de projeto/equipe/pessoa, indices de contexto, RPC `save_team_composition_record`, pagina `composicao-equipe` e backfill de permissoes.

203_respect_field_return_material_entry_type.sql
- Republica `save_team_stock_operation_record` para o `Retorno de campo` respeitar o `entry_type` derivado do cadastro do material, sem forcar tudo como `SUCATA`, mantendo origem tecnica `CAMPO / INSTALADO` e escopo por tenant.

204_preserve_measurement_work_completion_snapshot.sql
- Permite que Ordens de Medicao preservem no snapshot qualquer `Estado Trabalho` normalizado da Programacao, atualizando a constraint e a RPC de salvamento para nao limitar o valor a `CONCLUIDO`/`PARCIAL`.

205_swap_active_team_foremen.sql
- Cria a RPC `swap_active_team_foremen` para permutar encarregados entre duas equipes ativas do mesmo tenant, validando concorrencia das duas equipes, motivo obrigatorio, unicidade operacional e registrando historico em `app_entity_history`.

206_add_stock_transfer_operation_purpose.sql
- Adiciona `stock_transfers.operation_purpose` e `stock_transfers.balance_correction_reason` para distinguir movimentacao normal de correcao de saldo, com motivo obrigatorio em correcao, indice por tenant/finalidade e suporte na RPC `save_stock_transfer_record`.

207_create_reversals_page_permissions.sql
- Cadastra a pagina `estornos` em `app_pages`, cria permissoes por role e faz backfill em `app_user_page_permissions` para liberar a consulta read-only de estornos na matriz multi-tenant.

208_fix_team_stock_operation_purpose_rpc_call.sql
- Republica `save_team_stock_operation_record` para chamar explicitamente a assinatura atual de `save_stock_transfer_record` com `p_direct_purchase => false`, `p_operation_purpose => 'NORMAL'` e `p_balance_correction_reason => null`, evitando erro tecnico/generico em requisicoes de equipe apos a migration 206.

209_fix_stock_transfer_operation_purpose_overload.sql
- Renomeia a assinatura direta de `save_stock_transfer_record(..., p_direct_purchase)` para um helper interno sem overload e republica as wrappers publicas de 11 e 13 parametros, removendo a ambiguidade interna criada pelos defaults de `operation_purpose`.

210_harden_function_search_path_and_rpc_execute.sql
- Fixa `search_path = public, pg_temp` nas funcoes antigas apontadas pelo Supabase Advisor e remove `EXECUTE` de `PUBLIC`, `anon` e `authenticated` para funcoes `SECURITY DEFINER`, mantendo execucao por `service_role`.

211_block_duplicate_asbuilt_measurement_project.sql
- Bloqueia Medicao Asbuilt para projeto ja lancado no mesmo tenant, reforcando a RPC `save_project_asbuilt_measurement_order` e o trigger de `project_asbuilt_measurement_orders` com trava por projeto.

266_allow_multiple_projects_team_composition.sql
- Cria `team_composition_projects`, faz backfill do projeto legado da Composicao de Equipe e atualiza `save_team_composition_record` para receber multiplos projetos.

212_measurement_minimum_billing_guarantee.sql
- Adiciona calculo backend da garantia de faturamento minimo na Medicao sem producao, salvando `minimum_billing_amount` e snapshots/vinculos de tipo de equipe, meta de pontos e valor do ponto por grupo sem criar itens artificiais.
- Cria `calculate_measurement_minimum_billing_guarantee` para preview/API e trigger, reconhece o motivo por codigo ou nome normalizado e faz backfill das ordens existentes de garantia.
- Evita duplicidade do motivo de garantia por nome normalizado, reatribui ordens para um unico motivo por tenant e desativa duplicatas legadas.

213_dedupe_minimum_billing_no_production_reason.sql
- Executa limpeza incremental para ambientes onde a garantia minima ja foi duplicada antes da deduplicacao da migration 212, reatribuindo Medicao, Faturamento e Medicao Asbuilt para um unico motivo ativo.

214_normalize_programming_work_completion_codes.sql
- Normaliza codigos tecnicos legados do catalogo de `Estado Trabalho`, preserva labels de exibicao, atualiza referencias por cascata e bloqueia novos codigos com acento, espaco ou caractere fora de `A-Z`, `0-9` e `_`.
- Normaliza snapshots legados das Ordens de Medicao e reforca a RPC `save_project_measurement_order` para copiar o `Estado Trabalho` da Programacao em formato tecnico compativel com a constraint.

215_repair_reversals_page_permissions.sql
- Repara ambientes onde a tela `Estornos` foi publicada sem `page_key = estornos` em `app_pages`, preenchendo somente permissoes ausentes por role e usuario sem sobrescrever configuracoes existentes.

216_fix_reversal_operation_purpose_rpc_calls.sql
- Republica as chamadas internas das RPCs de estorno para chamar `save_stock_transfer_record` com `p_direct_purchase`, `p_operation_purpose = 'NORMAL'` e `p_balance_correction_reason = null`, evitando ambiguidade tecnica no estorno por item apos as migrations 206/209.

217_copy_programming_to_multiple_dates.sql
- Cria `copy_project_programming_to_dates` para copiar uma Programacao ativa para multiplas datas com ETAPA por destino, ajustando o rastreio de lotes para `single_to_dates` e mantendo validacao por tenant, concorrencia, conflito de horario e ETAPA.

218_add_asbuilt_service_coverage_end_date.sql
- Adiciona `project_asbuilt_measurement_orders.service_coverage_end_date` para registrar a data limite inclusiva dos servicos cobertos pelo Asbuilt.
- Mantem registros legados sem backfill, exige a data em novos cadastros, atualiza RPC normal/lote, registra historico e cria indice por tenant/data/projeto.

219_fix_asbuilt_coverage_rpc_overload.sql
- Renomeia a assinatura antiga de `save_project_asbuilt_measurement_order` para helper interno e recompila a RPC com data de cobertura, removendo o erro PostgreSQL `42725` de funcao ambigua.

220_version_asbuilt_by_project_coverage_date.sql
- Permite snapshots acumulados de Medicao Asbuilt para o mesmo projeto em datas de corte diferentes.
- Cria unicidade parcial por `tenant_id + project_id + service_coverage_end_date` para registros nao cancelados e atualiza trigger/RPC para bloquear somente o mesmo corte.

221_preserve_programming_wrapper_error_details.sql
- Preserva `reason` e `detail` das falhas SQL nas wrappers atuais de cadastro da Programacao Simples, sem alterar os overloads legados.

222_reuse_retired_serial_temp_table_in_batches.sql
- Corrige o cadastro em massa de Operacoes de Equipe para reutilizar e limpar `pg_temp.tmp_retired_serial_transfer_items` entre linhas do mesmo lote atomico, evitando `relation already exists`.

223_reuse_stock_transfer_temp_table_in_batches.sql
- Complementa a correcao do cadastro em massa de Operacoes de Equipe na funcao-base de estoque, reutilizando e limpando `pg_temp.tmp_stock_transfer_items` entre linhas do mesmo lote atomico.

224_add_team_composition_work_status.sql
- Adiciona `team_compositions.work_status` com os estados `WORKING` e `NOT_WORKING`.
- Publica overload da RPC `save_team_composition_record` que exige somente o encarregado, marcado como ausente, quando a equipe nao atuou.

225_allow_not_working_composition_without_project.sql
- Permite `project_id` e snapshots do projeto nulos exclusivamente quando `work_status = NOT_WORKING`.
- Mantem Projeto obrigatorio para `WORKING`, cria unicidade diaria da equipe sem atuacao e republica a RPC transacional.
 
Lacunas ainda nao versionadas
- integracao de auditoria adicional para expiracao de sessao, se necessario alem do `login_audit`
- habilitar manualmente no Supabase Auth a protecao contra senhas vazadas, quando o plano do projeto permitir.

Observacao
- As migrations acima suportam o app atual.
- A modelagem de `project` ja existe e pode evoluir com novos relacionamentos.
227. 227_create_team_stock_balance_page.sql
- Cadastra a pagina `estoque-equipes`, libera a consulta por role e preenche permissoes individuais ausentes sem sobrescrever configuracoes existentes.

228_make_programming_rede_decimal_transactional.sql
- Cria wrappers full individual e em lote que recebem `rede_qty numeric` e concluem o
  ajuste decimal dentro da mesma transacao da Programacao.
- Restringe EXECUTE das novas wrappers ao `service_role`, sem criar ou alterar policies
  RLS e sem adicionar permissao `DELETE`.

229_save_programming_work_completion_status_transactional.sql
- Cria RPC transacional para salvar Estado Trabalho com lock, `expectedUpdatedAt`,
  conflito estruturado, sincronizacoes operacionais por grupo persistido e historico principal.
- Restringe EXECUTE ao `service_role`, sem criar ou alterar policies RLS e sem adicionar
  permissao `DELETE`.

230_restrict_copy_programming_to_dates_execute.sql
- Corrige a regressao da migration 217, revogando EXECUTE de `PUBLIC`, `anon` e
  `authenticated` na RPC `copy_project_programming_to_dates`.
- Fixa `search_path = public, pg_temp`, mantem somente `service_role` e verifica os
  privilegios durante a propria migration.
- Nao cria ou altera policies RLS e nao adiciona permissao `DELETE`.

231_enforce_programming_composite_tenant_fks.sql
- Substitui FKs simples por FKs compostas com tenant na Programacao, atividades,
  historico, lotes de copia e vinculo da Medicao.
- Interrompe a migration quando encontra dado legado cruzado, valida todas as constraints
  e executa testes negativos de INSERT/UPDATE quando existem dados de tenants distintos.
- Preserva os comportamentos referenciais de cascade/set null aplicaveis.
- Nao cria ou altera policies RLS e nao adiciona permissao `DELETE`.

232_serialize_project_programming_schedule_writes.sql
- Serializa INSERT/UPDATE de agenda por tenant, equipe e data com advisory transaction lock.
- Impede corrida entre gravacoes concorrentes e bloqueia sobreposicao de intervalos ativos.
- Preserva o contrato 409 / TEAM_TIME_CONFLICT com dados do registro conflitante.
- Inclui preflight de sobreposicoes e nao cria ou altera policy RLS de `DELETE`.

233_harden_projects_programming_cross_flow.sql
- Serializa inativacao de Projeto e gravacao de Programacao pelo mesmo lock por tenant + projeto.
- Impede Projeto inativo com Programacao `PROGRAMADA`, `REPROGRAMADA` ou `ADIADA`.
- Remove INSERT/UPDATE e EXECUTE diretos de authenticated no escopo auditado.
- Adiciona FKs compostas por tenant aos historicos e previstos de Projeto.
- Nao cria policy RLS nem permissao de `DELETE`.

234_create_dashboard_teams_page.sql
- Cadastra `dashboard-equipes` em `app_pages`.
- Preenche somente permissoes ausentes por role e usuario, sem sobrescrever configuracoes existentes.
- Mantem `viewer` bloqueado por padrao e libera os demais perfis operacionais.

235_fix_programming_batch_decimal_rpc_name.sql
- Renomeia a wrapper decimal em lote da Programacao para
  `save_project_programming_batch_full_decimal`, respeitando o limite de 63 caracteres
  dos identificadores PostgreSQL e permitindo sua resolucao pelo PostgREST.
- Preserva a implementacao transacional da migration 228, fixa `search_path` seguro e
  mantem EXECUTE somente para `service_role`.

236_add_team_stock_operation_batch_reversal.sql
- Cria `reverse_team_stock_operation_batch_v1` para estornar atomicamente todos os itens ainda ativos de uma Operacao de Equipe.
- Permite concluir lotes parcialmente estornados, preserva a auditoria individual e reverte toda a chamada quando qualquer item falha.
- Valida ator ativo e tenant, bloqueia estorno de estorno e mantem EXECUTE somente para `service_role`.

237_group_team_stock_imports_for_batch_reversal.sql
- Adiciona `operation_batch_id` em `stock_transfer_team_operations` para identificar linhas da mesma requisicao criada pelo cadastro em massa.
- Faz backfill dos lotes existentes somente quando transacao, usuario e contexto operacional coincidem.
- Atualiza o cadastro em massa para persistir o agrupamento e cria `reverse_team_stock_operation_batch_v2` para estornar atomicamente materiais distribuidos em varios `transferId`.

238_add_stock_transfer_batch_reversal.sql
- Adiciona `operation_batch_id` em `stock_transfers` para agrupar linhas bem-sucedidas da mesma importacao e contexto operacional.
- Cria wrapper de importacao restrita ao `service_role`, mantendo o modo parcial por linha e vinculando cada movimentacao ao lote.
- Cria estorno atomico dos itens ainda ativos, com validacao de ator/tenant, bloqueio de Operacoes de Equipe e rollback total quando qualquer item falha.
- Nao faz backfill de importacoes historicas, pois os registros antigos nao possuem uma chave confiavel de lote.

239_backfill_stock_transfer_import_batches.sql
- Reconstrui lotes historicos sem `operation_batch_id` somente quando existem multiplas transferencias de item unico no mesmo segundo.
- Exige coincidencia de tenant, ator, segundo, operacao, centros, projeto, data, compra direta e finalidade.
- Exclui Operacoes de Equipe e movimentacoes criadas como estorno.
- Mantem grupos ambiguos ou isolados sem lote para evitar estorno conjunto indevido.

240_merge_split_stock_transfer_import_batches.sql
- Corrige o recorte por segundo da migration 239, que podia gerar lotes de aproximadamente cinco materiais.
- Une transferencias historicas consecutivas do mesmo contexto quando a diferenca entre registros e de ate 2 segundos.
- Processa somente registros sem lote ou com UUID deterministico da migration 239, preservando os UUIDs reais gerados pela importacao nova.
- Exclui Operacoes de Equipe, estornos e transferencias com mais de um item.

241_create_team_supervisor_history.sql
- Cria `team_supervisor_history` para versionar supervisor por equipe com `valid_from` e `valid_to`.
- Faz backfill a partir de `app_entity_history` e do supervisor atual de `teams`.
- Sincroniza novas trocas por trigger em `teams.supervisor_person_id`, com RLS por tenant e sem permissao de `DELETE`.

242_copy_programming_to_dates_inherit_work_status.sql
- Reaplica `copy_project_programming_to_dates` para resolver o ultimo `Estado Trabalho`
  valido da obra no mesmo tenant antes de criar os destinos.
- Faz a copia por datas herdar o Estado Trabalho vigente da obra, mantendo
  validacoes de tenant, concorrencia, ETAPA, conflito de agenda e projeto concluido.
- Reforca `search_path = public, pg_temp` e EXECUTE somente para `service_role`.

244_create_programming_map_page.sql
- Cadastra `mapa-programacao` em `app_pages`.
- Preenche somente permissoes ausentes em `role_page_permissions` para `master`, `admin`, `supervisor`, `user` e `viewer`, mantendo `viewer` bloqueado por padrao.
- Faz backfill em `app_user_page_permissions` apenas para usuarios que ja possuem matriz customizada, liberando admin/master e mantendo usuarios nao administrativos bloqueados.

245_default_new_pages_inactive_for_users.sql
- Adiciona `app_pages.default_user_access` com default `false` para que telas novas nascam inativas para usuarios nao administrativos.
- Ajusta permissoes automaticas do `mapa-programacao` para preservar admin/master liberados e usuarios comuns bloqueados quando a linha foi criada por migration.
- Preenche permissoes ausentes para usuarios legados conforme `default_user_access`, evitando que uma unica tela nova bloqueada transforme a sessao em matriz parcial.
- Cria triggers para preencher `app_user_page_permissions` ao cadastrar novas telas ou novos usuarios, sem sobrescrever configuracoes existentes.

246_postpone_programming_by_project_date.sql
- Cria `postpone_project_programming_group` para adiar atomicamente todas as programacoes ativas do mesmo Projeto + Data.
- Regra de escopo substituida pela migration 273: a RPC atual usa `programming_group_id`.
- Sem nova data, marca todas as linhas do grupo como `ADIADA`; com nova data, cria uma linha `REPROGRAMADA` para cada equipe afetada.
- Reutiliza as RPCs individuais de status/adiamento dentro da mesma transacao e reverte o grupo inteiro quando qualquer item falha.
- Mantem `expectedUpdatedAt` na linha clicada, escopo por `tenant_id` e EXECUTE somente para `service_role`.

247_allow_pending_serial_identification.sql
- Adiciona `materials.allow_pending_serial_identification` para preparar a regra configuravel futura de Cadastro Base.
- Permite pendencia de identificacao somente para materiais rastreaveis sem LP (`RELIGADOR`/`CHAVE`) quando a flag estiver ativa; `TRAFO` continua exigindo `Serial + LP`.
- Cria `stock_serial_pending_balances` para saldo pendente por tenant, material, centro, projeto e tipo, com FKs compostas por tenant.
- Atualiza as funcoes de movimentacao para Entrada/Transferencia sem serial ajustarem a pendencia na mesma transacao.
- Cria `identify_pending_serial_tracked_unit` para consumir uma pendencia e registrar a unidade identificada.
- Reforca `save_team_stock_operation_record` para manter Requisicao/Devolucao/Retorno de Campo com serial obrigatorio.

248_cancel_programming_by_project_date.sql
- Cria `cancel_project_programming_group` para cancelar atomicamente todas as programacoes ativas do mesmo Projeto + Data.
- Regra de escopo substituida pela migration 273: a RPC atual usa `programming_group_id`.
- Reutiliza `set_project_programming_status` dentro da mesma transacao, preservando historico, `expectedUpdatedAt` na linha clicada e rollback total do grupo em falha.
- Mantem escopo por `tenant_id`, bloqueia execucao por `anon/authenticated` e concede EXECUTE somente a `service_role`.

249_save_copy_source_in_programming_full_rpc.sql
- Recria `save_project_programming_full_decimal_with_electrical_and_eq` com parametros opcionais `p_copied_from_programming_id` e `p_copy_batch_id`.
- Permite que copias criadas por `COPY_TO_DATES` gravem o vinculo direto origem -> copia dentro da mesma transacao do INSERT.
- Valida origem/lote por `tenant_id` e mantem EXECUTE somente para `service_role`.

250_revoke_trigger_functions_from_public.sql
- Revoga EXECUTE publico das funcoes SECURITY DEFINER criadas pela migration 245.
- Ajusta `search_path` para `public, pg_temp`.
- Garante que funcoes de permissao automatica continuem restritas ao fluxo interno.

251_restrict_rpc_execute_to_service_role.sql
- Revoga EXECUTE de `anon` e `authenticated` em RPCs SECURITY DEFINER expostas apos as migrations 212-247.
- Mantem uso pelo backend via `service_role`.
- Reduz superficie de execucao direta pelo client autenticado.

252_create_idempotency_requests.sql
- Cria tabela `idempotency_requests` para cache de respostas de operacoes criticas com chave de idempotencia.
- Mantem acesso exclusivo via `service_role`, com RLS sem policies publicas.
- Adiciona indice por `expires_at` para limpeza periodica.

253_granular_page_permissions.sql
- Evolui permissoes por pagina para acoes granulares (`create`, `update`, `cancel`, `reverse`, `import`, `export`).
- Faz backfill das novas colunas a partir de `can_access`.
- Recria `user_has_page_action` com mapeamento real de acao para coluna.

254_create_minimum_factor_analysis_page.sql
- Cadastra `apuracao-fator-minimo` em `app_pages` com `default_user_access = false`.
- Preenche permissoes ausentes liberando somente perfis administrativos por padrao.
- Adiciona indice em `project_measurement_order_items` por `tenant_id`, `service_activity_id`, `is_active` e `measurement_order_id` para apoiar a simulacao filtrada por codigo de servico.

255_add_anticipated_work_completion_status.sql
- Adiciona `ANTECIPADO` ao catalogo `programming_work_completion_catalog` de todos os tenants e desativa o legado `ANTECIPADA`.
- Migra referencias existentes de `ANTECIPADA` para `ANTECIPADO` em `project_programming` e snapshots de Medicao.
- Cria `mark_project_programming_future_stages_anticipated` para marcar etapas ativas posteriores do mesmo projeto como `ANTECIPADO` quando uma etapa atual for salva como `CONCLUIDO`.
- Registra historico operacional para cada linha alterada, preservando escopo por `tenant_id + project_id + etapa_number`.
- Mantem EXECUTE restrito a `service_role`.

256_backfill_programming_work_completion_status.sql
- Preenche `Estado Trabalho` em branco de programacoes ativas (`PROGRAMADA`/`REPROGRAMADA`) usando sugestao automatica validada por catalogo ativo do tenant.
- Mantem fora do backfill automatico casos operacionais como etapa sem numeracao/flag e projeto nao encontrado.
- Registra historico em `project_programming_history` para cada linha atualizada.

257_backfill_inactive_programming_work_completion_status.sql
- Historicamente preencheu `Estado Trabalho` em branco de programacoes inativas (`ADIADA`/`CANCELADA`) usando sugestoes nao conclusivas e catalogo ativo do tenant.
- Nao herda `CONCLUIDO` para programacoes interrompidas; divergencias ficam para revisao operacional.
- Mantem o status operacional original e registra historico em `project_programming_history`.
- Comportamento superado pela migration 284: `ADIADA`/`CANCELADA` devem ficar com `Estado Trabalho` em branco.

258_guard_interrupted_programming_completed_work_status.sql
- Criou trigger em `project_programming` para impedir novas divergencias `ADIADA/CANCELADA + CONCLUIDO`.
- Bloqueia nova transicao para `ADIADA` ou `CANCELADA` quando o projeto ja possui Estado Trabalho concluido.
- Mantem dados legados intactos para revisao por auditoria, sem backfill destrutivo.
- Guarda recriada pela migration 284 para limpar qualquer `Estado Trabalho` em `ADIADA`/`CANCELADA`, preservando o bloqueio de projeto concluido.

267_sync_programming_operational_fields_by_project_date.sql
- Cria `sync_project_programming_group_operational_fields` para sincronizar campos operacionais da Programacao entre equipes ativas do mesmo Projeto + Data.
- Regra de escopo substituida pela migration 273: a RPC atual usa `programming_group_id`.
- Recria `save_project_programming_full_decimal_with_electrical_and_eq` para executar a sincronizacao dentro da mesma transacao do salvamento individual.
- Sincroniza Alimentador, Nº EQ, Tipo de SGD, clientes afetados, janela de desligamento, Apoio e quantidades (`POSTE`, `ESTRUTURA`, `TRAFO`, `REDE`).
- Registra historico operacional por linha afetada e mantem EXECUTE restrito a `service_role`.

268_backfill_no_production_measurement_rates.sql
- Corrige ordens `SEM_PRODUCAO` nao canceladas que ficaram com `manual_rate = 1`.
- Usa a ultima taxa `COM_PRODUCAO` nao cancelada do mesmo `tenant_id + project_id`.
- Registra historico em `project_measurement_order_history` com metadata `migration-268`.

269_guard_programming_stage_on_active_records.sql
- Exige ETAPA numerica ou flag `ETAPA UNICA`/`ETAPA FINAL` em programacoes ativas.
- Faz backfill seguro de ativas antigas sem ETAPA e preserva flags especiais em adiamento.

270_defer_active_programming_stage_guard.sql
- Troca a guarda imediata de ETAPA ativa por constraint trigger diferida.
- Permite que RPCs transacionais criem a linha base e preencham ETAPA antes do commit.

271_fix_deferred_programming_stage_guard_current_row.sql
- Ajusta a trigger diferida para validar a linha final persistida.
- Evita falso bloqueio quando a RPC full insere sem ETAPA e atualiza a etapa na mesma transacao.

272_harden_anticipated_work_completion_status.sql
- Adiciona `anticipated_by_programming_id`, `anticipated_at` e `previous_work_completion_status` em `project_programming`.
- Bloqueia `ANTECIPADO` sem ETAPA numerica, sem origem `CONCLUIDO` anterior no mesmo tenant/projeto ou sem rastreio.
- Recria a RPC de antecipacao para preservar Estado Trabalho anterior e origem causadora.
- Cria RPC de protecao para copia/adicao de equipe marcar `ANTECIPADO` somente apos nova validacao do `CONCLUIDO` anterior; a migration 276 depois restringe o fluxo normal quando o projeto esta concluido.
- Ao reabrir um `CONCLUIDO`, trigger restaura apenas as linhas `ANTECIPADO` causadas por aquela programacao.
- Quando dados legados bloqueiam o backfill, informa exemplos de registros invalidos para apoiar a correcao operacional.

273_define_programming_group_id.sql
- Adiciona `project_programming.programming_group_id` como fronteira persistida do grupo operacional.
- Faz backfill por ETAPA numerica (`tenant_id + project_id + execution_date + etapa_number`), ETAPA UNICA, ETAPA FINAL e grupo proprio para registros historicos sem etapa.
- Cria trigger para atribuir/recalcular o grupo em inserts e mudancas de projeto/data/etapa.
- Recria `cancel_project_programming_group`, `postpone_project_programming_group` e `sync_project_programming_group_operational_fields` para usar `programming_group_id`.
- Mantem `EXECUTE` das RPCs sensiveis restrito a `service_role` e adiciona indices por `tenant_id + programming_group_id`.

274_transactional_copy_programming_to_dates_selected_teams.sql
- Recria `copy_project_programming_to_dates` para aceitar multiplas datas com `teamIds` por destino.
- Executa validacao, lote, criacao das programacoes, vinculos de copia, historico e rastreio de `ANTECIPADO` em uma unica transacao; a migration 276 depois remove a excecao de copia normal em projeto concluido.
- Remove a estrategia de compensacao por UPDATE/CANCELADA quando uma iteracao falhava depois de criar linhas.
- Mantem EXECUTE restrito a `service_role`.

275_harden_programming_stage_state_integrity.sql
- Endurece a trigger diferida de ETAPA ativa para permitir exatamente uma classificacao.
- Programacao ativa deve ter `etapa_number > 0` sem flags, ou `ETAPA UNICA`, ou `ETAPA FINAL`.
- Bloqueia combinacoes como ETAPA 0, ETAPA negativa, ETAPA numerica com flag e `ETAPA UNICA + ETAPA FINAL`.
- A migration para antes de alterar a trigger quando encontra dados ativos invalidos e mostra exemplos para saneamento.

276_fix_anticipated_reopen_copy_and_group_ownership.sql
- Garante no banco no maximo um `CONCLUIDO` ativo por `tenant_id + project_id`, alinhando `CONCLUIDO` como conclusao global do projeto.
- Saneia duplicados legados de `CONCLUIDO` ativo antes do indice unico: mantem o registro mais recente por `updated_at`, `execution_date`, `etapa_number`, `created_at` e `id`, limpa o Estado Trabalho dos demais e registra historico.
- Forca `SET CONSTRAINTS ALL IMMEDIATE` apos saneamentos que atualizam `project_programming`, evitando eventos de trigger diferidos pendentes antes do `CREATE INDEX`.
- Encerra operacionalmente linhas `ANTECIPADO` com `status = ANTECIPADA` para liberar agenda da equipe, preservando `previous_operational_status` para restauracao.
- Ajusta `copy_project_programming_to_dates` de forma idempotente para bloquear data destino anterior/igual a origem, sem depender de localizar textualmente a trava de projeto `CONCLUIDO` na funcao ja instalada.
- Reforca `programming_group_id` como campo controlado pelo banco, preservando o grupo em tentativa de alteracao direta e recalculando apenas quando Projeto, Data ou ETAPA mudarem.

277_normalize_partial_and_completed_work_status.sql
- Garante catalogo ativo canonico de Estado Trabalho: `CONCLUIDO`, `PARCIAL_PLANEJADO`, `PARCIAL_NAO_PLANEJADO` e `ANTECIPADO`.
- Normaliza `PARCIAL`/`PARTIAL` legado para `PARCIAL_NAO_PLANEJADO` em `project_programming.work_completion_status` e `work_completion_status_id`.
- Desativa o item de catalogo `PARCIAL` e recria o trigger de sincronismo texto/UUID para aceitar somente catalogo ativo.
- Recria a sincronizacao generica de Estado Trabalho para usar `programming_group_id` e nao propagar `CONCLUIDO`/`ANTECIPADO`.
- Registra historico tecnico `NORMALIZE_WORK_COMPLETION_STATUS` nas linhas ajustadas.
- Bloqueia `CONCLUIDO` quando existir outra programacao ativa no mesmo `programming_group_id`, impedindo conclusao ambigua na mesma ETAPA/grupo.

278_harden_security_advisor_warnings.sql
- Corrige alertas de seguranca do Supabase Advisor em funcoes/RPCs sensiveis.
- Ajusta `search_path`, revoga grants amplos e adiciona validacao de chamador onde aplicavel.

279_harden_completed_group_integrity_transition.sql
- Recria `sync_project_programming_work_completion_status_fields` para respeitar update explicito por texto, inclusive limpeza para `NULL`, sem restaurar UUID antigo.
- Remove o trigger legado `trg_project_programming_sync_work_completion_status_fields` quando existir e mantem apenas `trg_project_programming_sync_work_completion_status`.
- Recria `enforce_completed_work_status_group_integrity` para comparar o Estado Trabalho canonico anterior e novo usando texto e UUID (`work_completion_status_id`).
- Mantem o bloqueio ao inserir/reativar/transicionar para `CONCLUIDO` quando houver outra linha ativa no mesmo `programming_group_id`.
- Evita falso bloqueio em edicoes operacionais comuns quando a linha ja estava tecnicamente `CONCLUIDO` no mesmo grupo, inclusive em dados com texto nulo e UUID apontando para `CONCLUIDO`.

280_fix_completed_group_integrity_on_reprogram.sql
- Corrige falso bloqueio ao reprogramar linha que ja herdava `CONCLUIDO`, quando a mudanca de data recalculava `programming_group_id`.

281_fix_completed_group_bypass_canonical_code.sql
- Ajusta o bypass da guarda de `CONCLUIDO` para comparar codigo canonico resolvido por texto/UUID, nao valores brutos.

282_fix_completed_group_integrity_null_boolean.sql
- Corrige booleanos NULL na guarda de `CONCLUIDO`, evitando falso bloqueio em linhas com Estado Trabalho vazio.

283_sync_completed_work_status_by_programming_group.sql
- Remove o indice parcial `idx_project_programming_one_active_completed_per_project`, que permitia apenas uma linha ativa `CONCLUIDO` por projeto.
- Cria indice parcial auxiliar por `tenant_id + project_id + programming_group_id` para programacoes ativas concluidas.
- Recria `enforce_completed_work_status_group_integrity` para permitir `CONCLUIDO` em varias equipes do mesmo `programming_group_id` e bloquear apenas outro grupo operacional ativo concluido no mesmo projeto.
- Usa `pg_advisory_xact_lock` por tenant/projeto para serializar conclusoes concorrentes apos a remocao do indice unico global.
- Faz backfill de grupos ja parcialmente concluidos, copiando `CONCLUIDO` para as linhas ativas irmas do mesmo `programming_group_id` com historico.
- Recria `sync_programming_work_completion_status_by_project_date` para sincronizar `CONCLUIDO` dentro do `programming_group_id` e continuar ignorando `ANTECIPADO`.

284_clear_interrupted_programming_work_completion_status.sql
- Limpa `work_completion_status` e `work_completion_status_id` de programacoes `ADIADA`/`CANCELADA` legadas, com historico por linha.
- Recria `enforce_interrupted_programming_completed_work_status` para manter `Estado Trabalho` em branco em linhas interrompidas.
- Preserva o bloqueio de adiamento/cancelamento quando o projeto ou a propria linha ja esta `CONCLUIDO`.
- Mantem `ANTECIPADA` fora dessa limpeza, pois `ANTECIPADO` e rastreio tecnico da conclusao antecipada.

285_fix_asbuilt_batch_import_coverage_date.sql
- Corrige regressao da migration 259 na RPC `save_project_asbuilt_measurement_order_batch_partial`.
- Restaura o repasse de `serviceCoverageEndDate`/`service_coverage_end_date` para `save_project_asbuilt_measurement_order` no cadastro em massa de Medicao Asbuilt.
- Preserva o limite de 500 medicoes por lote e os grants restritos a `authenticated`/`service_role`.

286_transfer_programming_team.sql
- Adiciona o status interno `TRANSFERIDA` em `project_programming`.
- Recria a guarda de linhas interrompidas para manter `Estado Trabalho` em branco tambem em `TRANSFERIDA`.
- Cria a RPC transacional `transfer_project_programming_team` para marcar a linha de origem como `TRANSFERIDA` e criar nova linha ativa na programacao destino.
- Registra historico `TRANSFER_TEAM` com origem, destino, grupo, projeto, data, etapa e nova linha criada.
- Mantem EXECUTE restrito a `service_role`.

287_add_stock_transfer_operation_event_id.sql
- Adiciona `stock_transfers.operation_event_id` como identificador deterministico do evento operacional.
- Define a regra de negocio por `tenant_id + data da movimentacao + equipe + projeto + status`.
- Cria triggers para manter o evento sincronizado em movimentacoes fisicas e operacoes de equipe.
- Faz backfill dos eventos existentes e adiciona indice por `tenant_id + operation_event_id`.
- Mantem funcoes auxiliares restritas e sem alteracao de policies RLS.

289_warehouse_addressing_cell_clear_and_conflicts.sql
- Cria `clear_warehouse_cell_addresses` para limpar em lote todos os materiais enderecados numa posicao (coluna+linha) do mapa do almoxarifado, independente de andar/posicao/tipo, com log em `warehouse_address_history`.
- Recria `save_warehouse_map_config` para retornar a lista detalhada de materiais/posicoes conflitantes (`conflicts`) quando o novo layout deixaria enderecos orfaos, mantendo o bloqueio `ADDRESSES_OUTSIDE_NEW_LAYOUT`.
- Mantem EXECUTE restrito a `service_role` e sem alteracao de policies RLS.

290_warehouse_map_config_history_snapshot.sql
- Recria `save_warehouse_map_config` para gravar em `warehouse_address_history.details` o snapshot `before`/`after` (colunas, linhas, prateleiras com andares) de cada `CONFIG_SAVE`, permitindo exibir historico de "como estava/como ficou" na tela de Configuracao do Mapa.
- Mantem EXECUTE restrito a `service_role` e sem alteracao de policies RLS.

291_warehouse_address_history_action_index.sql
- Substitui `idx_warehouse_address_history_tenant_map_created` por `idx_warehouse_address_history_tenant_map_action_created` (inclui `action_type`), necessario para a consulta paginada de historico de `CONFIG_SAVE` nao precisar varrer o volume, maior e crescente, de `ADDRESS_ASSIGN`/`ADDRESS_CLEAR` do mesmo mapa.

292_warehouse_addressing_multi_position.sql
- Remove `warehouse_material_addresses_unique_material`, permitindo o mesmo material ocupar mais de uma posicao no mesmo mapa (endereco continua sendo so um marcador de presenca por posicao, sem quantidade).
- Recria `assign_warehouse_material_address` com `p_address_id` opcional (null = cria endereco novo; preenchido = edita aquele endereco especifico), substituindo o upsert por `material_id`.
- Recria `assign_warehouse_material_addresses_batch` removendo os bloqueios `DUPLICATE_BATCH_MATERIAL` e `MATERIAL_ALREADY_ADDRESSED` (mantem `DUPLICATE_BATCH_POSITION`/`POSITION_OCCUPIED`/`MATERIAL_WITHOUT_STOCK`).
- Recria `clear_warehouse_material_address` para identificar a linha por `p_address_id` em vez de `p_material_id`.
- Mantem EXECUTE restrito a `service_role` e sem alteracao de policies RLS.

293_create_measurement_project_activity_indicators.sql
- Cria `measurement_project_activity_indicators` para configurar, por tenant, quais codigos de atividades devem aparecer como chips de uso no cadastro da Medicao.
- Adiciona RLS por tenant via `user_can_access_tenant`, indice por `tenant_id + is_active + sort_order + activity_code` e trigger de auditoria.
- Faz seed inicial dos codigos `AHO717` e `AHO720` para tenants existentes, permitindo alterar/adicionar/remover codigos pela tabela sem mexer no frontend.

294_create_stock_requisition_module.sql
- Cria a base do fluxo de Requisicao com Atendimento no Almoxarifado: `stock_requisition_requests`, `stock_requisition_request_items` e o catalogo `stock_requisition_adjustment_reason_catalog` (motivos de Reduzir/Recusar).
- Nao movimenta saldo; o atendimento (migration 295) gera a REQUISITION real reusando `save_team_stock_operation_record`.
- Aplica RLS por tenant via `user_can_access_tenant` (somente SELECT; escrita apenas pelas RPCs), FKs compostas `(id, tenant_id)` para centro/equipe/projeto/material e indices por status/equipe/projeto/data.

295_create_stock_requisition_rpcs.sql
- Cria as RPCs transacionais `create_stock_requisition_request`, `claim_stock_requisition_request`, `release_stock_requisition_claim`, `fulfill_stock_requisition_request` e `cancel_stock_requisition_request`, mais o helper `stock_requisition_actor_allowed`.
- `fulfill` e atomico (padrao begin/exception com rollback total): valida decisoes (Aceitar/Reduzir/Recusar), chama `save_team_stock_operation_record` por item, carimba `operation_batch_id = pedido` e vincula `resulting_transfer_item_id`.
- Concorrencia por claim (`EM_ATENDIMENTO` + expiracao); duplicidade nivel item; EXECUTE restrito a `service_role`.

296_register_stock_requisition_pages.sql
- Cadastra as telas `requisicao-solicitacao` e `requisicao-atendimento` na secao `Almoxarifado` com `default_user_access = false` (nascem bloqueadas para nao-admin) e backfill de permissoes por role e por usuario.

297_create_saida_requisicao_permission.sql
- Cria a permissao virtual `saida-requisicao` (nao navegavel; so na matriz de acesso) que controla, dentro de Operacoes de Equipe (`/saida`), quem pode fazer a operacao `REQUISITION`.
- Nasce bloqueada para todos (`default_user_access = false`); perfis administrativos seguem liberados por bypass de `is_admin`. Devolucao e Retorno de campo continuam sob a permissao `saida`.

298_harden_security_definer_execute_grants.sql
- Revoga EXECUTE de `public`, `anon` e `authenticated` em RPCs `SECURITY DEFINER` apontadas pelo Supabase Advisor.
- Mantem EXECUTE somente para `service_role`, alinhado ao padrao dos Route Handlers que validam bearer token, tenant e permissao antes da chamada.
- Cobre Requisicao com Atendimento, Faturamento, Medicao Asbuilt e Permissoes.

299_add_internal_rls_policies_for_system_tables.sql
- Adiciona policies explicitas `service_role` para as tabelas internas `idempotency_requests` e `rate_limit_events`.
- Fecha alertas INFO `RLS Enabled No Policy` do Supabase Advisor sem liberar acesso direto para `anon` ou `authenticated`.
- Preserva uso interno por backend/RPC e revoga grants diretos de usuarios finais.

300_fix_supabase_advisor_performance_warnings.sql
- Otimiza policies RLS apontadas pelo Advisor: usa `(select auth.uid())` em `app_users` e `app_user_tenants`, e consolida SELECT de `app_users`.
- Remove policies SELECT redundantes geradas a partir de antigas policies `FOR ALL` e separa escrita de Composicao de Equipe em INSERT/UPDATE.
- Remove indices duplicados legados em `job_levels`, `job_title_types` e `project`.

301_create_missing_foreign_key_indexes.sql
- Cria dinamicamente indices para foreign keys publicas que ainda nao possuem indice cobrindo as colunas da FK.
- Fecha alertas INFO `unindexed_foreign_keys` do Supabase Advisor.
- Nao remove indices marcados como `unused_index`; esses exigem auditoria manual de workload antes de qualquer drop.

302_drop_redundant_unused_indexes_after_audit.sql
- Remove somente dois indices `unused_index` confirmados como redundantes apos auditoria de 147 dias de estatisticas.
- Droppa `idx_app_users_tenant_matricula`, coberto pelo unique `app_users_tenant_id_matricula_key`.
- Droppa `idx_fk_team_composition_members_team_composition_membe_3b95065b`, coberto pelo indice composto em `(composition_id, tenant_id)`, mantendo os demais indices `unused_index` preservados.

303_add_query_performance_indexes.sql
- Adiciona indices compostos, sempre com `tenant_id` como prefixo, para achados objetivos do Query Performance/Index Advisor.
- Cobre historico de Programacao por `action_type + programming_id + created_at`, Medicao por `execution_date + updated_at`, Projetos por `is_active + is_test + execution_deadline` e Materiais por `is_active + codigo + id`.
- Substitui `idx_materials_tenant_active_codigo` por `idx_materials_tenant_active_codigo_id`, evitando duplicidade e cobrindo tambem a ordenacao secundaria por `id`.

308_identify_pending_serial_in_team_operations.sql
- Republica `save_team_stock_operation_record` para identificar `RELIGADOR`/`CHAVE` pendente durante `REQUISITION`/`RETURN`.
- Quando o serial informado ainda nao existe em `trafo_instances`, a RPC consome uma unidade de `stock_serial_pending_balances` via `identify_pending_serial_tracked_unit` no centro de origem, projeto e tipo da operacao.
- Executa identificacao + `save_stock_transfer_record` em subtransacao; se a gravacao falhar, a pendencia nao fica consumida.
- Mantem `TRAFO` exigindo unidade previamente registrada com `Serial + LP` e nao altera RLS/schema.

309_restrict_admin_rpc_execute_to_service_role.sql
- Revoga EXECUTE de `anon` e `authenticated` em `save_project_record` e `save_team_stock_operation_record`, que regrediram nas migrations 307 e 308.
- Usa varredura dinamica (padrao das migrations 210/251) para cobrir qualquer assinatura remanescente e valida ao final que nenhuma funcao `SECURITY DEFINER` continua executavel por `anon`/`authenticated`.
- Mantem uso pelo backend via `service_role`; nao cria/altera policies RLS nem adiciona permissao `DELETE`.

319_allow_generic_pending_serial_identification.sql (renomeada de 318_* em 2026-07-21 — ver nota de colisao abaixo)
- Recria `identify_pending_serial_tracked_unit` para permitir que `CHAVE`/`RELIGADOR` em Operacoes de Equipe consumam pendencia geral do centro (`project_id = null`) quando nao houver pendencia especifica do projeto.
- A prioridade continua sendo pendencia do mesmo projeto; o fallback so entra para estoque fisico geral de centro.
- A unidade criada/reativada em `trafo_instances` preserva `last_project_id` como o projeto da operacao, mantendo rastreio operacional.
- Mantem `SECURITY DEFINER` com EXECUTE apenas para `service_role`.

331_prevent_duplicate_active_measurement_items.sql
- Saneia itens ativos duplicados em `project_measurement_order_items`, preservando o registro mais recente por `tenant_id + measurement_order_id + service_activity_id`.
- Cria o indice unico parcial `idx_project_measurement_order_items_unique_active_activity` para impedir nova duplicidade ativa da mesma atividade na mesma ordem de Medicao.
- Mantem RLS/policies inalteradas e preserva `tenant_id` como prefixo da regra de unicidade.

332_register_dashboard_portfolio_page.sql
- Cadastra `dashboard-carteira-operacional` em `app_pages` com `default_user_access = false`.
- Preenche permissoes ausentes em `role_page_permissions` e `app_user_page_permissions`, liberando perfis administrativos e mantendo usuarios nao administrativos bloqueados por padrao.
- Nao cria tabelas operacionais, RPCs, grants ou policies novas.

333_dashboard_portfolio_forecast_values_rpc.sql
- Cria a RPC `dashboard_portfolio_forecast_values(p_tenant_id)` para consolidar o valor previsto da carteira por projeto.
- Formula: `SUM(coalesce(nullif(service_activities.voice_point, 0), 1) * project_activity_forecast.qty_planned * coalesce(service_activities.unit_value, 0) * 1)`.
- Mantem `SECURITY INVOKER`, revoga `public`/`anon` e concede `EXECUTE` para `authenticated` e `service_role`.

334_dashboard_portfolio_goal_coverage_rpc.sql
- Cria a RPC `dashboard_portfolio_goal_coverage(p_tenant_id, p_cycle_start, p_produced_value, p_remaining_potential, p_reference_date)` para calcular meta restante, cobertura da meta, autonomia em dias uteis e data prevista de esgotamento da carteira.
- Usa a meta oficial salva em `measurement_cycle_workdays` e `measurement_cycle_target_items`, somando `cycle_goal` e `daily_goal` do ciclo.
- Mantem `SECURITY INVOKER`, revoga `public`/`anon` e concede `EXECUTE` para `authenticated` e `service_role`.

339_add_cmd_to_serial_stock_movements.sql
- Adiciona `cmd boolean not null default false` em `stock_transfer_items` e `trafo_instances`, com indices parciais por tenant para filtros `CMD = Sim`.
- Atualiza a RPC base de Movimentacao de Estoque para persistir `cmd` nos itens e cria trigger para sincronizar a marcacao do item com a instancia serializada atual.
- Faz backfill conservador em `trafo_instances` pelo item de movimentacao mais recente da unidade e mantem EXECUTE da trigger function fechado para `public`/`anon`/`authenticated`.

342_create_programming_legacy_map.sql
- Cria `programming_legacy_map`, o de/para do ID legado de `project_programming` (uma linha por equipe) para a etapa em `programming` (uma por projeto+data) e para a linha de equipe em `programming_team`, resolvido pela chave natural `(tenant_id, project_id, execution_date)`.
- Popula por `insert ... select` re-executavel e reporta por `raise notice` as linhas legadas sem etapa correspondente e o numero de FKs sem par em `project_measurement_orders`, `project_apr_controls` e `cronograma_solicitacoes`.
- Mantem `project_programming` somente leitura (unico ALTER e a garantia idempotente da unique `(id, tenant_id)`, padrao da 226), com RLS de leitura por `user_can_access_tenant` e nenhuma policy de escrita.

343_migrate_legacy_programming_history.sql
- Migra `project_programming_history` para `programming_history` via `programming_legacy_map` (342), colapsando as linhas irmas que o modelo antigo gravava uma por equipe (2594 legadas -> 2027 apos dedupe, medido em producao em 2026-07-29).
- Preserva o `action_type` legado sem traduzir (CREATE/BATCH_CREATE/UPDATE/RESCHEDULE/COPY/ADIADA/CANCELADA), porque as operacoes nao sao equivalentes as do modelo novo; campos sem coluna no destino vao para `metadata` com prefixo `legacy`, e `programming_team_id` fica nulo por serem eventos de etapa.
- Idempotente por indice unico parcial sobre `metadata->>'legacyHistoryId'`, criado antes da carga; `project_programming_history` (fonte) nao e alterado.

344_cronograma_read_normalized_programming.sql
- Reponta `cronograma_solicitacoes.programacao_id` de `project_programming` para `programming`, trocando a FK simples por composta com `tenant_id` (regra 12 do guia_sql.md); 0 linhas a remapear em producao, com guarda que aborta se aparecer valor sem par no `programming_legacy_map`.
- Reescreve `get_cronograma_asbuilt_project_ids` para ler `programming`, mantendo as regras anteriores (ignora CANCELADA, exige Estado do Trabalho preenchido, ultimo por `execution_date`/`updated_at`) e o grant restrito a `service_role`.
- Adiciona `BENEFICIO_ATINGIDO` aos estados que liberam As Built: e o mesmo estado de negocio de `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO` com o codigo corrigido pela 310, e sem ele a troca de fonte tiraria As Built de 7 projetos.

345_identify_pending_serial_in_stock_exit.sql
- Republica `save_stock_transfer_record` para permitir `Saida` de `CHAVE`/`RELIGADOR` com serial informado ainda nao identificado, consumindo uma pendencia de `stock_serial_pending_balances` do centro `DE`.
- Mantem `TRAFO` exigindo unidade previamente registrada com `Serial + LP` e mantem `EXIT` sem serial bloqueado pelas validacoes existentes.
- Executa identificacao + gravacao da movimentacao no mesmo bloco transacional; se a gravacao falhar, a pendencia consumida e a unidade temporariamente criada em `trafo_instances` sao revertidas.
- Endurece os grants das assinaturas publicas de `save_stock_transfer_record`, revogando `anon`/`authenticated` e mantendo EXECUTE apenas para `service_role`, pois o backend chama a RPC via client admin.

350_apr_control_match_normalized_programming.sql
- Fase 5a do corte: reponta `project_apr_controls.programming_id` de `project_programming` para `programming`, remapeando os valores existentes via `programming_legacy_map` (66 de 172 APRs tinham vinculo; 0 orfaos, medido por `scripts/audit-apr-programming-match-readonly.mjs`); FK ja nascia composta por tenant na 226, so troca a tabela referenciada.
- Reescreve `save_project_apr_control` para casar `programming` (projeto+data, `status <> CANCELADA`) com `programming_team` (equipe pedida `ATIVA` na etapa), desempate "status ativo vence" antes de `updated_at desc` (mesmo padrao da migration 347, adiantando o gap que ela documentou para este modulo). Grant continua restrito a `service_role`.
- `set_project_apr_control_status` nao muda (nunca tocava `project_programming`). Medicao (2 RPCs, uma com patches dinamicos) fica para entrega propria — ver TASKS.md.
- ORDEM: a constraint precisa ser solta ANTES do remap dos valores (nao depois) — pego em teste manual do usuario apos a primeira versao (drop-depois-do-update violava a propria FK antiga durante o UPDATE). A migration 344 (Cronograma) tem a mesma ordem antiga e o mesmo bug latente, sem sintoma so porque a remessa dela e 0 linhas em producao.

351_medicao_match_normalized_programming.sql
- Fase 5b do corte (fecha o corte): reponta `project_measurement_orders.programming_id` de `project_programming` para `programming`, mesma ordem corrigida da 350 (drop constraint -> UPDATE remap via `programming_legacy_map` -> add constraint). 181 de 717 ordens tinham vinculo; 0 orfaos (medido por `scripts/audit-medicao-programming-match-readonly.mjs`).
- Reescreve as DUAS RPCs de escrita (`save_project_measurement_order`, `save_project_measurement_order_batch_partial`) por PATCH DINAMICO (`pg_get_functiondef`+`replace()`+`execute`, mesma tecnica das migrations 194/202/204/214) trocando so os trechos de match para `programming`+`programming_team` (equipe ATIVA), com normalizacao CRLF->LF do corpo vivo antes do replace e guarda que aborta se o texto esperado nao for encontrado. Desempate preservado identico ao legado (PROGRAMADA>REPROGRAMADA>ADIADA>CANCELADA>outro — unica coisa que Medicao faz diferente de APR/Cronograma, de proposito).
- `project_measurement_order_items.programming_activity_id` continua apontando para a tabela legada `project_programming_activities` (decisao explicita — sem par no `programming_legacy_map`, nullable, nunca lida de volta, tabela legada permanente).

353_sync_service_activities_code_idd.sql
- Sincroniza no versionamento a coluna `public.service_activities.code_idd`, criada diretamente no banco sem migration correspondente (divergencia migrations x banco, tratada conforme CLAUDE.md secao 12).
- `add column if not exists code_idd text` — no-op no ambiente onde a coluna ja existe; nao ha backfill nem alteracao de RLS, constraint ou grant.
- Consumida em leitura pelo detalhe da ordem de Medicao (modal `Detalhes da Ordem` e `Detalhamento (CSV)`), sempre filtrada por `tenant_id`.

354_prevent_present_member_multiple_team_compositions.sql
- Cria triggers deferrable em `team_composition_members` e `team_compositions` para impedir que a mesma pessoa com `is_present = true` fique em mais de uma composicao ativa no mesmo `tenant_id + composition_date`.
- Usa `pg_advisory_xact_lock` por tenant/data/pessoa para evitar corrida entre salvamentos simultaneos, validando o estado final da transacao.
- Nao bloqueia integrantes ausentes (`is_present = false`), preservando o fluxo `Nao atuou`; nao altera RLS, policies, grants nem cria funcao `SECURITY DEFINER`.

355_add_medicao_visualizacao_page_permissions.sql
- Registra a tela `medicao-visualizacao` (Visualizacao Medicao: filtros + `Exportar Excel (CSV)` + `Detalhamento (CSV)`, sem cadastro) em `app_pages`, herdando `default_user_access` da pagina `medicao`.
- Backfill de `app_user_page_permissions` gravando as 7 colunas de acao juntas (modelo da 253 — gravar so `can_access` deixaria `can_export = false` e o botao de CSV responderia 403 para nao-admin). Criterio: cada usuario recebe o mesmo valor que ja tem em `medicao`, entao a publicacao nao amplia o alcance de ninguem; liberar para perfis de consulta e feito depois na tela de Permissoes.
- Template por papel em `role_page_permissions` copiado de `medicao` (nao lido em runtime, mantido consistente como na 348). Validacao final aborta se algum usuario que exporta `medicao` ficar sem `read`+`export` em `medicao-visualizacao`. Nao altera RLS, policies, grants nem cria funcao `SECURITY DEFINER`.
- DEFEITO (corrigido pela 356): a heranca de `default_user_access` trouxe `true` de `medicao` (a migration 245 marcou todas as paginas existentes como `true`), e a tela nasceu liberada. O trigger AFTER INSERT da 253 gravou `true` para todos os usuarios no proprio INSERT, e o backfill "por usuario" desta migration, com `on conflict do nothing`, virou no-op. A validacao final so cobria o sentido "ninguem perdeu acesso".

356_force_new_pages_blocked_by_default.sql
- Cria o trigger `trg_app_pages_force_blocked_by_default` (BEFORE INSERT em `app_pages`, funcao `force_new_app_page_blocked_by_default()`, `SECURITY INVOKER`) que forca `default_user_access = false` em todo INSERT. Tela nova passa a nascer bloqueada por construcao, independente do valor que a migration de cadastro informar; como BEFORE roda antes de AFTER, o trigger de matriz de permissoes (253) sempre enxerga `false`.
- Liberar uma tela para usuarios comuns continua possivel, mas so como passo explicito e posterior: `update app_pages set default_user_access = true` + backfill em `app_user_page_permissions` (padrao da 348), visivel no diff da migration.
- Corrige `medicao-visualizacao` para `default_user_access = false`. NAO revoga as linhas ja gravadas em `app_user_page_permissions` — revogar acesso de usuario ativo e decisao de negocio e deve passar pela tela de Permissoes, com `updated_by` real e historico.
- Validacao final aborta se `medicao-visualizacao` nao ficar em `false` ou se o trigger nao existir. Nao altera RLS, policies, grants nem cria funcao `SECURITY DEFINER`.

357_dashboard_portfolio_asbuilt_factor_rpc.sql
- Cria `dashboard_portfolio_asbuilt_factor(p_tenant_id)`, contrato explicito entre a Carteira Operacional e a Medicao As Built. A Carteira nao pode ler `project_asbuilt_measurement_orders` direto (CLAUDE.md secao 5: feature nao importa dominio de feature irma); esta RPC segue o mesmo padrao das 333 e 334, que ja servem essa tela.
- Devolve `asbuilt_value`, `measured_value`, `factor`, `projects_with_asbuilt` e `projects_measured`. O fator e `valor As Built / valor medido nos MESMOS projetos`: As Built nao e producao paralela, e remedicao do mesmo escopo com valor reconhecido diferente, entao e taxa de realizacao e nunca valor a somar.
- A medicao operacional usa exatamente os mesmos filtros que a Carteira aplica em `valor acumulado` (`is_active`, `measurement_kind = COM_PRODUCAO`, `status <> CANCELADA`, itens ativos). Divergir aqui tornaria o fator incomparavel com o numero em que ele e aplicado.
- Sem janela de ciclo, de proposito: As Built acontece depois da medicao operacional, com defasagem, e recortar por ciclo pegaria o numerador incompleto e subestimaria o fator de forma sistematica.
- Sem segmentacao por centro de servico: a elegibilidade de As Built vem do Estado do Trabalho (`get_cronograma_asbuilt_project_ids`, migration 347), nunca de regional ou tipo de servico. Projeto medido sem As Built nao e isento, apenas ainda nao chegou ao marco de conclusao — por isso o fator e unico e uniforme.
- `security invoker` (padrao, como a 333): a RLS de cada tabela continua valendo para o usuario da sessao e o filtro por `p_tenant_id` e a segunda barreira. Nao altera RLS, policies nem cria funcao `SECURITY DEFINER`. EXECUTE revogado de `public`/`anon` e concedido a `authenticated` e `service_role`.

358_dashboard_portfolio_forecast_gaps_rpc.sql
- Cria `dashboard_portfolio_forecast_gaps(p_tenant_id, p_cycle_start, p_cycle_end, p_service_center)` e `dashboard_portfolio_forecast_gap_summary(...)`, que tornam visiveis na Carteira Operacional os projetos que a base da tela exclui por falta de atividade prevista.
- Tres situacoes: `SEM_PREVISAO` (nenhuma linha em `project_activity_forecast`, fora da base, falta cadastrar), `PREVISAO_ORFA` (tem linha, mas nenhuma casa com `service_activities` pelo par id+tenant_id; fora da base) e `PREVISAO_SEM_VALOR` (casa, mas o previsto soma zero; esta DENTRO da base e aparece como projeto saudavel sem potencial).
- `PREVISAO_ORFA` deve dar ZERO: a FK da 064 nao tem `ON DELETE`, entao `NO ACTION` impede apagar atividade referenciada, e o caso realista que sobra e divergencia de tenant entre a previsao e a atividade. Valor diferente de zero indica falha de integridade de importacao, nao cadastro pendente — a correcao e outra, por isso as duas situacoes saem separadas.
- O resumo agrega a propria funcao de lista, para que as duas nunca divirjam de criterio. A producao usa exatamente os mesmos filtros que a Carteira aplica em `valor acumulado` (`is_active`, `COM_PRODUCAO`, `status <> CANCELADA`, itens ativos) e o valor previsto repete a formula da 333.
- O numero que sustenta o bloco e `produced_in_cycle_outside`: receita real do ciclo que nao abate a meta no bloco `Cobertura da meta`, porque a meta vem de `measurement_cycle_target_items` e vale para o tenant inteiro enquanto o produzido so cobre a base da tela.
- `security invoker` (padrao, como 333 e 357): a RLS de cada tabela continua valendo para o usuario da sessao e o filtro por `p_tenant_id` e a segunda barreira. Nao altera RLS, policies nem cria funcao `SECURITY DEFINER`. EXECUTE revogado de `public`/`anon` e concedido a `authenticated` e `service_role`.

359_allow_direct_stock_exit.sql
- Libera `Saida direta`: republica `save_stock_transfer_record_direct_purchase_v209` trocando o guard `v_movement_type <> 'ENTRY'` por `not in ('ENTRY', 'EXIT')` e o motivo `DIRECT_PURCHASE_ENTRY_ONLY` por `DIRECT_MOVEMENT_ENTRY_OR_EXIT_ONLY`. `Transferencia` continua bloqueada para movimentacao direta.
- Reaproveita `stock_transfers.direct_purchase` em vez de criar coluna nova. `EXIT` com `project_id = null` e `direct_purchase = true` ja existia: as RPCs de estorno da `216` repassam a flag do registro original e o guard da `193` sempre teve escape por `notes ilike 'ESTORNO%'` — a migration libera o caminho manual, nao um estado novo de dados.
- Patch textual por `pg_get_functiondef` + `replace`, no padrao das `222`/`223`, porque a funcao ja foi patchada assim antes. Reescrever a partir do texto da `193` reverteria o fix de tabela temporaria da `222`, e o bloco de validacao final aborta justamente se o tratamento de `tmp_retired_serial_transfer_items` se perder, se o bloqueio novo nao entrar ou se o antigo sobreviver.
- Nao altera schema, RLS, policies nem grants; nao cria funcao `SECURITY DEFINER` nova. A base `save_stock_transfer_record_base_v181` ja pulava `PROJECT_REQUIRED` pela GUC `app.stock_transfer_direct_purchase` desde a `193`, entao nada muda nela.

361_team_composition_unmeasured_filter_rpc.sql
- Cria `list_unmeasured_team_composition_ids(...)` para filtrar a listagem de Composicao de Equipe por projetos sem Medicao antes da paginacao, evitando filtro parcial no frontend.
- A composicao entra quando pelo menos um projeto vinculado nao possui ordem ativa e nao cancelada em `project_measurement_orders` para o mesmo `Tenant + Projeto + Equipe + Data`; com filtro de Projeto ativo, a checagem vale somente para o projeto filtrado.
- `security invoker`, `search_path = public`, sem schema novo/RLS/policies; EXECUTE revogado de `public`, `anon` e `authenticated`, liberado apenas para `service_role`.

362_grant_programming_normalized_page_to_user_role.sql
- Fase C3 do corte da Programacao Normalizada: libera a TELA `programacao-normalizada` para o papel "Usuario" (`default_user_access = true` em `app_pages`, `can_access` em `role_page_permissions` e as 7 colunas de acao em `app_user_page_permissions`), no mesmo padrao de 4 passos da 348, com historico em `app_user_permission_history` gravado ANTES do update.
- Fecha uma inversao pai/filho concreta: a 348 liberou as tres granulares (`programacao-concluir`, `programacao-pendencia`, `programacao-corrigir-data`) para o papel, mas a tela PAI continuou bloqueada desde a 312 — o papel tinha as sub-permissoes de uma tela a que so chegava por concessao individual. A segunda validacao pos-execucao aborta se essa inversao continuar de pe.
- Precisa ser migration, e nao so edicao da constante `DEFAULT_USER_PAGE_ACCESS`: a propria constante documenta que adicionar chave exige `default_user_access = true` ja no banco, e a 356 forca `false` em todo INSERT de `app_pages` para que liberar tela seja sempre passo explicito. O trigger da 356 e BEFORE INSERT e nao afeta o UPDATE usado aqui.
- NAO remove acesso a `programacao-simples` nem a `programacao-visualizacao`: enquanto o menu apontar para a Simples (C6/C7), tirar acesso aqui deixaria o usuario comum sem nenhuma Programacao. Nao altera schema, RLS, policies, grants nem cria funcao.

363_stop_granting_programming_simples_to_new_users.sql
- Fase C7 do corte: zera `app_pages.default_user_access` de `programacao-simples` (e o `can_access` do template do papel "Usuario"), para que usuario nao-admin criado a partir de agora NAO nasca mais com a tela antiga pelo gatilho da 253.
- NAO revoga `app_user_page_permissions` de quem ja tem acesso, de proposito: no C6 a tela saiu do menu e a URL direta virou a unica rede de seguranca para comparar as duas Programacoes em producao. A limpeza dessas linhas e do C8, junto com a remocao da tela, onde a revogacao vira consequencia e nao decisao.
- Precisa vir antes da remocao de `programacao-simples` de `DEFAULT_USER_PAGE_ACCESS`: a regra escrita naquela constante so permite remover chave cujo `default_user_access` no banco ja seja `false`.
- Tres validacoes pos-execucao: o default tem de estar desligado; ninguem pode ter perdido `can_access` (a migration existe para parar de conceder, nunca para revogar); e `programacao-normalizada` tem de estar com `default_user_access = true`, senao a 362 nao foi aplicada e um usuario novo nasceria sem NENHUMA Programacao — neste caso a migration aborta.
- Nao altera schema, RLS, policies, grants nem cria funcao.

364_retire_programming_simples_page.sql
- Fase C8 do corte: aposenta o page_key `programacao-simples` no banco, agora que a tela, `/api/programacao(/meta)` e `server/modules/programacao` sairam do codigo. Revoga as 7 colunas de acao em `app_user_page_permissions`, zera o template em `role_page_permissions` e marca a pagina `ativo = false`, com historico gravado ANTES da revogacao.
- DESATIVA em vez de DELETAR a linha de `app_pages` de proposito: `page_key` e referenciado com `on delete cascade` por `role_page_permissions` e `app_user_page_permissions`, e com `on delete set null` por `app_user_permission_history` — um DELETE limparia as permissoes sozinho, mas zeraria a chave no HISTORICO, e todo registro de quem concedeu ou revogou essa tela viraria "pagina nula". O historico existe para responder quem deu acesso a que e quando; perder isso para economizar uma linha em `app_pages` e mau negocio.
- Diferente da 363, esta migration REVOGA: la a tela ainda existia e a URL direta era a rede de seguranca do C6; aqui a tela nao existe mais, e manter a permissao seria guardar acesso a uma rota que devolve 404.
- Tres validacoes pos-execucao: pagina inativa e sem concessao residual; NENHUM usuario nao-admin ativo pode ficar sem acesso a `programacao-normalizada` (aborta pedindo a 362, porque esse e o unico risco real do C8 — revogar a tela antiga de quem nunca recebeu a nova); e um `raise notice` com quantos registros de historico preservaram o page_key, que e a razao de desativar em vez de deletar.
- Nao altera schema, RLS, policies, grants nem cria funcao. NAO apaga `project_programming*`, que permanece como arquivo historico.

365_drop_duplicate_project_indexes.sql
- Fase P0 da auditoria de performance: remove duplicatas EXATAS dos indices de `public.project(tenant_id, priority)`, `public.project(tenant_id, city)` e `public.project(tenant_id, sob)`, quando o par realmente existe no ambiente alvo. A primeira versao assumia que `idx_project_tenant_priority` e `idx_project_tenant_city` sempre existiam; teste real mostrou ambiente com 0 indices mantidos depois do drop, porque so os `_uuid` existiam e eram os indices validos. A migration agora preserva `_uuid` quando ele e o unico indice conhecido, e so dropa `_uuid` quando o par sem sufixo tambem existe e a assinatura em `pg_index` e identica. Segundo teste real revelou outra duplicata da propria 029: `idx_project_tenant_sob` duplica o indice UNIQUE da constraint `(tenant_id, sob)`; a migration remove o indice nao-unique e preserva a constraint.
- Unico item da auditoria que dispensa o Nivel B: duplicata exata nunca e o unico caminho de acesso de nenhuma consulta — o planner usa um dos dois e o outro so custa escrita e WAL em toda alteracao de `project`, que carrega 17 indices. Nao ha o que medir; remover indice identico a outro nao pode piorar plano.
- `drop index` simples, sem `concurrently`, porque migrations rodam em transacao. Validacao pos-execucao confere que resta exatamente 1 indice simples para `(tenant_id, priority)`, exatamente 1 para `(tenant_id, city)`, exatamente 1 indice UNIQUE simples para `(tenant_id, sob)`, e que nao sobrou nenhum grupo de indice duplicado em `public.project`, usando a mesma assinatura de catalogo (indrelid + indkey + indclass + indexprs + indpred) da consulta de inventario do Nivel B.
- Nao altera schema, RLS, policies, grants nem cria funcao.

366_create_material_umb_options.sql
- Cria `material_umb_options` como catalogo multi-tenant de UMB da tela Materiais, com RLS de leitura por `user_can_access_tenant`, indice `(tenant_id, is_active, sort_order, code)` e trigger de auditoria.
- Semeia `M`, `KG` e `UN` para todos os tenants existentes e cria trigger em `tenants` para semear as mesmas opcoes em novos tenants.
- Republica `save_material_record` com a mesma assinatura da 288, normalizando UMB para maiusculo e recusando escrita quando a UMB nao existe ativa no catalogo do tenant.
- Grants preservados no padrao atual: tabela com `SELECT` para `authenticated`; RPC e funcao de seed sem EXECUTE para `public`/`anon`/`authenticated`, com `save_material_record` liberada apenas para `service_role`.

367_update_materials_umb_cjt_to_un.sql
- Saneia o cadastro oficial de materiais trocando `materials.umb = CJT` por `UN`, com comparacao normalizada por maiusculas/espacos.
- Registra um evento `UPDATE` em `material_history` para cada material alterado, com diff `umb: CJT -> UN`.
- Inclui validacao pos-update que aborta a migration se ainda restar algum material com UMB `CJT`.
- Nao reescreve snapshots operacionais (`requisicao_itens`, movimentacoes ou historicos de uso), preservando o valor historico que existia no momento da operacao.

368_restore_postpone_unique_violation_handler.sql
- Restaura em `postpone_project_programming_stage` o bloco `exception when unique_violation -> 409 UNIQUE_STAGE_PER_DATE` que existia na 326 e foi perdido quando a 337 reescreveu a funcao inteira para gravar o snapshot de classificacao. Sem ele, remarcar uma etapa para data que ja tem etapa ATIVA no projeto viola `programming_active_project_date_key` (346) e o 23505 sobe cru, virando erro generico de RPC na tela.
- Corpo IDENTICO ao da 337 (aceita ADIADA, fotografa a classificacao na rota "em espera", limpa o snapshot na rota com data, checa conflito de agenda das equipes ATIVA, roda `reclassify` no fim) + o `exception` de volta. A mensagem passa a dizer etapa "ATIVA": desde a 346 a unicidade e so `PROGRAMADA`/`REPROGRAMADA`, e CANCELADA/ADIADA/ANTECIPADA convivem na mesma data.
- Motivo de entrar agora: a tela passou a expor a SAIDA do "em espera" (etapa ADIADA volta ao plano recebendo data), e o caso mais provavel dessa retomada e justamente colidir com uma etapa criada naquela data enquanto a primeira estava em espera.
- Nao altera schema, RLS, policies nem indices. Grants reaplicados no padrao do modulo: `service_role` apenas, com validacao pos-execucao contra `anon`/`authenticated`.

369_cancel_team_participation_on_held_stage.sql
- Permite `cancel_project_programming_team` agir em etapa "em espera" (`ADIADA`), alem de `PROGRAMADA`/`REPROGRAMADA` — mesmo movimento que a 337 fez nas RPCs de cancelar/adiar etapa. Corpo identico ao da 349, mudando so a lista de status aceitos e a mensagem de recusa.
- Motivo: retomar uma etapa em espera revalida o conflito de agenda de TODAS as equipes ATIVA na data nova e recusa a retomada inteira se uma conflitar. Para destravar, o usuario precisa tirar aquela equipe antes; `remove_project_programming_team` ja aceitava etapa em espera, mas REMOVIDA significa "cadastrada por engano" (349) — sem esta migration, destravar custaria falsear o historico.
- `postpone_project_programming_team` (Adiar equipe) continua recusando etapa em espera de proposito: a operacao parte da data da etapa de origem, que a etapa em espera nao tem. A UI esconde essa opcao do menu do chip nesse caso.
- `add_project_programming_team` tambem segue bloqueado (317): sem `execution_date`, `programming_team_schedule_conflict` nao casa nada e a alocacao entraria sem checagem nenhuma.
- A guarda LAST_ACTIVE_TEAM vale igual para etapa em espera. Nao altera schema, RLS, policies nem indices; grants reaplicados para `service_role` apenas, com validacao pos-execucao.

372_update_service_activity_code_idd_rpc.sql
- Republica `save_service_activity_record` para receber `p_code_idd` e persistir `service_activities.code_idd` no cadastro/edicao de Atividades.
- `code_idd` permanece opcional: texto vazio e normalizado para `NULL`.
- Mantem escrita transacional, historico por `p_changes`, controle de concorrencia por `p_expected_updated_at` e validacoes existentes de categoria, grupo, pontos, status e codigo duplicado.
- A coluna ja existe pela migration 353; esta migration nao altera RLS, policies, indices ou constraints.
- Assinatura nova fica com EXECUTE apenas para `service_role`, pois a tela grava pela API backend.

373_team_composition_foreman_override.sql
- Adiciona `team_compositions.foreman_person_id` (FK composta `(foreman_person_id, tenant_id) -> people(id, tenant_id)`), permitindo que a Composicao de Equipe registre um encarregado diferente do cadastro da equipe naquele dia, sem reescrever `teams.foreman_person_id`, que vale para todas as datas.
- Backfill resolve o encarregado vigente na data pela `team_foreman_history` (161), com fallback para o cadastro da equipe. Linhas ativas que colidiriam no indice unico novo ficam com `foreman_person_id` nulo de proposito e continuam resolvendo pela cadeia atual — nenhuma composicao legada muda de comportamento.
- Nova constraint `team_compositions_foreman_single_team_per_date` (EXCLUDE via btree_gist, parcial em `is_active = true and foreman_person_id is not null`): o mesmo encarregado nao pode responder por EQUIPES DIFERENTES na mesma data. Duas composicoes ativas da MESMA equipe na mesma data continuam permitidas — `ux_team_compositions_context_active` (200) ja as autoriza por projeto principal distinto e a operacao usa isso hoje —, e nao ambiguizam a resolucao inversa encarregado + data -> equipe, porque a resposta e a mesma equipe. UNIQUE nao serve: a regra exige "iguais em tenant/data/encarregado E diferentes em equipe". Fecha tambem a brecha do fluxo `Nao atuou`, em que o encarregado entra como `is_present = false` e escapava da trava da 354.
- Republica `save_team_composition_record` com `p_foreman_person_id`. A RPC recusa encarregado inativo, de outro tenant, sem cargo contendo `ENCARREGADO`, ou ausente da lista de integrantes (`FOREMAN_NOT_MEMBER`); `NOT_WORKING` passa a exigir o encarregado SELECIONADO como unico integrante nao presente. O bloco `exception` trata `exclusion_violation` como `FOREMAN_DATE_CONFLICT` (409) e `unique_violation` como `DUPLICATE_CONTEXT` (409).
- A assinatura anterior (14 argumentos) e removida com `drop function` para nao deixar sobrecarga ambigua no PostgREST. Nao altera RLS, policies ou triggers; grants da assinatura nova ficam com `service_role` apenas.
- O backfill roda com `trg_team_compositions_present_member_date_conflict` (354) desligado e religa o trigger em seguida. Motivo: o UPDATE escreve SOMENTE `foreman_person_id`, coluna que o trigger nao valida — ele revalida integrantes presentes por data —, e existem composicoes anteriores a 354 que ja violam essa regra. Sem o desligamento a migration aborta com `TEAM_COMPOSITION_MEMBER_DATE_CONFLICT` por um dado que ela nao criou nem altera. A inconsistencia legada permanece e precisa ser tratada a parte.
- `resolve_team_foreman_snapshot` (161) NAO foi alterada: Medicao, Controle APR e Mapa de Programacao continuam resolvendo por historico -> cadastro e ainda nao enxergam o encarregado da composicao.

374_resolve_team_foreman_from_composition.sql
- Faz a Composicao de Equipe virar o nivel 1 de `resolve_team_foreman_snapshot` (161). Cadeia nova: composicao ativa da equipe naquela data (`foreman_name_snapshot`) -> `team_foreman_history` vigente na data -> `teams.foreman_person_id`. Assinatura e tipo de retorno inalterados, entao todo consumidor existente herda sem mudanca.
- A Medicao herda de graca: `trg_apply_measurement_team_snapshot` (161) ja chamava essa funcao. Nenhuma RPC, rota ou tela da Medicao foi tocada.
- O Controle de APR passa a usar o mesmo padrao: nova funcao `apply_apr_team_snapshot` + trigger `trg_apply_apr_team_snapshot` (`before insert or update of team_id, service_date, team_name_snapshot, foreman_name_snapshot`) em `project_apr_controls`. A RPC `save_project_apr_control` (370) NAO foi reescrita — o trigger sobrescreve o valor que ela grava a partir do join direto em `teams`. Evita republicar ~500 linhas de PL/pgSQL para trocar duas atribuicoes.
- Guarda de historico nos dois triggers: update que nao muda equipe nem data preserva o snapshot ja gravado. Decisao de negocio registrada: o encarregado e resolvido na ESCRITA, entao registro salvo ANTES de a composicao daquele dia existir congela o encarregado do cadastro e nao passa a segui-la depois.
- CORRIGE a constraint publicada na 373: `team_compositions_foreman_single_team_per_date` passa a valer somente para `work_status = 'WORKING'`. Caso real que motivou (equipe CESTO, cujo encarregado muda de um dia para o outro): o encarregado oficial de uma MK vai para o CESTO no dia D e a MK registra "Nao atuou", que por regra exige o encarregado como unico integrante nao presente — a versao anterior recusava e travava justamente o fluxo que a feature existe para atender. A 354 ja tinha decidido que `is_present = false` nao ocupa a pessoa; a 373 contrariava essa decisao sem justificativa.
- Nova constraint `team_compositions_team_single_foreman_per_date` (EXCLUDE via btree_gist, tambem so em `WORKING`): a mesma equipe nao pode ter, na mesma data, duas composicoes ativas com encarregados diferentes. Sem ela a resolucao teria duas respostas possiveis e o `limit 1` do nivel 1 escolheria arbitrariamente.
- O nivel 1 da resolucao tambem so olha composicao `WORKING`: "encarregado da equipe X no dia D" nao tem resposta util quando a equipe nao atuou; nesse caso a cadeia cai para historico -> cadastro.
- Novo indice parcial `idx_team_compositions_tenant_team_date_active` sustenta a busca do nivel 1 por tenant + equipe + data.
- Hardening de grant: `resolve_team_foreman_snapshot` tinha EXECUTE para `authenticated` desde a 161, contra a regra 16 de `guias/guia_sql.md`. Nenhum consumidor cliente existe (nenhuma chamada `.rpc()` em `src/` ou `supabase/functions/`) e todos os callers sao funcoes `SECURITY DEFINER`, que executam no contexto do dono — o EXECUTE passou a ser so de `service_role`. `apply_apr_team_snapshot` entra ja com revoke de `public`/`anon`/`authenticated`.
- Fora do escopo: o Mapa de Programacao continua exibindo o encarregado do cadastro da equipe. Ali a resolucao e de LEITURA por linha (equipe + data da ultima etapa), nao de escrita, e fazer isso no Node viraria N+1 ou payload grande — exige RPC propria recebendo os pares (equipe, data).

375_harden_supabase_advisor_security_warnings.sql
- Fecha warnings de seguranca do Supabase Advisor, exceto Auth/Leaked Password Protection, que permanece manual no Dashboard Supabase.
- Move `btree_gist` para o schema `extensions` (ou cria a extensao nesse schema se estiver ausente), preservando as constraints EXCLUDE que ja dependem da extensao.
- Fixa `search_path = public` em `tg_programming_capture_anticipated_snapshot`, `tg_programming_clear_snapshot_source` e `tg_programming_set_updated_at`, e revoga EXECUTE externo dessas trigger functions.
- Revoga EXECUTE de `public`, `anon` e `authenticated` nas RPCs `save_service_activity_record`, `save_project_measurement_order` e `save_project_measurement_order_batch_partial`; mantem somente `service_role`, compativel com os Route Handlers atuais que validam sessao/tenant/permissao antes de chamar as RPCs.
- Inclui validacao pos-aplicacao para abortar se alguma funcao continuar executavel por `anon`/`authenticated`, sem EXECUTE para `service_role`, sem `search_path` fixo, ou se `btree_gist` continuar em `public`.

376_fix_job_title_levels_rls_policies.sql
- Corrige o warning `multiple_permissive_policies` em `public.job_title_levels` removendo `job_title_levels_tenant_write`, que foi criada como `FOR ALL` na 371 e tambem era avaliada em `SELECT`.
- Mantem `job_title_levels_tenant_select` como unica policy permissiva de leitura para `authenticated`, preservando a leitura por tenant via `user_can_access_tenant`.
- Nao cria policy direta de escrita: os niveis de cargo sao persistidos pela RPC `save_job_title_record` chamada pelos Route Handlers com `service_role`.
- Inclui validacao pos-aplicacao para abortar se a policy de leitura sumir, se a policy antiga continuar existindo, ou se houver mais de uma policy permissiva `SELECT`/`ALL` para `authenticated`.

375_stock_operation_foreman_from_composition.sql
- Fecha a decisao "o estoque segue a composicao do dia". A RPC `save_team_stock_operation_record` deixa de resolver o encarregado por join direto em `teams.foreman_person_id` e passa a usar a cadeia da 374 (composicao do dia -> `team_foreman_history` -> cadastro).
- Achado que motivou: a Saida ganhou o atalho "Encarregado do dia", que lista quem respondeu por cada equipe segundo a Composicao. Com a RPC ainda lendo o cadastro, o usuario escolhia por um criterio e o registro — e a exportacao CSV, que tem coluna `encarregado` — saia com outra pessoa sempre que havia encarregado emprestado.
- Nova funcao `resolve_team_foreman(tenant, equipe, data)` devolve tambem o `foreman_person_id`, que `resolve_team_foreman_snapshot` nao expoe e que as operacoes de estoque precisam para gravar `foreman_person_id_snapshot`. `resolve_team_foreman_snapshot` mantem assinatura e passa a DELEGAR para ela, entao a cadeia existe num lugar so e os consumidores atuais (triggers da Medicao e da APR) nao mudam.
- Nao foi preciso trigger nem parametro novo vindo do cliente: a RPC ja recebia `p_entry_date`, entao a data da operacao ja estava disponivel dentro dela.
- A resolucao do encarregado fica DEPOIS da checagem `TEAM_NOT_FOUND` de proposito: `FOUND` e por statement, e resolver antes sobrescreveria o resultado do `SELECT` em `teams`.
- Hardening: a 308 concedia EXECUTE de `save_team_stock_operation_record` a `authenticated`. A RPC so e chamada de `src/lib/server/teamStockOperations.ts` (backend, service_role), entao o EXECUTE passou a ser apenas de `service_role`, junto com as duas funcoes de resolucao.
- Auditoria de consumidores feita na mesma tarefa: Estornos e Posicao Trafo herdam esta correcao porque leem `stock_transfer_team_operations.foreman_name_snapshot`; Medicao, Controle de APR, Apuracao de Fator Minimo e Dashboard de Equipes ja herdavam a 374 pelo snapshot da ordem. `Saldo por Equipe` continua no cadastro (posicao de "agora", sem data). `Mapa de Programacao` e o unico caso em aberto: resolucao de leitura por linha, que exige RPC propria.
- Registros ja gravados NAO mudam: a resolucao continua acontecendo na escrita.


377_drop_unused_stock_conflict_views.sql
- Remove as views `v_stock_conflict_items` e `v_stock_conflicts`, criadas pela 007 SEM `security_invoker = true`.
- Por que importa: view sem essa opcao executa com privilegio do owner e ignora a RLS das tabelas base. `stock_conflicts` tem RLS por tenant desde a 006 (endurecida na 020/021), e as views a contornavam.
- Achado que motivou: consulta ao banco vivo mostrava `security_invoker=true` nas tres views de `public` — ou seja, SEM risco ativo em producao. Mas nenhum arquivo do repositorio aplica a opcao nas duas views de conflito: a correcao foi feita a mao, fora do versionamento, provavelmente na leva de remediacao do Advisor que originou a 375. Producao correta, receita errada: `db reset`, branch de preview ou projeto novo recriariam as views vulneraveis.
- Escolha de remover em vez de corrigir: nenhuma referencia a `v_stock_conflict%` em `src/`. Versionar a correcao de um objeto sem consumidor manteria superficie exposta e mais um objeto para governar. Se a tela de conflitos precisar, recriar seguindo a regra 23 de `guias/guia_sql.md`.
- Inclui validacao pos-aplicacao (padrao da 375) para abortar se sobrar qualquer view de `public` acessivel por `anon`/`authenticated` sem `security_invoker = true`.
- Governanca criada na mesma tarefa: regras 23-27 em `guias/guia_sql.md`, check estatico `npm run db:view-check` (roda sem link, pega o defeito na origem — um check que so le o banco vivo teria passado), `npm run db:view-check-live`, `npm run db:drift-check` e `guias/runbook_drift_schema.md`.

378_backfill_material_categories_from_xlsx.sql
- Cria os catalogos multi-tenant `material_categories` e `material_subcategories`, com RLS de leitura por tenant, auditoria, nomes unicos e FK composta entre subcategoria e categoria.
- Adiciona `materials.category_id` e `materials.subcategory_id`, com FKs compostas por `tenant_id` para impedir classificacao cruzada entre tenants e subcategoria fora da categoria selecionada.
- Aplica backfill idempotente gerado da planilha `materiais_2026-08-11_categorizados.xlsx`, deduplicando 1.165 codigos por `codigo` e abortando se algum codigo tiver classificacao divergente.
- Registra `material_history` com diff de Categoria/Subcategoria por nome para cada material alterado.
- Republica `save_material_record` para exigir e validar categoria/subcategoria ativa no tenant.
- A tela `/materiais` passa a cadastrar, editar, filtrar, listar e exportar Categoria/Subcategoria consumindo os catalogos.

379_create_team_operations_export_rpc.sql
- Cria a RPC `list_team_operations_export` para exportar Operacoes de Equipe por stream, aplicando filtros no banco e devolvendo as colunas do CSV prontas.
- Adiciona indices de suporte em `stock_transfer_team_operations(tenant_id, transfer_id)` e nos vinculos de estorno por item.
- A RPC e `SECURITY DEFINER`, fixa `search_path = public` e fica executavel apenas por `service_role`.

380_realign_team_operations_export_default_limit.sql
- Republica `list_team_operations_export` para realinhar o default de `p_limit` para 1000, o teto efetivo de linhas por resposta do PostgREST neste projeto.
- Sem efeito no caminho da aplicacao, que passa `p_limit` explicitamente; corrige a divergencia entre banco vivo e migrations apos aplicacao manual da 379.
- Reaplica revoke/grant explicitos para manter EXECUTE apenas em `service_role`.

381_team_operations_category_filters_export.sql
- Republica `list_team_operations_export` com `p_category_id` e `p_subcategory_id`, consumindo `materials.category_id/subcategory_id` criados na 378.
- Inclui as colunas `categoria` e `subcategoria` no CSV de Operacoes de Equipe, logo apos `descricao`.
- Remove a assinatura anterior da RPC para evitar sobrecarga ambigua e reaplica EXECUTE apenas para `service_role`.

382_allow_no_project_no_production_measurement.sql
- Permite `project_measurement_orders.project_id` e `project_code_snapshot` nulos exclusivamente para ordens `SEM_PRODUCAO` sem vinculo de Programacao.
- Mantem Projeto obrigatorio para `COM_PRODUCAO` por constraint e pela RPC `save_project_measurement_order`.
- Republica `enforce_project_measurement_order_context_unique` para bloquear duplicidade por `Projeto + Equipe + Data` quando ha Projeto e por `Equipe + Data` quando a ordem `SEM_PRODUCAO` nao tem Projeto.
- Aplica patch dinamico em `save_project_measurement_order` para aceitar `SEM_PRODUCAO` sem Projeto, sem tentar resolver Programacao/Centro/Projeto nesse caso, e preserva EXECUTE apenas para `service_role`.

383_create_stock_reversal_request_flow.sql
- Cria o fluxo de solicitacao -> atendimento para estornos: `stock_reversal_requests` e `stock_reversal_request_items`, com RLS de leitura por tenant, auditoria, indices e unique parcial para impedir dois pedidos abertos do mesmo item original.
- Cadastra a tela `estorno-atendimento` em `app_pages`, nascendo bloqueada para usuarios nao administrativos, e faz backfill de permissoes por role/usuario.
- Cria RPCs `create_stock_reversal_request`, `claim_stock_reversal_request`, `reject_stock_reversal_request` e `approve_stock_reversal_request`, todas `SECURITY DEFINER` com EXECUTE apenas para `service_role`.
- A aprovacao executa os itens solicitados usando as RPCs de estorno existentes (`reverse_stock_transfer_item_record_v1` ou `reverse_team_stock_operation_item_record_v1`) e marca o pedido como `EXECUTADO`; falha de regra marca `FALHA_EXECUCAO` sem estorno parcial.

384_harden_stock_reversal_request_flow.sql
- Renomeia as RPCs da fila criadas na 383 para versoes internas `_v383` e recria wrappers com regras de negocio adicionais.
- Impede solicitante de assumir, aprovar ou recusar o proprio pedido e exige claim ativo do atendente antes de aprovar/recusar.
- Bloqueia `BATCH` sem `itemIds` explicitos, mantendo `FULL` como unico modo que seleciona todos os itens validos.
- Revoga EXECUTE de `authenticated`/`anon` nas RPCs antigas de execucao direta de estorno (`reverse_*`), mantendo apenas `service_role`.

385_normalize_roles_and_viewer_read_only.sql
- Mantem somente `admin`, `user` e `viewer` ativos em `app_roles`.
- Migra usuarios `master` para `admin` e usuarios `supervisor` para `user`, com historico em `app_user_permission_history`.
- Regrava o template `role_page_permissions` do `viewer` para permitir apenas paginas de consulta conhecidas e bloquear todas as acoes de escrita/exportacao.
- Regrava `app_user_page_permissions` dos usuarios `viewer` existentes no mesmo padrao de leitura apenas.
- Republica `save_user_permissions` para aceitar somente `admin`, `user` e `viewer`; quando o papel alvo e `viewer`, paginas fora da whitelist sao gravadas como bloqueadas e todas as acoes ficam `false`.

386_harden_admin_tenant_links.sql
- Cria `ensure_app_user_tenant_link` para centralizar criacao/reativacao do vinculo usuario-tenant sem duplicar default ativo.
- Faz backfill de `app_user_tenants` para usuarios existentes com `tenant_id`, evitando lockout de administradores apos exigir selecao de contrato.
- Republica `sync_auth_user_to_app_user` para criar/reativar o vinculo quando um usuario nasce ou e sincronizado a partir do Supabase Auth.
- Republica `user_is_admin_in_tenant` para considerar administradores vinculados via `app_user_tenants`, nao apenas `app_users.tenant_id`.
- Republica `save_user_permissions` para aceitar usuario alvo vinculado por `app_user_tenants` no tenant atual e criar/reativar o vinculo quando o papel salvo for `admin`.
- Inclui validacao pos-aplicacao que aborta se sobrar administrador ativo sem vinculo ativo no proprio tenant.

387_programming_history_tenant_created_index.sql
- Cria `idx_programming_history_tenant_created` em `programming_history(tenant_id, created_at desc)` para sustentar a leitura de historico de Estado Trabalho usada pela Medicao.
- Substitui a sugestao crua do Supabase Advisor (`created_at`) por um indice alinhado ao padrao multi-tenant do projeto.
- Inclui validacao pos-aplicacao para abortar se o indice esperado nao existir.

390_create_service_center_rpcs.sql
- Cria as RPCs `save_service_center_record` e `set_service_center_record_status` para o cadastro de Centro de Servico.
- Move cadastro, edicao, ativacao/cancelamento e historico de `project_service_centers` para transacao unica com `SELECT ... FOR UPDATE` e `expectedUpdatedAt`.
- Mantem as RPCs `SECURITY DEFINER` executaveis apenas por `service_role`, com validacao pos-aplicacao contra grants para `anon`/`authenticated`.

391_create_municipality_rpcs.sql
- Cria as RPCs `save_municipality_record` e `set_municipality_record_status` para o cadastro de Municipio.
- Move cadastro, edicao, ativacao/cancelamento e historico de `project_municipalities` para transacao unica com `SELECT ... FOR UPDATE` e `expectedUpdatedAt`.
- Mantem as RPCs `SECURITY DEFINER` executaveis apenas por `service_role`, com validacao pos-aplicacao contra grants para `anon`/`authenticated`.

392_advisor_tenant_first_performance_indexes.sql
- Cria `idx_stock_transfer_team_operations_tenant_created` em `stock_transfer_team_operations(tenant_id, created_at desc)` para a listagem geral de Operacoes de Equipe ordenada por criacao.
- Cria `idx_programming_tenant_execution_date` em `programming(tenant_id, execution_date)` para leituras da Programacao Normalizada por periodo sem filtro de status.
- Cria `idx_programming_tenant_project_execution_date` em `programming(tenant_id, project_id, execution_date)` para leituras por projetos especificos e janela de data.
- Mantem as sugestoes cruas do Advisor como indices tenant-first e deixa `team_compositions` para nova medicao antes de qualquer indice adicional.

393_close_authenticated_write_surface.sql
- Derruba as policies de INSERT/UPDATE/DELETE/ALL de `authenticated` em `public`, fechando a escrita direta via PostgREST que contornava `authorizePageAction` e as RPCs transacionais.
- Preserva a leitura antes do drop: toda policy `FOR ALL` cujo tenant nao tenha outra policy de SELECT tem o `USING` original recriado como policy de SELECT.
- Revoga INSERT/UPDATE/DELETE de `public`/`anon`/`authenticated` no schema e ajusta `ALTER DEFAULT PRIVILEGES` para tabela futura nao nascer aberta; SELECT permanece intocado.
- Alinha o schema as regras 13 e 14 do `guias/guia_sql.md`, que ja exigiam esse padrao, e estende as tabelas o mesmo hardening que 251/298/388 aplicaram as RPCs.
- Inclui validacao pos-aplicacao que aborta se sobrar policy/grant de escrita, se alguma tabela perder a leitura, ou se `service_role` perder acesso.

394_harden_function_search_path_post_210.sql
- Fixa `search_path = public, pg_temp` nas funcoes de `public` criadas depois da 210 e que ficaram com `search_path` mutavel (`user_is_admin_in_tenant`, `tg_programming_set_updated_at`, `tg_programming_capture_anticipated_snapshot`, `tg_programming_clear_snapshot_source`).
- Varre `pg_proc` em vez de repetir lista fixa, para nao envelhecer como a 210; ignora funcoes pertencentes a extensao (`pg_depend.deptype = 'e'`).
- Inclui validacao pos-aplicacao que aborta se sobrar funcao de `public` com `search_path` mutavel.

395_harden_admin_pin_storage.sql
- Adiciona `app_users.admin_pin_secret` com bcrypt (fator 12) aplicado sobre o SHA-256 existente, e faz backfill idempotente a partir de `admin_pin_hash`.
- Cria `verify_admin_pin_secret(uuid, uuid, text)` `SECURITY DEFINER`, executavel apenas por `service_role`, que revalida vinculo e papel de admin e compara em tempo constante sem o hash sair do banco.
- Fase EXPAND: mantem `admin_pin_hash` para permitir rollback da Edge Function; enquanto a coluna existir o risco de dump segue aberto.
- Inclui validacao pos-aplicacao que aborta se sobrar hash sem bcrypt correspondente ou se a RPC ficar exposta a anon/authenticated.

396_drop_legacy_admin_pin_hash.sql
- Fase CONTRACT. NAO aplicar junto com a 395: exige que a nova versao de `verify_admin_pin` ja esteja publicada e testada.
- Remove `app_users.admin_pin_hash` e republica `verify_admin_pin_secret` sem o fallback de transicao, deixando o bcrypt como unico caminho.
- Aborta antes de remover se algum usuario tiver hash antigo sem `admin_pin_secret`, para nao trancar administrador para fora.

397_fix_admin_pin_search_path.sql
- Republica `verify_admin_pin_secret` com `search_path = public, extensions, pg_temp`: as migrations 395/396 fixaram `public, pg_temp` e chamam `crypt()` sem qualificar, mas em projeto Supabase o pgcrypto ja vem no schema `extensions` e o `create extension` da 000 foi no-op.
- Erro era latente: o backfill da 395 funcionou por rodar em bloco `DO`, que herda o search_path da sessao, e a funcao so executa quando a Edge Function `verify_admin_pin` for publicada.
- Usa os dois schemas no search_path em vez de qualificar `extensions.crypt`, para funcionar tambem em banco reconstruido do zero, onde a 000 cria o pgcrypto em `public`.
- Validacao pos-aplicacao confere que `proconfig` da funcao inclui `extensions` e que a RPC nao e executavel por `anon`/`authenticated`. O smoke test de hash que acompanha roda em bloco `DO` e portanto herda o search_path da sessao: ele confirma que o pgcrypto existe, nao que resolve de dentro da funcao. A prova real e chamar `verify_admin_pin_secret` para um usuario com `admin_pin_secret` preenchido.
- A 394 nao precisa de correcao equivalente: nenhuma funcao ajustada por ela usa pgcrypto, operador de extensao ou schema fora de `public`.

398_stock_requisition_requested_by_date_index.sql
- Cria `idx_stock_requisition_requests_tenant_requested_date_created` em `stock_requisition_requests(tenant_id, requested_by, request_date desc, created_at desc)`, parcial para `requested_by is not null`.
- Substitui a sugestao crua do Supabase Advisor (`request_date`) por um indice tenant-first para a aba "minhas requisicoes", que filtra por solicitante e ordena por data/criacao.
- Inclui validacao pos-aplicacao para abortar se o indice esperado nao existir.

399_create_missing_foreign_key_indexes_post_301.sql
- Repete a varredura dinamica da 301 para criar indices faltantes de FKs publicas adicionadas depois daquela leva.
- Fecha a nova remessa de alertas INFO `unindexed_foreign_keys` do Supabase Advisor sem listar manualmente as 62 constraints do relatorio.
- Mantem `unused_index` fora do escopo: remocao de indice continua exigindo auditoria separada de workload, janela de estatisticas, constraints e fluxos raros.

400_programming_team_programmed_foreman_snapshot.sql
- Adiciona `programmed_foreman_person_id` e `programmed_foreman_name_snapshot` em `programming_team`, com FK tenant-aware para `people` e indice tenant-first.
- Faz backfill usando `team_foreman_history` pela data de criacao da alocacao, preservando quem era o encarregado previsto quando a programacao foi registrada.
- Republica `save_project_programming_stage`, `add_project_programming_team` e `postpone_project_programming_team` para gravar/preservar o encarregado programado na alocacao.
- Cria `resolve_programmed_foreman_for_team` para validar novos encarregados contra pessoa ativa do tenant com cargo ativo de Encarregado.
- Trocas de encarregado programado gravam `UPDATE_PROGRAMMED_FOREMAN` em `programming_history` e exigem motivo; alteracoes de outros campos continuam aceitando motivo vazio.
- Hardening: editar uma etapa com equipe ja vinculada nao exige que essa equipe ainda esteja ativa no cadastro; `ativo = true` segue exigido somente para nova inclusao. Valor vazio explicito de encarregado programado e recusado pela API/RPC, e o formulario nao sobrescreve vazio historico ao marcar equipes visiveis.

401_create_activity_type_page_and_team_type_rpcs.sql
- Cadastra a pagina `tipo-atividade` em `app_pages` (secao Cadastro Base) com `default_user_access = false`, seguindo a 245: tela nova nasce liberada so para administrador e depende de liberacao explicita em `/permissoes`. Por isso a chave NAO entra em `DEFAULT_USER_PAGE_ACCESS`.
- Cria `save_team_type_record` e `set_team_type_record_status`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, no mesmo padrao transacional da 390/391: `SELECT ... FOR UPDATE`, comparacao de `expected_updated_at` e escrita em `app_entity_history` na mesma transacao.
- A tela `Tipo de Atividade` administra o catalogo existente `team_types` (origem do campo `Tipo` em `Atividades`), sem tabela nova e sem migracao de dados.
- `team_types` tem unique `(tenant_id, name)` case-sensitive; a RPC de salvar faz checagem extra por `upper(btrim(name))` para recusar duplicidade que difere so em caixa/espaco, que o indice deixaria passar.
- Cancelamento e recusado com `TEAM_TYPE_IN_USE` enquanto houver `service_activities` ou `teams` ativos apontando para o tipo: inativar um tipo em uso tiraria a opcao do select sem tocar nos registros gravados.
- Inclui validacao pos-aplicacao que aborta se as RPCs ficarem executaveis por `anon`/`authenticated` ou se a pagina nao for cadastrada.

402_move_team_type_screen_to_tipo_equipe.sql
- Consolida a tela de cadastro de `team_types` em `/tipo-equipe` e aposenta o page_key `tipo-atividade` criado pela 401: `Tipo de Atividade` e `Tipo de Equipe` sao a mesma informacao, as duas telas apontavam para a mesma tabela.
- A 401 NAO foi editada (guia_sql regra 2: ja estava commitada/publicada e pode ter sido aplicada); a correcao e para a frente. Se a 401 nunca tiver sido aplicada, os blocos que tratam de `tipo-atividade` viram no-op.
- Republica `save_team_type_record` e `set_team_type_record_status` gravando `module_key = 'tipo-equipe'`, sem mudar assinatura. O revoke/grant e repetido porque `create or replace` so preserva privilegio de funcao que ja existia — se a 401 nao rodou, a funcao nasce aqui e nasceria executavel por public.
- Migra `app_entity_history` de `module_key = 'tipo-atividade'` para `'tipo-equipe'` (filtrando `entity_table = 'team_types'`), para a tela nao perder a auditoria feita antes da consolidacao.
- Aposenta `tipo-atividade` no padrao da 364: desativa em `app_pages`, revoga permissoes e grava `app_user_permission_history`, sem deletar a linha — deletar zeraria o `page_key` do historico de permissao, que tem `on delete set null`.
- Revoga `can_create`/`can_update`/`can_cancel`/`can_export` de `tipo-equipe` para usuarios e papeis nao administradores, PRESERVANDO `can_access`. Motivo: a 245 deu `default_user_access = true` a essa pagina e a 253 fez backfill de `can_create = can_access`; enquanto a rota era placeholder isso era inofensivo, mas ao virar CRUD real todo nao-admin ganharia poder de renomear e cancelar tipos usados por Equipes, Meta, Medicao e Atividades sem nenhuma acao do administrador.
- Validacao pos-aplicacao aborta se: as RPCs ficarem executaveis por `anon`/`authenticated`; `tipo-equipe` nao estiver ativa; sobrar historico de `team_types` no module_key antigo; `tipo-atividade` continuar ativo; ou sobrar permissao de escrita em `tipo-equipe` para nao-admin.

403_create_activity_category_page_and_rpcs.sql
- Etapa 2 de 3 do trabalho de dar tela de Cadastro Base aos campos Tipo/Categoria/Grupo de Atividades.
- Cadastra a pagina `categoria-atividade` em `app_pages` (secao Cadastro Base) com `default_user_access = false`, seguindo a 245. Por isso a chave NAO entra em `DEFAULT_USER_PAGE_ACCESS`.
- Cria `save_activity_category_record` e `set_activity_category_record_status`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, no mesmo padrao transacional da 390/391/402.
- A tela administra o catalogo existente `types_service_activities` (origem do campo `Categoria` em Atividades, coluna `service_activities.type_service`), sem tabela nova e sem migracao de dados.
- Pagina nova e nao reaproveitamento de `/tipo-servico`: aquele placeholder e reservado para `project_service_types`, o Tipo de Servico do PROJETO, lido por Projetos/Medicao/Apuracao Fator Minimo/Mapa Programacao. Tabelas e dominios diferentes, entao aqui nao ha o CRUD duplicado que a 402 teve de resolver.
- `types_service_activities_tenant_name_key` e unique `(tenant_id, name)` case-sensitive; a RPC de salvar faz checagem extra por `upper(btrim(name))` para recusar duplicidade que difere so em caixa/espaco.
- Cancelamento e recusado com `ACTIVITY_CATEGORY_IN_USE` enquanto houver `service_activities` ativa apontando para a categoria: `Categoria` e obrigatoria no formulario e o meta so lista `ativo = true`, entao inativar em uso deixaria a atividade antiga impossivel de reeditar.
- `sort_order` nao e exposto na tela: a coluna existe desde a 145, mas nenhum leitor do catalogo ordena por ela. Cadastro novo fica com o default 100.
- Inclui validacao pos-aplicacao que aborta se as RPCs ficarem executaveis por `anon`/`authenticated` ou se a pagina nao for cadastrada.

404_create_activity_group_catalog_and_page.sql
- Etapa 3 de 3 (conclui) do trabalho de dar tela de Cadastro Base aos campos Tipo/Categoria/Grupo de Atividades. Unica das tres com TABELA NOVA.
- Cria `activity_groups` (catalogo por tenant), semeia a partir dos `service_activities.group_name` ja existentes, adiciona `service_activities.group_id` com FK composta `(group_id, tenant_id)` e indice tenant-first, e faz o backfill do vinculo.
- RLS da tabela nova concede SOMENTE `SELECT` a `authenticated`, no padrao fixado pela 393; o revoke de INSERT/UPDATE/DELETE e repetido explicitamente para nao depender do `alter default privileges` do ambiente.
- `group_name` NAO e removida: continua como SNAPSHOT do nome. A RPC `check_measurement_minimum_billing_unit_value` (212) casa o grupo por `normalize_minimum_billing_token(sa.group_name)` para o valor do ponto da garantia de faturamento minimo, e `/api/locacao/activities/catalog` e `/api/apuracao-fator-minimo` leem a coluna direto. Trocar por FK exigiria reescrever calculo financeiro em producao.
- `group_id` nasce NULLABLE espelhando `group_name`, que perdeu o NOT NULL na 050; a obrigatoriedade segue cobrada na RPC de escrita.
- Seed deduplica por `upper(btrim(group_name))`, entao "SOT AEREA" e "Sot Aerea" viram um grupo so. Seguro para o faturamento minimo: `normalize_minimum_billing_token` ja aplica upper, remove acento e descarta o que nao e A-Z0-9. Os valores ja gravados em `group_name` nao sao reescritos.
- Republica `save_service_activity_record` trocando `p_group_name text` por `p_group_id uuid`, com `drop function` explicito da versao da 372: manter as duas criaria overload e o PostgREST nao resolveria a chamada. A RPC resolve o nome no catalogo e grava `group_id` + `group_name`, entao nao existe par id/nome inconsistente.
- Cria `save_activity_group_record` e `set_activity_group_record_status`, `SECURITY DEFINER`, `EXECUTE` so para `service_role`. Renomear um grupo propaga o nome para o `group_name` das atividades vinculadas, senao o snapshot congelaria e o faturamento minimo casaria por um token fora do catalogo.
- Cancelamento recusado com `ACTIVITY_GROUP_IN_USE` enquanto houver atividade ativa vinculada.
- Cadastra a pagina `grupo-atividade` com `default_user_access = false`; a chave NAO entra em `DEFAULT_USER_PAGE_ACCESS`.
- Validacao pos-aplicacao aborta se: as RPCs ficarem executaveis por `anon`/`authenticated`; sobrar assinatura antiga de `save_service_activity_record`; a pagina nao for cadastrada; ou sobrar atividade ativa com `group_name` preenchido e `group_id` nulo.

405_allow_not_working_composition_with_optional_project.sql
- Republica `save_team_composition_record` por patch dinamico para permitir Projetos em composicoes `NOT_WORKING`, mantendo a lista vazia como caso valido.
- `WORKING` continua exigindo ao menos um Projeto; `NOT_WORKING` passa a validar projetos somente quando informados, recusando lista invalida, duplicada ou fora do tenant.
- Quando `NOT_WORKING` tem Projeto, a RPC persiste `project_id`, snapshots agregados e linhas em `team_composition_projects`; sem Projeto, continua gravando `project_id = null`.
- Reaplica revoke de `public`/`anon`/`authenticated`, concede EXECUTE apenas a `service_role` e aborta se o trecho antigo `PROJECT_NOT_ALLOWED` continuar na funcao.

406_fix_service_activities_code_idd_text.sql
- Corrige drift de schema em `public.service_activities.code_idd`: ambientes onde a coluna ja existia como
  `bigint` nao foram corrigidos pela 353, porque `add column if not exists code_idd text` virou no-op.
- Converte `code_idd` para `text` com `using nullif(btrim(code_idd::text), '')`, preservando valores
  numericos existentes como texto e alinhando o banco ao contrato atual de Atividades/Medicao.
- Corrige a falha `42804` da RPC `save_service_activity_record` no cadastro/importacao de Atividades:
  `column "code_idd" is of type bigint but expression is of type text`.
- Inclui validacao pos-aplicacao para abortar se `service_activities.code_idd` nao ficar como `text`.

407_create_no_production_reason_page_and_rpcs.sql
- Cadastra a pagina `motivo-sem-producao` em `app_pages` (secao Cadastro Base) com `default_user_access = false`; a chave nao entra em `DEFAULT_USER_PAGE_ACCESS`.
- Cria `save_no_production_reason_record` e `set_no_production_reason_record_status`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, no padrao transacional de cadastros-base: `SELECT ... FOR UPDATE`, `expected_updated_at` e historico em `app_entity_history`.
- A tela administra o catalogo existente `measurement_no_production_reasons`, sem tabela nova; esse catalogo alimenta `Medicao`, `Medicao Asbuilt` e `Faturamento` em ordens `SEM_PRODUCAO`.
- O cadastro normaliza codigo para caixa alta, bloqueia codigo fora de letras/numeros/underline, preserva unicidade por `(tenant_id, code)` e recusa nomes duplicados que diferem so por caixa/espaco.
- Quando `p_sort_order` vem nulo no cadastro, a RPC calcula a proxima ordem do tenant em sequencia de 10 em 10.
- Cancelamento e recusado com `NO_PRODUCTION_REASON_IN_USE` enquanto houver registros ativos usando o motivo em `project_measurement_orders`, `project_asbuilt_measurement_orders` ou `project_billing_orders`.
- Inclui validacao pos-aplicacao que aborta se as RPCs ficarem executaveis por `anon`/`authenticated` ou se a pagina nao for cadastrada com `default_user_access = false`.

408_create_stock_center_page_and_rpcs.sql
- Cadastra a pagina `centro-estoque` em `app_pages` (secao Cadastro Base) com `default_user_access = false`; a chave nao entra em `DEFAULT_USER_PAGE_ACCESS`.
- Cria `save_stock_center_record` e `set_stock_center_record_status`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, no padrao transacional de cadastros-base: `SELECT ... FOR UPDATE`, `expected_updated_at` e historico em `app_entity_history`.
- A tela administra o catalogo existente `stock_centers`, mas somente centros fisicos de estoque (`center_type = 'OWN'`, `controls_balance = true`) sem vinculo em `teams.stock_center_id`.
- Centros de estoque proprios de equipes nao aparecem na tela e as RPCs recusam qualquer tentativa de editar ou alterar status desses registros com `TEAM_STOCK_CENTER`.
- Cadastro novo sempre cria centro `OWN` com `controls_balance = true`, que pode alimentar o select `Centro de estoque` de `Solicitacao de Requisicao`.
- Cancelamento e recusado se o centro tiver saldo diferente de zero em `stock_center_balances` ou requisicao aberta em `stock_requisition_requests`.
- Revoga escrita direta em `stock_centers` para `public`, `anon` e `authenticated`, mantendo escrita pela aplicacao via `service_role` e RPCs.

409_contract_control_fields_and_rpc.sql
- Corrige/versiona o drift manual dos campos de controle em `contract`: se a coluna `"e-mail"` existir e `email` nao existir, renomeia preservando dados; se ambas existirem, aborta em divergencia antes de remover a coluna legada.
- Adiciona `telefone_corporativo numeric`, `email text`, `nome_gestor text` e `empresa text` em `contract`.
- Faz backfill de `empresa` a partir de `name` quando estiver vazia, preservando o contrato atual consumido por Projetos.
- Cria `save_contract_control_record`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, `SELECT ... FOR UPDATE`, `expected_updated_at` e historico em `app_entity_history`.
- Mantem um contrato por tenant via `UNIQUE (tenant_id)` ja existente e inclui validacao pos-aplicacao para coluna legada e grant da RPC.

410_create_utility_distributor_contact_page.sql
- Cadastra/atualiza a pagina `responsavel-distribuidora` como `Responsaveis Distribuidora`, preservando o mesmo `page_key` historico.
- Cria `save_utility_distributor_contact_record` e `set_utility_distributor_contact_status`, `SECURITY DEFINER`, com `EXECUTE` apenas para `service_role`, `SELECT ... FOR UPDATE`, `expected_updated_at` e historico em `app_entity_history`.
- A tela usa um `kind` fechado para escolher internamente entre `project_utility_responsibles` e `project_utility_field_managers`; o cliente nao envia nome de tabela nem `tenant_id`.
- As duas tabelas continuam alimentando os campos `Responsavel Distribuidora` e `Gestor de campo Distribuidora` em Projetos via `/api/projects/meta`, sempre filtradas por tenant e `ativo`.
- Como a rota existia como placeholder, define `default_user_access = false` e revoga escrita/exportacao de nao-admin herdada de `can_access`, preservando leitura ja concedida.
- Inclui validacao pos-aplicacao que aborta se as RPCs ficarem executaveis por `anon`/`authenticated`, se a pagina nao estiver ativa ou se sobrar escrita para nao-admin.

411_activity_groups_unit_value_source.sql
- Adiciona `activity_groups.unit_value numeric(14,2)` com check de valor maior ou igual a zero.
- Faz backfill do valor do grupo pelos valores canonicos conhecidos (`SOT AEREA`, `SOC`, `PODA`, `LLEE`/`LINHA VIVA`, `SEGURANCA`) e, para grupos customizados, pelo ultimo `service_activities.unit_value` vinculado.
- Republica `save_activity_group_record` para cadastrar/editar `unit_value` com historico em `app_entity_history`.
- Republica `save_service_activity_record` preservando a assinatura atual, mas usando `activity_groups.unit_value` como fonte de verdade para gravar o snapshot `service_activities.unit_value`.
- Mantem RLS, grants e tenant derivados do backend: RPCs `SECURITY DEFINER` seguem executaveis apenas por `service_role`.
