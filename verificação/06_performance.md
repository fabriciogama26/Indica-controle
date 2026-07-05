# Performance — Verificação Obrigatória

> Atualizado: 2026-06 (auditoria completa do sistema)
> Este arquivo deve ser revisado antes de qualquer PR que toque em API, banco ou componente de listagem.

---

## CAMADA: BANCO DE DADOS

### ❌ NÃO FAZER

- Usar `.select("*")` — traz colunas desnecessárias e futuras colunas desconhecidas
- Usar `.limit()` acima de 1.000 sem paginação real ou justificativa documentada
- Usar `.limit(50000)` ou similar em dashboards — calcular no banco, não no JS
- Fazer query sem filtro obrigatório de `tenant_id`
- Filtrar em JavaScript depois de trazer todos os registros (`data.filter(...)` sobre 10k+ rows)
- Fazer `SELECT ... WHERE` antes de `INSERT` para checar unicidade sem constraint no banco
- Omitir índice em colunas usadas como filtro frequente (`tenant_id`, `execution_date`, `status`, `is_active`, `team_id`, `project_id`)
- Calcular agregações (soma, contagem, percentual) no JavaScript quando podem ser feitas no SQL

### ✅ FAZER

- Listar explicitamente apenas as colunas necessárias no `.select()`
- Usar paginação com `.range(offset, offset + pageSize - 1)` em listagens
- Aplicar todos os filtros no banco, não no JS
- Usar RPC SQL para dashboards que exigem agregação
- Criar índices compostos nas colunas usadas juntas em filtros frequentes
- Usar `UNIQUE constraint` ou `exclusion constraint` para garantir unicidade no banco
- Usar `.maybeSingle()` em vez de `.select().limit(1)` quando espera um ou nenhum

### Como confirmar problemas de banco

```sql
-- Verificar se há sequential scans (rodar no Supabase SQL Editor):
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, project_id, team_id, execution_date, status
FROM project_measurement_orders
WHERE tenant_id = 'uuid-aqui'
  AND measurement_kind = 'COM_PRODUCAO'
  AND status != 'CANCELADA'
ORDER BY execution_date DESC
LIMIT 100;
-- Se aparecer "Seq Scan" em vez de "Index Scan", falta índice.

-- Ver índices existentes em uma tabela:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'project_measurement_orders';
```

### Índices mínimos obrigatórios no projeto

```sql
-- Auth (chamado em TODAS as 68 rotas):
CREATE INDEX IF NOT EXISTS idx_appusers_auth_id ON app_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_appusers_tenant_ativo ON app_users(tenant_id, ativo);
CREATE INDEX IF NOT EXISTS idx_aut_user_ativo ON app_user_tenants(user_id, ativo);
CREATE INDEX IF NOT EXISTS idx_approles_id ON app_roles(id);

-- Medição (dashboard crítico):
CREATE INDEX IF NOT EXISTS idx_pmo_tenant_kind_status_date
  ON project_measurement_orders(tenant_id, measurement_kind, status, execution_date DESC)
  WHERE is_active = true;

-- Programação:
CREATE INDEX IF NOT EXISTS idx_pp_tenant_date
  ON project_programming(tenant_id, execution_date)
  WHERE status != 'CANCELADA';

-- Equipes:
CREATE INDEX IF NOT EXISTS idx_teams_tenant_ativo ON teams(tenant_id, ativo);

-- Projetos:
CREATE INDEX IF NOT EXISTS idx_project_tenant_active ON project(tenant_id, is_active);
```

---

## CAMADA: API / ROUTE HANDLERS

### ❌ NÃO FAZER

- Criar novo `SupabaseClient` a cada request (usar singleton)
- Disparar queries de auth (getUser, app_users, app_roles) sem cache em todas as rotas
- Fazer queries sequenciais que poderiam ser paralelas
- Fazer duas queries na mesma tabela quando uma com `.or()` ou IN resolveria
- Retornar JSON de resposta sem logar o tamanho quando acima de 100KB
- Fazer fallback de schema com 3-5 queries sequenciais — resolver a migration
- Buscar dados de catálogo (raramente alterados) a cada request sem cache
- Retornar campos de auditoria interna (`created_by`, `updated_by`, raw IDs) para o front quando não necessário

