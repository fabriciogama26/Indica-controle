# Inspeção: Tenant, RLS e Programação
**Data:** 2026-07-01  
**Escopo:** leitura pura — zero alterações realizadas

---

## 1. Migrations relacionadas aos temas solicitados

### 1.1 `app_user_tenants`

| Migration | O que faz |
|-----------|-----------|
| `045_create_tenants_and_user_tenant_access.sql` | Cria `public.tenants`, cria `public.app_user_tenants` (user_id, tenant_id, is_default, ativo), define índices únicos, faz backfill de tenants a partir de `app_users.tenant_id`, define políticas RLS da tabela e cria `user_can_access_tenant()` |
| `046_add_tenant_fk_to_all_tenant_tables.sql` | Loop dinâmico: encontra toda tabela com coluna `tenant_id`, faz backfill em `tenants` e adiciona FK `tenant_id → tenants(id)` onde ainda não existe |

---

### 1.2 `tenant_id` (evolução geral)

| Migration | O que faz |
|-----------|-----------|
| `006_rls_tenant.sql` | Primeiras políticas RLS por tenant (materials, inventory, requisicoes, stock_movements, etc.) usando subconsulta direta `au.tenant_id = table.tenant_id` — **anterior** à função `user_can_access_tenant` |
| `020_harden_rls_auth_uid_active.sql` | Endurece políticas adicionando `au.ativo = true` |
| `021_rls_to_authenticated.sql` | Migra políticas para `to authenticated` |
| `045_*` | Cria FK formal tenant_id → tenants e backfill |
| `046_*` | Generaliza FK para todas as tabelas |
| `058_enforce_rls_no_all_no_delete.sql` | Padroniza RLS em ~22 tabelas: remove políticas ALL/DELETE, cria só INSERT + UPDATE com `user_can_access_tenant(tenant_id)` |
| `231_enforce_programming_composite_tenant_fks.sql` | Eleva FKs simples de project_programming para FKs compostas `(col, tenant_id)` impedindo cross-tenant em nivel de constraint |

---

### 1.3 `user_can_access_tenant`

| Migration | O que faz |
|-----------|-----------|
| `045_create_tenants_and_user_tenant_access.sql` | **Cria** a função (versão original e atual) |

Nenhuma migration posterior redefine essa função. Versão vigente (lida diretamente do arquivo):

```sql
create or replace function public.user_can_access_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.ativo = true
      and (
        exists (
          select 1
          from public.app_user_tenants aut
          where aut.user_id = au.id
            and aut.tenant_id = p_tenant_id
            and aut.ativo = true
        )
        or au.tenant_id = p_tenant_id   -- fallback legado
      )
  )
$$;
```

**Observações críticas:**
- A função é `stable` (não `security definer`) — executa no contexto de quem chama (RLS policies no `authenticated` role).
- O fallback `au.tenant_id = p_tenant_id` existe para usuários criados antes de `app_user_tenants` e não exige entrada na tabela auxiliar.
- Sem cache interno: cada chamada faz duas consultas (app_users + app_user_tenants).

---

### 1.4 `project_programming`

