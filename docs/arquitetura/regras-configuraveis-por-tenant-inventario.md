# Regras Configuráveis por Tenant — Inventário
Gerado em: 2026-06-27 | Revisado em: 2026-06-27 (revisão técnica obrigatória)

Base de dados: 284+ migrations, 68 rotas de API, ~29 módulos. Nomes de tabelas verificados diretamente nas migrations — não presumidos.

Toda `rule_key` usa **namespace de módulo** para garantir unicidade global e prevenir colisão entre módulos distintos. Formato obrigatório: `<modulo>.<nome_da_regra>`. A coluna `rule_key` em `business_rule_definitions` tem constraint UNIQUE global — o namespace torna a unicidade semântica e previsível.

---

## Classificação de Tabelas por Escopo (adicionada 2026-06-27)

Estudo completo em `acesso-por-tenant-e-contrato-estudo.md`. Resumo:

| Grupo | Tabelas | Estratégia |
|-------|---------|------------|
| **Global do tenant** | `tenants`, `app_users`, `app_roles`, `app_user_tenants`, `app_pages`, `role_page_permissions`, `app_user_page_permissions`, `contract`, `people`, `materials`, `inventory_balance`, `job_titles`, `service_activities` | Mantêm apenas `tenant_id`. Sem `contract_id`. |
| **Catálogo configurável do tenant** | `programming_sgd_types`, `programming_reason_catalog`, `programming_work_completion_catalog`, `programming_eq_catalog` | Catálogos com `tenant_id`. Sem `contract_id`. Usados por `tenant_business_rules` (Fases 1-10). `contract_business_rules` — **arquitetura futura, não existe**. |
| **Operacional por contrato** | `project` (âncora principal), `project_programming`, `project_programming_history`, `project_measurement_orders`, `project_billing_orders`, `project_asbuilt_measurement_orders`, `project_material_forecast`, `project_activity_forecast`, `location_planning` | Hoje: apenas `tenant_id`. Futuro: `project` receberá `contract_id`; demais herdam por JOIN. |
| **Indefinido (decisão de negócio)** | `teams`, `trafo_instances`, `measurement_meta_targets` | Podem ser globais do tenant ou por contrato. Requer decisão explícita antes da Fase E do plano de acesso por contrato. |

**Impacto nas regras configuráveis:** Nas Fases 1-10, apenas `tenant_business_rules` referencia esses catálogos. Quando `contract_business_rules` for criada (Fases A+B do plano de acesso por contrato), os catálogos serão compatíveis com o mesmo schema sem alteração.

---

## 0. Mapa de Nomes de Tabelas Reais (verificado nas migrations)

| Módulo | Nome real da tabela | Nome incorreto nos docs anteriores | Migration |
|--------|--------------------|------------------------------------|-----------|
| Contratos | `contract` | `contracts` (plural incorreto) | 032/033 |
| Medição | `project_measurement_orders` | `measurement_orders` | 112 |
| As Built | `project_asbuilt_measurement_orders` | `measurement_asbuilt_orders` (NOME ERRADO — corrigido 2026-06-27) | 177 |
| Faturamento | `project_billing_orders` | `billing_orders` | 176 |
| Itens Faturamento | `project_billing_order_items` | `billing_order_items` | 176 |
| Itens Medição | `project_measurement_order_items` | `measurement_order_items` | 112 |

Esses nomes reais devem ser usados em TODAS as migrations futuras (276 em diante).

---

## 1. Inventário de Módulos e Telas

