# Regras Configuráveis por Tenant — Plano de Implementação
Gerado em: 2026-06-27 | Revisado em: 2026-06-27 (revisão técnica obrigatória)

Pré-requisito: leitura e validação de `regras-configuraveis-por-tenant-estudo.md` e `regras-configuraveis-por-tenant-inventario.md`.

Toda `rule_key` usa namespace de módulo obrigatório (`<modulo>.<nome>`). Não usar chaves sem namespace — a coluna `rule_key` em `business_rule_definitions` é UNIQUE global; o namespace previne colisão entre módulos.

---

## 1. Decisões Técnicas Fechadas (verificadas no repositório)

| Decisão | Resultado |
|---------|-----------|
| D1 — Integridade contrato-tenant — **REFERÊNCIA FUTURA** | `contract_business_rules` não existe nas Fases 1-10. Esta decisão é preservada para quando a tabela for criada (Fases A+B do plano de acesso por contrato). Após a Fase A (adição de UNIQUE(tenant_id, id) em `contract`), FK composta se tornará viável e trigger poderá ser substituído. **Não aplicável agora.** |
| D2 — Padrão RLS | `public.user_can_access_tenant(tenant_id)` — função definida na migration 045. Não usar claims JWT. |
| D3 — Vigência em V1 | **Sem vigência**: `valid_from`/`valid_until` removidos de `tenant_business_rules`. UNIQUE(tenant_id, rule_key) sem ambiguidade. Vigência é feature futura. |
| D4 — Snapshot | `project_programming_history` para programação. Para medição, as built e faturamento: coluna `applied_rules_snapshot JSONB` nas próprias tabelas de operação (sem histórico dedicado nestes módulos). |
| D5 — Aprovação de faturamento | **Opção A**: campos `approved_by UUID` e `approved_at TIMESTAMPTZ` em `project_billing_orders`. Fluxo atual é simples (ABERTA/FECHADA/CANCELADA), sem múltiplas etapas. Migration na Fase 7. |
| D6 — frontend_exposable default | **false**. Apenas `programacao.require_sgd_fields` e `programacao.export_layout` recebem `true`. |
| D7 — intermediate_completion_policy | Trigger 275 valida ETAPA, não `work_completion_status` — sem conflito direto. `reject` e `allow_without_anticipation` são bloqueados para produção até teste completo do checklist. |

---

## 2. Roadmap por Fases

### Fase 0 — Auditoria e congelamento (concluída com este estudo)

**Objetivo:** Mapear o estado atual, identificar hardcodes e propor arquitetura.

**Resultado:** Os três arquivos em `docs/arquitetura/`:
- `regras-configuraveis-por-tenant-estudo.md`
- `regras-configuraveis-por-tenant-inventario.md`
- `regras-configuraveis-por-tenant-plano.md` (este arquivo)
- `regras-configuraveis-por-tenant-pre-implantacao.md` (checklist)

**Critério de aceite:** Documentação revisada e validada pelo usuário. Lista de decisões técnicas D1-D7 fechadas.

**Dependências:** Nenhuma.

---

### Fase 1 — Fundação: tabelas e migrations

**Objetivo:** Criar a infraestrutura de dados no banco sem alterar comportamento existente.

**Arquivos/áreas afetados:**
- `supabase/migrations/276_create_business_rule_definitions.sql`
- `supabase/migrations/277_create_tenant_business_rules.sql`
- ~~`supabase/migrations/278_create_contract_business_rules.sql`~~ — **CANCELADA** (ver nota abaixo)
- `supabase/migrations/279_create_rule_audit_logs.sql`
- `supabase/migrations/280_seed_initial_business_rules.sql`
- ~~`supabase/migrations/281_add_applied_rules_snapshot_columns.sql`~~ — **REMOVIDA DA FASE 1** (ver nota abaixo)

**Migrations necessárias:** ver Seção 3 deste documento. A migration 278 foi cancelada definitivamente. O bloco monolítico de snapshots (antes referenciado como 281) foi dividido em três migrations separadas nas Fases 5, 6 e 7 — cada uma usa o próximo número disponível no momento da implementação.

**Impacto esperado:** Zero impacto em produção. As tabelas são criadas vazias (exceto `business_rule_definitions` com defaults). Nenhum código existente é alterado.

**Riscos:**
- O seed deve ter exatamente 17 regras, todas com `default_value` que reproduz o comportamento hardcoded atual.

**DECISÃO 2026-06-27 — Migration 278 CANCELADA (não postergada):**
A migration `278_create_contract_business_rules.sql` **não será criada**. Como as migrations 279 e 280 serão aplicadas antes, criar uma migration de número 278 futuramente resultaria em aplicação fora de ordem — o que é inválido em projetos com migrations sequenciais. Quando `contract_business_rules` for necessária (após Fases A+B do plano de acesso por contrato), usar o **próximo número disponível no momento** — não reservar nem assumir nenhum número agora.

**DECISÃO 2026-06-27 — Migration 281 REMOVIDA DA FASE 1:**
A migration `281_add_applied_rules_snapshot_columns.sql` foi removida da Fase 1. A Fase 1 deve ser estritamente aditiva (novas tabelas vazias + seed). Adicionar colunas em tabelas operacionais antes de qualquer handler usar essas colunas cria código morto e aumenta o risco de rollback. Distribuição:
- **Fase 5** (Programação completa): snapshot em `project_programming_history`
- **Fase 6** (Medição e As Built): snapshot em `project_measurement_orders` e `project_asbuilt_measurement_orders`
- **Fase 7** (Faturamento): snapshot em `project_billing_orders` + colunas `approved_by`/`approved_at`

**A Fase 1 inclui apenas as migrations: 276, 277, 279, 280.**

**Ajuste no `allowed_scopes` de `business_rule_definitions`:** Na Fase 1, nenhuma regra terá `allowed_scopes` incluindo `'contract'`. O valor `'contract'` em `allowed_scopes` só será habilitado quando `contract_business_rules` for criada.

**Rollback:** `DROP TABLE` das 4 tabelas criadas (276, 277, 279, 280) — sem impacto em código existente. Não há colunas em tabelas operacionais para reverter nesta fase.

**Testes necessários:**
- Aplicar migrations em ambiente de staging.
- Verificar que todas as tabelas têm RLS ativa.
- Confirmar que a seed de `business_rule_definitions` está correta (defaults = comportamento atual).
- Verificar constraint UNIQUE em `rule_key` — tentar inserir chave duplicada deve falhar.
- Verificar que usuário autenticado NÃO consegue INSERT/UPDATE direto em `tenant_business_rules`.
- Verificar que `contract_business_rules` NÃO existe (não foi criada na Fase 1).

**Critério de aceite:** Migrations 276, 277, 279, 280 aplicadas, tabelas acessíveis via Supabase Studio, RLS verificada, seed com 17 regras confirmada. Nenhuma coluna adicionada em tabelas operacionais nesta fase.

**Dependências:** Fase 0 concluída e validada.

---

### Fase 2 — Serviço central de resolução de regras

**Objetivo:** Criar o serviço TypeScript de resolução de regras com cache, sem modificar nenhum handler existente.