| Migration | O que faz |
|-----------|-----------|
| `067_create_project_programming.sql` | Cria tabela com `tenant_id NOT NULL`, políticas RLS (SELECT/INSERT/UPDATE), tabela de atividades `project_programming_activities`, triggers de audit |
| `068_link_teams_service_center_and_harden_programming_rpc.sql` | Redefine `save_project_programming` com guard de service_center |
| `069_add_programming_cancellation.sql` | Adiciona campos de cancelamento |
| `070_add_programming_status_and_project_guard.sql` | Coluna `status`, guard de projeto ativo |
| `071_programming_week_summary_and_support_catalog.sql` | `support_item_id`, redefine `save_project_programming`, cria `get_programming_week_summary()` |
| `074_create_programming_copy_batches.sql` | Tabela de lotes de cópia |
| `076_create_copy_team_programming_period_rpc.sql` | RPC de cópia por período |
| `082_create_programming_batch_create_rpc.sql` | Cria `batch_create_project_programming` |
| `085_add_programming_structure_fields_and_actions_support.sql` | Campos estruturais (poste_qty, estrutura_qty, etc.) |
| `087_add_programming_enel_fields_and_sgd_types.sql` | Campos ENEL / sgd_type_id |
| `088_create_postpone_project_programming_rpc.sql` | Cria RPC de adiamento |
| `091_create_programming_full_save_rpcs.sql` | RPCs full (save_project_programming_full) |
| `094_add_programming_stage_and_completion_fields.sql` | Campos etapa / conclusão |
| `097_move_programming_status_history_into_rpcs.sql` | Centraliza histórico de status nos RPCs |
| `101_create_project_programming_history.sql` | Cria `project_programming_history`, migra dados de `app_entity_history`, redefine `set_project_programming_status` e `postpone_project_programming` |
| `122_sync_work_completion_status_by_project_date_trigger.sql` | Trigger `trg_project_programming_sync_work_completion_status` |
| `127_sync_programming_documents_by_project_date_and_lv_window.sql` | Trigger `trg_project_programming_sync_documents` |
| `183_limit_work_completion_status_cascade_to_project_date.sql` | Redefine trigger de work_completion_status |
| `231_enforce_programming_composite_tenant_fks.sql` | FKs compostas (project_id, tenant_id), (team_id, tenant_id), etc. |
| `232_serialize_project_programming_schedule_writes.sql` | Trigger concorrência `trg_00_project_programming_schedule_concurrency` (advisory lock + overlap check) |
| `273_define_programming_group_id.sql` | Trigger `trg_project_programming_assign_group_id` |
| `272_harden_anticipated_work_completion_status.sql` | Triggers `zz_trg_project_programming_anticipated_work_status`, `trg_project_programming_restore_anticipated_by_reopened_completion` |
| `275_harden_programming_stage_state_integrity.sql` | Remove trigger legado `zz_trg_project_programming_active_stage_required` |
| `277_normalize_partial_and_completed_work_status.sql` | Redefine triggers sync_work_completion e completed_group_integrity |
| `279_harden_completed_group_integrity_transition.sql` | Redefine triggers sync_work_completion e zz_completed_group_integrity (versão atual) |
| `280_fix_completed_group_integrity_on_reprogram.sql` | Fix de integridade de grupo ao reprogramar |
| `281_fix_completed_group_bypass_canonical_code.sql` | Fix de bypass do código canônico |
| `282_fix_completed_group_integrity_null_boolean.sql` | Fix de boolean null em completed_group |

---

### 1.5 `project_programming_history`

| Migration | O que faz |
|-----------|-----------|
| `101_create_project_programming_history.sql` | **Cria** a tabela, migra dados de `app_entity_history`, cria `append_project_programming_history_record()` (security definer) e redefine `set_project_programming_status` + `postpone_project_programming` para usar a nova tabela |
| `102_use_programming_history_only_and_physical_rescheduled_status.sql` | RPCs de save passam a gravar só em `project_programming_history` |
| `231_*` | FKs compostas na tabela (pph_programming_tenant_fk etc.) |

---

## 2. Definição real das estruturas

### 2.1 `public.user_can_access_tenant(uuid)`

Definida em `045_create_tenants_and_user_tenant_access.sql` (linha 149–173). Ver seção 1.3 acima.

**Semântica:**
- Retorna `true` se `auth.uid()` está ativo e tem vínculo na `app_user_tenants` com `ativo = true` OU se `app_users.tenant_id = p_tenant_id` (fallback).
- Não é security definer. Não usa JWT claims diretamente além de `auth.uid()`.

---

### 2.2 `public.project_programming` — estrutura da tabela

Definida em `067_create_project_programming.sql` com ~80 colunas acumuladas ao longo das migrations. Colunas da migration original:

```
id uuid PK
tenant_id uuid NOT NULL REFERENCES tenants(id)   ← OBRIGATÓRIO desde a criação
project_id uuid NOT NULL REFERENCES project(id)
team_id uuid NOT NULL REFERENCES teams(id)
execution_date date NOT NULL
period text NOT NULL CHECK IN ('INTEGRAL','PARCIAL')
start_time time NOT NULL
end_time time NOT NULL
expected_minutes integer NOT NULL CHECK > 0
feeder text
support text
note text
sgd_number / sgd_included_at / sgd_delivered_at
pi_number / pi_included_at / pi_delivered_at
pep_number / pep_included_at / pep_delivered_at
created_at / updated_at / created_by / updated_by
```

**Constraint de unicidade original:**
```sql
UNIQUE (tenant_id, project_id, team_id, execution_date)
```

**Campos adicionados por migrations posteriores (seleção):**
- `status` (070) — valores: `PROGRAMADA`, `ADIADA`, `CANCELADA`, `REPROGRAMADA`
- `is_active boolean` (069)
- `cancellation_reason / canceled_at / canceled_by` (069)
- `support_item_id uuid` (071)
- `poste_qty / estrutura_qty / trafo_qty / rede_qty` (085)
- `etapa_number integer` (094)
- `etapa_unica / etapa_final boolean` (154/156)
- `work_completion_status / previous_work_completion_status` (155+)
- `sgd_type_id / electrical_eq_catalog_id / campo_eletrico` (087/110/151)
- `outage_start_time / outage_end_time` (089)
- `service_description` (090)
- `affected_customers` (087)
- `anticipated_by_programming_id / anticipated_at` (255+)
- `copied_from_programming_id / copy_batch_id` (074)
- `programming_group_id` (273)

**FKs compostas (231):**
```sql
pp_project_tenant_fk    → project(id, tenant_id)
pp_team_tenant_fk       → teams(id, tenant_id)
pp_support_item_tenant_fk → programming_support_items(id, tenant_id)
pp_eq_catalog_tenant_fk → programming_eq_catalog(id, tenant_id)
pp_copied_from_tenant_fk → project_programming(id, tenant_id)
pp_copy_batch_tenant_fk → project_programming_copy_batches(id, tenant_id)
```

---

### 2.3 Políticas RLS de `project_programming`

Definidas em `067_create_project_programming.sql` (linhas 87–104):

```sql
-- SELECT
policy project_programming_tenant_select
  FOR SELECT TO authenticated
  USING (public.user_can_access_tenant(project_programming.tenant_id));

-- INSERT
policy project_programming_tenant_insert
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_tenant(project_programming.tenant_id));

-- UPDATE
policy project_programming_tenant_update
  FOR UPDATE TO authenticated
  USING (public.user_can_access_tenant(project_programming.tenant_id))
  WITH CHECK (public.user_can_access_tenant(project_programming.tenant_id));
```

**DELETE:** sem política — `DELETE` bloqueado por ausência de policy (padrão RLS).

Nenhuma migration posterior altera diretamente as políticas de `project_programming` (somente corrige triggers e constraints).

---

### 2.4 Triggers em `project_programming` (estado atual — última migration aplicada)