| Módulo | Rota da tela | Arquivos principais | APIs/RPCs | Tabelas principais | Prioridade de migração |
|--------|-------------|---------------------|-----------|--------------------|----------------------|
| Programação | `/programacao-simples`, `/programacao-visualizacao` | `src/server/modules/programacao/handlers.ts`, `rpc.ts`, `queries.ts` | `GET/POST/PUT/PATCH /api/programacao`, `GET /api/mapa-programacao` | `project_programming`, `project_programming_history`, `project_programming_activities` | **1 — Alta** |
| Medição | `/medicao` | `src/app/api/medicao/route.ts` (inline) | `GET/POST/PUT/PATCH /api/medicao`, `GET /api/medicao/minimum-billing`, `GET /api/medicao/rate-suggestion` | `project_measurement_orders`, `project_measurement_order_items`, `measurement_activities` | **2 — Alta** |
| As Built (Medição As Built) | `/medicao-asbuilt` | `src/modules/dashboard/medicao-asbuilt/` | `GET/POST/PUT/PATCH /api/medicao-asbuilt` | `project_asbuilt_measurement_orders`, `project_asbuilt_measurement_order_items` | **3 — Média** |
| Faturamento | `/faturamento` | `src/app/api/faturamento/route.ts` (inline) | `GET/POST/PUT/PATCH /api/faturamento` | `project_billing_orders`, `project_billing_order_items` | **4 — Média** |
| Projetos | `/projetos` | `src/modules/dashboard/projetos/`, `src/server/modules/projects/authorization.ts` | `GET/POST /api/projects`, `GET /api/projects/forecast`, `GET /api/projects/activity-forecast` | `project`, `contract`, `project_history` | **5 — Média** |
| Apuração Fator Mínimo | `/apuracao-fator-minimo` | `src/modules/dashboard/apuracao-fator-minimo/` | `GET /api/apuracao-fator-minimo` | `project_measurement_orders`, `minimum_factor_analysis` | **6 — Média** |
| Equipes | `/equipes` | `src/modules/dashboard/equipes/` | `GET/POST/PUT /api/teams` | `teams`, `team_types` | **7 — Baixa** |
| Composição de Equipe | `/composicao-equipe` | `src/modules/dashboard/composicao-equipe/` | `GET/POST /api/composicao-equipe` | `team_compositions` | **7 — Baixa** |
| Pessoas | `/pessoas` | `src/modules/dashboard/pessoas/` | `GET/POST/PUT /api/people` | `people` | **7 — Baixa** |
| Materiais | `/materiais` | `src/modules/dashboard/materiais/` | `GET/POST/PUT /api/materials` | `materials` | **7 — Baixa** |
| Entrada (Estoque) | `/entrada` | `src/modules/dashboard/entrada/` | `GET/POST /api/stock-transfers`, `POST /api/stock-transfers/import` | `stock_transfers`, `stock_transfer_items` | **8 — Baixa** |
| Saída (Estoque Equipes) | `/saida` | `src/modules/dashboard/saida/` | `GET/POST /api/team-stock-operations`, `POST /api/team-stock-operations/import` | `team_stock_operations`, `team_stock_operation_items` | **8 — Baixa** |
| Estornos | `/estornos` | `src/modules/dashboard/estornos/` | `GET/POST /api/estornos` | `stock_reversals` | **8 — Baixa** |
| Controle APR | `/controle-apr` | `src/modules/dashboard/controle-apr/` | `GET/POST /api/controle-apr` | `apr_control_orders` | **9 — Baixa** |
| Meta | `/meta` | `src/modules/dashboard/meta/` | `GET/POST /api/meta` | `measurement_meta_targets` | **6 — Média** |
| Dashboard Equipes | `/dashboard-equipes` | `src/modules/dashboard/dashboard-equipes/` | `GET /api/dashboard-equipes` | `project_measurement_orders`, `teams` | **9 — Baixa** |
| Dashboard Medição | `/dashboard-medicao` | `src/modules/dashboard/dashboard-medicao/` | `GET /api/dashboard-medicao` | `project_measurement_orders` | **9 — Baixa** |
| Dash Operacional Faturamento | `/dash-operacional-faturamento` | `src/modules/dashboard/dash-operacional-faturamento/` | `GET /api/dash-operacional-faturamento` | `project_billing_orders`, `project_measurement_orders` | **9 — Baixa** |
| Dash Estoque | `/dash-estoque` | `src/modules/dashboard/dash-estoque/` | `GET /api/dash-estoque` | `inventory_balance` | **9 — Baixa** |
| Locação | `/locacao` | `src/modules/dashboard/locacao/` | `GET/POST /api/locacao` | `location_planning` | **8 — Baixa** |
| Posição Trafo | `/posicao-trafo` | `src/modules/dashboard/posicao-trafo/` | `GET/POST /api/trafo-positions` | `trafo_instances` | **9 — Baixa** |
| Atividades | `/atividades` | `src/modules/dashboard/atividades/` | `GET/POST /api/activities` | `service_activities` | **7 — Baixa** |
| Cargo | `/cargo` | `src/modules/dashboard/cargo/` | `GET/POST /api/job-titles` | `job_titles` | **9 — Baixa** |
| Consumo Projeto | `/consumo-projeto` | `src/modules/dashboard/consumo-projeto/` | `GET /api/consumo-projeto` | `project`, `team_stock_operations` | **9 — Baixa** |
| Estoque Equipes | `/estoque-equipes` | `src/modules/dashboard/estoque-equipes/` | `GET /api/team-stock-balance` | `team_stock_balance` | **9 — Baixa** |
| Estoque (Saldo) | `/estoque` | `src/modules/dashboard/estoque/` | `GET /api/stock-balance` | `inventory_balance` | **9 — Baixa** |
| Permissões | `/permissoes` | `src/modules/dashboard/permissoes/` | `GET/PUT /api/app-users/[userId]/permissions` | `user_page_permissions` | **10 — Baixa** |
| Mapa Programação | `/mapa-programacao` | `src/modules/dashboard/mapa-programacao/` | `GET /api/mapa-programacao` | `project_programming` | **1 — Alta** |
| Home | `/` | `src/modules/dashboard/home/` | — | — | **10 — Baixa** |