**Arquivos/áreas afetados:**
- `src/lib/server/businessRules.ts` — lógica de resolução com hierarquia **`global → tenant`** (sem contract_business_rules — decisão de postergar; a hierarquia completa `global → tenant → contrato` entra junto com o plano de acesso por contrato)
- `src/lib/server/businessRulesCache.ts` — cache in-process com TTL de 60s por tenant (mesmo padrão `Map<string, { data: T; expiresAt: number }>` de `catalogs.ts`)
- `src/lib/server/businessRuleKeys.ts` — constantes TypeScript de todas as rule_keys com namespace

**Impacto esperado:** Zero impacto em produção. Os arquivos são criados mas não importados por nenhum handler ainda.

**Riscos:**
- Cache in-process é por instância serverless Vercel — isolado entre instâncias. TTL de 60s é o fallback de consistência eventual.
- Regras com `criticality = 'critical'` devem sempre re-fetchar antes de operações críticas — implementar `bypassCache` no início.

**Rollback:** Remover os três arquivos.

**Testes necessários:**
- Testes unitários para `resolveBusinessRule()` com hierarquia `global → tenant` (sem contrato na Fase 2).
- Testes de borda: regra inexistente → fallback para default; tenant sem configuração → usa default.
- Testes de precedência: override de tenant vence default; sem override → default do catálogo.
- Teste de lote: `resolveBusinessRules()` com 20 chaves em uma única query.
- Teste de cache: segunda chamada para o mesmo tenant usa cache (sem query ao banco).

**Nota:** A hierarquia completa `global → tenant → contrato` e os testes de `contract vence tenant` só entram quando `contract_business_rules` for criada (plano de acesso por contrato, após Fase A+B).

**Critério de aceite:** Funções exportadas, testadas e documentadas. Nenhum handler modificado.

**Dependências:** Fase 1 concluída.

---

### Fase 3 — Integração backend: handlers críticos de Programação

**Objetivo:** Integrar `resolveBusinessRules()` nos handlers mais críticos do módulo Programação, substituindo os hardcodes de maior risco. `programacao.require_sgd_fields` é a primeira regra a ser implementada.

**Pré-verificação obrigatória — confirmada na Fase 0:**
- `sgd_type_id`: nullable no banco (migration 087 — ADD COLUMN sem NOT NULL)
- `campo_eletrico`: nullable no banco (migration 110 — ADD COLUMN sem NOT NULL)
- `electrical_eq_catalog_id`: nullable no banco (migration 151 — ADD COLUMN sem NOT NULL)
- **Nenhuma migration de schema necessária** para ativar `programacao.require_sgd_fields = false`.

**Arquivos/áreas afetados:**
- `src/server/modules/programacao/handlers.ts` — principal
- `src/app/api/programacao/route.ts` — validação de motivo >= N chars

**Regras a migrar nesta fase:**
- `programacao.require_sgd_fields` — campos SGD obrigatórios (primeira regra)
- `programacao.block_operations_if_project_concluded` — bloqueio por CONCLUIDO
- `programacao.min_cancel_reason_chars` — mínimo de caracteres para motivo de cancelamento
- `programacao.min_reschedule_reason_chars` — mínimo de caracteres para reprogramação
- `programacao.intermediate_completion_policy` — política de conclusão em etapa não-final

**Comportamento por valor de `programacao.intermediate_completion_policy`:**

- **`reject`**: handler retorna erro se `etapa_final = false` e status destino é `CONCLUIDO`. RPC `mark_project_programming_future_stages_anticipated` não é chamada. O trigger de banco (migration 275, DEFERRED) valida apenas integridade de ETAPA — não bloqueia CONCLUIDO por si só. O handler TypeScript é o único controle para `reject`.
- **`mark_future_as_anticipated`** (default — comportamento atual): chama `mark_project_programming_future_stages_anticipated` após salvar `CONCLUIDO` em qualquer etapa numérica.
- **`allow_without_anticipation`**: aceita `CONCLUIDO` em qualquer etapa; não chama a RPC de antecipação; etapas futuras permanecem inalteradas.

**Bloqueio de produção para reject/allow_without_anticipation:** Esses dois valores não devem ser configurados em ambiente de produção até que o checklist completo de `Mapa_Regras_Programacao.md` seja executado com eles ativos.

**Impacto esperado:** Comportamento idêntico ao atual para todos os tenants (defaults = comportamento hardcoded). Primeiro handler a usar `resolveBusinessRules()`.

**Riscos:**
- Alterar `handlers.ts` é cirúrgico mas de alto risco — este arquivo tem mais de 2000 linhas.
- A chamada a `resolveBusinessRules()` adiciona latência mínima. O cache deve estar ativo e testado antes.
- Se o banco não tiver a seed correta, o fallback para `default_value` deve garantir comportamento original.

**Rollback:** Reverter `handlers.ts` e `programacao/route.ts` para valores hardcoded anteriores. As tabelas de regras permanecem (Fase 1 é independente).

**Testes necessários:**
- Teste de regressão completo do módulo Programação (checklist de `Mapa_Regras_Programacao.md`).
- Teste com `programacao.require_sgd_fields = false` para um tenant de teste — campos SGD não são mais exigidos.
- Teste de performance: criação de programação com resolução de regras < 100ms total.

**Critério de aceite:** Todos os casos do checklist de `Mapa_Regras_Programacao.md` passam. Um tenant de teste com `programacao.require_sgd_fields = false` consegue salvar programação sem campos SGD.

**Dependências:** Fases 1 e 2 concluídas.

---

### Fase 4 — Integração front-end (context/hook)

**Objetivo:** Criar hook React para regras que o frontend precisa conhecer, consumindo apenas regras com `frontend_exposable = true`.

**Arquivos/áreas afetados:**
- `src/hooks/useBusinessRules.ts` — hook React com query ao endpoint
- `src/app/api/business-rules/route.ts` — endpoint GET autenticado; filtra por `frontend_exposable = true`
- `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` — consumo do hook

**Regras a expor para o frontend nesta fase (as únicas com frontend_exposable = true):**
- `programacao.export_layout` — determina qual botão de exportação aparece e com qual label
- `programacao.require_sgd_fields` — determina se campos SGD são exibidos no formulário

**Impacto esperado:** Para tenants com `programacao.export_layout != 'ENEL_EXCEL'`, o botão "ENEL-EXCEL" não aparece. Para o default `ENEL_EXCEL`, comportamento idêntico ao atual.

**Decisão — padrão do hook (Opção B confirmada):**

Os módulos operacionais atuais usam `useState + useEffect + fetch manual` — não usam TanStack Query, `useQuery` nem `queryKey`. Introduzir TanStack Query nesta fase adicionaria `QueryClient`, provider e padrão de invalidação sem benefício proporcional para um hook simples de regras com TTL de 60s no servidor.

**`useBusinessRules` usará o mesmo padrão dos módulos existentes:**
```typescript
const [rules, setRules] = useState<Record<string, string>>({});
useEffect(() => {
  fetch('/api/business-rules?keys=...').then(r => r.json()).then(setRules);
}, [ruleKeys.join(',')]);
```

Se TanStack Query for adotado globalmente em uma fase futura, este hook poderá ser migrado sem impacto nos handlers.

**Riscos:**
- Se o endpoint de regras falhar, o frontend deve usar defaults seguros (regras mais restritivas).
- Regras com `frontend_exposable = false` nunca devem aparecer na resposta do endpoint.