| Nome do trigger | Timing | Evento | Função chamada | Migration |
|-----------------|--------|--------|---------------|-----------|
| `trg_project_programming_audit` | BEFORE | INSERT OR UPDATE | `apply_audit_fields()` | 067 |
| `trg_00_project_programming_schedule_concurrency` | BEFORE | INSERT OR UPDATE OF tenant_id, team_id, execution_date, start_time, end_time, status | `enforce_project_programming_schedule_concurrency()` (security definer) | 232 |
| `trg_project_programming_sync_documents` | AFTER | INSERT OR UPDATE | sincroniza docs entre programações mesma (project, date, janela LV) | 127 |
| `trg_project_programming_sync_work_completion_status` | AFTER | INSERT OR UPDATE | sincroniza `work_completion_status` por (project, date) | 279 (redefine 122→183→277→279) |
| `zz_trg_project_programming_completed_group_integrity` | AFTER | INSERT OR UPDATE | valida integridade de grupo CONCLUÍDO | 279 (redefine 277→279) |
| `trg_project_programming_assign_group_id` | BEFORE | INSERT OR UPDATE | atribui `programming_group_id` | 273 |
| `zz_trg_project_programming_anticipated_work_status` | AFTER | UPDATE | valida status de trabalho antecipado | 272 |
| `trg_project_programming_restore_anticipated_by_reopened_completion` | AFTER | UPDATE | restaura status ao reabrir | 272 |

**Funções dos triggers (security definer):**
- `enforce_project_programming_schedule_concurrency()` — usa `pg_advisory_xact_lock` por tenant+team+date; revoke de `public/anon/authenticated`, grant apenas a `service_role` (função interna do trigger).
- `apply_audit_fields()` — preenche created_at, updated_at, created_by, updated_by.

---

### 2.5 `public.get_programming_week_summary(uuid, date)`

Definida em `071_programming_week_summary_and_support_catalog.sql` (linhas 682–743):

- Retorna `(team_id, week_start, week_end, worked_days, capacity_days, free_days, load_percent, load_status)`.
- `security definer`, `set search_path = public`.
- Agrupa por team_id as equipes ativas (`teams.ativo = true`) e conta `distinct execution_date` onde `status = 'PROGRAMADA'` na janela da semana.
- `capacity_days` hardcoded em `5`.
- Grant: `authenticated` + `service_role`.

---

## 3. Frontend — Padrões de dados

### 3.1 Realtime

| Padrão | Presença |
|--------|----------|
| `supabase.channel(` | **NÃO ENCONTRADO** — nenhum arquivo .ts/.tsx usa |
| `postgres_changes` | **NÃO ENCONTRADO** |
| `realtime.setAuth` | **NÃO ENCONTRADO** |
| `removeChannel` | **NÃO ENCONTRADO** |

**Conclusão:** o frontend **não usa Realtime** do Supabase. Não há subscriptions de nenhum tipo.

---

### 3.2 React Query

Arquivo: `src/lib/react-query/provider.tsx`

```typescript
new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,   // DESABILITADO globalmente
      staleTime: 30_000,             // 30 segundos de cache
    },
    mutations: {
      retry: false,
    },
  },
})
```

| Padrão | Presença |
|--------|----------|
| `refetchInterval` | **NÃO ENCONTRADO** em nenhum componente — sem polling periódico |
| `refetchOnWindowFocus` | Explicitamente `false` no provider global |
| `invalidateQueries` | **NÃO ENCONTRADO** em nenhum arquivo frontend |

---

### 3.3 `get_programming_week_summary`

Arquivo: `src/server/modules/programacao/queries.ts` (linha 54–69)

```typescript
export async function fetchProgrammingWeekSummary(
  supabase: SupabaseClient,
  tenantId: string,
  weekStart: string,
) {
  const { data, error } = await supabase.rpc("get_programming_week_summary", {
    p_tenant_id: tenantId,
    p_week_start: weekStart,
  });
  ...
}
```

Chamado via RPC normal — sem cache especial, sem polling, sem realtime.

---

### 3.4 Leitura direta de `project_programming`

O arquivo `src/server/modules/programacao/queries.ts` faz leituras diretas via `.from("project_programming").select(...)` nas funções:
- `fetchProgrammingRows()` — lista por tenant + range de datas
- `fetchProgrammingById()` — por id
- `fetchProgrammingConflictPayload()` — verifica conflito
- `fetchProgrammingStageValidation()` — validação de etapa
- `fetchNextProgrammingStage()` — próxima etapa