---

## 2. Inventário de APIs e RPCs

| API / RPC | Módulo | Arquivo | Operações | Validações server-side |
|-----------|--------|---------|-----------|----------------------|
| `GET /api/programacao` | Programação | `src/app/api/programacao/route.ts` | Listar programações por período e filtros | tenant_id da sessão, permissão read |
| `POST /api/programacao` | Programação | `src/app/api/programacao/route.ts` → `handlers.ts` | Criar programação | tenant, permissão create, campos obrigatórios, conflito horário, ETAPA, CONCLUIDO bloqueante |
| `PUT /api/programacao` | Programação | `src/app/api/programacao/route.ts` → `handlers.ts` | Editar programação | tenant, permissão update, CANCELADA/ADIADA bloqueante, ANTECIPADO bloqueante, conflito |
| `PATCH /api/programacao` (batch) | Programação | `src/app/api/programacao/route.ts` → `handlers.ts` | Ações: cancelar, adiar, copiar, adicionar equipe, salvar Estado Trabalho, copiar para datas, lote | tenant, permissão específica por ação |
| RPC `save_project_programming_full_decimal_with_electrical_and_eq` | Programação | `src/server/modules/programacao/rpc.ts` | Salvar programação completa transacional | tenant_id, time conflict, stage conflict, security definer |
| RPC `save_project_programming_batch_full_decimal` | Programação | `src/server/modules/programacao/rpc.ts` | Salvar lote de programações | tenant_id, múltiplos times e conflicts |
| RPC `copy_team_programming_period` | Programação | `src/server/modules/programacao/rpc.ts` | Copiar linha de equipe em período | tenant_id, CONCLUIDO guard |
| RPC `copy_project_programming_to_dates` | Programação | `src/server/modules/programacao/rpc.ts` | Copiar para múltiplas datas/equipes | tenant_id, etapa conflict, schedule conflict |
| RPC `mark_project_programming_future_stages_anticipated` | Programação | `src/server/modules/programacao/rpc.ts` | Marcar etapas futuras como ANTECIPADO | tenant_id, source etapa_number |
| RPC `mark_project_programming_stage_anticipated` | Programação | `src/server/modules/programacao/rpc.ts` | Marcar uma etapa específica como ANTECIPADO | tenant_id, source programming_id |
| RPC `set_project_programming_status` | Programação | `src/server/modules/programacao/rpc.ts` | Cancelar/adiar programação | tenant_id, reason, expectedUpdatedAt |
| RPC `cancel_project_programming_group` | Programação | `src/server/modules/programacao/rpc.ts` | Cancelar grupo operacional | tenant_id, programming_group_id |
| RPC `postpone_project_programming` | Programação | `src/server/modules/programacao/rpc.ts` | Adiar com nova data | tenant_id, data futura |
| RPC `postpone_project_programming_group` | Programação | `src/server/modules/programacao/rpc.ts` | Adiar grupo operacional | tenant_id, programming_group_id |
| RPC `save_project_programming_work_completion_status_full` | Programação | `src/server/modules/programacao/rpc.ts` | Salvar Estado Trabalho isolado | tenant_id, CONCLUIDO guard, ANTECIPADO guard |
| `GET /api/medicao` | Medição | `src/app/api/medicao/route.ts` | Listar ordens de medição | tenant_id da sessão |
| `POST /api/medicao` | Medição | `src/app/api/medicao/route.ts` | Criar/editar/cancelar ordem de medição | tenant, campos obrigatórios, status transitions |
| `GET /api/medicao/minimum-billing` | Medição | `src/app/api/medicao/minimum-billing/route.ts` | Calcular garantia mínima | tenant_id, team_id, data, motivo |
| RPC `calculate_measurement_minimum_billing_guarantee` | Medição | `src/app/api/medicao/minimum-billing/route.ts` | Calcular valor da garantia mínima | tenant_id, team_type, score_target |
| `GET /api/faturamento` | Faturamento | `src/app/api/faturamento/route.ts` | Listar ordens de faturamento | tenant_id |
| `POST/PUT /api/faturamento` | Faturamento | `src/app/api/faturamento/route.ts` | Criar/editar/cancelar/reabrir faturamento | tenant, reason >= 10 chars, status |
| `GET /api/mapa-programacao` | Mapa Programação | `src/app/api/mapa-programacao/route.ts` | Mapa visual de programações por projeto | tenant_id, CONCLUIDO/ANTECIPADO resolution |
| `GET /api/meta` | Meta | `src/app/api/meta/route.ts` | Leitura de metas e medições | tenant_id, ciclo |
| `GET /api/apuracao-fator-minimo` | Apuração | `src/app/api/apuracao-fator-minimo/route.ts` | Calcular fator mínimo por equipe | tenant_id, período |
| `GET/POST /api/projects` | Projetos | `src/app/api/projects/route.ts` | CRUD de projetos | tenant_id, contract |
| `GET /api/dash-operacional-faturamento` | Dashboard | `src/app/api/dash-operacional-faturamento/route.ts` | Dashboard faturamento+medição | tenant_id, filtra CANCELADA |

