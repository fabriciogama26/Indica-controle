# Acesso por Tenant e Contrato — Pré-Implementação
Gerado em: 2026-06-27

Todos os campos abaixo foram preenchidos com base na leitura direta das migrations e código-fonte do repositório, não por presunção.

---

## Pré-requisito absoluto

Este plano só pode ser iniciado após as **Fases 1 a 10 de regras configuráveis** estarem concluídas e estáveis em produção.

- Fase 1 de regras configuráveis: migrations 276, 277, 279, 280 (somente essas quatro).
- Fases 5, 6 e 7: migrations de snapshot para Programação, Medição/As Built e Faturamento (números a confirmar no momento de cada fase).
- **Migration 278 (`contract_business_rules`): CANCELADA DEFINITIVAMENTE.** Nunca será criada com esse número — as migrations 279 e 280 já existem; inserção fora de ordem invalida o histórico. Quando `contract_business_rules` for necessária (após Fases A+B deste plano), usar o próximo número disponível naquele momento.

---

## Checklist de Bloqueio

### Pré-requisitos externos
- [ ] Fases 1 a 10 das regras configuráveis concluídas e estáveis em produção (Fase 1: 276, 277, 279, 280; Fases 5/6/7: snapshots — números a confirmar)
- [ ] Sem regressões em Programação, Medição, As Built e Faturamento por pelo menos 2 semanas após estabilização
- [ ] `contract_business_rules`: **CANCELADA DEFINITIVAMENTE (migration 278)** — será criada com o próximo número disponível somente após contrato 1:N, `app_user_contracts`, `activeContractId` e `user_can_access_scope()` existirem
- [ ] Decisões de negócio 11.1 a 11.8 do estudo técnico respondidas e documentadas

### Banco e schema
- [x] Tabela `public.contract` confirmada — PK: `id UUID`, campos: `tenant_id, name, valor, ativo, created_at, updated_at, created_by, updated_by` (migrations 032/033)
- [x] UNIQUE(tenant_id) identificada — migration 032 (nome real a ser confirmado com `pg_constraint` antes da Fase A)
- [ ] Nome exato da constraint UNIQUE(tenant_id) confirmado: `SELECT conname FROM pg_constraint WHERE conrelid = 'public.contract'::regclass AND contype = 'u'`
- [x] `is_default` NÃO existe hoje em `public.contract` — será criado na Fase A com o próximo número disponível, confirmado no momento da implementação (não reservar 283 agora)
- [x] Tabelas operacionais sem `contract_id` direto: `project`, `project_programming`, `project_measurement_orders`, `project_billing_orders`, `project_asbuilt_measurement_orders`, `location_planning`
- [x] Âncora operacional definida: apenas `project` receberá `contract_id` direto; demais herdam por JOIN

### Modelo de acesso
- [x] `app_user_contracts`: DDL sem campos funcionais (can_read/can_update/can_approve) validado — esses pertencem ao sistema de permissões existente (`app_user_page_permissions`)
- [x] Índice parcial para acesso global definido: `UNIQUE ON (user_id, tenant_id) WHERE contract_id IS NULL AND is_active = true`
- [x] Índice parcial para acesso específico definido: `UNIQUE ON (user_id, tenant_id, contract_id) WHERE contract_id IS NOT NULL AND is_active = true`
- [x] Trigger de validação de modo (global vs específico) definido: `validate_contract_access_mode()`
- [x] Semântica de `contract_id = NULL` documentada: acesso global a todos os contratos do tenant
- [x] Seed inicial definido: todos os usuários ativos recebem registro com `contract_id IS NULL` (acesso global) — preserva comportamento atual

### Autenticação e contexto
- [x] Algoritmo de resolução do contrato ativo documentado (5 casos — seção 3.4 do estudo técnico)
- [x] Chave de cache atual confirmada: `${token}:${requestedTenantId ?? ""}` — NÃO inclui contractId
- [x] Chave de cache futura definida: `${token}:${requestedTenantId ?? ""}:${requestedContractId ?? ""}`
- [ ] `resolveAuthenticatedAppUser()` adaptado para retornar `activeContractId` e `availableContractIds` (Fase C)
- [ ] Tipo `AuthenticatedAppUserContext` atualizado com os novos campos

### RLS
- [x] `user_can_access_scope()` assinatura validada: `(p_tenant_id uuid, p_contract_id uuid) RETURNS boolean LANGUAGE sql STABLE`
- [x] Cruzamento correto confirmado: `au.auth_user_id = auth.uid()` → `au.id` → `app_user_contracts.user_id` (campo real em `app_users` é `auth_user_id`, NÃO `id`)
- [x] NÃO usa `user_id = auth.uid()` diretamente — padrão real da migration 045 verificado
- [x] Campo de status ativo confirmado: `app_users.ativo` (NÃO `is_active`)

### Backend (service_role ignora RLS)
- [x] Padrão de validação explícita documentado: queries sempre incluem `.eq("tenant_id", tenantId).eq("contract_id", contractId)`
- [x] `contract_id` do payload do body NUNCA é confiado diretamente
- [x] Em edição: `contract_id` buscado do registro existente no banco — nunca do payload

### Frontend
- [x] Módulos operacionais usam `useState` + `useEffect` + fetch manual (NÃO TanStack Query/useQuery)
- [x] Não existe padrão de `queryKey` nos módulos operacionais — invalidação ao trocar de contrato deve ser implementada via dependência de `useEffect` no hook de cada módulo
- [ ] Mecanismo de invalidação de fetch ao trocar de contrato documentado por módulo
- [ ] Bloqueio de troca com formulário não salvo documentado (verificar `isDirty` antes de trocar)

