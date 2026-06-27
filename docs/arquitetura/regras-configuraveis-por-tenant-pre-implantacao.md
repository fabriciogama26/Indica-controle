# Regras Configuráveis por Tenant — Pré-Implantação
Gerado em: 2026-06-27

Todos os campos abaixo foram preenchidos com base na leitura direta das migrations e código-fonte do repositório, não por presunção.

---

## Checklist de Bloqueio

Todos os itens abaixo devem estar confirmados antes de criar a primeira migration (276).

### Confirmações de banco e schema

- [x] Nome real da tabela de contratos confirmado: **`public.contract`** (migration 033 — renomeada de `contrato`)
- [x] PK da tabela de contratos: **`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`**
- [x] Existe ou não existe UNIQUE(tenant_id, id) na tabela de contratos: **NÃO EXISTE. Existe apenas `UNIQUE(tenant_id)` — 1 contrato por tenant.**
- [x] Integridade tenant x contrato: **Opção B (trigger `validate_contract_tenant_match` — FK composta inviável)**
- [x] Campo sgd_type_id em project_programming: aceita NULL? **SIM** (migration 087 — ADD COLUMN sem NOT NULL)
- [x] Campo campo_eletrico em project_programming: aceita NULL? **SIM** (migration 110 — ADD COLUMN sem NOT NULL, constraint apenas proíbe blank, não null)
- [x] Campo electrical_eq_catalog_id em project_programming: aceita NULL? **SIM** (migration 151 — ADD COLUMN sem NOT NULL, FK com ON DELETE SET NULL)
- [x] Status COMPLETO: ainda existe em produção ou apenas legado de leitura? **LEGADO DE LEITURA — presente em múltiplas funções de banco (migrations 217, 229, 255, 256, 257, 258, 272, 274) e em 5 locais do código TypeScript. Novas gravações usam apenas CONCLUIDO. Limpeza é fase futura.**

### Confirmações de segurança e RLS

- [x] Função RLS para multi-tenant identificada: **`public.user_can_access_tenant(p_tenant_id uuid)`** — definida na migration 045
- [x] Policies de INSERT/UPDATE em tabelas de regras: **bloqueadas para usuários autenticados** (sem policies de escrita — somente via SECURITY DEFINER)
- [x] upsert_business_rule_override: sem EXECUTE para authenticated — **a ser implementado com REVOKE conforme padrão da migration 251**
- [x] tenant_id nunca aceito do payload do cliente — **confirmado: `resolveAuthenticatedAppUser()` é a única fonte**
- [x] changed_by sempre derivado de resolveAuthenticatedAppUser() — **confirmado no design**

### Confirmações de arquitetura

- [x] Vigência V1: **sem valid_from/valid_until nas migrations iniciais** (decisão D3)
- [x] Snapshot de regras: **distribuído pelas fases de integração — Fase 5 (Programação), Fase 6 (Medição e As Built), Fase 7 (Faturamento)**. Nenhum snapshot é criado na Fase 1.
- [x] As Built incluído na estratégia de snapshot — **`project_asbuilt_measurement_orders`** (nome real confirmado — NÃO `measurement_asbuilt_orders`). Migration na Fase 6.
- [x] intermediate_completion_policy: **`reject` e `allow_without_anticipation` bloqueados para produção até checklist completo** — trigger 275 valida apenas ETAPA, não work_completion_status; controle é no handler TypeScript
- [x] Migration 275 analisada e fases reordenadas — **sem conflito com intermediate_completion_policy; trigger valida ETAPA (status PROGRAMADA/REPROGRAMADA), não work_completion_status**
- [x] frontend_exposable = false como default; true apenas onde necessário — **somente `programacao.require_sgd_fields` e `programacao.export_layout`** (decisão D6)
- [x] Modelo de aprovação de faturamento: **Opção A — colunas `approved_by UUID` e `approved_at TIMESTAMPTZ` em `project_billing_orders`. Fluxo atual é simples (ABERTA/FECHADA/CANCELADA), sem múltiplas etapas.** (decisão D5) — Migration entra na **Fase 7**, não na Fase 1.