---

## 3. Inventário de Tabelas do Banco

Nomes verificados nas migrations. Onde havia divergência com os docs anteriores, o nome real está indicado.

| Tabela | tem tenant_id? | RLS ativa? | Migration de criação | Módulos que a usam |
|--------|---------------|------------|---------------------|-------------------|
| `app_users` | Sim | Sim | 000 | Auth global |
| `app_roles` | Não (global) | Não confirmado | 023 | Auth global |
| `app_user_tenants` | Não (link user-tenant) | Sim | 045 | Auth global |
| `tenants` | Não (é o tenant) | Sim | 045 | Auth global |
| `page_permissions` | Não (global) | Não | 022 | Permissões |
| `user_page_permissions` | Sim | Sim | 024 | Permissões |
| `permission_change_history` | Sim | — | 027 | Permissões |
| `materials` | Sim | Sim | 001 | Materiais, Estoque |
| `inventory_balance` | Sim | Sim | 001 | Estoque |
| `requisicoes` | Sim | Sim | 001 | (legado) |
| `project` | Sim | Sim | 029 | Projetos, Programação |
| `contract` | Sim (UNIQUE) | Sim | 032/033 | Projetos, Programação |
| `project_history` | Sim | — | 036 | Projetos |
| `project_material_forecast` | Sim | — | 041 | Projetos |
| `project_activity_forecast` | Sim | — | 064 | Projetos |
| `people` | Sim | Sim | 014 | Pessoas, Equipes |
| `job_titles` | Sim | — | 014 | Cargo |
| `teams` | Sim | Sim | 052 | Equipes, Programação |
| `team_types` | Sim | — | 053 | Equipes, Medição |
| `service_activities` | Sim | Sim | 049 | Atividades, Programação, Medição |
| `location_planning` | Sim | Sim | 059 | Locação |
| `project_programming` | Sim | Sim | 067 | Programação, Mapa |
| `project_programming_history` | Sim | Sim | 101 | Programação |
| `project_programming_activities` | Sim | — | 114 | Programação |
| `programming_sgd_types` | Sim | Sim | 087 | Programação |
| `programming_work_completion_catalog` | Sim | Sim | 155 | Programação |
| `programming_eq_catalog` | Sim | Sim | 151 | Programação |
| `programming_reason_catalog` | Sim | — | 135 | Programação |
| `programming_support_items` | Sim | — | 072 | Programação |
| `project_measurement_orders` | Sim | Sim | 112 | Medição |
| `project_measurement_order_items` | Sim | — | 112 | Medição |
| `project_asbuilt_measurement_orders` | Sim | Sim | 177 | As Built |
| `measurement_meta_targets` | Sim | — | 161 | Meta |
| `measurement_score_targets` | Sim | — | 192 | Medição, Meta |
| `project_billing_orders` | Sim | Sim | 176 | Faturamento |
| `project_billing_order_items` | Sim | — | 176 | Faturamento |
| `stock_transfers` | Sim | Sim | 128 | Entrada |
| `stock_transfer_items` | Sim | — | 128 | Entrada |
| `team_stock_operations` | Sim | Sim | 140 | Saída |
| `team_stock_operation_items` | Sim | — | 140 | Saída |
| `apr_control_orders` | Sim | Sim | 226 | Controle APR |
| `team_compositions` | Sim | — | 200 | Composição Equipe |
| `idempotency_requests` | Não | — | 252 | Global (locks) |

---

## 4. Inventário de Regras Fixas (Hardcodes)

