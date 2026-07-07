# Inventário de arquivos front-end (UI) e avaliação da estrutura

Data: 2026-07-07

---

## Objetivo

Mapear todos os arquivos que compõem o "front" do sistema (o que é renderizado para o usuário) e avaliar se a organização atual do `src/` está alinhada com o padrão definido em `estrutura_saas_multitenant.md`.

---

## Onde está a UI

| Pasta | Conteúdo | Arquivos |
|---|---|---|
| `src/app/(dashboard)/` | Rotas do painel — um `page.tsx` fino por tela + `layout.tsx` | 45 |
| `src/app/(public)/` | Login e recuperação de senha | 2 |
| `src/app/` (raiz) | `layout.tsx`, `page.tsx`, `globals.css`, `page.module.css` | 4 |
| `src/modules/dashboard/**` | Implementação real de cada tela: `*PageView.tsx` + `.module.css` + `constants/types/utils/hooks/api` do módulo | 112 |
| `src/components/` | Componentes compartilhados: `AppShell`, `Pagination`, `ModulePlaceholder`, `ExportProgressModal`, `ActionIcon` + `.module.css` | 11 |
| `src/hooks/` | `useAuth`, `useErrorLogger`, `useExportCooldown`, `usePagination` | 4 |
| `src/providers/AppProviders.tsx` | Providers globais (React Query etc.) | 1 |
| `src/context/AuthContext.tsx` | Contexto de autenticação client-side | 1 |
| `src/lib/utils/`, `lib/constants/pagination.ts`, `lib/supabase/client.ts` | Helpers usados pela UI (csv, formatters, parsers, cliente Supabase client-side) | 5 |
| `src/types/` | Tipos usados no front (`auth.ts`, `xlsx.d.ts`) | 2 |

**Total front (UI): ~187 arquivos**

## O que NÃO é front (backend/infra)

| Pasta | Conteúdo | Arquivos |
|---|---|---|
| `src/app/api/` | Rotas de API (controllers) | 72 |
| `src/server/modules/` | Handlers, queries, RPC, normalizers por domínio | 15 |
| `src/services/auth/` | Serviço de autenticação | 1 |
| `src/lib/server/` | Helpers server-only (stockTransfers, teamStockOperations, locationPlanning, idempotency, concurrency...) | 8 |

---

## Avaliação: a estrutura está no caminho certo?

**Sim, no geral está alinhada com o padrão recomendado**, com adaptações razoáveis para Next.js App Router. Pontos observados:

### Acertos

1. **Separação rota vs. UI real é consistente.** Todo `page.tsx` em `src/app/(dashboard)/*` é um wrapper fino que só importa a View do módulo:
   ```tsx
   // src/app/(dashboard)/estoque/page.tsx
   import { CurrentStockPageView } from "@/modules/dashboard/estoque/CurrentStockPageView";
   export default function EstoquePage() {
     return <CurrentStockPageView />;
   }
   ```
   Isso é exatamente o que o guia pede: rota não deve conter regra nem lógica de tela.

2. **`modules/` organizado por domínio**, um por tela (`estoque`, `medicao`, `programacao`, `faturamento`...), cada um com seu próprio `constants.ts`, `types.ts`, `utils.ts`, e quando necessário `hooks.ts`/`api.ts`. Isso é fiel ao "cada domínio cresce sem virar caos" do guia.

3. **`components/` reservado para o que é realmente reutilizável** (layout do shell, paginação, export). Não virou depósito de regra de negócio.

4. **Nomenclatura previsível**: `*PageView.tsx` + `.module.css` do lado, em quase todos os módulos. Poucos módulos fogem do padrão (ex.: `apuracao-fator-minimo`, `dash-operacional-faturamento`, `mapa-programacao`, `programacao` só têm `index.ts` — vale conferir se ainda usam essa convenção ou se é código legado a normalizar).

### Pontos de atenção (gaps em relação ao guia)

1. **Lógica de backend fragmentada em 3 lugares sem critério único**: `src/app/api/*` (controller), `src/server/modules/*` (mistura de use-case + repository + mapper) e `src/lib/server/*` (helpers soltos como `stockTransfers.ts`, `teamStockOperations.ts`). O guia pede camadas claras (`controllers` → `use-cases` → `repositories`). Hoje não há um critério explícito de "isso vai para `server/modules`, aquilo vai para `lib/server`" — parece ter crescido organicamente. Não é urgente, mas se o projeto continuar crescendo vale consolidar em um único lugar (`server/modules/<dominio>/`) e aposentar `lib/server/*`.

2. **Sem `middleware.ts` na raiz.** Não há guard de rota/tenant no nível de Next.js middleware — a autorização parece acontecer via `lib/server/pageAuthorization.ts` chamado dentro de cada rota/página. Funciona, mas depende de toda rota nova lembrar de chamar essa checagem; um middleware centralizado reduz o risco de esquecimento.

3. **Sem pasta `domain/` ou `policies/` explícita.** Regras de negócio "puras" (ex.: `reversalRules.ts`) estão soltas em `lib/business/`, e autorização está espalhada em `lib/auth/authorization.ts`, `lib/server/pageAuthorization.ts` e `server/modules/projects/authorization.ts`. Não é um erro grave — só não segue o agrupamento único que o guia sugere.

4. **Sem pasta `tenancy/` dedicada** (`tenant-resolver`, `tenant-guard`, etc.). Pelo que se vê, o isolamento multi-tenant parece apoiado em RLS do Supabase + `account_owner_id`, o que é uma estratégia válida (e é a que o próprio guia recomenda como ponto de partida) — mas vale confirmar que TODA rota de API valida o tenant no servidor antes de consultar o banco, e não confia apenas na RLS.

### Conclusão prática

A separação **UI × API × server** está correta e é o que mais importa para "entregar só o front" — dá pra empacotar os ~187 arquivos listados acima sem arrastar lógica de servidor. Os gaps são de **organização interna do backend** (camadas de use-case/repository/policy), não de front-end. Se o objetivo imediato é separar UI de backend para entrega, a estrutura atual já suporta isso bem.
