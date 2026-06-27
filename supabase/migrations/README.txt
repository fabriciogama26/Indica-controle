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
- Preenche `Estado Trabalho` em branco de programacoes inativas (`ADIADA`/`CANCELADA`) usando sugestoes nao conclusivas e catalogo ativo do tenant.
- Nao herda `CONCLUIDO` para programacoes interrompidas; divergencias ficam para revisao operacional.
- Mantem o status operacional original e registra historico em `project_programming_history`.

258_guard_interrupted_programming_completed_work_status.sql
- Cria trigger em `project_programming` para impedir novas divergencias `ADIADA/CANCELADA + CONCLUIDO`.
- Bloqueia nova transicao para `ADIADA` ou `CANCELADA` quando o projeto ja possui Estado Trabalho concluido.
- Mantem dados legados intactos para revisao por auditoria, sem backfill destrutivo.

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
- Cria RPC para copia/adicao de equipe marcar `ANTECIPADO` somente apos nova validacao do `CONCLUIDO` anterior.
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
- Executa validacao, lote, criacao das programacoes, vinculos de copia, historico e rastreio de `ANTECIPADO` em uma unica transacao.
- Remove a estrategia de compensacao por UPDATE/CANCELADA quando uma iteracao falhava depois de criar linhas.
- Mantem EXECUTE restrito a `service_role`.

275_harden_programming_stage_state_integrity.sql
- Endurece a trigger diferida de ETAPA ativa para permitir exatamente uma classificacao.
- Programacao ativa deve ter `etapa_number > 0` sem flags, ou `ETAPA UNICA`, ou `ETAPA FINAL`.
- Bloqueia combinacoes como ETAPA 0, ETAPA negativa, ETAPA numerica com flag e `ETAPA UNICA + ETAPA FINAL`.
- A migration para antes de alterar a trigger quando encontra dados ativos invalidos e mostra exemplos para saneamento.