Coluna "Recomendação" usa a `rule_key` com namespace de módulo obrigatório.

| Módulo | Arquivo | Linha aprox. | Regra atual | Camada | Risco | Pode virar config? | Recomendação |
|--------|---------|-------------|-------------|--------|-------|-------------------|-------------|
| Programação | `src/app/api/programacao/route.ts` | 578 | Motivo de cancelamento/adiamento deve ter >= 10 chars | API server | Médio | Sim | `programacao.min_cancel_reason_chars` (number, default=10) |
| Programação | `src/server/modules/programacao/handlers.ts` | 1200-1222 | sgdTypeId, electricalField, electricalEqCatalogId são obrigatórios (campos nullable no banco) | Handler | Alto | Sim | `programacao.require_sgd_fields` (boolean, default=true) — **primeira regra a implementar; campos já são nullable no banco** |
| Programação | `src/server/modules/programacao/handlers.ts` | 1600 | ANTECIPADO não pode ser selecionado manualmente | Handler | Alto | Sim (parcial) | `programacao.allow_manual_antecipado` (boolean, default=false) |
| Programação | `src/server/modules/programacao/handlers.ts` | 1868 | Salvar CONCLUIDO dispara marcação automática de ANTECIPADO em etapas futuras | Handler | Alto | Sim | **Substituída por** `programacao.intermediate_completion_policy` (enum, ver Seção 7) |
| Programação | `src/server/modules/programacao/handlers.ts` | ~297 | Período com CONCLUIDO bloqueia cópia | Handler | Médio | Sim (parcial) | `programacao.block_operations_if_project_concluded` (boolean, default=true) |
| Programação | `src/server/modules/programacao/normalizers.ts` | 164-167 | `CONCLUIDO` e `COMPLETO` são ambos tratados como "concluído" | Normalizer | Médio | **Não** (migração histórica) | `COMPLETO` é alias legado de leitura; novas gravações aceitam apenas `CONCLUIDO`; limpeza histórica é fase futura; `isCompletedWorkStatus()` deve ser centralizada (hoje duplicada em 5 locais) |
| Programação | `src/server/modules/programacao/normalizers.ts` | 169-171 | `ANTECIPADO` é o único código aceito como "antecipado" | Normalizer | Baixo | Não (código de catálogo) | Manter fixo; o catálogo `programming_work_completion_catalog` já é por tenant |
| Programação | `supabase/migrations/087_*.sql` | 16-17 | SGD export_column limitado a 3 valores (`SGD_AT_MT_VYP`, `SGD_BT`, `SGD_TET`) | Banco (CHECK) | Alto | Sim | Substituir CHECK pelo catálogo `programming_export_column_definitions` (ver Seção 7, regra `programacao.export_layout`) — CHECK só pode ser removido após catálogo criado, populado e código migrado |
| Programação | `src/server/modules/programacao/handlers.ts` | 1735-1737 | Motivo de reprogramação deve ter >= 10 chars | Handler | Médio | Sim | `programacao.min_reschedule_reason_chars` (number, default=10) |
| Programação | `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | ~1704 | Botão "ENEL-EXCEL" e layout de exportação ENEL | View (frontend) | Alto | Sim | `programacao.export_layout` (enum: `ENEL_EXCEL`, `ENEL_NOVO`, `DEFAULT`, default=`ENEL_EXCEL`) |
| Faturamento | `src/app/api/faturamento/route.ts` | 859 | Motivo de cancelamento/reabertura deve ter >= 10 chars | API server | Médio | Sim | `faturamento.min_cancel_reason_chars` (number, default=10) |
| Medição | `src/app/api/medicao/minimum-billing/route.ts` | — | Cálculo de garantia mínima via RPC com critérios fixos de `team_type` e `score_target` | API+RPC | Médio | Sim (parcial) | `medicao.enable_minimum_billing` (boolean, default=true) |
| Auth | `src/lib/server/appUsersAdmin.ts` | 8 | Cache de autenticação TTL = 45.000ms | Lib | Baixo | Sim (operacional) | Via variável de ambiente — não virar config de tenant |
| Auth | `src/context/AuthContext.tsx` | 36-43 | Session idle timeout padrão = 30min (via env) | Context | Baixo | Sim (via env) | Já usa `NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES` — manter |
| Programação | `src/server/modules/programacao/queries.ts` | 83 | Chunk size = 100 para busca de atividades | Query | Baixo | Não (otimização interna) | Manter fixo |

---

## 5. Regras Duplicadas entre Módulos

| Regra | Módulos com duplicação |
|-------|----------------------|
| Verificação de status "concluído" (`isCompletedWorkStatus`) | `src/server/modules/programacao/normalizers.ts` + `src/app/api/mapa-programacao/route.ts` (implementação local linha 127) + `src/modules/dashboard/programacao-simples/utils.ts` (linha 782) + `src/app/api/medicao/route.ts` (linha 466, inline) + `src/modules/dashboard/medicao/MeasurementPageView.tsx` (linha 544, inline). Cinco implementações. Deve ser centralizada em `normalizers.ts` na Fase 10. |
| Normalização de `workCompletionStatus` para token uppercase | `src/server/modules/programacao/normalizers.ts::normalizeWorkCompletionStatus` + `src/server/modules/dashboard-measurement/controller.ts` (linha 189, reimplementação paralela) |
| Limiar de 10 chars para motivo de ação | `src/app/api/programacao/route.ts:578` + `src/app/api/faturamento/route.ts:859` — sem constante compartilhada |
| Normalização de `tenant_id` em queries | Todo handler de API — sem helper centralizado; cada arquivo faz `.eq("tenant_id", resolution.appUser.tenant_id)` inline |
| Validação de datas de documentos (pedido > aprovada) | `src/server/modules/programacao/normalizers.ts::getInvalidRequestedDateLabel` + `src/modules/dashboard/programacao-simples/validators.ts::getDocumentRequestedAfterApprovedLabel` (duplicado frontend+backend) |
| Filtragem de status "CANCELADA" em queries | `src/app/api/apuracao-fator-minimo/route.ts` + `src/app/api/dash-operacional-faturamento/route.ts` + `src/app/api/meta/route.ts` — sem abstração compartilhada |

---

## 6. Regras Apenas no Front-end (risco alto)

| Regra | Arquivo | Risco | Observação |
|-------|---------|-------|-----------|
| Layout de exportação ENEL-EXCEL (colunas e estrutura) | `src/modules/dashboard/programacao-simples/exports.ts` | **Alto** | Sem validação backend; estrutura ENEL hardcoded no frontend |
| Label do botão "ENEL-EXCEL" e "Extração ENEL NOVO" | `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | **Alto** | Nome de cliente específico visível para todos os tenants; deve ser controlado por `programacao.export_layout` |
| Sugestão automática da próxima ETAPA numérica | `src/modules/dashboard/programacao-simples/hooks.ts` | Médio | Backend valida conflito, mas a sugestão em si é só frontend |
| Validação local de tempo (endTime > startTime) | `src/modules/dashboard/programacao-simples/validators.ts` | Baixo | Backend também valida em `handlers.ts` |
| Validação local de documentos (data pedido > aprovada) | `src/modules/dashboard/programacao-simples/validators.ts` | Baixo | Backend replica em `getInvalidRequestedDateLabel()` |
| Filtro "NAO_INFORMADO" como status visual especial | `src/modules/dashboard/programacao-simples/` (uso em filtros) | Médio | Semântica não padronizada — não existe como status no banco |
| Exibição visual de ETAPA FINAL vs ETAPA UNICA (prioridade) | `src/modules/dashboard/programacao-simples/exports.ts` | Baixo | Regra de display; sem impacto de negócio |