**Rollback:** Remover o hook e restaurar valores hardcoded no frontend. Endpoint pode ser deixado inativo.

**Testes necessários:**
- `useBusinessRules` retorna defaults corretos sem configuração de tenant.
- Botão ENEL-EXCEL some para tenant com `programacao.export_layout = 'DEFAULT'`.
- Campos SGD são ocultos para tenant com `programacao.require_sgd_fields = false`.
- Endpoint não expõe regras com `frontend_exposable = false`.

**Critério de aceite:** Pelo menos duas regras visuais funcionando de ponta a ponta (banco → endpoint → hook → UI).

**Dependências:** Fases 2 e 3 concluídas.

---

### Fase 5 — Programação: migração completa de todas as regras

**Objetivo:** Concluir a migração de todas as regras identificadas no inventário para o módulo Programação.

**Arquivos/áreas afetados:**
- `src/server/modules/programacao/handlers.ts`
- `src/server/modules/programacao/rpc.ts`
- `src/server/modules/programacao/normalizers.ts`
- `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx`
- `src/modules/dashboard/programacao-simples/exports.ts`

**Regras a finalizar:**
- `programacao.allow_manual_antecipado`
- `programacao.require_final_stage_for_completion`
- `programacao.allow_overlapping_schedules`
- `programacao.export_layout` (completo — múltiplos layouts via catálogo `programming_export_column_definitions`)

**Migration desta fase:**
- `<proxima_migration>_add_snapshot_to_programming_history.sql` — adiciona `applied_rules_snapshot JSONB` em `project_programming_history` (preenchido em ações de conclusão, antecipação e bloqueio por regra). Confirmar próximo número disponível no momento da Fase 5.

**Impacto esperado:** Módulo Programação totalmente configurável por tenant. Nenhum hardcode de comportamento restante (exceto constantes técnicas como chunk size).

**Riscos:**
- `programacao.allow_manual_antecipado` afeta a lógica de `isAnticipatedWorkStatus()` — usada em múltiplos lugares; precisa de refactoring cuidadoso.
- O CHECK constraint de `export_column` (migration 087) só pode ser removido após catálogo `programming_export_column_definitions` criado, populado e código migrado.
- `reject` e `allow_without_anticipation` em `intermediate_completion_policy`: liberados para teste nesta fase, mas não ativar em produção sem checklist completo.

**Rollback:** Por regra — cada regra tem fallback para `default_value`. Rollback total: reverter para hardcodes da Fase 3.

**Testes necessários:**
- Suite completa do checklist de Programação.
- Teste com tenant configurado para cada nova regra — verificar comportamento.
- Teste de cross-tenant: configuração de tenant A não afeta tenant B.
- Teste específico de `intermediate_completion_policy = reject` e `allow_without_anticipation` com checklist completo.

**Critério de aceite:** Checklist de `Mapa_Regras_Programacao.md` passa 100%. Nenhum `if` de comportamento fixo no módulo Programação.

**Dependências:** Fase 4 concluída.

---

### Fase 6 — Migração Medição e As Built

**Objetivo:** Integrar `resolveBusinessRules()` nos handlers de Medição e As Built.

**Arquivos/áreas afetados:**
- `src/app/api/medicao/route.ts`
- `src/app/api/medicao-asbuilt/route.ts` (se existir)
- `src/app/api/medicao/minimum-billing/route.ts`

**Tabelas reais afetadas:** `project_measurement_orders`, `project_asbuilt_measurement_orders`

**Regras a migrar:**
- `medicao.enable_minimum_billing`
- `medicao.require_programming_match`
- `medicao.max_backdate_days`

**Migration desta fase:**
- `<proxima_migration>_add_snapshot_to_measurement.sql` — adiciona `applied_rules_snapshot JSONB` em `project_measurement_orders` e `project_asbuilt_measurement_orders` (nome real confirmado na migration 177; sem tabela de histórico dedicada nesses módulos). Confirmar próximo número disponível no momento da Fase 6.

**Impacto esperado:** Medição configurável por tenant. Tenants com `medicao.enable_minimum_billing = false` não calculam garantia mínima.

**Riscos:**
- `medicao.max_backdate_days = 0` (sem limite) é o default — confirmar que isso não quebra validações existentes de data retroativa.
- `medicao.require_programming_match` pode requerer mudança em como o campo `programming_id` é tratado no cadastro.

**Rollback:** Por regra — revertendo para valores hardcoded inline no route handler.

**Testes necessários:**
- Criar medição com data retroativa além do limite configurado — deve ser bloqueada.
- Criar medição sem `programming_id` com `medicao.require_programming_match = true` — deve ser bloqueada.
- Garantia mínima não é calculada com `medicao.enable_minimum_billing = false`.

**Critério de aceite:** Regras de Medição configuráveis e testadas.

**Dependências:** Fase 5 concluída.

---

### Fase 7 — Migração Faturamento

**Objetivo:** Integrar `resolveBusinessRules()` no módulo de Faturamento.

**Arquivos/áreas afetados:**
- `src/app/api/faturamento/route.ts`
- `src/modules/dashboard/faturamento/BillingPageView.tsx`

**Tabela real afetada:** `project_billing_orders`

**Regras a migrar:**
- `faturamento.min_cancel_reason_chars`
- `faturamento.require_approval_before_billing`
- `faturamento.allow_billing_without_measurement`

**Modelo de aprovação (Decisão D5 — Opção A):**
O fluxo atual tem status `ABERTA/FECHADA/CANCELADA`. Para `faturamento.require_approval_before_billing = true`, adicionar na Fase 7:

```sql
ALTER TABLE public.project_billing_orders
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Ambas nullable — NULL = não aprovado ainda ou regra não ativa
```

**Nota sobre `faturamento.require_approval_before_billing`:** esta regra tem `criticality = 'critical'`. O handler de faturamento deve sempre re-fetchar o valor do banco (sem cache, `bypassCache: true`) ao executar a operação de fechamento do faturamento.

**Migration desta fase:**
- `<proxima_migration>_add_snapshot_and_approval_to_billing.sql` — adiciona `applied_rules_snapshot JSONB` + colunas `approved_by UUID` e `approved_at TIMESTAMPTZ` em `project_billing_orders` (ambas nullable; aprovação entra nesta fase junto com a regra). Confirmar próximo número disponível no momento da Fase 7.

**Impacto esperado:** Faturamento configurável. Para tenants com `faturamento.require_approval_before_billing = true`, será necessário adicionar campo de aprovação na tela e validação no backend.

**Riscos:**
- `faturamento.allow_billing_without_measurement` afeta a criação de faturamento — verificar se existe validação atual de vínculo com medição.

**Rollback:** Por regra — revertendo para valores hardcoded.

**Testes necessários:**
- Motivo de cancelamento com menos de `faturamento.min_cancel_reason_chars` é rejeitado.
- Faturamento sem medição é bloqueado para tenants com `faturamento.allow_billing_without_measurement = false`.
- Regra `faturamento.require_approval_before_billing = true` sempre re-fetcha do banco (sem cache) antes da operação crítica.

**Critério de aceite:** Regras de Faturamento configuráveis e testadas.

**Dependências:** Fase 6 concluída.

---

### Fase 8 — Migração demais módulos

**Objetivo:** Migrar regras restantes de menor prioridade: Projetos, Equipes, Estoque.

