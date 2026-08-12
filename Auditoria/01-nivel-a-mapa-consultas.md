# Nível A — Mapa `Página → API → tabela → filtros → índice`

Análise estática. Nenhuma consulta foi executada contra produção.

---

## 1. Retrato do repositório

| Métrica | Valor | Fonte |
|---|---|---|
| API Routes (`route.ts`) | **90** | `src/app/api/**` |
| Chamadas `.from(...)` no servidor | **989** | `src/app/api`, `src/server`, `src/lib/server` |
| Tabelas distintas acessadas | **105** | mesmo escopo |
| Índices vivos (criados − dropados nas migrations) | **258** | `supabase/migrations/*.sql` |
| Funções/RPC `public.*` | **198** | migrations |
| Views | **3** (`project_with_labels`, `v_stock_conflicts`, `v_stock_conflict_items`) | migrations |
| Materialized views | **0** | migrations |
| Migrations | **371** | `supabase/migrations/` |
| Edge Functions | **18** | `supabase/functions/` |

---

## 2. Modelo de acesso — descoberta que reordena a auditoria

Todas as rotas de API resolvem o usuário via `resolveAuthenticatedAppUser` ([appUsersAdmin.ts:142](../src/lib/server/appUsersAdmin.ts#L142)), que devolve `context.supabase` = cliente criado por `getSupabaseAdmin()` com **`SUPABASE_SERVICE_ROLE_KEY`** ([appUsersAdmin.ts:108](../src/lib/server/appUsersAdmin.ts#L108)).

Consequências, todas verificadas:

- **Nenhuma consulta do frontend vai direto ao PostgREST.** Busca por `.from(` em `src/modules`, `src/hooks`, `src/components` retorna 66 ocorrências, e **todas** são `Array.from(...)`, não Supabase. O cliente só fala com `/api/*`.
- **RLS não está no caminho quente das consultas da aplicação.** `service_role` faz bypass de RLS. As 308 policies continuam sendo a última barreira (e devem continuar existindo), mas **não são a causa do Disk I/O das telas**.
- O isolamento por tenant depende inteiramente do `.eq("tenant_id", context.appUser.tenant_id)` escrito à mão em cada consulta. Isso é um risco de segurança relevante, porém fora do escopo desta auditoria de performance — está registrado como observação em [`05-nivel-d-arquitetura.md`](05-nivel-d-arquitetura.md#8-observação-fora-de-escopo-de-performance).

**Efeito prático:** o item "políticas RLS que executam subqueries ou funções repetidamente" da checklist é **rebaixado de ALTO para INFORMATIVO** neste projeto. Detalhe em [`02-nivel-a-indices.md`](02-nivel-a-indices.md#7-rls--por-que-não-é-o-gargalo-aqui).

---

## 3. Custo fixo por requisição

Todo request de API paga, antes da primeira consulta de negócio:

| Etapa | Consultas | Mitigação existente |
|---|---|---|
| `supabase.auth.getUser(token)` | 1 chamada à Auth API | cache 45 s |
| `app_users` por `auth_user_id` | 1 | cache 45 s |
| `app_roles` por `id` | 1 | cache 45 s |
| `app_user_tenants` por `user_id` | 1 | cache 45 s |
| `requirePageAction` → `app_user_page_permissions` | 1 | **sem cache** |
| `requirePageAction` → `app_pages` | 1 (se não houver permissão de usuário) | **sem cache** |
| `requirePageAction` → `role_page_permissions` | 1 (se cair no fallback de role) | **sem cache** |

O cache de auth ([appUsersAdmin.ts:8](../src/lib/server/appUsersAdmin.ts#L8), TTL 45 s, teto de 500 entradas) cobre as 4 primeiras. `requirePageAction` ([pageAuthorization.ts:79](../src/lib/server/pageAuthorization.ts#L79)) **não tem cache** e roda em cascata: usuário → página → role.

- Usuário admin: 0 consultas (curto-circuito em `context.role.isAdmin`).
- Usuário comum com permissão explícita: **1** consulta.
- Usuário comum caindo no default de role: **3** consultas.

Índices existentes cobrem os três acessos — `idx_app_user_page_permissions_tenant_user (tenant_id, user_id, page_key)`, `idx_app_pages_section (section, page_key)`, `idx_role_page_permissions_tenant_role_id (tenant_id, role_id, page_key)`. São leituras de 1 linha em tabelas pequenas: custo de latência, não de Disk I/O.

> **Severidade: BAIXO / Confiança: Alta.** Não é fonte de I/O. É, porém, +3 round-trips por request em telas que disparam várias chamadas — candidato natural a entrar no mesmo cache de 45 s do auth. Ganho é de latência percebida, não de disco.

---

## 4. Checklist obrigatória — resultado item a item

| # | Item | Resultado | Onde |
|---|---|---|---|
| 1 | Consultas de páginas/APIs/RPC/Edge | ✅ mapeadas — 989 chamadas, 90 rotas | este arquivo |
| 2 | `.select('*')` desnecessário | ✅ **zero ocorrências** — todas as consultas listam colunas | — |
| 3 | Milhares de registros filtrados/agrupados em JS | ❌ **8 rotas** | §6 |
| 4 | `COUNT`/`SUM`/`GROUP BY`/`ORDER BY`/`DISTINCT` em tabelas grandes | ❌ agregação quase toda em JS, não em SQL | §6, [`05`](05-nivel-d-arquitetura.md) |
| 5 | Múltiplas consultas na mesma tabela para cards diferentes | ❌ **6 dashboards** | [`05`](05-nivel-d-arquitetura.md) |
| 6 | N+1 queries | ⚠️ **42 loops com `await`**, quase todos chunking legítimo — 3 exceções | §7 |
| 7 | Paginação no frontend | ❌ **5 telas** | §8 |
| 8 | Filtros sem índice compatível | ❌ **4 achados** | §5 |
| 9 | Índice simples que deveria ser composto | ❌ 2 achados | [`02`](02-nivel-a-indices.md) |
| 10 | Índices duplicados/inúteis | ❌ 2 duplicatas exatas + 2 prefixos redundantes | [`02`](02-nivel-a-indices.md) |
| 11 | FK sem índice útil | ⚠️ exige `pg_indexes` real — script no Nível B | [`03`](03-nivel-b-pg-stat-statements.md) |
| 12 | Índices para `tenant_id` | ✅ **232 dos 258** índices começam por `tenant_id`; os 26 restantes são legítimos | [`02`](02-nivel-a-indices.md) |
| 13 | `tenant_id` + project/team/data/status | ⚠️ padrão dominante — cobertura irregular | §5 |
| 14 | RLS com subquery/função repetida | ℹ️ rebaixado — `service_role` faz bypass | §2 |
| 15 | RPC que varre tabela completa | ⚠️ exige Nível B | [`03`](03-nivel-b-pg-stat-statements.md) |
| 16 | View com agregação cara | ❌ `project_with_labels` — 10 `LEFT JOIN`, 30 usos | §9 |
| 17 | Dashboard que recalcula histórico inteiro | ❌ 3 casos | [`05`](05-nivel-d-arquitetura.md) |
| 18 | Polling/refetch excessivo | ✅ `staleTime: 30s`, `refetchOnWindowFocus: false`, nenhum `refetchInterval` | §10 |
| 19 | Chamadas duplicadas React/Next | ✅ nada encontrado | §10 |
| 20 | Import registro a registro | ❌ 2 rotas | §11 |
| 21 | Migration que piora performance | ⚠️ 1 padrão | [`02`](02-nivel-a-indices.md) |

---

## 5. Mapas por tela — filtros × índice

Ordenados por risco.

### 5.1 `MinimumFactorAnalysisPage` — risco **ALTO**

```
MinimumFactorAnalysisPage
  ↓ src/modules/dashboard/apuracao-fator-minimo/MinimumFactorAnalysisPageView.tsx
/api/apuracao-fator-minimo
  ↓ src/app/api/apuracao-fator-minimo/route.ts
project_measurement_orders                              (route.ts:356)
  filters:
    tenant_id
    is_active         = true
    measurement_kind  = 'COM_PRODUCAO'
    execution_date    [range]
    project_id        [in]  ← chunks de 100
    team_id           [in]  (opcional)
    status            (opcional)
  order:  execution_date, team_name_snapshot
  paginação: .range() em páginas de 1000, em laço, por chunk de projeto
```

**Índices atuais em `project_measurement_orders`:**

| Índice | Colunas |
|---|---|
| `idx_project_measurement_orders_tenant_kind_active_status` | `(tenant_id, measurement_kind, is_active, status)` |
| `idx_project_measurement_orders_tenant_exec_status` | `(tenant_id, execution_date, status, updated_at desc)` |
| `idx_project_measurement_orders_context_lookup` | `(tenant_id, project_id, team_id, execution_date)` |
| `idx_project_measurement_orders_tenant_exec_updated` | `(tenant_id, execution_date desc, updated_at desc)` |
| `idx_project_measurement_orders_tenant_project_team` | `(tenant_id, project_id, team_id, updated_at desc)` |

**Problema:** nenhum índice combina as igualdades reais (`measurement_kind`, `is_active`, `status`) **com** `execution_date` no fim.

- `..._tenant_kind_active_status` tem as igualdades certas mas **não tem `execution_date`** → o range vira filtro pós-índice, gerando `Rows Removed by Filter`.
- `..._tenant_exec_status` põe `execution_date` (range) **na 2ª posição** → tudo depois dele é inutilizado para busca.
- `..._context_lookup` tem `team_id` no meio; quando a tela não filtra equipe, o `execution_date` da 4ª posição não é usado para seek.

**`CANDIDATE — awaiting pg_stat_statements / EXPLAIN`** (não criar ainda — ver [`02` §8](02-nivel-a-indices.md#8-índices--candidatos-não-faltantes)):

```sql
-- CANDIDATO. Não aplicar antes do Nível B confirmar frequência
-- e do Nível C confirmar mudança de plano.
create index concurrently if not exists idx_project_measurement_orders_kind_active_status_exec
  on public.project_measurement_orders
  (tenant_id, measurement_kind, is_active, status, execution_date);
```

**Motivo do risco ALTO:** este é o padrão de filtro **mais repetido do repositório** em `project_measurement_orders` — 4 ocorrências idênticas (`meta/route.ts:304`, `meta/route.ts:508`, `dashboard-measurement/controller.ts:678`, `dashboard-measurement/controller.ts:1116`) mais 2 variantes com `project_id[in]`. Consulta frequente + intervalo de data + tenant + IN de projeto, paginada em páginas de 1000 e agregada em JavaScript.

---

### 5.2 `DashboardMeasurementPage` — risco **ALTO**

```
DashboardMeasurementPage
  ↓ /api/dashboard-medicao
  ↓ src/server/modules/dashboard-measurement/controller.ts   (1.701 linhas, 38 consultas, 12 tabelas)
project_measurement_orders        controller.ts:609, 678, 719, 1116
project_measurement_order_items   chunks de 200
teams / team_types / team_type_history / people / measurement_score_targets /
measurement_cycle_workdays / measurement_team_type_targets / ...
```

Consulta em `controller.ts:719` adiciona `minimum_billing_amount [range]` ao conjunto acima. Existe índice parcial `idx_project_measurement_orders_minimum_billing (tenant_id, minimum_billing_amount) where minimum_billing_amount > 0`, mas ele não carrega nem `execution_date` nem `measurement_kind` — o planner terá de escolher entre um índice e outro, nunca os dois.

Mesma recomendação de 5.1 resolve as 4 consultas.

---

### 5.3 `OperationalBillingDashboardPage` — risco **ALTO**

```
OperationalBillingDashboardPage
  ↓ /api/dash-operacional-faturamento
  ↓ src/app/api/dash-operacional-faturamento/route.ts   (2.398 linhas, 40 consultas, 9 tabelas)
project_with_labels               route.ts:500   filters: tenant_id, is_active   order: sob, id
project_measurement_orders        route.ts:728   filters: tenant_id, is_active, measurement_kind, status, project_id[in]
project_measurement_order_items   route.ts:682   filters: tenant_id, is_active, measurement_order_id[in]   order: id
paginação: QUERY_PAGE_SIZE = 1000, FILTER_CHUNK_SIZE = 100
```

40 consultas numa rota só. Ver [`05-nivel-d-arquitetura.md`](05-nivel-d-arquitetura.md).

---

### 5.4 `DashEstoquePage` — risco **ALTO**

```
DashEstoquePage
  ↓ /api/dash-estoque
  ↓ src/app/api/dash-estoque/route.ts   (1.126 linhas, 29 consultas, 12 tabelas)

stock_transfers            route.ts:365   tenant_id + entry_date[range]   order: entry_date, id
                                          .range() em páginas de 1000 até DASH_TRANSFERS_MAX_ROWS = 20.000
stock_transfer_items       route.ts:391   tenant_id + stock_transfer_id[in]  (chunks de 100)
materials                  route.ts:~420  tenant_id + is_active + id[in]     (chunks de 500)
stock_transfer_team_operations, project, teams, stock_center_balances,
stock_transfer_reversals, stock_transfer_item_reversals
```

**Até 20.000 movimentações trazidas para a memória do Node**, mais itens, materiais, equipes, projetos e conjuntos de estorno — tudo para agregar em JavaScript.

> ✅ **P0.1 corrigido em 2026-08-12:** estourar o teto deixou de truncar em silêncio e passou a devolver **HTTP 422**. O teto continua existindo até a agregação subir para o banco (P2.1).

Índice atual `idx_stock_transfers_tenant_entry_date (tenant_id, entry_date desc, created_at desc)` atende o filtro e o `ORDER BY entry_date`, mas a ordenação da rota é `entry_date ASC, id ASC` — o `id` não está no índice, então há uma ordenação residual, e o `OFFSET` crescente do laço (`.range(offset, offset+999)`) força o Postgres a **reprocessar e descartar** todas as linhas anteriores a cada página. Na página 20 isso significa varrer 19.000 linhas para devolver 1.000.

**Recomendado:** trocar `OFFSET` por keyset pagination (`.gt("id", lastId)` dentro da mesma data) **ou**, melhor, mover a agregação para RPC — ver [`05`](05-nivel-d-arquitetura.md).

---

### 5.5 `programming` (Programação Normalizada) — risco **MÉDIO-ALTO**

```
/api/programacao-normalizada, /api/medicao, /api/mapa-programacao
  ↓ src/server/modules/programacao-normalizada/queries.ts
programming
  padrão dominante:  tenant_id + status + project_id[in]                    (2×)
                     tenant_id + status + project_id[in] + execution_date[range]  (2×)
  order: project_id, execution_date, updated_at
```

**Índices atuais em `programming`:** `(tenant_id, status, execution_date desc)`, `(tenant_id, work_completion_status)`, `(tenant_id, work_completion_status, execution_date)`, `(tenant_id, is_pendencia) partial`, mais 3 uniques parciais em `(tenant_id, project_id, …)`.

**Problema:** o filtro mais usado é `tenant_id + project_id[in] + status`, e nenhum índice não-parcial começa por `(tenant_id, project_id)`. Os uniques que começam assim têm `WHERE status IN ('PROGRAMADA','REPROGRAMADA')` e `execution_date is not null` — só servem quando a consulta cai exatamente dentro do predicado parcial.

**`CANDIDATE — awaiting pg_stat_statements / EXPLAIN`**:

```sql
-- CANDIDATO. Não aplicar antes do Nível B + C.
create index concurrently if not exists idx_programming_tenant_project_status_exec
  on public.programming
  (tenant_id, project_id, status, execution_date);
```

Cobre as 4 variantes (com e sem range de data), na ordem correta.

---

### 5.6 `project_billing_orders` — risco **MÉDIO**

```
/api/faturamento  →  faturamento/route.ts:583
  filters: tenant_id
  order:   updated_at
```

Índices atuais: `(tenant_id, status, updated_at desc)`, `(tenant_id, project_id, updated_at desc)`, `(tenant_id, ingresso_date desc)`. Nenhum é `(tenant_id, updated_at)`. Uma listagem sem filtro de status paga uma ordenação — candidata a `Sort Method: external merge` quando a tabela crescer (causa raiz #1).

**`CANDIDATE — awaiting pg_stat_statements / EXPLAIN`**, com a evidência mais fraca das quatro (1 consulta só). Confirmar no Nível C se o plano usa `..._tenant_status_updated` com `Seq Scan` + `Sort`. Se sim:

```sql
-- CANDIDATO de baixa prioridade. Provavelmente não se paga.
create index concurrently if not exists idx_project_billing_orders_tenant_updated
  on public.project_billing_orders (tenant_id, updated_at desc);
```

> Confiança: Média. Só criar depois de medir — a tabela pode ser pequena o bastante para o `Sort` ser irrelevante.

---

## 6. Milhares de registros carregados para agregar em JavaScript

| Rota | Teto de linhas | Constante |
|---|---|---|
| `dash-estoque/route.ts` | **20.000** movimentações + itens/materiais/equipes | `DASH_TRANSFERS_MAX_ROWS = 20000` ([:149](../src/app/api/dash-estoque/route.ts#L149)) |
| `apuracao-fator-minimo/route.ts` | ilimitado (laço de páginas de 1.000) | `QUERY_PAGE_SIZE = 1000` ([:8](../src/app/api/apuracao-fator-minimo/route.ts#L8)) |
| `dash-operacional-faturamento/route.ts` | ilimitado (laço de páginas de 1.000) | `QUERY_PAGE_SIZE = 1000` ([:419](../src/app/api/dash-operacional-faturamento/route.ts#L419)) |
| `dashboard-portfolio/controller.ts` | ilimitado | `QUERY_PAGE_SIZE = 1000` ([:9](../src/server/modules/dashboard-portfolio/controller.ts#L9)) |
| `estornos/route.ts` | **5.000** | `REVERSAL_QUERY_LIMIT = 5000` ([:216](../src/app/api/estornos/route.ts#L216)) |
| `programacao-normalizada/queries.ts` | **5.000** × 2 | `PROJECT_WORK_COMPLETION_ROW_LIMIT`, `MAP_STAGE_ROW_LIMIT` |
| `programacao-normalizada/route.ts` | **5.000** (export) | `STAGE_LIST_EXPORT_MAX_ROWS` |
| `team-stock-balance/route.ts` | ilimitado | `QUERY_PAGE_SIZE = 1000` |

Nenhuma dessas rotas usa `COUNT`, `SUM`, `AVG` ou `GROUP BY` do PostgreSQL — **toda agregação é feita em JavaScript**. Isso troca CPU/RAM barata do Postgres por I/O de disco (ler todas as linhas), rede (trafegar todas as linhas) e RAM do Node.

> **Severidade: ALTO / Confiança: Alta.** É o achado estrutural desta auditoria. Detalhado em [`05-nivel-d-arquitetura.md`](05-nivel-d-arquitetura.md).

---

## 7. N+1 queries

42 laços com `await` de consulta no corpo. A esmagadora maioria é **chunking legítimo** — quebrar um `IN (...)` de 3.000 ids em blocos de 100/200/500 para não estourar o limite de URL do PostgREST. Isso é `⌈N/100⌉` consultas, não `N` consultas: não é N+1.

Casos que merecem atenção:

| Local | Padrão | Avaliação |
|---|---|---|
| [`apuracao-fator-minimo/route.ts:356`](../src/app/api/apuracao-fator-minimo/route.ts#L356) | laço de chunk de projeto **× laço de paginação de 1.000** | **aninhamento duplo** — nº de consultas = chunks × páginas. Com 500 projetos e 5.000 ordens: 5 chunks × N páginas cada. ALTO |
| [`dash-estoque/route.ts:363`](../src/app/api/dash-estoque/route.ts#L363) | `OFFSET` crescente até 20.000 | 20 consultas com custo crescente de descarte. ALTO |
| [`consumo-projeto/route.ts:256`](../src/app/api/consumo-projeto/route.ts#L256) | 4 laços em sequência sobre as mesmas ids | consolidável. MÉDIO |
| [`team-stock-balance/route.ts:392-393`](../src/app/api/team-stock-balance/route.ts#L392) | dois laços adjacentes sobre o mesmo conjunto | consolidável. MÉDIO |
| [`dashboard-portfolio/controller.ts:438,487`](../src/server/modules/dashboard-portfolio/controller.ts#L438) | chunk de `project_id` → chunk de itens | chunking legítimo. BAIXO |

> **Confiança: Alta** para os dois primeiros (código lido), **Média** para os demais (padrão detectado por heurística, cabe leitura caso a caso).

---

## 8. Paginação feita no frontend

| Tela | Linha | Efeito |
|---|---|---|
| `MinimumFactorAnalysisPageView.tsx` | [:243](../src/modules/dashboard/apuracao-fator-minimo/MinimumFactorAnalysisPageView.tsx#L243) `rows.slice(...)` | backend devolve **todas** as linhas do período; frontend mostra 1 página |
| `OperationalBillingDashboardPageView.tsx` | [:515](../src/modules/dashboard/dash-operacional-faturamento/OperationalBillingDashboardPageView.tsx#L515) | idem |
| `DashboardPortfolioPageView.tsx` | [:142](../src/modules/dashboard/dashboard-carteira-operacional/DashboardPortfolioPageView.tsx#L142) | idem |
| `LocationPageView.tsx` | [:337](../src/modules/dashboard/locacao/LocationPageView.tsx#L337) | idem |
| `mapa-programacao/components/ProjectTable.tsx` | [:24](../src/modules/dashboard/mapa-programacao/components/ProjectTable.tsx#L24) | idem |

Ressalva importante: quando o backend já agregou para poucas dezenas de linhas, paginar em memória é correto e barato. O problema é a combinação **backend pagina em blocos de 1.000 → devolve tudo → frontend fatia**. Nas cinco telas acima, é o que acontece.

Contraexemplo saudável: `stock-requisitions/route.ts` usa `DEFAULT_PAGE_SIZE = 20` com `.range()` real no banco.

---

## 9. View `project_with_labels`

- **10 `LEFT JOIN`** sobre tabelas de lookup (`project_service_centers`, `contract`, `project_service_types`, `project_priorities`, `voltage_levels`, `project_sizes`, `people`, `utility_responsibles`, `utility_field_managers`, `municipalities`).
- **30 usos** em 14 arquivos diferentes.
- `with (security_invoker = true)` — correto para multi-tenant.
- Sem agregação (`GROUP BY`), o que limita o dano: o planner consegue empurrar os filtros para `project`.

**Padrões de acesso encontrados (12 distintos):**

| Filtros | Ocorrências | `ORDER BY` |
|---|---|---|
| `tenant_id + is_active` | 6 | `sob`, `sob,id` |
| `tenant_id + id` | 6 | — |
| `tenant_id` | 4 | `updated_at`, `id` |
| `tenant_id + is_active + is_third_party` | 3 | `sob` |
| `tenant_id + is_active + is_test + is_third_party` | 2 | `sob`, `execution_deadline` |
| `tenant_id + is_test` | 2 | `id` |
| `tenant_id + is_third_party + sob~` (ilike) | 1 | — |

**Índices atuais em `project`** relevantes: `idx_project_tenant_is_active (tenant_id, is_active, updated_at desc)`, `idx_project_tenant_is_test`, `idx_project_tenant_is_third_party`, `idx_project_tenant_active_test_deadline (tenant_id, is_active, is_test, execution_deadline)`, `ux_project_tenant_sob_upper (tenant_id, upper(sob))`.

**Problema:** o `ORDER BY sob` — o mais frequente — não é atendido por nenhum índice (`ux_project_tenant_sob_upper` indexa `upper(sob)`, não `sob`). Toda listagem paga um `Sort` sobre o resultado de um join de 11 tabelas. Com `.range()` por cima, é o cenário clássico de `external merge` (causa raiz #1).

**`CANDIDATE — awaiting pg_stat_statements / EXPLAIN`**:

```sql
-- CANDIDATO. Não aplicar antes do Nível B + C-2.
create index concurrently if not exists idx_project_tenant_active_test_third_sob
  on public.project (tenant_id, is_active, is_test, is_third_party, sob);
```

O filtro `sob~` (`ilike '%…%'`) em [`cronograma-solicitacoes/queries.ts:226`](../src/server/modules/cronograma-solicitacoes/queries.ts#L226) **não é indexável** por B-tree por causa do curinga à esquerda. Se essa busca for frequente, o caminho é `pg_trgm` + índice GIN; caso contrário, deixar como está.

> **Severidade: MÉDIO / Confiança: Média.** Depende do tamanho real de `project`, que só o Nível B informa.

---

## 10. Frontend — refetch e chamadas duplicadas

✅ **Nenhum achado.** Configuração em [`src/lib/react-query/provider.tsx`](../src/lib/react-query/provider.tsx):

```ts
refetchOnWindowFocus: false,
staleTime: 30_000,
```

- Nenhum `refetchInterval` em todo o `src/` — não há polling.
- Nenhum `gcTime` customizado; o padrão do React Query serve.
- Nenhuma chamada duplicada por `useEffect` sem deps detectada.

Este é o item da checklist em melhor estado no projeto.

---

## 11. Imports registro a registro

| Rota | Comportamento | Severidade |
|---|---|---|
| [`stock-transfers/import/route.ts:188`](../src/app/api/stock-transfers/import/route.ts#L188) | `for` sobre `entries`, uma transação por linha | **ALTO** |
| [`team-stock-operations/import/route.ts:360`](../src/app/api/team-stock-operations/import/route.ts#L360) | idem | **ALTO** |
| [`projects/activity-forecast/import/route.ts:371`](../src/app/api/projects/activity-forecast/import/route.ts#L371) | `insert(rowsToInsert)` — **lote por projeto** | ✅ correto |

As duas primeiras validam e gravam linha a linha para poder devolver `results[]` com sucesso/erro por linha — requisito legítimo de UX. Mas o custo é `N` round-trips + `N` transações + `N` gravações de WAL. Numa planilha de 2.000 linhas isso é 2.000 commits.

**Caminho:** RPC que recebe o lote como `jsonb`, processa em uma transação e devolve o array de resultados por linha. Já existe precedente no próprio projeto — `save_project_billing_order_batch_partial`, `save_project_measurement_order_batch_partial`, `save_team_stock_operation_batch_full`. O padrão está estabelecido; falta aplicá-lo aos dois imports.

> **Confiança: Alta.** Padrão de solução já validado no repositório.

---

## 12. Consultas sem `tenant_id` no filtro

30 ocorrências detectadas. Triagem manual:

- **Falsos positivos (maioria):** `.insert(...)` / `.update(...)` — o `tenant_id` vai no payload, não no filtro. Ex.: [`teams/route.ts:582`](../src/app/api/teams/route.ts#L582), [`people/route.ts:588`](../src/app/api/people/route.ts#L588).
- **Corretos por natureza:** catálogos globais sem `tenant_id` na tabela — `app_roles`, `app_pages`, `stock_transfer_reversal_reason_catalog`, `stock_requisition_adjustment_reason_catalog`, `warehouse_storage_types`.
- **A confirmar caso a caso:** `job_title_types` ([job-titles/route.ts:283](../src/app/api/job-titles/route.ts#L283)), `job_levels` ([:324](../src/app/api/job-titles/route.ts#L324)), `app_entity_history` ([composicao-equipe/route.ts:753](../src/app/api/composicao-equipe/route.ts#L753)) — essas tabelas **têm** `tenant_id` e índices que começam por ele.

> **Severidade: INFORMATIVO para performance / Confiança: Baixa** (heurística de parser, não leitura completa). Os três últimos merecem leitura — se forem `select` sem filtro de tenant, o problema é de **isolamento**, não de I/O, e deve ser tratado fora desta auditoria.