---

## 7. Catálogo Proposto de Regras Configuráveis

Todas as `rule_key` usam namespace de módulo. Chaves sem namespace foram descartadas. As duas chaves boolean `auto_anticipate_on_conclusion` e `intermediate_completion_as_anticipated` foram **substituídas** pela chave enum `programacao.intermediate_completion_policy`.

**CORREÇÃO D6:** `frontend_exposable` tem default `false`. Apenas as regras marcadas com `true` abaixo precisam ser conhecidas pelo frontend.

| Módulo | rule_key (com namespace) | value_type | default_value | allowed_scopes | criticality | frontend_exposable | editable_by | Descrição |
|--------|--------------------------|-----------|--------------|----------------|-------------|-------------------|-------------|-----------|
| programacao | `programacao.require_sgd_fields` | boolean | true | {tenant,contract} | high | **true** | tenant_admin | **PRIMEIRA REGRA A IMPLEMENTAR.** Exige sgdTypeId (nullable no banco), electricalField (nullable) e electricalEqCatalogId (nullable) para salvar programação. Nenhuma migration de schema necessária para ativar com false. |
| programacao | `programacao.intermediate_completion_policy` | enum | mark_future_as_anticipated | {tenant,contract} | high | false | admin | Política ao salvar CONCLUIDO em etapa não-final. Valores: `reject`, `mark_future_as_anticipated`, `allow_without_anticipation`. Documentar que reject e allow_without_anticipation requerem teste completo antes de produção. |
| programacao | `programacao.block_operations_if_project_concluded` | boolean | true | {tenant,contract} | high | false | admin | CONCLUIDO ativo no projeto bloqueia criação, cópia, adição de equipe, adiamento e cancelamento |
| programacao | `programacao.allow_manual_antecipado` | boolean | false | {tenant,contract} | medium | false | admin | Permite selecionar ANTECIPADO manualmente no campo Estado Trabalho |
| programacao | `programacao.min_cancel_reason_chars` | number | 10 | {tenant} | low | false | tenant_admin | Número mínimo de caracteres para motivo de cancelamento/adiamento |
| programacao | `programacao.min_reschedule_reason_chars` | number | 10 | {tenant} | low | false | tenant_admin | Número mínimo de caracteres para motivo de reprogramação |
| programacao | `programacao.export_layout` | enum | ENEL_EXCEL | {tenant} | low | **true** | tenant_admin | Layout de exportação padrão. Valores controlados pelo catálogo `programming_export_column_definitions` |
| programacao | `programacao.require_final_stage_for_completion` | boolean | false | {tenant,contract} | high | false | admin | Exige que a etapa seja `etapa_final = true` para aceitar CONCLUIDO. Relacionado a `intermediate_completion_policy = reject` |
| programacao | `programacao.allow_overlapping_schedules` | boolean | false | {tenant} | medium | false | admin | Permite que uma equipe tenha duas programações com horário sobrepostos no mesmo dia |
| medicao | `medicao.enable_minimum_billing` | boolean | true | {tenant,contract} | medium | false | tenant_admin | Habilita cálculo e registro de garantia mínima de faturamento por equipe |
| medicao | `medicao.require_programming_match` | boolean | false | {tenant,contract} | medium | false | admin | Exige que a medição esteja vinculada a uma programação existente |
| medicao | `medicao.max_backdate_days` | number | 0 | {tenant} | medium | false | tenant_admin | Número máximo de dias retroativos para criar uma medição (0 = sem limite) |
| faturamento | `faturamento.min_cancel_reason_chars` | number | 10 | {tenant} | low | false | tenant_admin | Número mínimo de caracteres para motivo de cancelamento/reabertura de faturamento |
| faturamento | `faturamento.require_approval_before_billing` | boolean | false | {tenant,contract} | critical | false | admin | Exige aprovação antes de fechar faturamento. Requer colunas approved_by/approved_at em project_billing_orders (Fase 7). |
| faturamento | `faturamento.allow_billing_without_measurement` | boolean | true | {tenant,contract} | medium | false | admin | Permite criar faturamento sem medição vinculada |
| projetos | `projetos.require_contract_link` | boolean | false | {tenant} | low | false | admin | Exige que todo projeto esteja vinculado a um contrato |
| equipes | `equipes.enforce_unique_foreman_per_team` | boolean | true | {tenant} | low | false | admin | Impede que o mesmo encarregado seja associado a mais de uma equipe ativa |