**Arquivos/áreas afetados:**
- `src/server/modules/projects/authorization.ts`
- `src/app/api/teams/route.ts`
- `src/app/api/projects/route.ts`

**Regras a migrar:**
- `projetos.require_contract_link`
- `equipes.enforce_unique_foreman_per_team`

**Nota:** `auth.session_idle_timeout_minutes` não vira config de tenant — permanece via variável de ambiente (`NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES`).

**Riscos:** Baixos. `equipes.enforce_unique_foreman_per_team` já tem constraint no banco (migration 054) — relaxar a constraint ou torná-la condicional pode requerer migration adicional.

**Rollback:** Por regra.

**Testes necessários:** Testes específicos de cada regra migrada.

**Critério de aceite:** Regras dos módulos restantes configuráveis.

**Dependências:** Fase 7 concluída.

---

### Fase 9 — Tela administrativa e auditoria

**Objetivo:** Criar interface para que admins do SaaS ou do tenant configurem regras sem intervenção de código.

**Arquivos/áreas afetados:**
- `src/app/(dashboard)/admin-regras/page.tsx` (nova rota)
- `src/modules/dashboard/admin-regras/` (novo módulo)
- `src/app/api/business-rules/route.ts` (estender com POST/PUT via `upsert_business_rule_override`)
- `supabase/migrations/<proxima_migration>_admin_rules_page_permission.sql` (confirmar número disponível no momento da Fase 9)

**Funcionalidades mínimas:**
- Listar regras ativas do tenant com valor atual, default e metadados (`criticality`, `editable_by`).
- Editar valor de uma regra — apenas regras com `editable_by = 'tenant_admin'` para admins de tenant; todas para admins do SaaS.
- Visualizar histórico de `rule_audit_logs` por regra (old_value, new_value, changed_by, reason, changed_at).
- Filtro por módulo.

**Rollback:** Desativar a rota na configuração de páginas. As configurações salvas permanecem no banco.

**Dependências:** Fase 8 concluída.

---

### Fase 10 — Remoção de hardcodes e consolidação

**Objetivo:** Remover todo código de compatibilidade, aliases de hardcodes e normalizers duplicados entre módulos. Centralizar `isCompletedWorkStatus()` em um único utilitário.

**Arquivos/áreas afetados:**
- `src/app/api/medicao/route.ts` — remover verificação inline de COMPLETO
- `src/app/api/mapa-programacao/route.ts` — remover `isCompletedWorkStatus` local (linha 127)
- `src/modules/dashboard/programacao-simples/utils.ts` — remover implementação local (linha 782)
- `src/modules/dashboard/medicao/MeasurementPageView.tsx` — remover verificação inline (linha 544)
- `src/server/modules/programacao/normalizers.ts` — manter como fonte única de `isCompletedWorkStatus()`
- `src/server/modules/dashboard-measurement/controller.ts` — remover reimplementação paralela (linha 189)

**Impacto esperado:** Código mais limpo. `isCompletedWorkStatus()` em um único arquivo. Regras centralizadas em `businessRules.ts`.

**Testes necessários:**
- Suite de regressão completa de todos os módulos.
- Verificar que `isCompletedWorkStatus()` aceita `CONCLUIDO` e `COMPLETO` (alias legado) — não remover suporte a `COMPLETO` até limpeza histórica confirmada.

**Critério de aceite:** Zero duplicação de lógica de regras de negócio entre módulos. `businessRuleKeys.ts` é a fonte única de chaves. `normalizers.ts` é a fonte única de `isCompletedWorkStatus()`.

**Dependências:** Fase 9 concluída.

---

## 3. DDL Completo das Migrations Sugeridas

Os números seguem a sequência do projeto (última migration confirmada: 275).

### `276_create_business_rule_definitions.sql`

```sql
-- Catálogo global de definições de regras (sem tenant_id)
-- rule_key DEVE ter formato '<modulo>.<nome>' — namespace previne colisão entre módulos
-- frontend_exposable: default false. Apenas programacao.require_sgd_fields e
-- programacao.export_layout recebem true (decisão D6).
CREATE TABLE IF NOT EXISTS public.business_rule_definitions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key              TEXT NOT NULL UNIQUE,
  module                TEXT NOT NULL,
  description           TEXT NOT NULL,
  value_type            TEXT NOT NULL,
  default_value         TEXT NOT NULL,
  allowed_values        JSONB,
  allowed_scopes        TEXT[] NOT NULL DEFAULT '{tenant}',
  editable_by           TEXT NOT NULL DEFAULT 'admin',
  frontend_exposable    BOOLEAN NOT NULL DEFAULT false,
  criticality           TEXT NOT NULL DEFAULT 'low',
  requires_change_reason BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT brd_value_type_check CHECK (value_type IN ('boolean','number','string','enum','json')),
  CONSTRAINT brd_editable_by_check CHECK (editable_by IN ('admin','tenant_admin','none')),
  CONSTRAINT brd_criticality_check CHECK (criticality IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS idx_brd_module_active
  ON public.business_rule_definitions (module, is_active);

ALTER TABLE IF EXISTS public.business_rule_definitions ENABLE ROW LEVEL SECURITY;

-- DECISÃO: sem SELECT direto para authenticated.
-- A tabela contém metadados internos (criticality, editable_by, allowed_values, defaults técnicos)
-- que NÃO devem ser expostos diretamente ao navegador.
-- Acesso: apenas via service_role no backend (appUsersAdmin / handlers).
-- Regras com frontend_exposable = true são entregues ao front pelo endpoint /api/business-rules,
-- que filtra e retorna apenas { rule_key, resolved_value } — sem metadados internos.
-- Sem política de SELECT/INSERT/UPDATE/DELETE para roles de usuário — somente via migration e service_role.
```

### `277_create_tenant_business_rules.sql`

```sql
-- Override de regras por tenant (sem vigência em V1 — decisão D3)
-- Política RLS usa user_can_access_tenant (padrão real do sistema, migration 045)
-- NÃO usar auth.jwt()->>'tenant_id' — padrão não usado neste projeto
CREATE TABLE IF NOT EXISTS public.tenant_business_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  rule_key    TEXT NOT NULL REFERENCES public.business_rule_definitions(rule_key),
  rule_value  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  -- valid_from e valid_until AUSENTES em V1 (decisão D3)
  created_by  UUID REFERENCES public.app_users(id),
  updated_by  UUID REFERENCES public.app_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_tbr_tenant_key_active
  ON public.tenant_business_rules (tenant_id, rule_key, is_active);

ALTER TABLE IF EXISTS public.tenant_business_rules ENABLE ROW LEVEL SECURITY;

-- Política RLS usando padrão real do sistema (user_can_access_tenant)
DROP POLICY IF EXISTS tenant_rules_select ON public.tenant_business_rules;
CREATE POLICY tenant_rules_select ON public.tenant_business_rules
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));

-- Escrita: bloqueada para roles de usuário diretamente
-- Insert/Update/Delete ocorrem APENAS via upsert_business_rule_override (SECURITY DEFINER)
-- Não criar políticas de INSERT/UPDATE/DELETE para roles de usuário
```

### ~~`278_create_contract_business_rules.sql`~~ — CANCELADA