**Estas leituras passam pelo RLS** (client `authenticated`) — correto.

---

## 4. Confirmações finais

### 4.1 `project_programming.tenant_id` é obrigatório?

**SIM.** Desde a migration `067_create_project_programming.sql`:

```sql
tenant_id uuid not null references public.tenants(id),
```

A constraint nunca foi relaxada. Toda row em `project_programming` tem `tenant_id NOT NULL`.

---

### 4.2 Todo update de programação passa por RPC/função?

**SIM, para todas as operações de escrita.** O frontend NÃO faz `.update()` direto no Supabase client sobre `project_programming`.

Todas as escritas são canalizadas por RPCs `security definer`:

| Operação | RPC |
|----------|-----|
| Criar / editar programação | `save_project_programming()` |
| Cancelar / Adiar status | `set_project_programming_status()` |
| Adiar com nova data | `postpone_project_programming()` |
| Copiar para múltiplas datas/equipes | `copy_project_programming_to_dates()` |
| Criação em lote | `batch_create_project_programming()` / `save_project_programming_batch_full()` |
| Save full (com etapa/conclusão) | `save_project_programming_full()` |
| Histórico operacional | `append_project_programming_history_record()` |
| Status de conclusão de trabalho | `save_programming_work_completion_status()` |

Cada RPC valida `tenant_id` explicitamente antes de qualquer write e registra histórico em `project_programming_history`.

---

## 6. Arquitetura da página de Programação — como é montada e atualizada

### 6.1 Visão geral da estrutura

```
src/app/(dashboard)/programacao-simples/page.tsx   ← Server Component (Next.js App Router)
  └─ <ProgrammingSimplePageView />                  ← "use client" — Client Component raiz
       ├─ useProgrammingBoardData()                 ← hook: carrega e atualiza grade
       ├─ useProgrammingActivityCatalog()           ← hook: busca atividades com debounce
       ├─ useProgrammingEtapaSuggestion()           ← hook: sugere próxima etapa
       ├─ useHistoryModal()                         ← hook: histórico de alterações
       ├─ useCancelModal()                          ← hook: fluxo de cancelamento
       ├─ usePostponeModal()                        ← hook: fluxo de adiamento
       └─ useCopyToDatesModal()                     ← hook: cópia para múltiplas datas
```

---

### 6.2 Server Component

**Arquivo:** `src/app/(dashboard)/programacao-simples/page.tsx`

```typescript
import { ProgrammingSimplePageView } from "@/modules/dashboard/programacao-simples";

export default function ProgramacaoSimplesPage() {
  return <ProgrammingSimplePageView />;
}
```

- **Puro pass-through** — não busca dados, não passa props, não usa `cookies()` nem `headers()`.
- Não há `generateStaticParams`, `revalidate`, nem `fetch` no Server Component.
- Toda lógica de dados está no Client Component.

---

### 6.3 Client Component raiz

**Arquivo:** `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx`

- Marcado com `"use client"` na linha 1.
- Contém todo o estado local da grade e dos formulários via `useState`.
- Não usa `useRouter`, não chama `router.refresh()` em nenhum ponto.
- Não usa `useSearchParams` nem `usePathname`.

**Estado local relevante (useState):**

| Estado | Tipo | Propósito |
|--------|------|-----------|
| `schedules` | `ScheduleItem[]` | Grade completa carregada da API |
| `projects` | `ProjectItem[]` | Catálogo de projetos |
| `teams` | `TeamItem[]` | Catálogo de equipes |
| `form` | `FormState` | Formulário de criação/edição |
| `activeFilters` | `FilterState` | Filtros aplicados (data, projeto, equipe, status) |
| `filterDraft` | `FilterState` | Rascunho antes de aplicar filtros |
| `editingScheduleId` | `string \| null` | ID da programação em edição |
| `editingExpectedUpdatedAt` | `string \| null` | Timestamp para optimistic concurrency |
| `page` | `number` | Página atual da listagem |
| `feedback` | `{type, message} \| null` | Mensagem de sucesso/erro ao usuário |