### Pendências que bloqueiam início da Fase 1

Após revisão técnica completa: **NENHUMA PENDÊNCIA BLOQUEANTE PARA A FASE 1.**

Todos os fatos foram verificados e as decisões fechadas:
- Nomes de tabelas reais confirmados.
- Campos SGD nullable confirmados (sem migration de schema necessária).
- Padrão RLS confirmado (`user_can_access_tenant`).
- Decisão de integridade de contrato confirmada (trigger — Opção B).
- Decisão de vigência confirmada (sem valid_from/valid_until em V1).

### Pendências que não bloqueiam Fase 1 mas devem ser resolvidas antes das fases indicadas

1. **Antes da Fase 3:** Confirmar com o negócio se `reject` em `intermediate_completion_policy` é desejado para algum tenant. (Fase 5 libera para testes.)
2. **Antes da Fase 5:** Executar checklist completo de `Mapa_Regras_Programacao.md` para `intermediate_completion_policy = reject` e `allow_without_anticipation`.
3. **Antes da Fase 7:** Confirmar o modelo de aprovação de faturamento com o usuário (Opção A confirmada — colunas em `project_billing_orders`). A migration de snapshot e aprovação de faturamento entra na Fase 7 (próximo número disponível, não reservado agora).
4. **Antes da Fase 7:** Verificar se existe validação atual de vínculo medição-faturamento para `faturamento.allow_billing_without_measurement = false`.
5. **Antes da Fase 9:** Confirmar público-alvo da tela administrativa (admin do SaaS, admin do tenant, ou ambos). Define `editable_by` em cada regra.
6. **Fase futura (após estabilização):** Limpeza histórica do token `COMPLETO` no banco. Confirmado que ainda existe em dados de produção.

### Nota sobre contract_business_rules (migration 278) — CANCELADA

- **DECISÃO FINAL 2026-06-27:** A migration 278 (`contract_business_rules`) está **cancelada definitivamente — nunca será criada com esse número**.
- Criar migration 278 depois que 279 e 280 já existem resultaria em aplicação fora de sequência, o que invalida o histórico de migrations.
- **A Fase 1 inclui apenas as migrations: 276, 277, 279, 280.**
- A hierarquia de resolução de regras da Fase 1 é `global → tenant` (dois níveis — sem camada de contrato).
- Quando `contract_business_rules` for necessária (após plano de acesso por contrato, Fases A+B), usar o **próximo número disponível naquele momento** — não reservar número agora.
- A hierarquia `global → tenant → contrato` só entra quando `contract_business_rules` for criada.
- O plano de acesso por contrato só deve ser iniciado APÓS as Fases 1 a 10 de regras configuráveis estarem concluídas e estáveis em produção.

---

## Mapa de Nomes Reais (usar em TODAS as migrations 276+)

| Referência nos docs anteriores | Nome real verificado | Migration de criação |
|-------------------------------|---------------------|---------------------|
| `contracts` (plural) | `contract` (singular) | 032/033 |
| `billing_orders` | `project_billing_orders` | 176 |
| `billing_order_items` | `project_billing_order_items` | 176 |
| `measurement_orders` | `project_measurement_orders` | 112 |
| `measurement_order_items` | `project_measurement_order_items` | 112 |

---

## Tabela de Nullability dos Campos SGD em project_programming

| Campo | Migration de criação | NOT NULL? | DEFAULT | Aceita NULL? |
|-------|---------------------|-----------|---------|--------------|
| `sgd_type_id` | 087 | NÃO | nenhum | SIM |
| `campo_eletrico` | 110 | NÃO | nenhum | SIM (constraint proíbe blank string, mas não NULL) |
| `electrical_eq_catalog_id` | 151 | NÃO | nenhum | SIM (FK com ON DELETE SET NULL) |