> **Esta migration não será criada.** As migrations 279 e 280 já foram planejadas com números maiores, tornando impossível inserir 278 no histórico sem quebrar a sequência. Quando `contract_business_rules` for necessária (após as Fases A+B do plano de acesso por contrato), usar o próximo número disponível naquele momento.
>
> O DDL de referência abaixo é mantido apenas para documentação do design futuro.

```sql
-- REFERÊNCIA FUTURA — NÃO APLICAR como migration 278
-- Usar próximo número disponível quando contract_business_rules for criada
-- Override de regras por contrato
-- Integridade: trigger (Opção B — decisão D1 confirmada)
-- Tabela real de contratos: public.contract (não "contracts" — verificado migration 033)
-- contract tem tenant_id UNIQUE (1 contrato por tenant) — FK composta inviável

CREATE TABLE IF NOT EXISTS public.contract_business_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  contract_id UUID NOT NULL,
  rule_key    TEXT NOT NULL REFERENCES public.business_rule_definitions(rule_key),
  rule_value  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES public.app_users(id),
  updated_by  UUID REFERENCES public.app_users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, contract_id, rule_key)
  -- FK composta AUSENTE: não existe UNIQUE(tenant_id, id) em public.contract
  -- Integridade garantida pelo trigger abaixo
);

CREATE INDEX IF NOT EXISTS idx_cbr_tenant_contract_key_active
  ON public.contract_business_rules (tenant_id, contract_id, rule_key, is_active);

-- Trigger de validação de integridade tenant x contract (Opção B confirmada)
-- Referencia public.contract (nome real — migration 033)
CREATE OR REPLACE FUNCTION public.validate_contract_tenant_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contract
    WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'contract_id % nao pertence ao tenant_id %', NEW.contract_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_contract_tenant_match() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_contract_tenant_match() TO service_role;

DROP TRIGGER IF EXISTS trg_cbr_validate_tenant ON public.contract_business_rules;
CREATE TRIGGER trg_cbr_validate_tenant
  BEFORE INSERT OR UPDATE ON public.contract_business_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_contract_tenant_match();

ALTER TABLE IF EXISTS public.contract_business_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_rules_select ON public.contract_business_rules;
CREATE POLICY contract_rules_select ON public.contract_business_rules
  FOR SELECT TO authenticated USING (public.user_can_access_tenant(tenant_id));
-- Sem política de INSERT/UPDATE/DELETE — escrita via upsert_business_rule_override
```

### `279_create_rule_audit_logs.sql`

```sql
-- Log imutável de mudanças em regras — append-only
-- Referencia public.contract (nome real — verificado migration 033)
-- Em INSERT: OLD não existe → usar NULL para old_value e old_record
-- Em UPDATE: gravar OLD e NEW com snapshots completos
-- Em DELETE: NEW não existe → usar NULL para new_value e new_record
CREATE TABLE IF NOT EXISTS public.rule_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('tenant','contract')),
  scope_id    UUID NOT NULL,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  contract_id UUID REFERENCES public.contract(id),
  -- Referencia public.contract (não contracts)
  rule_key    TEXT NOT NULL,
  old_value   TEXT,       -- NULL em INSERT
  new_value   TEXT,       -- NULL em DELETE
  old_record  JSONB,      -- snapshot completo anterior; NULL em INSERT
  new_record  JSONB,      -- snapshot completo novo; NULL em DELETE
  changed_by  UUID NOT NULL REFERENCES auth.users(id),
  reason      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ral_tenant_key_changed
  ON public.rule_audit_logs (tenant_id, rule_key, changed_at DESC);

ALTER TABLE IF EXISTS public.rule_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON public.rule_audit_logs;
CREATE POLICY audit_logs_select ON public.rule_audit_logs
  FOR SELECT TO authenticated
  USING (public.user_can_access_tenant(tenant_id));
-- Sem política de INSERT (insert via trigger SECURITY DEFINER) e sem UPDATE/DELETE jamais

-- ESTRATÉGIA DE AUDITORIA:
-- O caminho principal de escrita é: upsert_business_rule_override (Fase 9)
--   → recebe p_reason → insere diretamente em rule_audit_logs com reason preenchido.
-- O trigger abaixo é uma PROTEÇÃO SECUNDÁRIA para escritas diretas via SQL administrativo,
-- onde p_reason não está disponível. Nesses casos, reason = NULL é aceitável.
-- Regras com requires_change_reason = true: a validação da justificativa ocorre em
-- upsert_business_rule_override (que recusa se p_reason for NULL/vazio).
-- O trigger NÃO substitui o INSERT direto feito pela RPC — ambos coexistem.

CREATE OR REPLACE FUNCTION public.log_tenant_business_rule_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Trigger acionado apenas por escrita direta (não via upsert_business_rule_override,
  -- que já insere em rule_audit_logs com reason correto antes de alterar a linha).
  -- reason = NULL aqui é esperado — escritas diretas não têm contexto de justificativa.
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.rule_audit_logs
      (action, scope_type, scope_id, tenant_id, rule_key, old_value, new_value, old_record, new_record, changed_by, reason)
    VALUES
      ('INSERT', 'tenant', NEW.tenant_id, NEW.tenant_id, NEW.rule_key,
       NULL, NEW.rule_value, NULL, to_jsonb(NEW), NEW.updated_by, NULL);
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.rule_audit_logs
      (action, scope_type, scope_id, tenant_id, rule_key, old_value, new_value, old_record, new_record, changed_by, reason)
    VALUES
      ('UPDATE', 'tenant', NEW.tenant_id, NEW.tenant_id, NEW.rule_key,
       OLD.rule_value, NEW.rule_value, to_jsonb(OLD), to_jsonb(NEW), NEW.updated_by, NULL);
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.rule_audit_logs
      (action, scope_type, scope_id, tenant_id, rule_key, old_value, new_value, old_record, new_record, changed_by, reason)
    VALUES
      ('DELETE', 'tenant', OLD.tenant_id, OLD.tenant_id, OLD.rule_key,
       OLD.rule_value, NULL, to_jsonb(OLD), NULL, OLD.updated_by, NULL);
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_tenant_business_rule_change() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_tenant_business_rule_change() TO service_role;

DROP TRIGGER IF EXISTS trg_tbr_audit ON public.tenant_business_rules;
CREATE TRIGGER trg_tbr_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_business_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_tenant_business_rule_change();
```

### `280_seed_initial_business_rules.sql`