**Filtragem e paginação:** feitas em memória no cliente via `useMemo` — sem roundtrip ao servidor para filtrar ou paginar. A grade completa do range de datas já está em `schedules`.

---

### 6.4 Server Actions

**NÃO EXISTE nenhuma Server Action** no módulo de Programação.

- Nenhum arquivo usa `"use server"`.
- Nenhuma `action=` de formulário aponta para Server Action.
- Toda comunicação server-side é feita via Route Handlers (REST).

---

### 6.5 Rotas/API (Route Handlers)

| Rota | Método | Propósito |
|------|--------|-----------|
| `GET /api/programacao` | GET | Carrega grade (schedules + meta) ou responde queries específicas (history, nextEtapa, etapaValidation) via query params |
| `GET /api/programacao/meta` | GET | Carrega somente catálogos (projects, teams, supportOptions, sgdTypes, eqCatalog, reasonOptions, workCompletionCatalog) em paralelo com `Promise.all` |
| `POST /api/programacao` | POST | `BATCH_CREATE` (nova programação em lote), `COPY_TO_DATES`, `ADD_TEAM` |
| `PUT /api/programacao` | PUT | Edição de programação existente |
| `PATCH /api/programacao` | PATCH | `CANCELAR`, `ADIAR`, `SALVAR_ESTADO_TRABALHO` |

Todas as rotas:
- Resolvem o usuário autenticado via `resolveAuthenticatedAppUser(request, ...)` — usa o JWT do header `Authorization: Bearer <token>`.
- Verificam permissão via `authorizeProgrammingAction(resolution, action)`.
- Delegam escrita para RPCs `security definer` no banco.
- Retornam JSON.

---

### 6.6 Carregamento inicial

Ao montar o componente, o hook `useProgrammingBoardData` dispara `loadBoardData()` via `useEffect`:

```typescript
useEffect(() => {
  void loadBoardData();
}, [loadBoardData]);
```

`loadBoardData` chama `fetchBoardSnapshot`, que faz **duas requisições em paralelo** (`Promise.all`):

```typescript
const [metaData, schedulesData] = await Promise.all([
  fetchProgrammingMeta({ accessToken }),           // GET /api/programacao/meta
  fetchProgrammingSnapshot({                        // GET /api/programacao?startDate=...&endDate=...
    accessToken,
    startDate: requestStartDate,
    endDate: requestEndDate,
    includeMeta: false,
  }),
]);
```

- `/api/programacao/meta` — 7 queries em paralelo (projects, teams, support, sgdTypes, eqCatalog, reasonOptions, workCompletion).
- `/api/programacao` — busca `project_programming` + atividades por chunks de 100 IDs + reschedule history.

O resultado é aplicado em `applyBoardSnapshot(data)`, que atualiza todos os estados via `setProjects`, `setTeams`, `setSchedules`, etc.

O `useEffect` re-dispara quando `activeFilters` (startDate, endDate) ou `weekStartDate`/`weekEndDate` mudam, pois `loadBoardData` está no array de deps via `useCallback` que captura essas variáveis.

---

### 6.7 Recarregamento após salvar (padrão único e consistente)

**Não existe `router.refresh()`.** O padrão de atualização após qualquer mutação é:

```typescript
// Após salvar / cancelar / adiar / copiar / adicionar equipe:
const boardData = await fetchBoardSnapshot();
if (boardData) applyBoardSnapshot(boardData);
```

`fetchBoardSnapshot` refaz as **mesmas duas chamadas paralelas** do carregamento inicial e atualiza o estado local completo. Esse padrão é usado em **todos os 7 fluxos de mutação**:

| Operação | Chama fetchBoardSnapshot após sucesso? |
|----------|----------------------------------------|
| Salvar/editar programação (`handleSubmit`) | SIM |
| Reprogramar (`confirmReprogram`) | SIM |
| Cancelar (`useCancelModal.confirmCancellation`) | SIM |
| Adiar (`usePostponeModal.confirmPostpone`) | SIM |
| Copiar para datas (`useCopyToDatesModal.confirmCopyToDates`) | SIM |
| Adicionar equipe (`confirmAddTeam`) | SIM |
| Salvar Estado Trabalho do modal (`saveWorkCompletionStatusFromAlertModal`) | SIM |

Em caso de falha no `fetchBoardSnapshot`, a mutação **não é desfeita** — o feedback indica "salvo com sucesso, mas houve falha ao atualizar a visualização" e o usuário precisa recarregar a página manualmente.

---

### 6.8 `router.refresh()`

**NÃO É USADO.** Confirmado via grep em todos os arquivos do módulo:

```
Resultado: No matches found
```

Nenhum `useRouter` é importado. Nenhuma navegação programática existe na página de Programação.

---

### 6.9 Token de acesso — como é obtido e renovado

O componente não usa o cliente Supabase para fazer queries diretamente à grade. O access token JWT é obtido via hook de auth:

```typescript
const { session } = useAuth();
const accessToken = session?.accessToken ?? null;
```

Antes de cada operação de escrita, o token é renovado via:

```typescript
const { data } = await supabase.auth.getSession();
const refreshedAccessToken = data.session?.access_token?.trim() ?? "";
```

Se a primeira tentativa retorna 401, o token é renovado e a operação é repetida uma vez.

---

### 6.10 Diagrama resumido do fluxo de dados

```
Browser (mount)
  │
  ├─► GET /api/programacao/meta  ─► catalogs.ts (Promise.all 7 queries) ─► Supabase RLS
  ├─► GET /api/programacao        ─► queries.ts (project_programming + activities) ─► Supabase RLS
  │
  └─ applyBoardSnapshot(data) → setSchedules / setProjects / setTeams / ... (estado local)

Usuário edita → handleSubmit / confirmCancellation / confirmPostpone / ...
  │
  ├─► PUT/POST/PATCH /api/programacao
  │     └─► handler.ts → saveProgrammingFullViaRpc / cancelProgrammingViaRpc / ...
  │           └─► supabase.rpc('save_project_programming_full' / ...) ─► SECURITY DEFINER
  │
  └─ (após resposta OK) → fetchBoardSnapshot() → applyBoardSnapshot() → atualiza estado local
```

---

## 5. Pontos de atenção identificados (não corrigidos — somente observados)

1. **`user_can_access_tenant` não é `security definer`** — executada no contexto do `authenticated` role. Em situações de RLS bypass (ex.: funções `security definer` que chamam a função via subquery), o contexto pode diferir. Verificar se as políticas retornam o resultado esperado quando chamadas dentro de RPCs.

2. **Fallback `au.tenant_id = p_tenant_id`** — usuários sem registro em `app_user_tenants` mas com `app_users.tenant_id` preenchido ainda passam. Se a migração completa para multi-tenant ainda não terminou, esses usuários podem acessar mais do que o esperado.

3. **`get_programming_week_summary` hardcoda `capacity_days = 5`** — sem configuração por tenant.

4. **Frontend sem `invalidateQueries`** — após mutations (save, cancelar), a grade só reflete a mudança se o componente refazer o fetch manualmente (ex.: re-mount ou lógica explícita de refresh). Confirmar se o handler de resposta da API triggera algum reload no componente para evitar stale data.

5. **Sem Realtime** — qualquer mudança feita por outro usuário na mesma grade não é visível até o próximo fetch. O sistema usa `p_expected_updated_at` (optimistic concurrency) nos RPCs para detectar conflito, mas não notifica proativamente o cliente sobre mudanças de terceiros.

---

*Gerado em 2026-07-01 — inspeção read-only sobre migrations 000 a 282 e src/server/modules/programacao/*