**Nota — `programacao.intermediate_completion_policy` (substitui dois booleans anteriores):**

As chaves `auto_anticipate_on_conclusion` (boolean) e `intermediate_completion_as_anticipated` (boolean) foram **removidas** e substituídas por um único enum com semântica mais clara:

- **`reject`**: impede salvar `CONCLUIDO` em etapa que não seja `etapa_final = true`. Handler retorna erro. RPC `mark_project_programming_future_stages_anticipated` não é chamada. O trigger de banco (migration 275) valida apenas ETAPA, não o work_completion_status — portanto o handler TypeScript é o único bloqueio para reject.
- **`mark_future_as_anticipated`** (default — comportamento atual): permite `CONCLUIDO` em qualquer etapa numérica. Chama `mark_project_programming_future_stages_anticipated` após salvar. Etapas futuras com `etapa_number` maior recebem status `ANTECIPADO`.
- **`allow_without_anticipation`**: permite `CONCLUIDO` em qualquer etapa. Não chama a RPC de antecipação. Estado das demais etapas permanece inalterado.

**Nota — Status legado `COMPLETO`:**

- Novas gravações: apenas `CONCLUIDO` é aceito.
- Leitura: `isCompletedWorkStatus()` aceita `CONCLUIDO` e `COMPLETO` como alias legado. Verificado em migrations 217, 229, 255, 256, 257, 258, 272, 274 — o token COMPLETO ainda está presente em múltiplas funções de banco.
- Limpeza histórica: fase futura, não bloqueante para as demais fases.
- Esta compatibilidade **NÃO é configurável por tenant**.
- A função `isCompletedWorkStatus()` deve ser centralizada em um único utilitário — hoje está duplicada em 5 locais (`normalizers.ts`, `mapa-programacao/route.ts`, `utils.ts`, `medicao/route.ts`, `MeasurementPageView.tsx`).

