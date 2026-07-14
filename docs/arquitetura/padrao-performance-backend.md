# Padrão de Performance — Backend

> **As regras canônicas vivem em [`guias/guia_backend.md`](../../guias/guia_backend.md).** Este arquivo é mantido como referência complementar — contém os exemplos de código completos e o histórico de aplicação por tela que o guia resume. Em caso de divergência entre este arquivo e `guias/guia_backend.md`, o guia prevalece; atualize este arquivo na mesma tarefa que atualizar a regra.

Referência detalhada do `CLAUDE.md`/`AGENTS.md` (seção "Padrão de Performance — Backend"). Toda tela ou endpoint novo que liste, pagine ou agregue dados deve seguir os padrões abaixo. Os padrões foram extraídos das correções aplicadas em Medição, Medição As Built e Programação (2026-06).

---

## Problema central que esses padrões evitam

Padrão recorrente que NÃO deve se repetir:

```
buscar todos os registros do banco
  → cruzar tabelas no Node/JS
  → filtrar/ordenar em memória
  → paginar no final
```

Isso transporta a base inteira para o Node antes de qualquer filtro, escala mal com o crescimento dos dados e não usa os índices do Postgres.

---

## 1. Listas operacionais: paginação real no banco

### Errado
```ts
// Busca TUDO em loop até esgotar, depois filtra/pagina em memória
const allRows = await fetchPagedSupabaseRows((from, to) =>
  supabase.from("orders").select("*").eq("tenant_id", tenantId).range(from, to)
);
const filtered = allRows.filter((r) => matchesDerivedFilter(r));
const page = filtered.slice(offset, offset + pageSize);
```

### Certo
```ts
let query = supabase
  .from("orders")
  .select("*", { count: "exact" })
  .eq("tenant_id", tenantId);

if (statusFilter) query = query.eq("status", statusFilter);
if (dateFilter) query = query.eq("execution_date", dateFilter);

const { data, count } = await query
  .order("execution_date", { ascending: false })
  .range(from, to);
```

Referência real: `src/app/api/medicao/route.ts` (P1-A) e `src/app/api/medicao-asbuilt/route.ts` (P4).

### Filtros nativos vs. filtros derivados
- **Nativo** = existe como coluna ou é resolvível via `.in("id", [...])`/`.eq(...)` antes da query principal. Vai direto ao banco.
- **Derivado** = calculado em runtime cruzando tabelas (ex.: `programmingMatch`, `workCompletionStatus`, `completionAlert` em Medição), sem coluna própria. Aplicado como pós-filtro **somente nos itens da página retornada** pelo banco — nunca sobre o dataset completo.

Trade-off aceito: quando há filtro derivado ativo, o `total` da paginação fica aproximado (conta os registros que passam pelo filtro nativo, não pelo derivado). Documentar isso no TXT da tela quando acontecer. Exemplo: `docs/Tela_Medicao_SaaS.txt`, seção "Atualizacao 2026-06-30 — P1-A".

### Pré-resolução de filtro derivado em ID nativo
Quando o filtro derivado pode ser resolvido por uma tabela de junção leve, transforme-o em filtro nativo via pré-resolução de IDs:

```ts
const activityOrdersResult = await fetchPagedSupabaseRows((from, to) =>
  supabase
    .from("project_measurement_order_items")
    .select("measurement_order_id")
    .eq("tenant_id", tenantId)
    .eq("service_activity_id", activityId)
    .range(from, to)
);
const activityOrderIdSet = new Set(activityOrdersResult.data.map((i) => i.measurement_order_id));
// depois: query.in("id", Array.from(activityOrderIdSet))
```

Referência real: `activityOrderIdSet` em `src/app/api/medicao/route.ts`.

---

## 2. Históricos: sempre com `.limit(N)`

Toda query de histórico/auditoria precisa de limite explícito.

- **50** — histórico de ações exibido em modal/tela (ex.: `fetchProgrammingHistory`, `loadHistory` em Medição As Built).
- **500** — listas de cruzamento de IDs para uso interno, não exibidas diretamente (ex.: `fetchRescheduledProgrammingIds`).

```ts
const { data } = await supabase
  .from("project_programming_history")
  .select("...")
  .eq("tenant_id", tenantId)
  .order("created_at", { ascending: false })
  .limit(50) // <- obrigatório
  .returns<HistoryRow[]>();
```

---

## 3. Catálogos e dados estáticos: endpoint `/meta` separado

Dados que mudam pouco (catálogos, projetos ativos, equipes, tipos) não devem ser buscados de novo a cada refresh de uma lista operacional que muda constantemente.

