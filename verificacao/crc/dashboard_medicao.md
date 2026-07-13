# CRC — Dashboard de Medição

> Atualizado: 2026-06 | Endpoint mais pesado do sistema em número de queries e volume de dados.

---

## Visão Geral

**Tela:** Dashboard de Medição
**Rota:** `/dashboard-medicao`
**Page Key:** `dashboard-medicao`
**Arquivo de documentação:** Verificar `docs/`

**O que faz:**
> Exibe indicadores de performance de medição por ciclo, equipe, encarregado e supervisor.
> Consolida dados de ordens de medição, metas de ciclo, status de conclusão de programação e histórico de equipes.
> É uma tela de leitura — não grava dados.

---

## Arquivos do Módulo

| Arquivo | Responsabilidade |
|---|---|
| `src/app/(dashboard)/dashboard-medicao/page.tsx` | Entry point |
| `src/modules/dashboard/dashboard-medicao/DashboardMedicaoPageView.tsx` | Componente principal |
| `src/app/api/dashboard-medicao/route.ts` | Delega para controller |
| **`src/server/modules/dashboard-measurement/controller.ts`** | **Toda a lógica — 1.179 linhas** |
| `src/server/modules/dashboard-measurement/index.ts` | Exporta `handleDashboardMeasurementGet` |
| `src/server/modules/team-performance/calculations.ts` | Cálculos de performance por equipe |
| `src/server/modules/team-performance/contracts.ts` | Tipos e contratos |
| `src/server/modules/team-performance/index.ts` | Exporta `calculateTeamPerformanceWindow` |

---

## API Routes Utilizadas

| Método | Endpoint | O que faz | Queries |
|---|---|---|---|
| GET | `/api/dashboard-medicao` | Carrega todo o dashboard | **12-14 queries** |
| GET | `/api/dashboard-equipes` | Versão para equipes (reutiliza mesmo handler) | **10-12 queries** |

---

## Tabelas Supabase Acessadas (por request)

| Tabela | Operação | Filtros | Limite | Status |
|---|---|---|---|---|
| `project_measurement_orders` | SELECT (COM_PRODUCAO) | tenant_id, is_active, measurement_kind, status | **10.000** ⚠️ | sem filtro de data |
| `project_measurement_orders` | SELECT (SEM_PRODUCAO) | tenant_id, is_active, measurement_kind, status, min_billing > 0 | **10.000** ⚠️ | sem filtro de data |
| `project` | SELECT | tenant_id, id IN [...] | sem limite | OK |
| `project_service_centers` | SELECT | tenant_id, id IN [...] | sem limite | OK |
| `project_programming` | SELECT | tenant_id, project_id IN [...], execution_date <= endDate | sem limite | verificar índice |
| `teams` | SELECT | tenant_id, id IN [...] | sem limite | OK |
| `teams` | SELECT (ativos) | tenant_id, ativo=true | sem limite | **query duplicada** ⚠️ |
| `team_type_history` | SELECT | tenant_id, team_id IN [...] | sem limite | verificar |
| `team_foreman_history` | SELECT | tenant_id, team_id IN [...] | sem limite | verificar |
| `team_types` | SELECT | tenant_id, id IN [...] | sem limite | OK |
| `people` | SELECT | tenant_id, id IN [...] | sem limite | OK |
| `project_measurement_order_items` | SELECT | tenant_id, is_active, order_id IN [...] | chunks de 200 IDs | verificar |
| `measurement_cycle_workdays` | SELECT | tenant_id, cycle_start | 1 | OK |
| `measurement_cycle_target_items` | SELECT | tenant_id, cycle_id | sem limite | OK |

---

## Regras de Negócio Principais

1. **Ciclo de medição:** Começa no dia 21 e termina no dia 20 do mês seguinte.
2. **Filtro padrão:** Ciclo atual (calculado dinamicamente pelo `resolveCycleStart`).
3. **Ordens de teste:** Projetos com `is_test=true` são excluídos dos cálculos de produção.
4. **Tipos de medição:** `COM_PRODUCAO` são as medições reais; `SEM_PRODUCAO` são garantias de faturamento mínimo.
5. **Conclusão de programação:** Derivada do histórico de `project_programming` até o fim do ciclo, não do snapshot.
6. **Meta por tipo de equipe:** Calculada em `calculateTeamPerformanceWindow` — sensível a mudanças.

---

## Pontos de Atenção (Riscos)

- [x] **CRÍTICO:** `.limit(10000)` em duas queries de orders SEM filtro de data — traz histórico inteiro do tenant.
- [x] **ALTO:** Duas queries separadas de `teams` (visíveis + ativas) — podem ser unificadas.
- [x] **MÉDIO:** Filtros de ciclo/período aplicados em JavaScript depois de trazer todos os dados.
- [ ] `calculateTeamPerformanceWindow` — lógica complexa, testar antes de qualquer refatoração.
- [ ] Sem cache — cada abertura de tela dispara 12-14 queries ao Supabase.

---

## Fluxo de GET (carregamento do dashboard)

```
Browser → GET /api/dashboard-medicao?cycleStart=...
  1. resolveAuthenticatedAppUser (4 queries de auth)
  2. requirePageAction (1 query de permissão)
  3. SELECT project_measurement_orders (COM_PRODUCAO) — limit 10.000 ❌
  4. SELECT project_measurement_orders (SEM_PRODUCAO) — limit 10.000 ❌
  5. fetchProjectMetaMap → SELECT project + SELECT project_service_centers
  6. fetchProjectCompletionTimeline → SELECT project_programming
  7. SELECT teams (por IDs dos pedidos)
  8. SELECT teams (ativos) ← duplicata ❌
  9. SELECT team_type_history
  10. SELECT team_foreman_history
  11. SELECT team_types
  12. SELECT people
  13. SELECT project_measurement_order_items
  14. SELECT measurement_cycle_workdays
  15. SELECT measurement_cycle_target_items (se ciclo encontrado)

Total: 15 queries, potencial de trazer 20.000 registros brutos
```

---

## Correções Prioritárias

1. Adicionar filtro de data na query de orders (usar `cycleStart` mais antigo do histórico como cutoff)
2. Unificar as duas queries de `teams` em uma
3. Considerar RPC para calcular totais no banco e retornar apenas o resumo final
4. Adicionar cache de curto prazo (2-5 minutos) para dados de ciclo que não mudam durante o dia

---

## Histórico de Mudanças Estruturais

| Data | O que mudou |
|---|---|
| 2026-06 | Criado CRC com identificação dos problemas de performance críticos |
| 2026-07-05 | `project_measurement_order_items` passou a ser lido em chunks de 200 IDs para evitar falha do Dashboard Medicao em recortes com muitas ordens |