### Nomenclatura confirmada (obrigatório usar nos documentos e migrations futuros)
- [x] As Built: `project_asbuilt_measurement_orders` (migration 177) — NÃO `measurement_asbuilt_orders`
- [x] Sem uso de `project_asbuilt_measurement_orders` em nomes errados nos documentos

---

## Pendências que bloqueiam Fase A

1. **Decisões de negócio 11.1 a 11.8** do estudo técnico ainda abertas (equipes, trafo, metas, dashboard consolidado, contrato padrão, permissões por contrato, migração gradual, estoque por contrato)
2. **Fase 1 de regras configuráveis** deve estar concluída e estável antes de iniciar
3. **Nome real da constraint UNIQUE(tenant_id)** em `public.contract` deve ser confirmado antes de criar a migration da Fase A (executar query em `pg_constraint` — ver Fase A do plano futuro)

---

## Pendências que não bloqueiam Fase A mas devem ser resolvidas antes das fases indicadas

1. **Antes da Fase C:** Definir quais rotas de API devem exigir `x-contract-id` vs quais podem operar sem contrato (telas globais do tenant)
2. **Antes da Fase G:** Mapear todas as RPCs que precisarão de `p_contract_id` adicionado na assinatura
3. **Antes da Fase H:** Definir UX de bloqueio ao trocar de contrato com formulário não salvo
4. **Antes da Fase I:** Confirmar quais dashboards devem ter modo consolidado e quais filtram apenas por contrato
5. **Antes da Fase J:** Confirmar que 100% das queries de operação passam `contract_id` explicitamente (service_role ignora RLS)

---

## Mapa de Nomes Reais (usar em TODAS as migrations deste plano)

> **Numeração:** Não usar 278 jamais. Não assumir 283 ou 284 disponíveis — confirmar próximo número real no momento de criação de cada migration.

| Módulo | Nome real verificado | Nome INCORRETO (não usar) | Migration |
|--------|---------------------|--------------------------|-----------|
| Contratos | `contract` | `contracts` | 032/033 |
| Projetos | `project` | — | 029 |
| Programação | `project_programming` | — | 067 |
| Medição | `project_measurement_orders` | `measurement_orders` | 112 |
| **As Built** | **`project_asbuilt_measurement_orders`** | **`measurement_asbuilt_orders`** | **177** |
| Faturamento | `project_billing_orders` | `billing_orders` | 176 |
| Usuários | `app_users` | — | 000 |
| Status ativo em app_users | `ativo` (BOOLEAN) | `is_active` | 000 |
| Vínculo auth em app_users | `auth_user_id` (UUID UNIQUE) | — | 000 |

---

## Primeiro Teste de Fumaça Após Fase B (app_user_contracts criada)

- [ ] Usuário sem registro em `app_user_contracts` não acessa nenhum contrato (retorna 403 ou lista vazia)
- [ ] Usuário com `contract_id = NULL` acessa todos os contratos ativos do tenant
- [ ] Usuário com `contract_id` específico não acessa outros contratos
- [ ] Impossível inserir acesso global quando existe específico ativo (trigger retorna exceção)
- [ ] Impossível inserir acesso específico quando existe global ativo (trigger retorna exceção)
- [ ] Fase 1 de regras configuráveis continua funcionando sem alteração
- [ ] Resolução de regras (`resolveBusinessRules`) não é afetada pela criação de `app_user_contracts`

---

## Referências de Migrations Relevantes

| Migration | Conteúdo relevante para este plano |
|-----------|-----------------------------------|
| 000 | Criação de `app_users` com `auth_user_id UUID UNIQUE` e `ativo BOOLEAN` |
| 015 | `current_app_user_id()` — retorna `app_users.id` via `auth.uid()` |
| 022/023 | `user_is_admin_in_tenant(p_tenant_id uuid)` — função de admin |
| 032 | Criação de `contrato` (depois `contract`) com `tenant_id UNIQUE` (1 contrato por tenant) |
| 033 | Renomeação de `contrato` para `contract`; recria policies com `user_can_access_tenant` |
| 045 | Criação de `user_can_access_tenant()` — função RLS padrão; cruzamento via `auth_user_id` |
| 177 | Criação de `project_asbuilt_measurement_orders` — nome real da tabela As Built |
| 251 | REVOKE EXECUTE de `authenticated`/`anon` em todas as RPCs SECURITY DEFINER |
| 276, 277, 279, 280 | Fase 1 de regras configuráveis (pré-requisito mínimo deste plano) |
| Fases 5/6/7 | Migrations de snapshot e aprovação — números a confirmar no momento |
| **\<proxima_migration\>** | **Fase A — Preparar contract para 1:N** |
| **\<proxima_migration\>** | **Fase B — Criar `app_user_contracts`** |
| (sem migration) | **Fase C — Adaptar `resolveAuthenticatedAppUser`** (código TypeScript) |
| **\<proxima_migration\>** | **Fase D — Criar `user_can_access_scope()`** (migration de função) |
| **\<proxima_migration\>** | **Fase E — Adicionar `contract_id` em `project`** |
| **\<proxima_migration\>** | **Fase F — Backfill de `project.contract_id`** |

> **Não reservar números agora.** Confirmar `SELECT MAX(migration_number) FROM schema_migrations` antes de criar cada migration.