```sql
-- Seed do catálogo de regras com defaults que reproduzem o comportamento atual
-- Todas as rule_key usam namespace de módulo obrigatório
-- auto_anticipate_on_conclusion e intermediate_completion_as_anticipated foram REMOVIDAS
-- e substituídas por programacao.intermediate_completion_policy (enum)
-- frontend_exposable = false por padrão (decisão D6)
-- Apenas programacao.require_sgd_fields e programacao.export_layout = true
INSERT INTO public.business_rule_definitions
  (rule_key, module, description, value_type, default_value, allowed_values,
   allowed_scopes, editable_by, frontend_exposable, criticality, requires_change_reason, is_active)
VALUES
  -- MÓDULO: programacao
  (
    'programacao.require_sgd_fields',
    'programacao',
    'Exige sgdTypeId, electricalField e electricalEqCatalogId para salvar programacao. Campos sao nullable no banco. Primeira regra a implementar.',
    'boolean', 'true', NULL,
    '{tenant,contract}', 'tenant_admin', true, 'high', false, true
  ),
  (
    'programacao.intermediate_completion_policy',
    'programacao',
    'Politica ao salvar CONCLUIDO em etapa nao-final. reject=bloqueia (handler TypeScript); mark_future_as_anticipated=antecipa etapas futuras (default); allow_without_anticipation=aceita sem antecipar. reject e allow_without_anticipation exigem teste completo antes de producao.',
    'enum', 'mark_future_as_anticipated',
    '["reject","mark_future_as_anticipated","allow_without_anticipation"]'::jsonb,
    '{tenant,contract}', 'admin', false, 'high', true, true
  ),
  (
    'programacao.block_operations_if_project_concluded',
    'programacao',
    'CONCLUIDO ativo no projeto bloqueia criacao, copia, adicao de equipe, adiamento e cancelamento.',
    'boolean', 'true', NULL,
    '{tenant,contract}', 'admin', false, 'high', false, true
  ),
  (
    'programacao.allow_manual_antecipado',
    'programacao',
    'Permite selecionar ANTECIPADO manualmente no campo Estado Trabalho.',
    'boolean', 'false', NULL,
    '{tenant,contract}', 'admin', false, 'medium', false, true
  ),
  (
    'programacao.min_cancel_reason_chars',
    'programacao',
    'Minimo de caracteres para motivo de cancelamento/adiamento.',
    'number', '10', NULL,
    '{tenant}', 'tenant_admin', false, 'low', false, true
  ),
  (
    'programacao.min_reschedule_reason_chars',
    'programacao',
    'Minimo de caracteres para motivo de reprogramacao.',
    'number', '10', NULL,
    '{tenant}', 'tenant_admin', false, 'low', false, true
  ),
  (
    'programacao.export_layout',
    'programacao',
    'Layout de exportacao padrao da Programacao. Colunas controladas pelo catalogo programming_export_column_definitions.',
    'enum', 'ENEL_EXCEL',
    '["ENEL_EXCEL","ENEL_NOVO","DEFAULT"]'::jsonb,
    '{tenant}', 'tenant_admin', true, 'low', false, true
  ),
  (
    'programacao.require_final_stage_for_completion',
    'programacao',
    'Exige que etapa_final = true para aceitar CONCLUIDO. Relacionado a intermediate_completion_policy = reject.',
    'boolean', 'false', NULL,
    '{tenant,contract}', 'admin', false, 'high', false, true
  ),
  (
    'programacao.allow_overlapping_schedules',
    'programacao',
    'Permite que uma equipe tenha duas programacoes com horario sobrepostos no mesmo dia.',
    'boolean', 'false', NULL,
    '{tenant}', 'admin', false, 'medium', false, true
  ),
  -- MÓDULO: medicao
  (
    'medicao.enable_minimum_billing',
    'medicao',
    'Habilita calculo e registro de garantia minima de faturamento por equipe.',
    'boolean', 'true', NULL,
    '{tenant,contract}', 'tenant_admin', false, 'medium', false, true
  ),
  (
    'medicao.require_programming_match',
    'medicao',
    'Exige que a medicao esteja vinculada a uma programacao existente.',
    'boolean', 'false', NULL,
    '{tenant,contract}', 'admin', false, 'medium', false, true
  ),
  (
    'medicao.max_backdate_days',
    'medicao',
    'Dias maximos retroativos para criar medicao (0 = sem limite).',
    'number', '0', NULL,
    '{tenant}', 'tenant_admin', false, 'medium', false, true
  ),
  -- MÓDULO: faturamento
  (
    'faturamento.min_cancel_reason_chars',
    'faturamento',
    'Minimo de caracteres para motivo de cancelamento/reabertura de faturamento.',
    'number', '10', NULL,
    '{tenant}', 'tenant_admin', false, 'low', false, true
  ),
  (
    'faturamento.require_approval_before_billing',
    'faturamento',
    'Exige aprovacao antes de fechar faturamento. CRITICALITY CRITICAL: sempre re-fetchar do banco, nunca usar cache. Requer colunas approved_by/approved_at em project_billing_orders (Fase 7).',
    'boolean', 'false', NULL,
    '{tenant,contract}', 'admin', false, 'critical', true, true
  ),
  (
    'faturamento.allow_billing_without_measurement',
    'faturamento',
    'Permite criar faturamento sem medicao vinculada.',
    'boolean', 'true', NULL,
    '{tenant,contract}', 'admin', false, 'medium', false, true
  ),
  -- MÓDULO: projetos
  (
    'projetos.require_contract_link',
    'projetos',
    'Exige que todo projeto esteja vinculado a um contrato.',
    'boolean', 'false', NULL,
    '{tenant}', 'admin', false, 'low', false, true
  ),
  -- MÓDULO: equipes
  (
    'equipes.enforce_unique_foreman_per_team',
    'equipes',
    'Impede que o mesmo encarregado seja associado a mais de uma equipe ativa.',
    'boolean', 'true', NULL,
    '{tenant}', 'admin', false, 'low', false, true
  )
ON CONFLICT (rule_key) DO NOTHING;
```

### `<proxima_migration>_add_snapshot_to_programming_history.sql` — Fase 5

> **Numeração:** Não usar 281. Confirmar próximo número disponível no momento da Fase 5.

```sql
-- Snapshot de regras aplicadas para Programação (decisão D4)
-- Tabela project_programming_history já existe (migration 101)
-- Formato do JSONB (hierarquia vigente: global → tenant)
-- { "resolved_at": "ISO8601", "rules": { "rule_key": { "value": "...", "source": "default|tenant" } } }
-- Nota: source "contract" só entra após contract_business_rules existir (Fases A+B do plano de acesso por contrato)

ALTER TABLE public.project_programming_history
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido quando action_type = 'CONCLUIDO', 'ANTECIPADO_AUTO' ou similares

COMMENT ON COLUMN public.project_programming_history.applied_rules_snapshot IS
  'Snapshot das regras de negocio vigentes no momento da operacao. Ver business_rule_definitions para catalogo.';
```

### `<proxima_migration>_add_snapshot_to_measurement.sql` — Fase 6

> **Numeração:** Não assumir que segue diretamente o número da Fase 5. Confirmar próximo disponível.

```sql
-- Snapshot de regras aplicadas para Medição e As Built (decisão D4)
-- Sem tabela de histórico dedicada nesses módulos — coluna na tabela de operação
-- Nomes reais verificados nas migrations
-- Formato do JSONB (hierarquia vigente: global → tenant)
-- { "resolved_at": "ISO8601", "rules": { "rule_key": { "value": "...", "source": "default|tenant" } } }

ALTER TABLE public.project_measurement_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido em: criar medição, calcular garantia mínima

-- NOME REAL CONFIRMADO (migration 177): project_asbuilt_measurement_orders
ALTER TABLE public.project_asbuilt_measurement_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido em: salvar as built com regras aplicadas

COMMENT ON COLUMN public.project_measurement_orders.applied_rules_snapshot IS
  'Snapshot das regras de negocio vigentes no momento da operacao.';
COMMENT ON COLUMN public.project_asbuilt_measurement_orders.applied_rules_snapshot IS
  'Snapshot das regras de negocio vigentes no momento da operacao.';
```

### `<proxima_migration>_add_snapshot_and_approval_to_billing.sql` — Fase 7