**Conclusão:** `programacao.require_sgd_fields = false` pode ser ativado sem migration de schema.

---

## Mapa da Migration 275 (trigger de integridade de ETAPA)

| Item | Valor real |
|------|-----------|
| Função criada | `public.enforce_project_programming_active_stage_required()` |
| Trigger criado | `project_programming_active_stage_valid_check` |
| Tipo | CONSTRAINT TRIGGER — DEFERRABLE INITIALLY DEFERRED |
| Evento | AFTER INSERT OR UPDATE OF `status`, `etapa_number`, `etapa_unica`, `etapa_final` |
| O que valida | Status `PROGRAMADA`/`REPROGRAMADA` exige exatamente uma das três condições: (1) etapa_number > 0 + não-unica + não-final, (2) etapa_unica = true, (3) etapa_final = true |
| Valida work_completion_status? | **NÃO** — não toca em `work_completion_status` |
| Conflita com intermediate_completion_policy = reject? | **NÃO** — são orthogonais. O trigger valida ETAPA; o handler valida work_completion_status. |
| Permissões | REVOKE ALL de public/anon/authenticated; GRANT EXECUTE a service_role |

---

## Padrão de RPC e Segurança Confirmado

| Item | Padrão real |
|------|------------|
| Cliente Supabase no backend | `service_role` (via `SUPABASE_SERVICE_ROLE_KEY` em `appUsersAdmin.ts`) |
| RPCs SECURITY DEFINER | EXECUTE revogado de `anon` e `authenticated` em TODAS as RPCs (migration 251) |
| Único caller válido das RPCs | `service_role` |
| Como o backend chama RPCs | `supabase.rpc(name, params)` onde `supabase` é o cliente com `service_role` |
| Cache de auth TTL | 45s (`AUTH_CACHE_TTL_MS = 45_000` em `appUsersAdmin.ts`) |
| Cache de catálogos TTL | 5 minutos (`CATALOG_TTL_MS = 5 * 60 * 1000` em `catalogs.ts`) |
| Cache de regras (a criar) | 60s — mesmo padrão `Map<string, { data: T; expiresAt: number }>` |

---

## Ordem de Criação das Migrations (após checklist aprovado)

| Ordem | Migration | Dependência | Impacto em produção |
|-------|-----------|-------------|-------------------|
| 1 | `276_create_business_rule_definitions.sql` | nenhuma | Zero — tabela nova vazia |
| 2 | `277_create_tenant_business_rules.sql` | 276 | Zero — tabela nova vazia |
| — | ~~`278_create_contract_business_rules.sql`~~ | — | **CANCELADA** — número nunca será usado; próximo disponível no momento da implementação futura |
| 3 | `279_create_rule_audit_logs.sql` | 276, 277 | Zero — tabela nova vazia |
| 4 | `280_seed_initial_business_rules.sql` | 279 | Zero — seed reproduz behavior atual |
| Fase 5 | `<proxima_migration>_add_snapshot_to_programming_history.sql` | `project_programming_history` | Mínimo — ADD COLUMN IF NOT EXISTS nullable |
| Fase 6 | `<proxima_migration>_add_snapshot_to_measurement.sql` | `project_measurement_orders`, `project_asbuilt_measurement_orders` | Mínimo — ADD COLUMN IF NOT EXISTS nullable |
| Fase 7 | `<proxima_migration>_add_snapshot_and_approval_to_billing.sql` | `project_billing_orders` | Mínimo — ADD COLUMN IF NOT EXISTS nullable |

> **Numeração:** Não reservar números agora. Confirmar `SELECT MAX(number) FROM schema_migrations` (ou equivalente) no momento de criar cada migration das Fases 5, 6 e 7.

---

## Primeiro Teste de Fumaça Após Fase 1

