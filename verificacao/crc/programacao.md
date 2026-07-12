# CRC — Programação

> Atualizado: 2026-06-27 | Módulo de maior complexidade do sistema.
> Arquivo de referência obrigatória antes de qualquer alteração nesta tela.

---

## Visão Geral

**Tela:** Programação (Board de programação de equipes)
**Rota:** `/programacao-simples`
**Page Key:** `programacao-simples`
**Arquivo de documentação:** `docs/` (verificar arquivo correspondente)

**O que faz:**
> Permite programar, reprogramar, adiar e cancelar a execução de projetos por equipes em datas específicas.
> É a tela operacional mais crítica do sistema — uma programação incorreta afeta medição, faturamento e histórico.

---

## Arquivos do Módulo

| Arquivo | Responsabilidade |
|---|---|
| `src/app/(dashboard)/programacao-simples/page.tsx` | Entry point |
| `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | Componente principal — **2.160 linhas** |
| `src/modules/dashboard/programacao-simples/types.ts` | Tipos da tela |
| `src/modules/dashboard/programacao-simples/constants.ts` | Constantes (PAGE_SIZE, HISTORY_PAGE_SIZE, labels) |
| `src/modules/dashboard/programacao-simples/utils.ts` | Utilitários (formatDate, getDisplayProgrammingStatus, normalizeHistoryItemsForDisplay, etc.) |
| `src/modules/dashboard/programacao-simples/api.ts` | Chamadas à API (saveProgramming, cancelProgramming, postponeProgramming, copyProgrammingToDates, fetchProgrammingHistory, etc.) |
| `src/modules/dashboard/programacao-simples/hooks.ts` | Hooks de dados e domínio (ver abaixo) |
| `src/modules/dashboard/programacao-simples/validators.ts` | Validações de payload (buildReasonText, isReasonSelectionValid, buildConflictAlertDetails, etc.) |
| `src/modules/dashboard/programacao-simples/exports.ts` | Builders de CSV/XLSX (buildProgrammingCsvContent, buildEnelCsvContent, etc.) |
| `src/modules/dashboard/programacao-simples/components.tsx` | Modais e painéis (ProgrammingCancelModal, ProgrammingHistoryModal, etc.) |
| `src/app/api/programacao/route.ts` | Route Handler — **661 linhas** (lógica delegada para server/modules) |
| `src/server/modules/programacao/catalogs.ts` | Busca de catálogos (reason, sgd, eq, work completion) |
| `src/server/modules/programacao/selects.ts` | Queries de programação, projetos, equipes |
| `src/server/modules/programacao/rpc.ts` | Chamadas RPC ao banco (salvar, concorrência, histórico) |
| `src/server/modules/programacao/types.ts` | Tipos server-side |
| `supabase/migrations/273_define_programming_group_id.sql` | Define `project_programming.programming_group_id` e recria RPCs de grupo |
| `supabase/migrations/274_transactional_copy_programming_to_dates_selected_teams.sql` | Garante COPY_TO_DATES atomico para multiplas datas/equipes |
| `supabase/migrations/275_harden_programming_stage_state_integrity.sql` | Garante que programacao ativa tenha exatamente uma classificacao valida de ETAPA |
| `supabase/migrations/276_fix_anticipated_reopen_copy_and_group_ownership.sql` | Garante CONCLUIDO unico por projeto, encerra ANTECIPADO como ANTICIPADA, bloqueia copia retroativa e blinda programming_group_id |
| `supabase/migrations/277_normalize_partial_and_completed_work_status.sql` | Normaliza PARCIAL legado, fecha catalogo canonico de Estado Trabalho e bloqueia CONCLUIDO com outra linha ativa no mesmo grupo |
| `scripts/audit-programming-operational-groups-readonly.sql` | Auditoria read-only de Projeto + Data com múltiplas ETAPAs ativas |

**Hooks em `hooks.ts`:**

| Hook | Estado gerenciado | Responsabilidade |
|---|---|---|
| `useProgrammingBoardData` | schedules, projects, teams, filters, loading | Busca e atualização do board |
| `useProgrammingActivityCatalog` | activities, support options, sgd/eq catalogs | Catálogos do formulário |
| `useProgrammingEtapaSuggestion` | etapa sugerida | Sugestão automática de etapa |
| `useHistoryModal` | historyTarget, historyItems, historyPage, isLoadingHistory | Histórico de alterações por programação |
| `useCancelModal` | cancelTarget, cancelReasonCode/Notes, isCancelling | Modal de cancelamento |
| `usePostponeModal` | postponeTarget, postponeReasonCode/Notes, postponeDate, isPostponing | Modal de adiamento |
| `useCopyToDatesModal` | copyToDatesTarget, copyToDatesRows, isCopyingToDates | Modal de cópia para múltiplas datas |

---

## API Routes Utilizadas

| Método | Endpoint | O que faz | Queries estimadas |
|---|---|---|---|
| GET | `/api/programacao` | Carrega projetos, equipes, programações da semana, catálogos | 10-15 queries |
| POST | `/api/programacao` | Salvar, copiar, criar em lote, cancelar programação | 3-8 queries + RPC |
| PUT | `/api/programacao` | Atualizar programação existente | 2-5 queries + RPC |
| DELETE | `/api/programacao` | Cancelar programação | RPC |

---

## Tabelas Supabase Acessadas

| Tabela | Operação | Filtros principais | Status índice |
|---|---|---|---|
| `project_with_labels` (view) | SELECT | tenant_id, is_active, is_test | verificar |
| `project_programming` | SELECT/RPC | tenant_id, execution_date (range), team_id | ❌ verificar índice (tenant_id, execution_date) |
| `project_programming_activities` | SELECT | tenant_id, programming_id, is_active | verificar |
| `project_programming_history` | SELECT/INSERT | tenant_id, programming_id, action_type | verificar |
| `teams` | SELECT | tenant_id, ativo | verificar |
| `team_types` | SELECT | tenant_id | verificar |
| `people` | SELECT | tenant_id, id IN [...] | verificar |
| `project_service_centers` | SELECT | tenant_id | verificar |
| `programming_support_items` | SELECT | tenant_id, is_active | verificar |
| `programming_sgd_types` | SELECT | tenant_id, is_active | sem índice necessário (pequena) |
| `programming_eq_catalog` | SELECT | tenant_id, is_active | sem índice necessário (pequena) |
| `programming_reason_catalog` | SELECT | tenant_id, is_active | sem índice necessário (pequena) |
| `programming_work_completion_catalog` | SELECT | tenant_id, is_active | sem índice necessário (pequena) |
| `project_location_plans` | SELECT | tenant_id, project_id IN [...] | verificar |
| `app_users` | SELECT | tenant_id, id IN [...] | verificar |

---

## Regras de Negócio Principais

1. **Conflito de horário:** Uma equipe não pode ter duas programações que se sobrepõem em horário no mesmo dia. Checar antes de salvar — idealmente com constraint no banco.
2. **Projeto concluído:** `CONCLUIDO` e global do projeto. Nao permitir nova programacao em projeto com status CONCLUIDO sem reabrir e nao permitir mais de um `CONCLUIDO` ativo por `tenant_id + project_id`.
3. **Concorrência:** PUT exige `expectedUpdatedAt`. Conflito retorna 409 com `currentRecord`, `currentUpdatedAt`, `updatedBy` e `changedFields`.
4. **Histórico na mesma transação:** O histórico de alteração deve ser gravado na mesma RPC que a programação.
5. **Lote atômico:** Criação em lote (BATCH_CREATE) deve ser atômica — rollback total se qualquer item falhar.
6. **Cancelamento vs Adiamento:** São operações distintas. Adiada cria nova programação. Cancelada apenas encerra.
7. **Etapas:** A sequência de `etapa_number` deve ser respeitada. Não salvar etapa posterior antes da anterior.
8. **Atividades são opcionais:** `project_programming_activities` pode ter zero registros por programação — comportamento válido. Operadores não preenchem atividades na prática. O RPC aceita `p_activities = []` e soft-deletes existentes sem erro. Não requer backfill.
9. **Grupo operacional:** `programming_group_id` é a fronteira única para cancelamento de grupo, adiamento de grupo, sincronização operacional e duplicidade em adicionar equipe. A derivação é: ETAPA numérica por tenant/projeto/data/etapa, ETAPA ÚNICA por tenant/projeto/data/flag, ETAPA FINAL por tenant/projeto/data/flag e registros históricos sem etapa em grupo próprio.
10. **COPY_TO_DATES atomico:** Cópia para múltiplas datas/equipes deve usar `copy_project_programming_to_dates` transacional. Se uma equipe/data falhar por conflito, etapa ou rastreio de ANTECIPADO, nenhuma linha nova, lote ou histórico parcial pode permanecer.
11. **Integridade estrita de ETAPA ativa:** Programacao `PROGRAMADA`/`REPROGRAMADA` deve estar em exatamente um estado: `etapa_number > 0` sem flags, `ETAPA UNICA` ou `ETAPA FINAL`. ETAPA 0, ETAPA negativa, ETAPA numerica com flag e `ETAPA UNICA + ETAPA FINAL` sao bloqueadas no banco por constraint trigger diferida.
12. **Revalidacao de ANTECIPADO:** `ANTECIPADO` encerra operacionalmente a linha como `ANTECIPADA`, com `is_active = false`, para liberar agenda. Ao reabrir o unico `CONCLUIDO`, linhas vinculadas voltam ao `previous_work_completion_status` e `previous_operational_status`. Reatribuicao para outro `CONCLUIDO` e tolerancia para dado legado inconsistente, nao fluxo normal. Copia normal de projeto concluido nao tem excecao para origem `ANTECIPADO`. A migration 276 saneia duplicados legados de `CONCLUIDO`, mantendo um canônico por tenant/projeto e registrando historico nas linhas limpas.

---

## Pontos de Atenção (Riscos)

- [x] **CRÍTICO:** Verificação de conflito de horário era feita via SELECT antes de INSERT, sem lock. → Resolvido: trigger + pg_advisory_xact_lock (migration 232).
- [x] **ALTO:** 5 queries fallback sequenciais em `fetchProgrammingRows` por incompatibilidade de schema. → Resolvido: migration aplicada, fallbacks removidos.
- [x] **ALTO:** Route Handler com 4.519 linhas. → Resolvido: 661 linhas; lógica delegada para `src/server/modules/programacao/`.
- [x] **ALTO:** PageView com 2.619 linhas. → Parcialmente resolvido: 2.160 linhas após extração de 4 hooks de modal. Meta: abaixo de 1.000.
- [x] **MÉDIO:** Projetos e equipes carregados sem paginação → aceitável enquanto tenant tiver volume controlado; indexes adicionados.
- [ ] **MÉDIO:** PageView ainda em 2.160 linhas — acima do limite de 1.000 do AGENTS.md. Próxima extração: hooks de formulário e de board.
- [ ] Catálogos (sgd_types, eq_catalog, reason_catalog) são buscados a cada GET — candidatos a cache de curto prazo.

---

## Colaboradores (dependências)

| Módulo / Arquivo | Como usa |
|---|---|
| `src/lib/server/appUsersAdmin.ts` | Auth + tenant em toda rota (singleton admin + cache TTL 45s) |
| `src/lib/server/pageAuthorization.ts` | Validação de page_key=programacao-simples |
| `src/lib/server/concurrency.ts` | `hasUpdatedAtConflict`, `buildConcurrencyConflictResponse` |
| `src/lib/server/locationPlanning.ts` | Defaults de apoio da locação do projeto |
| `src/lib/server/apiHelpers.ts` | `parsePagination`, `parsePositiveInteger`, `normalizeText` e outros utilitários de rota |

---

## Fluxo de GET (carregamento da tela)

```
Browser → GET /api/programacao?startDate=...&endDate=...
  1. resolveAuthenticatedAppUser (4 queries de auth)
  2. requirePageAction (1 query de permissão)
  3. fetchProjects (project_with_labels — sem paginação)
  4. fetchTeams (teams + team_types + people + service_centers — 4 queries paralelas)
  5. fetchSupportOptions (programming_support_items)
  6. fetchProgrammingRows (project_programming — até 5 tentativas fallback!)
  7. fetchProgrammingActivities (project_programming_activities)
  8. fetchRescheduledProgrammingIds (project_programming_history)
  9. fetchProgrammingWeekSummary (RPC get_programming_week_summary)
  10. fetchProjectSupportDefaults (project_location_plans)
  11. fetchProgrammingSgdTypes + fetchProgrammingEqCatalog + fetchProgrammingReasonCatalog + fetchProgrammingWorkCompletionCatalog (4 queries de catálogo)