> **Numeração:** Confirmar próximo disponível. Esta migration pode ser a primeira deste conjunto a ter um número acima de 283 — não assumir.

```sql
-- Snapshot de regras e colunas de aprovação para Faturamento (decisões D4 e D5)
-- Formato do JSONB (hierarquia vigente: global → tenant)
-- { "resolved_at": "ISO8601", "rules": { "rule_key": { "value": "...", "source": "default|tenant" } } }

ALTER TABLE public.project_billing_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido em: fechar faturamento, aprovar, cancelar por regra

-- Colunas de aprovação para faturamento.require_approval_before_billing (decisão D5 Opção A)
ALTER TABLE public.project_billing_orders
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
-- Ambas nullable. NULL = não aprovado ou regra não ativa para o tenant.

COMMENT ON COLUMN public.project_billing_orders.applied_rules_snapshot IS
  'Snapshot das regras de negocio vigentes no momento da operacao.';
COMMENT ON COLUMN public.project_billing_orders.approved_by IS
  'Usuario que aprovou o faturamento (quando faturamento.require_approval_before_billing = true).';
COMMENT ON COLUMN public.project_billing_orders.approved_at IS
  'Timestamp da aprovacao do faturamento.';
```

### `<proxima_migration>_admin_rules_page_permission.sql`

```sql
-- Permissão de página para tela administrativa de regras (Fase 9)
-- Estrutura segue o padrão de page_permissions existente (migration 022)
INSERT INTO public.page_permissions (page_key, description, is_admin_only)
VALUES ('admin-regras', 'Gerenciamento de regras configuráveis por tenant', true)
ON CONFLICT (page_key) DO NOTHING;
```

---

## 4. Serviços e Utilitários Sugeridos

| Arquivo | Responsabilidade | Localização |
|---------|-----------------|-------------|
| `src/lib/server/businessRules.ts` | Resolução de regras com hierarquia `global → tenant` (Fase 2). A camada de contrato será adicionada junto com o plano de acesso por contrato. Funções: `resolveBusinessRule`, `resolveBusinessRuleBoolean`, `resolveBusinessRuleNumber`, `resolveBusinessRules` (lote) | `src/lib/server/` — junto com `appUsersAdmin.ts` |
| `src/lib/server/businessRulesCache.ts` | Cache in-process com TTL 60s. Mesmo padrão Map+TTL de `catalogs.ts`. Expõe `getCachedRules`, `setCachedRules`, `invalidateTenantRulesCache`. Documentar limitação de isolamento por instância Vercel. | `src/lib/server/` |
| `src/lib/server/businessRuleKeys.ts` | Objeto TypeScript com todas as rule_keys como constantes tipadas com namespace. Exemplo: `export const BUSINESS_RULE_KEYS = { REQUIRE_SGD_FIELDS: 'programacao.require_sgd_fields', INTERMEDIATE_COMPLETION_POLICY: 'programacao.intermediate_completion_policy', ... } as const` | `src/lib/server/` |
| `src/hooks/useBusinessRules.ts` | Hook React para consumo de regras `frontend_exposable = true` no frontend. **Padrão `useState + useEffect + fetch manual`** — sem TanStack Query (decisão Fase 4; mesma convenção dos módulos operacionais existentes). Expõe `useBooleanRule(key)`, `useNumberRule(key)`, `useStringRule(key)`. | `src/hooks/` |
| `src/app/api/business-rules/route.ts` | Endpoint GET autenticado que retorna regras resolvidas para o tenant da sessão. Filtra por `frontend_exposable = true`. POST/PUT para admins via `upsert_business_rule_override` (Fase 9). | `src/app/api/business-rules/` |

---

## 5. Como os Fluxos Críticos Mudam

### Fluxo: Salvar programação (`saveProgramming` em `handlers.ts`)

**Antes:**
```typescript
// Campos SGD obrigatórios hardcoded — todos os tenants
// Campos são nullable no banco mas o handler os torna obrigatórios
if (!sgdTypeId) {
  return NextResponse.json({ message: "Tipo de SGD é obrigatório..." }, { status: 400 });
}
```

**Depois:**
```typescript
// Hierarquia vigente: global → tenant (sem contractId)
// contractId só entra quando contract_business_rules existir (Fases A+B do plano de acesso por contrato)
const rules = await resolveBusinessRules({
  supabase: resolution.supabase,
  tenantId: resolution.appUser.tenant_id,
  ruleKeys: [
    BUSINESS_RULE_KEYS.REQUIRE_SGD_FIELDS,
    BUSINESS_RULE_KEYS.MIN_RESCHEDULE_REASON_CHARS,
  ],
});

const requireSgdFields = rules[BUSINESS_RULE_KEYS.REQUIRE_SGD_FIELDS] === 'true';
if (requireSgdFields && !sgdTypeId) {
  return NextResponse.json({ message: "Tipo de SGD é obrigatório..." }, { status: 400 });
}

const minRescheduleChars = Number(rules[BUSINESS_RULE_KEYS.MIN_RESCHEDULE_REASON_CHARS] ?? 10);
if (isPotentialReschedule && changeReason && changeReason.trim().length < minRescheduleChars) {
  return NextResponse.json({ message: `O motivo deve ter ao menos ${minRescheduleChars} caracteres.` }, { status: 400 });
}
```

---

### Fluxo: Salvar CONCLUIDO em etapa (política de conclusão intermediária)

**Antes:**
```typescript
// Sempre chama antecipação automática
if (isCompletedWorkStatus(normalizedStatus) && etapaNumber !== null) {
  await markFutureProgrammingStagesAnticipatedViaRpc({...});
}
```

**Depois:**
```typescript
const policy = rules[BUSINESS_RULE_KEYS.INTERMEDIATE_COMPLETION_POLICY] ?? 'mark_future_as_anticipated';
// Nota: trigger de banco (migration 275) valida apenas ETAPA, não work_completion_status
// O handler TypeScript é o único ponto de controle para 'reject'

if (isCompletedWorkStatus(normalizedStatus) && etapaNumber !== null) {
  if (policy === 'reject') {
    // verificar etapa_final no banco — retornar erro se false
    if (!isEtapaFinal) {
      return NextResponse.json({ message: "CONCLUIDO só é permitido na etapa final para este tenant." }, { status: 400 });
    }
  } else if (policy === 'mark_future_as_anticipated') {
    await markFutureProgrammingStagesAnticipatedViaRpc({...});
  }
  // allow_without_anticipation: aceitar sem chamar RPC
}
```

---

### Fluxo: Exportação no frontend

**Antes:**
```typescript
// Botão sempre visível para todos os tenants
<button onClick={handleEnelExport}>ENEL-EXCEL</button>
```

**Depois:**
```typescript
const { data: rules } = useBusinessRules(['programacao.export_layout']);
const exportLayout = rules?.['programacao.export_layout'] ?? 'ENEL_EXCEL';

{exportLayout === 'ENEL_EXCEL' && (
  <button onClick={() => handleExport('ENEL_EXCEL')}>ENEL-EXCEL</button>
)}
{exportLayout === 'ENEL_NOVO' && (
  <button onClick={() => handleExport('ENEL_NOVO')}>Extração ENEL NOVO</button>
)}
{exportLayout === 'DEFAULT' && (
  <button onClick={() => handleExport('DEFAULT')}>Exportar</button>
)}
```