### ✅ FAZER

- Usar singleton para o Supabase admin client
- Cachear resultado de auth por token com TTL de 30-60s
- Paralelizar queries independentes com `Promise.all()`
- Usar `unstable_cache` do Next.js para dados de catálogo (revalidate 5min)
- Logar tamanho de resposta para endpoints que retornam listas
- Retornar apenas os campos que o front-end realmente usa
- Documentar o número esperado de queries por request no comentário do handler

### Checklist de queries por request (preencher no TXT da tela)

```
Endpoint: GET /api/[nome]
Queries disparadas:
  1. resolveAuthenticatedAppUser → 4 queries (auth + app_users + app_roles + app_user_tenants)
  2. [tabela principal] → filtros: tenant_id, [outros filtros], limit: [N]
  3. [tabela de apoio] → filtros: [...]
  ...
Total de queries: [N]
Tamanho estimado de resposta: [KB/MB]
```

### Exemplo: singleton do Supabase admin client

```typescript
// ANTES (problemático — novo client a cada request):
function getSupabaseAdmin() {
  return createClient(url, key, { auth: { persistSession: false } });
}

// DEPOIS (correto — singleton):
let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Missing Supabase admin credentials.");
  _supabaseAdmin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabaseAdmin;
}
```

### Exemplo: cache de auth por token

```typescript
// Cache simples em memória com TTL:
const authCache = new Map<string, { result: AuthenticatedAppUserResolution; expiresAt: number }>();

export async function resolveAuthenticatedAppUser(request: NextRequest, options = {}) {
  const token = extractBearerToken(request);
  if (!token) return { error: { status: 401, message: "Missing authorization header." } };

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  // ... lógica existente de 4 queries ...
  const result = { supabase, authUserId, appUser, tenantAccess, role };

  authCache.set(token, { result, expiresAt: Date.now() + 45_000 }); // TTL: 45s
  // Limpar entradas expiradas periodicamente:
  if (authCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of authCache) {
      if (v.expiresAt < now) authCache.delete(k);
    }
  }
  return result;
}
```

### Exemplo: log de tamanho de resposta

```typescript
// Adicionar antes do return em endpoints de lista:
const payload = { data: rows, total, page };
const size = Buffer.byteLength(JSON.stringify(payload));
if (size > 102_400) { // > 100KB
  console.warn(`[PERF] ${request.nextUrl.pathname} → ${(size / 1024).toFixed(1)}KB`);
}
return NextResponse.json(payload);
```

### Exemplo: dashboard como RPC em vez de dados brutos

```typescript
// ANTES (problemático — busca 10.000 registros para agregar no JS):
const { data: orders } = await supabase
  .from("project_measurement_orders")
  .select("id, project_id, team_id, execution_date, ...")
  .eq("tenant_id", tenantId)
  .limit(10000);
const total = orders.reduce((sum, o) => sum + o.value, 0); // agrega no JS

// DEPOIS (correto — RPC retorna apenas o resumo):
const { data: summary } = await supabase.rpc("get_measurement_dashboard_summary", {
  p_tenant_id: tenantId,
  p_cycle_start: cycleStart,
  p_cycle_end: cycleEnd,
});
// summary = { total_value, order_count, project_count, by_team: [...] }
```

---

## CAMADA: FRONT-END

### ❌ NÃO FAZER

- Disparar request sem filtro de período (ex: buscar ano inteiro por padrão)
- Chamar a mesma API tanto no server component quanto no client component
- Fazer múltiplas chamadas ao mesmo endpoint ao carregar uma tela
- Chamar `getUser()`, `getSession()` ou `/api/auth/session-access` em vários componentes separados
- Aplicar filtros em JavaScript sobre uma lista completa já buscada

### ✅ FAZER

- Definir filtro de período padrão: mês atual ou últimos 30 dias
- Usar React Query com `staleTime` adequado para evitar refetch desnecessário
- Centralizar dados de sessão em um único contexto (`AuthContext`)
- Aplicar debounce (300ms mínimo) em campos de busca que disparam request
- Usar paginação com cursor ou offset para listas grandes