Total: ~15-20 queries por request de GET
```

---

## Histórico de Mudanças Estruturais

| Data | O que mudou |
|---|---|
| 2026-06-07 | Auditoria: identificados riscos de sobreposição, fallback de schema e arquivo acima do limite |
| 2026-06-10 | Migration 232: trigger + pg_advisory_xact_lock resolve sobreposição de horário |
| 2026-06-10 | Fallbacks de schema removidos; route.ts reduzido de 4.519 → 661 linhas; lógica em server/modules/programacao/ |
| 2026-06-21 | ProgrammingSimplePageView.tsx: 2.619 → 2.160 linhas; extraídos 4 hooks de modal (useHistoryModal, useCancelModal, usePostponeModal, useCopyToDatesModal) para hooks.ts |
| 2026-06-21 | Investigação de project_programming_activities: zero registros confirmado como comportamento esperado — atividades são opcionais e não usadas operacionalmente |
| 2026-06-27 | Migration 273 adiciona `programming_group_id`, backfill por etapa/flags, trigger de atribuição e RPCs de cancelamento, adiamento e sincronização operacional usando a mesma fronteira de grupo |
| 2026-06-27 | Migration 274 recria `copy_project_programming_to_dates` para copiar multiplas datas/equipes em uma unica transacao, removendo compensacao por cancelamento de linhas ja criadas |
| 2026-06-27 | Migration 275 endurece a validacao diferida de ETAPA ativa para bloquear combinacoes invalidas em escrita direta, RPC, importacao e edicao |
| 2026-06-27 | Migration 276 saneia duplicados legados, força constraints diferidas antes do indice unico, garante CONCLUIDO unico por projeto, encerra ANTECIPADO como ANTICIPADA para liberar agenda, bloqueia copia para data anterior/igual com patch idempotente da RPC, remove excecao de copia em projeto concluido e impede alteracao direta de programming_group_id |
| 2026-06-27 | Migration 277 normaliza PARCIAL legado para PARCIAL_NAO_PLANEJADO, desativa catalogo PARCIAL, recria trigger texto/UUID de Estado Trabalho, troca sincronizacao generica para programming_group_id sem propagar CONCLUIDO/ANTECIPADO e bloqueia CONCLUIDO quando houver outra linha ativa no mesmo programming_group_id |