---

### Fluxo: Fechar faturamento (regra critical — tabela real: project_billing_orders)

**Antes:**
```typescript
// Sem verificação de aprovação
// Tabela: project_billing_orders (não billing_orders)
await closeProjectBillingOrder(billingOrderId);
```

**Depois:**
```typescript
// Hierarquia vigente: global → tenant (sem contractId)
// contractId só entra quando contract_business_rules existir (Fases A+B do plano de acesso por contrato)
// Regra critical: sempre re-fetchar do banco, nunca usar cache
const rules = await resolveBusinessRules({
  supabase: resolution.supabase,
  tenantId: resolution.appUser.tenant_id,
  ruleKeys: [BUSINESS_RULE_KEYS.REQUIRE_APPROVAL_BEFORE_BILLING],
  bypassCache: true,  // criticality = 'critical' → sem cache
});

if (rules[BUSINESS_RULE_KEYS.REQUIRE_APPROVAL_BEFORE_BILLING] === 'true') {
  // Verificar colunas approved_by/approved_at em project_billing_orders (adicionadas na Fase 7)
  const billingOrder = await getProjectBillingOrder(billingOrderId);
  if (!billingOrder.approved_by || !billingOrder.approved_at) {
    return NextResponse.json({ message: "Faturamento requer aprovação antes de ser fechado." }, { status: 422 });
  }
}
```

---

## 6. Plano de Rollout Gradual

1. **Default igual ao hardcode atual**: a seed (migration 280) insere `default_value` que reproduz exatamente o comportamento hardcoded. Nenhum tenant vê mudança ao aplicar as migrations.

2. **Opt-in por tenant**: apenas tenants que explicitamente recebem configuração diferente em `tenant_business_rules` mudam de comportamento.

3. **Rollout gradual por módulo**: integrar módulo por módulo (Fase 3 a 8). Cada módulo pode ser testado em isolamento.

4. **Primeira regra em tenant de teste**: aplicar `programacao.require_sgd_fields = false` em um tenant de teste antes de qualquer produção. Verificar que salvar programação sem campos SGD funciona corretamente. Nenhuma migration de schema necessária.

5. **Monitoramento pós-mudança**: após cada fase, monitorar logs de erro (`useErrorLogger`) nos módulos migrados por 48h.

6. **Cache TTL**: com TTL de 60s, uma mudança de regra pode levar até 60s para ser refletida em todas as instâncias Vercel. Para regras `criticality = 'critical'`, o código não usa cache (`bypassCache: true`).

---

## 7. Rollback por Fase

| Fase | Estratégia de rollback | Impacto |
|------|----------------------|---------|
| 1 (Migrations) | `DROP TABLE` das 4 tabelas novas (276, 277, 279, 280) | Zero — sem código consumindo e sem colunas em tabelas operacionais |
| 2 (Serviço) | Remover 3 arquivos novos | Zero — sem imports |
| 3 (Handler Programação) | `git revert` dos commits de `handlers.ts` + `programacao/route.ts` | Baixo — funcionalidade restaurada imediatamente |
| 4 (Frontend hook) | Remover `useBusinessRules.ts` + restaurar values hardcoded na View | Baixo — botão ENEL volta a aparecer para todos |
| 5 (Programação completa) | `git revert` da fase 5 | Médio — múltiplos arquivos |
| 6-8 (Outros módulos) | `git revert` por módulo | Baixo — módulos independentes |
| 9 (Tela admin) | Desativar rota na configuração de páginas | Zero — configurações salvas permanecem |
| 10 (Consolidação) | Restaurar duplicações via `git revert` | Baixo |

---

## 8. Checklist de Aceite Final

Antes de considerar o projeto de regras configuráveis concluído:

- [ ] Todas as migrations efetivamente criadas em cada fase aplicadas em produção com a numeração real confirmada (não assumir 276-282 — cada fase usa o próximo número disponível no momento).
- [ ] Todas as `rule_key` no banco usam namespace de módulo (`<modulo>.<nome>`).
- [ ] `business_rule_definitions` contém as 17 regras do catálogo proposto (sem `auto_anticipate_on_conclusion` nem `intermediate_completion_as_anticipated` — substituídas por `programacao.intermediate_completion_policy`).
- [ ] `resolveBusinessRules()` testado unitariamente com cobertura da **hierarquia `global → tenant`** (dois níveis — sem contrato). **A hierarquia `global → tenant → contrato` e testes de `contract > tenant` só entram quando `contract_business_rules` for criada (plano de acesso por contrato, Fases A+B). Não implementar antes disso.**
- [ ] Cache de regras com TTL 60s funcionando. Documentado que instâncias Vercel têm caches isolados. Mesmo padrão de `catalogs.ts`.
- [ ] Regras com `criticality = 'critical'` nunca usam cache (bypassCache implementado).
- [ ] Módulo Programação: checklist completo de `Mapa_Regras_Programacao.md` passa.
- [ ] `programacao.require_sgd_fields = false` testado em tenant de teste — campos SGD não exigidos (campos já são nullable no banco — confirmado).
- [ ] `programacao.intermediate_completion_policy = reject` testado com checklist completo antes de ativar em produção.
- [ ] `programacao.intermediate_completion_policy = allow_without_anticipation` testado com checklist completo antes de ativar em produção.
- [ ] Módulo Medição: `medicao.enable_minimum_billing`, `medicao.require_programming_match` e `medicao.max_backdate_days` configuráveis.
- [ ] Módulo Faturamento: `faturamento.min_cancel_reason_chars` configurável; `faturamento.require_approval_before_billing` implementado com bypassCache; colunas `approved_by`/`approved_at` adicionadas em `project_billing_orders`.
- [ ] `applied_rules_snapshot` preenchido em operações críticas de `project_programming_history`, `project_measurement_orders`, `project_asbuilt_measurement_orders` e `project_billing_orders`.
- [ ] Nomes de tabelas reais usados em todas as migrations e queries: `contract`, `project_measurement_orders`, `project_billing_orders`, `project_asbuilt_measurement_orders` (NÃO `measurement_asbuilt_orders`).
- [ ] Zero ocorrências de `if (tenantId === "x")` em toda a codebase.
- [ ] `isCompletedWorkStatus()` centralizada em `normalizers.ts` — aceita `CONCLUIDO` e `COMPLETO` (alias legado). Removida das outras 4 localizações.
- [ ] Zero duplicação de `normalizeWorkCompletionStatus` entre módulos.
- [ ] Tela administrativa acessível apenas para usuários com permissão `manage_business_rules`.
- [ ] Admin de tenant não consegue editar regras com `editable_by = 'admin'`.
- [ ] `rule_audit_logs` recebe entrada para cada mudança de configuração com `old_record` e `new_record`.
- [ ] Tenant de teste validado com configurações diferentes do default.
- [ ] CHECK constraint de `export_column` (migration 087) removido SOMENTE após `programming_export_column_definitions` criado, populado e código migrado.
- [ ] Policy RLS em `tenant_business_rules` usa `user_can_access_tenant(tenant_id)` — não claims JWT.
- [ ] Trigger `validate_contract_tenant_match` referencia `public.contract` (não `public.contracts`).
- [ ] Documentação em `docs/arquitetura/` atualizada ao final de cada fase.
- [ ] `TASKS.md` atualizado com status de cada fase.