### Configuração React Query recomendada

```typescript
// Para dados de listagem operacional (mudam frequentemente):
useQuery({
  queryKey: ["programacao", tenantId, filters],
  queryFn: () => fetchProgramacao(filters),
  staleTime: 30_000,      // 30s antes de considerar stale
  gcTime: 5 * 60_000,     // 5min no cache após stale
  refetchOnWindowFocus: false, // evitar refetch ao trocar de aba
});

// Para catálogos (raramente mudam):
useQuery({
  queryKey: ["catalogo", "sgd-types", tenantId],
  queryFn: () => fetchSgdTypes(),
  staleTime: 10 * 60_000, // 10min — dado não muda frequentemente
  gcTime: 30 * 60_000,
});
```

---

## Checklist de performance por PR

Antes de abrir PR em qualquer tela ou API, responder:

- [ ] Quantas queries Supabase esta rota dispara por request? (documentar no TXT)
- [ ] Há `.limit()` acima de 1.000? Se sim, está paginando ou é RPC de agregação?
- [ ] Há `.select("*")`? Substituir por lista de colunas.
- [ ] Os filtros estão no banco? Nenhum `data.filter(...)` sobre lista completa.
- [ ] As colunas usadas em filtro têm índice? Documentar ou criar migration.
- [ ] Dados de catálogo têm cache? (`unstable_cache` ou `staleTime` no React Query)
- [ ] O tamanho da resposta foi verificado? (logar se > 100KB)
- [ ] Dashboard retorna resumo ou dados brutos? (preferir RPC/resumo)
- [ ] Há queries que poderiam ser paralelas e estão sequenciais?
- [ ] O Supabase client está sendo recriado a cada request?
## Verificacao desta entrega - 2026-06-27
- [x] Trigger de sincronizacao usa chave operacional `tenant_id + programming_group_id`.
- [x] Backfill limita validacoes de detalhe a 20 registros em mensagens de erro.
- [x] Nao aplicavel: endpoint de listagem ou dashboard novo.

## Verificacao desta entrega - 2026-07-04
- [x] Exportacao da Medicao deixa de montar CSV no navegador e passa a baixar `text/csv` de rota server-side.
- [x] Rota de exportacao reaproveita paginacao de ate 500 registros por pagina, sem `.select("*")` novo e sem `.limit(50000)`.
- [x] Resposta CSV acima de 100KB registra log `[EGRESS]`.
- [x] Lacuna documentada: rota ainda reaproveita o pipeline paginado existente; proxima etapa pode extrair service/RPC dedicado para reduzir queries internas.

## Verificacao desta entrega - 2026-07-04 - Modal compartilhado
- [x] Mudanca posterior foi apenas de estado/modal em botoes de exportacao existentes.
- [x] Nao foram adicionadas queries, endpoints, `.select("*")`, `.limit()` ou processamento extra de listas.
- [x] Nao aplicavel: nenhuma alteracao de cache, paginacao ou filtro de banco.

## Verificacao desta entrega - 2026-07-05
- [x] Novas rotas nao usam `.select("*")`; colunas foram listadas explicitamente.
- [x] Leitura do mapa filtra por `tenant_id` e `stockCenterId`; andares sao buscados por `shelf_id IN (...)`, nao por tenant inteiro.
- [x] Nao aplicavel nesta etapa: dashboard/agregacao pesada; a tela retorna layout e saldo do centro selecionado.
- [x] Centros de equipe sao identificados por query pequena em `teams.stock_center_id`, paralela a `stock_centers`, sem carregar saldo/material para centros inelegiveis.

## Verificacao desta entrega - 2026-07-05 - Dashboard Medicao
- [x] Query de `project_measurement_order_items` continua sem `.select("*")`, usando somente `measurement_order_id, total_value`.
- [x] `.in("measurement_order_id", orderIds)` grande foi dividido em chunks de 200 IDs para evitar falha por URL/query extensa no PostgREST.
- [x] Payload final do dashboard nao foi ampliado; a alteracao muda apenas a estrategia interna de leitura dos itens.