### Padrão
1. Cache em memória no backend com TTL (padrão 5 min) por `tenantId`:
```ts
const CATALOG_TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, { data: T[]; expiresAt: number }>();

export async function fetchCatalog(supabase, tenantId) {
  const cached = _cache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const { data } = await supabase.from("catalog").select("*").eq("tenant_id", tenantId);
  _cache.set(tenantId, { data, expiresAt: Date.now() + CATALOG_TTL_MS });
  return data;
}
```
2. Endpoint próprio (`GET /api/<modulo>/meta`) retornando só os catálogos.
3. Endpoint operacional principal aceita `?meta=0` para pular o que já foi carregado pelo `/meta` e retornar só os dados que mudam (lista/agendamento).
4. Frontend chama os dois em paralelo e mescla via spread (campos opcionais no tipo de resposta permitem o merge sem conflito):
```ts
const [metaData, listData] = await Promise.all([
  fetchMeta({ accessToken }),
  fetchList({ accessToken, ...filters, includeMeta: false }),
]);
return { ...metaData, ...listData };
```

Referência real: `src/app/api/programacao/meta/route.ts`, `?meta=0` em `src/app/api/programacao/route.ts`, `fetchBoardSnapshot` em `src/modules/dashboard/programacao-simples/hooks.ts`.

Catálogos já cacheados no projeto (`src/server/modules/programacao/catalogs.ts`): projetos, equipes, tipos de SGD, catálogo elétrico, catálogo de motivo, catálogo de conclusão de obra.

---

## 4. Queries independentes: sempre `Promise.all`

Nunca encadear `await` sequencial quando os resultados não dependem uns dos outros.

### Errado (sequencial, ~430ms de overhead acumulado)
```ts
const supportDefaults = await fetchProjectSupportDefaults(...);
const activities = await fetchProgrammingActivities(...);
const rescheduleHistory = await fetchRescheduledProgrammingIds(...);
const users = await fetchUsers(...);
```

### Certo
```ts
const [supportDefaults, activities, rescheduleHistory, users] = await Promise.all([
  fetchProjectSupportDefaults(...),
  fetchProgrammingActivities(...),
  fetchRescheduledProgrammingIds(...),
  fetchUsers(...),
]);
```

Quando alguma query é condicional (ex.: só roda se houver IDs), use `Promise.resolve(valorPadrão)` no lugar dela dentro do mesmo array — mantém tudo no mesmo `Promise.all` sem `if` quebrando o paralelismo:
```ts
const [a, b] = await Promise.all([
  condicao ? fetchAlgo(...) : Promise.resolve(valorPadrao),
  fetchOutraCoisa(...),
]);
```

Referência real: `GET /api/programacao/route.ts` — bloco com `extraTeamsForSchedules`, `supportDefaults`, `activitiesResult`, `rescheduleHistoryMap`, `usersResult`.

---

## 5. Dashboards e apurações: nunca como lista comum

Telas de dashboard, apuração ou faturamento que mostram totais/agregados não devem carregar a lista bruta no Node para somar em JS. Usar:
- RPC de agregação no Postgres (`SUM`, `COUNT`, `GROUP BY` no banco).
- Rollup pré-calculado.
- View materializada quando o agregado é caro e não muda em tempo real.

Esse padrão ainda está pendente de aplicação geral em Dashboard Operacional/Faturamento — ver `docs/arquitetura/` e `TASKS.md` para status.

---

## Checklist antes de criar uma tela/endpoint novo

1. Existe padrão equivalente já implementado? Reaproveitar a arquitetura de Medição, Medição As Built ou Programação — não reinventar.
2. A tela tem lista operacional + catálogo estático? Separar em dois endpoints (`/meta` + lista) desde o início, não como otimização posterior.
3. Todo filtro existe como coluna no banco? Se não, ele é resolvível via pré-resolução de IDs (vira nativo) ou precisa ser pós-filtro de página (documentar trade-off de total aproximado)?
4. Toda query de histórico tem `.limit()`?
5. Toda query independente está em `Promise.all`?
6. Dashboards/apurações usam RPC de agregação, não lista carregada por inteiro?

---

## Histórico de aplicação

| Data | Tela | Mudança |
|------|------|---------|
| 2026-06-30 | Medição (P1-A) | Paginação real no banco para todos os filtros; `activityId` nativo via pré-resolução; `programmingMatch`/`workCompletionStatus`/`completionAlert` viram pós-filtro de página. |
| 2026-06-30 | Medição As Built (P4) | `count+range` na listagem; `allIdsQuery` paralela para summary; `.limit(50)` em `loadHistory`. |
| 2026-06-30 | Programação | `.limit(500)` em `fetchRescheduledProgrammingIds`; 5 queries pós-`fetchProgrammingRows` paralelizadas; novo `/api/programacao/meta`; suporte a `?meta=0`; frontend split em paralelo. |
| 2026-06 | Histórico de Programação (P3) | `.limit(50)` em `fetchProgrammingHistory`. |