- [ ] `business_rule_definitions` criada com seed das 17 regras
- [ ] Todas as `rule_key` no formato `<modulo>.<nome>` (verificar com SELECT)
- [ ] `frontend_exposable = true` apenas para `programacao.require_sgd_fields` e `programacao.export_layout`
- [ ] `tenant_business_rules` criada, RLS funcionando com `user_can_access_tenant`
- [ ] **`contract_business_rules` NÃO existe** — migration 278 foi **cancelada definitivamente** (não postergada — nunca será criada com esse número)
- [ ] Usuário autenticado NÃO consegue fazer INSERT direto via client Supabase em `tenant_business_rules`
- [ ] `rule_audit_logs` criada, sem política de INSERT para authenticated
- [ ] `resolveBusinessRules('tenant_id_teste', ['programacao.require_sgd_fields'])` retorna `'true'` (default)
- [ ] Hierarquia de resolução funciona em dois níveis: `global → tenant` (sem nível `contract` nesta fase)
- [ ] Sem quebra em nenhum fluxo existente de Programação, Medição ou Faturamento

### Critérios de Aceite da Fase 5 (Programação completa)

- [ ] Coluna `applied_rules_snapshot JSONB` adicionada em `project_programming_history`
- [ ] Snapshot preenchido em ações de conclusão, antecipação e bloqueio por regra

### Critérios de Aceite da Fase 6 (Medição e As Built)

- [ ] Coluna `applied_rules_snapshot JSONB` adicionada em `project_measurement_orders`
- [ ] Coluna `applied_rules_snapshot JSONB` adicionada em `project_asbuilt_measurement_orders` (nome real — NÃO `measurement_asbuilt_orders`)
- [ ] Snapshot preenchido no fechamento de ordens de medição e as built

### Critérios de Aceite da Fase 7 (Faturamento)

- [ ] Coluna `applied_rules_snapshot JSONB` adicionada em `project_billing_orders`
- [ ] Colunas `approved_by UUID` e `approved_at TIMESTAMPTZ` adicionadas em `project_billing_orders` (nullable)
- [ ] Snapshot preenchido no fechamento de ordens de faturamento
- [ ] Fluxo de aprovação funciona com regra `faturamento.require_approval_before_billing`

---

## Referências de Migrations Relevantes

| Migration | Conteúdo relevante |
|-----------|-------------------|
| 032 | Criação de `contrato` com `tenant_id UNIQUE` (1 contrato por tenant) |
| 033 | Renomeação de `contrato` para `contract` |
| 045 | Criação de `user_can_access_tenant()` — função RLS padrão do sistema |
| 087 | `sgd_type_id` adicionado como nullable em `project_programming` |
| 101 | Criação de `project_programming_history` |
| 110 | `campo_eletrico` adicionado como nullable em `project_programming` |
| 112 | Criação de `project_measurement_orders` (nome real) |
| 151 | `electrical_eq_catalog_id` adicionado como nullable em `project_programming` |
| 176 | Criação de `project_billing_orders` (nome real) |
| 177 | Criação de `project_asbuilt_measurement_orders` (nome real — NÃO `measurement_asbuilt_orders`) |
| 229 | RPC `save_project_programming_work_completion_status_full` — bloqueia CONCLUIDO/COMPLETO |
| 251 | REVOKE EXECUTE de `authenticated`/`anon` em todas as RPCs SECURITY DEFINER |
| 255 | Adição de ANTECIPADO ao catálogo; RPC `mark_project_programming_future_stages_anticipated` |
| 258 | Trigger `enforce_interrupted_programming_completed_work_status` — bloqueia ADIADA/CANCELADA com CONCLUIDO |
| 272 | Endurecimento de `mark_project_programming_future_stages_anticipated` |
| 275 | Trigger `project_programming_active_stage_valid_check` — valida ETAPA em PROGRAMADA/REPROGRAMADA (NÃO valida work_completion_status) |