**Catálogo de colunas de exportação (`programming_export_column_definitions`):**

O CHECK constraint atual em `export_column` (migration 087) não deve ser removido sem substituição. O catálogo a seguir controla quais colunas pertencem a cada layout:

```sql
-- Tabela conceitual (migration futura após 280)
CREATE TABLE programming_export_column_definitions (
  id            UUID PRIMARY KEY,
  export_layout TEXT NOT NULL,       -- ex: 'ENEL_EXCEL', 'ENEL_NOVO', 'DEFAULT'
  column_key    TEXT NOT NULL,       -- chave da coluna (ex: 'SGD_AT_MT_VYP')
  column_label  TEXT NOT NULL,       -- rótulo no cabeçalho do arquivo exportado
  source_field  TEXT NOT NULL,       -- campo na tabela/view de origem
  column_order  INTEGER NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  tenant_id     UUID REFERENCES tenants(id)  -- NULL = disponível para todos os tenants
);
```

A regra `programacao.export_layout` define qual layout o tenant usa. As colunas válidas para aquele layout são lidas do catálogo, não do CHECK inline. O CHECK constraint da migration 087 só pode ser removido após:
1. Catálogo criado e populado com todas as colunas atuais dos três layouts existentes.
2. Código de exportação migrado para ler do catálogo.
3. Validação server-side implementada e testada substituindo o CHECK.

---

## 8. Inventário de Tabelas de Histórico por Módulo

Verificado nas migrations para definir onde `applied_rules_snapshot` deve ser adicionado (decisão D4):

| Módulo | Tabela de histórico dedicada? | Conclusão |
|--------|------------------------------|-----------|
| Programação | Sim — `project_programming_history` (migration 101) | Adicionar `applied_rules_snapshot JSONB` nesta tabela na **Fase 5** (próximo número disponível no momento) |
| Medição | Não existe tabela de histórico dedicada (verificado) | Adicionar `applied_rules_snapshot JSONB` em `project_measurement_orders` na **Fase 6** (próximo número disponível) |
| As Built | Não existe tabela de histórico dedicada (verificado) | Adicionar `applied_rules_snapshot JSONB` em `project_asbuilt_measurement_orders` na **Fase 6** (mesmo número da Medição) |
| Faturamento | Não existe tabela de histórico dedicada (verificado) | Adicionar `applied_rules_snapshot JSONB` + `approved_by`/`approved_at` em `project_billing_orders` na **Fase 7** (próximo número disponível) |

---

## 9. Prioridade de Migração por Módulo

| Prioridade | Módulo | Justificativa |
|-----------|--------|--------------|
| 1 | **Programação** | Módulo mais complexo, melhor documentado, maior número de hardcodes identificados. `programacao.require_sgd_fields` é a primeira regra: maior impacto visível (bloqueia tenants sem campos ENEL), campos já são nullable no banco. |
| 2 | **Medição** | Regras de garantia mínima e vínculo com programação variam por contrato; `minimum_billing` já é calculado por RPC com lógica de `team_type` e `score_target` que pode mudar por tenant. |
| 3 | **Faturamento** | Tem duplicação da regra de 10 chars e pode precisar de aprovação pré-faturamento para alguns contratos; `faturamento.require_approval_before_billing` tem criticality `critical`. Requer adição de colunas de aprovação em `project_billing_orders`. |
| 4 | **Mapa Programação** | Consome dados de Programação; a lógica de exibição de CONCLUIDO/ANTECIPADO deve ser consistente com `programacao.intermediate_completion_policy`. |
| 5 | **Projetos** | Regra de vínculo obrigatório com contrato pode variar; menor impacto imediato. |
| 6 | **Equipes / Composição** | `equipes.enforce_unique_foreman_per_team` já existe no banco (migration 054); migração simples. |
| 7 | **Apuração Fator Mínimo / Meta** | Dependem de Medição; migrar após Medição estar estabilizada. |
| 8 | **Estoque / Estornos** | Menor variação entre tenants identificada; pode aguardar. |
| 9 | **Dashboards** | São read-only; não têm regras de escrita para migrar. |
| 10 | **Cadastros (Cargo, Pessoas, Materiais, Atividades)** | Regras simples e uniformes entre tenants. |
