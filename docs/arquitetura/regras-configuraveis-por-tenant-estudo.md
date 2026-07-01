# Regras Configuráveis por Tenant — Estudo Técnico
Gerado em: 2026-06-27 | Revisado em: 2026-06-27 (revisão técnica obrigatória)

Escopo: repositório `Indica-controle` com stack Next.js 16 + Supabase/Postgres + Vercel.
Propósito: mapear a arquitetura atual e propor modelo de regras configuráveis por tenant sem duplicar código, sem branches por cliente e sem `if (tenantId === "x")` espalhado.

---

## 1. Resumo Executivo

O sistema possui 284+ migrations versionadas, 68 rotas de API em Next.js 16, ~29 módulos de tela, e uma camada de multi-tenancy sólida baseada em `tenant_id` + RLS no Supabase. A maioria das regras de negócio críticas já está server-side e protegida por RLS ou RPCs `security definer`. O principal risco identificado é a existência de **regras de comportamento fixas no código** que deveriam ser configuráveis por tenant ou por contrato: limites de caracteres hardcoded, campos obrigatórios incondicionais (campos "ENEL" são obrigatórios para todos os tenants), lógica de transição de status embutida em normalizers, e exportações de layout ENEL que assumem estrutura de um cliente específico. Nenhum `if (tenantId === "x")` foi encontrado — o hardcode é por ausência de configuração, não por exceção explícita.

Toda `rule_key` neste sistema usa **namespace de módulo** para garantir unicidade global e prevenir colisão entre módulos. Formato obrigatório: `<modulo>.<nome_da_regra>`. Exemplos: `programacao.min_cancel_reason_chars`, `faturamento.require_approval_before_billing`, `medicao.max_backdate_days`.

---

## 2. Arquitetura Atual

### 2.1 Stack e estrutura

| Camada | Tecnologia | Localização |
|--------|-----------|-------------|
| Frontend | Next.js 16.1.6 / React 19 / TypeScript 5 | `src/app/`, `src/modules/` |
| Estado de servidor | TanStack Query v5 | hooks dos módulos |
| API | Next.js Route Handlers (App Router) | `src/app/api/` |
| Handlers de negócio | TypeScript server-side | `src/server/modules/` |
| Banco de dados | Supabase/Postgres com RLS | `supabase/migrations/` |
| Auth | Supabase Auth + service_role para admin | `src/lib/server/appUsersAdmin.ts` |
| Deploy | Vercel (serverless, múltiplas instâncias) | — |

Estrutura de pastas relevante:

```
src/
  app/api/            — 68 rotas HTTP (route handlers)
  server/modules/     — handlers e RPCs (apenas programacao)
  modules/dashboard/  — views de tela (~29 módulos)
  lib/server/         — utilitários de autenticação e autorização
  context/            — AuthContext (client-side)
  services/auth/      — auth.service.ts (login, sessão)
supabase/migrations/  — 284+ arquivos .sql versionados
```

### 2.2 Multi-tenancy atual

O multi-tenancy é implementado por colunas `tenant_id uuid` em todas as tabelas de negócio. A tabela `tenants` (migration 045) formaliza o tenant como entidade. A tabela `app_user_tenants` permite que um usuário tenha acesso a múltiplos tenants, com `is_default` para o tenant padrão.

Fluxo de resolução do tenant:

1. `app_users.tenant_id` — tenant nativo do usuário.
2. `app_user_tenants` — links adicionais ativos (vínculo 1:N).
3. Header HTTP `x-tenant-id` — override explícito pelo frontend.
4. Validação: se `x-tenant-id` não estiver na lista de tenants permitidos do usuário, retorna 403.

A função `user_can_access_tenant(p_tenant_id uuid)` (migration 045) consolida essa lógica no banco para uso nas políticas RLS.

### 2.3 Fluxo de autenticação e resolução do tenant_id

Toda requisição protegida passa por `resolveAuthenticatedAppUser()` em `src/lib/server/appUsersAdmin.ts`:

1. Extrai Bearer token do header `Authorization`.
2. Verifica cache em memória (TTL 45s, chave `token:tenant_id`).
3. Chama `supabase.auth.getUser(token)` via service_role.
4. Busca `app_users` pelo `auth_user_id`.
5. Busca `app_roles` pelo `role_id`.
6. Busca `app_user_tenants` para listar tenants disponíveis.
7. Resolve `activeTenantId` a partir do header `x-tenant-id` ou `is_default`.
8. Retorna `AuthenticatedAppUserContext` com `appUser.tenant_id` sempre resolvido.

O `tenant_id` derivado da sessão — nunca do payload do cliente — é passado para todas as queries e RPCs.

### 2.4 RLS atual

RLS está ativo em todas as tabelas de negócio desde a migration 006. O padrão de política usado é:

```sql
-- Padrão antigo (migrations 006-020): subquery em app_users
using (
  exists (select 1 from public.app_users au
          where au.auth_user_id = auth.uid()
          and au.tenant_id = tabela.tenant_id)
)

-- Padrão atual (migrations 021+): função utilitária
using (public.user_can_access_tenant(tabela.tenant_id))
```

Definição real da função (migration 045):

```sql
create or replace function public.user_can_access_tenant(p_tenant_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.app_users au
    where au.auth_user_id = auth.uid()
      and au.ativo = true
      and (
        exists (
          select 1 from public.app_user_tenants aut
          where aut.user_id = au.id
            and aut.tenant_id = p_tenant_id
            and aut.ativo = true
        )
        or au.tenant_id = p_tenant_id
      )
  )
$$;
```

RPCs sensíveis usam `security definer` e recebem `p_tenant_id` explicitamente do backend server-side (não do cliente). A migration 251 revogou execute de `public`, `anon` e `authenticated` em todas as RPCs SECURITY DEFINER do schema public — o único caller válido é `service_role`, que é o cliente que o backend Next.js usa.

Tabelas com RLS confirmado: `app_users`, `materials`, `inventory_balance`, `requisicoes`, `project_programming`, `programming_sgd_types`, `tenants`, `app_user_tenants`, `project_billing_orders`, `project_measurement_orders`, `project_asbuilt_measurement_orders` e todas as tabelas criadas nas migrations 045+.

### 2.5 Tabelas reais dos módulos principais

**ATENÇÃO — nomes reais verificados nas migrations:**

| Módulo | Tabela real (não presumida) | Migration de criação |
|--------|----------------------------|---------------------|
| Contratos | `contract` (renomeada de `contrato` em 033) | 032, 033 |
| Programação | `project_programming` | 067 |
| Histórico Programação | `project_programming_history` | 101 |
| Medição | `project_measurement_orders` | 112 |
| As Built | `project_asbuilt_measurement_orders` | 177 |
| Faturamento | `project_billing_orders` | 176 |

A tabela `contract` tem `tenant_id` como coluna UNIQUE (constraint criada na migration 032). Isso significa que cada tenant tem **exatamente um contrato** na tabela `contract`. Não existe UNIQUE(tenant_id, id) porque `tenant_id` já é único por si só. A FK composta `FOREIGN KEY (tenant_id, contract_id) REFERENCES contract(tenant_id, id)` é **inviável** sem um UNIQUE composto em `contract(tenant_id, id)`. Ver decisão D1.

### 2.6 Onde vivem as regras de negócio hoje

| Camada | Onde | Exemplos |
|--------|------|----------|
| Handler server-side | `src/server/modules/programacao/handlers.ts` | CONCLUIDO bloqueia criação, ANTECIPADO automático, motivo >= 10 chars |
| Route handler inline | `src/app/api/*/route.ts` | Faturamento: cancellation reason >= 10 chars; Medicao: validações de status |
| Normalizers | `src/server/modules/programacao/normalizers.ts` | `isCompletedWorkStatus()`, `isAnticipatedWorkStatus()` |
| RPC PL/pgSQL | `supabase/migrations/` | Constraints de ETAPA, triggers de ANTECIPADO, guards de CANCELADA+CONCLUIDO |
| Trigger DEFERRED de banco | migration 275 | `project_programming_active_stage_valid_check` — valida integridade de ETAPA em PROGRAMADA/REPROGRAMADA |
| Frontend (risco) | `src/modules/dashboard/*/` | Exportação ENEL-EXCEL, labels hardcoded, validators.ts locais |

---

## 3. Diagnóstico de Riscos

### 3.1 Riscos de acesso cruzado entre tenants

**Baixo** — O modelo atual é bem protegido. Toda query usa `.eq("tenant_id", tenantId)` onde `tenantId` vem de `resolution.appUser.tenant_id`, derivado da sessão server-side. RPCs recebem `p_tenant_id` explicitamente. O risco de cross-tenant existe apenas se uma RPC `security definer` antiga não validar `p_tenant_id`, o que não foi observado nas migrations lidas.

Pontos de atenção:
- O cache de auth em memória (`_authCache`) em `appUsersAdmin.ts` tem TTL de 45s. Se um usuário for desativado, o acesso persiste por até 45s.
- A função `user_can_access_tenant()` é `stable` — pode ser cacheada pelo Postgres entre linhas da mesma query, o que é seguro mas merece documentação.

### 3.2 Regras críticas apenas no front-end

| Regra | Arquivo | Risco |
|-------|---------|-------|
| Sugestão automática de próxima ETAPA | `src/modules/dashboard/programacao-simples/hooks.ts` | Médio — backend também valida conflito de etapa |
| Validação local de documentos (data pedido > aprovada) | `src/modules/dashboard/programacao-simples/validators.ts` | Baixo — backend duplica em `getInvalidRequestedDateLabel()` |
| Exportação ENEL-EXCEL (colunas fixas) | `src/modules/dashboard/programacao-simples/exports.ts` | Alto — sem validação backend; layout assume estrutura ENEL |
| Label "ENEL-EXCEL" hardcoded no botão | `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | Alto — não configurável por tenant |
| Filtro `NAO_INFORMADO` tratado como null | `src/modules/dashboard/programacao-simples/validators.ts` | Médio — semântica de filtro não padronizada |

### 3.3 Hardcodes identificados

| Hardcode | Arquivo | Linha aprox. | Tipo |
|----------|---------|-------------|------|
| Mínimo 10 chars para motivo de cancelamento/adiamento | `src/app/api/programacao/route.ts` | 578 | Limite numérico |
| Mínimo 10 chars para motivo em faturamento | `src/app/api/faturamento/route.ts` | 859 | Limite numérico |
| `CONCLUIDO` bloqueia todas as operações | `src/server/modules/programacao/handlers.ts` | múltiplas | Transição de status |
| `ANTECIPADO` não pode ser selecionado manualmente | `src/server/modules/programacao/handlers.ts` | 1600 | Regra comportamento |
| SGD export_column fixo em `('SGD_AT_MT_VYP', 'SGD_BT', 'SGD_TET')` | `supabase/migrations/087_add_programming_enel_fields_and_sgd_types.sql` | 16-17 | Enum fixo no banco |
| Campos opcionais no banco: sgd_type_id, campo_eletrico, electrical_eq_catalog_id | `src/server/modules/programacao/handlers.ts` | 1200-1222 | Validação hardcoded tornando nullable nullable como obrigatório |
| `isCompletedWorkStatus()` usa tokens fixos `CONCLUIDO`, `COMPLETO` | `src/server/modules/programacao/normalizers.ts` | 164-167 | Status fixo no código |
| `isAnticipatedWorkStatus()` usa token fixo `ANTECIPADO` | `src/server/modules/programacao/normalizers.ts` | 169-171 | Status fixo no código |
| Exportação com colunas ENEL no layout "ENEL-EXCEL" | `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | ~1704 | Layout de cliente específico |
| Cache de auth TTL fixo em 45.000ms | `src/lib/server/appUsersAdmin.ts` | 8 | Limite numérico |
| Cache de auth tamanho máximo fixo em 500 | `src/lib/server/appUsersAdmin.ts` | 29 | Limite numérico |
| Session idle timeout resolvido de env com fallback 30min | `src/context/AuthContext.tsx` | 36-43 | Limite numérico |
| Chunk size 100 para busca de atividades | `src/server/modules/programacao/queries.ts` | 83 | Limite numérico |

**Nota sobre campos SGD:** Os campos `sgd_type_id` (migration 087), `campo_eletrico` (migration 110) e `electrical_eq_catalog_id` (migration 151) foram criados como **nullable** no banco. A obrigatoriedade é imposta apenas no handler TypeScript. Isso significa que a regra `programacao.require_sgd_fields = false` pode ser ativada sem migration de schema — o banco já aceita NULL nesses campos.

### 3.4 Regras duplicadas entre módulos

| Regra | Módulos com duplicação |
|-------|----------------------|
| `normalizeWorkCompletionStatus()` / `isCompletedWorkStatus()` | `src/server/modules/programacao/normalizers.ts` + `src/app/api/medicao/route.ts` (reimplementada como token inline) + `src/app/api/mapa-programacao/route.ts` (reimplementada local) + `src/modules/dashboard/programacao-simples/utils.ts` (reimplementada local) + `src/modules/dashboard/medicao/MeasurementPageView.tsx` (reimplementada inline) |
| Validação de `tenant_id` em queries diretas | Todo handler de API — sem helper centralizado para queries |
| Normalização de texto/data/tempo | `src/server/modules/programacao/normalizers.ts` + `src/lib/server/apiHelpers.ts` + funções inline em rotas |
| Mínimo 10 chars para motivo de ação | `programacao/route.ts` + `faturamento/route.ts` — sem constante compartilhada |

---

## 4. Proposta de Arquitetura

### 4.1 Modelo de dados (DDL conceitual completo)

**Justificativa do design:**
O padrão atual do projeto usa JSONB extensivamente para metadados variáveis (ex: `changes`, `metadata` em tabelas de histórico) e colunas tipadas para dados indexáveis. Seguindo esse padrão, `rule_value` deve ser `text` (simples, indexável) com um campo `value_type` que o interpretador usa para converter. Dados complexos (allowed_values, metadata de regra) ficam em JSONB, alinhado ao padrão já estabelecido.

**Convenção de `rule_key`:** toda chave tem prefixo de módulo para garantir unicidade global e evitar colisão. Formato: `<modulo>.<nome>`. A coluna `rule_key` tem constraint `unique` — a unicidade é global, não por módulo.

---

**Tabela `business_rule_definitions`** (catálogo global — sem tenant_id)

```sql
CREATE TABLE IF NOT EXISTS public.business_rule_definitions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key              TEXT NOT NULL UNIQUE,
  -- Formato obrigatório: '<modulo>.<nome>' — ex: 'programacao.min_cancel_reason_chars'
  -- O namespace previne colisão entre módulos. rule_key é única globalmente.
  module                TEXT NOT NULL,
  description           TEXT NOT NULL,
  value_type            TEXT NOT NULL CHECK (value_type IN ('boolean','number','string','enum','json')),
  default_value         TEXT NOT NULL,
  allowed_values        JSONB,
  -- NULL = sem restrição; array JSON = valores válidos para enum
  allowed_scopes        TEXT[] NOT NULL DEFAULT '{tenant}',
  -- Escopos onde pode ser sobrescrita: '{tenant}', '{tenant,contract}', '{}'
  editable_by           TEXT NOT NULL DEFAULT 'admin' CHECK (editable_by IN ('admin','tenant_admin','none')),
  -- 'admin' = apenas admins do SaaS via migration
  -- 'tenant_admin' = admin do tenant pode editar via tela administrativa
  -- 'none' = somente via migration, nunca editável pela UI
  frontend_exposable    BOOLEAN NOT NULL DEFAULT false,
  -- DECISÃO D6: default false. Apenas regras explicitamente necessárias no frontend recebem true.
  -- Regras com true confirmadas: programacao.require_sgd_fields, programacao.export_layout
  criticality           TEXT NOT NULL DEFAULT 'low' CHECK (criticality IN ('low','medium','high','critical')),
  -- 'critical' = afeta cálculos financeiros ou status definitivos (faturamento, conclusão)
  requires_change_reason BOOLEAN NOT NULL DEFAULT false,
  -- Se true, gravar sem 'reason' na auditoria deve ser bloqueado
  is_active             BOOLEAN NOT NULL DEFAULT true,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brd_module_active
  ON public.business_rule_definitions (module, is_active);
```

Esta tabela não tem `tenant_id` porque é um catálogo global de definições. **RLS: sem SELECT para `authenticated`** — a tabela não é acessível diretamente pelo cliente Supabase. Leitura ocorre apenas via `service_role` no backend. Regras com `frontend_exposable = true` são entregues ao front pelo endpoint `/api/business-rules`, que filtra e retorna apenas `{ rule_key, resolved_value }` — sem expor `criticality`, `editable_by`, `allowed_values`, `default_value` ou outros metadados internos. Escrita somente via migration — sem política de INSERT/UPDATE/DELETE para roles de usuário.

---

**Tabela `tenant_business_rules`** (override por tenant)

**DECISÃO D3 — Sem vigência em V1.** Os campos `valid_from` e `valid_until` são removidos da Fase 1. A vigência temporal introduz complexidade (conflito de UNIQUE, necessidade de EXCLUDE USING gist) sem benefício imediato. Será adicionada em versão futura se houver demanda. O constraint UNIQUE(tenant_id, rule_key) funciona sem ambiguidade.

```sql
CREATE TABLE IF NOT EXISTS public.tenant_business_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  rule_key    TEXT NOT NULL REFERENCES public.business_rule_definitions(rule_key),
  rule_value  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  -- Sem valid_from / valid_until em V1 — decisão D3
  created_by  UUID REFERENCES public.app_users(id),
  updated_by  UUID REFERENCES public.app_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_tbr_tenant_key_active
  ON public.tenant_business_rules (tenant_id, rule_key, is_active);
```

---

**Tabela `contract_business_rules`** — ARQUITETURA FUTURA (não existe, não será criada nas Fases 1-10)

> **DECISÃO FINAL 2026-06-27 — CANCELADA:** A migration 278 (`contract_business_rules`) está **cancelada definitivamente** — não será criada com esse número. As migrations 279 e 280 já existem; inserir 278 depois quebraria a sequência.
>
> Esta tabela **não existe**, **não está indexada**, **não tem RLS**, **não é exposta em tela** e **não participa do resolvedor nas Fases 1-10**.
>
> Quando `contract_business_rules` for necessária (após Fase A+B do plano de acesso por contrato), usar o **próximo número disponível** naquele momento — não reservar número agora.

**Arquitetura vigente (Fases 1 a 10):** `global → tenant` — apenas duas camadas.

**Arquitetura futura (após plano de acesso por contrato, Fases A+B):** `global → tenant → contrato`.

**Justificativa do cancelamento:** Com o modelo 1:1 atual (`UNIQUE(tenant_id)` em `public.contract`), `contract_business_rules` seria funcionalmente equivalente a `tenant_business_rules`. Criar a tabela sem endpoints, sem uso nos handlers e sem tela gera código morto. A camada `contrato` só tem utilidade quando existir mais de um contrato por tenant.

**DDL de referência futura (NÃO APLICAR até Fases A+B):**

```sql
-- REFERÊNCIA FUTURA — não criar antes da Fase A (remoção de UNIQUE tenant-contrato)
-- Usar próximo número disponível no momento — não é 278
-- Após a Fase A, public.contract terá UNIQUE(tenant_id, id) — a FK composta abaixo se torna viável
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
  -- Após Fase A: FOREIGN KEY (tenant_id, contract_id) REFERENCES contract(tenant_id, id)
  -- Antes da Fase A: integridade garantida por trigger validate_contract_tenant_match (Opção B)
);

-- Índice: criar junto com a tabela (não existe agora)
CREATE INDEX IF NOT EXISTS idx_cbr_tenant_contract_key_active
  ON public.contract_business_rules (tenant_id, contract_id, rule_key, is_active);

-- Trigger de validação de integridade (ativo antes da Fase A; pode ser removido após FK composta)
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

CREATE TRIGGER trg_cbr_validate_tenant
  BEFORE INSERT OR UPDATE ON public.contract_business_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_contract_tenant_match();
```

---

**Tabela `rule_audit_logs`** (log imutável de mudanças — append-only)

```sql
CREATE TABLE IF NOT EXISTS public.rule_audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('tenant','contract')),
  scope_id    UUID NOT NULL,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  contract_id UUID REFERENCES public.contract(id),
  -- NULL quando scope_type = 'tenant'; preenchido quando scope_type = 'contract'
  rule_key    TEXT NOT NULL,
  old_value   TEXT,
  -- NULL em INSERT (não havia valor anterior)
  new_value   TEXT,
  -- NULL em DELETE (valor foi removido)
  old_record  JSONB,
  -- Snapshot completo do registro anterior; NULL em INSERT
  new_record  JSONB,
  -- Snapshot completo do novo registro; NULL em DELETE
  changed_by  UUID NOT NULL REFERENCES auth.users(id),
  reason      TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ral_tenant_key_changed
  ON public.rule_audit_logs (tenant_id, rule_key, changed_at DESC);
```

Notas do trigger de auditoria:
- Em INSERT: `OLD` não existe no contexto PL/pgSQL → usar `NULL` para `old_value` e `old_record`
- Em UPDATE: gravar `OLD.rule_value` e `NEW.rule_value` com snapshots JSON completos
- Em DELETE: `NEW` não existe → usar `NULL` para `new_value` e `new_record`

### 4.2 Hierarquia de resolução de regras

**Hierarquia da Fase 1 (atual — Fases 1 a 10 das regras configuráveis):**
```
Prioridade 1: tenant_business_rules
     ↓ (se não existir override de tenant)
Prioridade 2: business_rule_definitions.default_value (padrão global do sistema)
```

**Hierarquia futura (após plano de acesso por contrato — Fases A+B):**
```
Prioridade 1 (mais específica): contract_business_rules
     ↓ (se não existir regra ativa para o contrato)
Prioridade 2: tenant_business_rules
     ↓ (se não existir override de tenant)
Prioridade 3: business_rule_definitions.default_value (padrão global do sistema)
```

Condições de ativação para que uma regra seja considerada:
- `is_active = true`
- (Sem vigência em V1 — valid_from/valid_until removidos da Fase 1)

### 4.3 Serviço central getTenantRules / resolveBusinessRules

Arquivo sugerido: `src/lib/server/businessRules.ts`

```typescript
// Resolução de uma única regra (retorna string — o caller converte)
// Hierarquia vigente (Fases 1-10): global → tenant (sem contractId)
// contractId só entra na assinatura quando contract_business_rules existir (Fases A+B do plano de acesso por contrato)
export async function resolveBusinessRule(params: {
  supabase: SupabaseClient;
  tenantId: string;
  ruleKey: string;
  // contractId?: string | null;  // FUTURO — não incluir até Fases A+B
}): Promise<string>

// Sobrecarga tipada por valor (conveniência para o caller)
export async function resolveBusinessRuleBoolean(params): Promise<boolean>
export async function resolveBusinessRuleNumber(params): Promise<number>

// Resolução em lote — obrigatório para evitar N+1 queries dentro do mesmo handler
export async function resolveBusinessRules(params: {
  supabase: SupabaseClient;
  tenantId: string;
  ruleKeys: string[];
  bypassCache?: boolean;  // para regras criticality = 'critical'
  // contractId?: string | null;  // FUTURO — não incluir até Fases A+B
}): Promise<Record<string, string>>
```

Estratégia de resolução em SQL (via RPC ou query direta):

**Query da Fase 2 (hierarquia `global → tenant`):**
```sql
-- Resolução sem contract_business_rules — Fases 1-10 das regras configuráveis
SELECT
  brd.rule_key,
  COALESCE(tbr.rule_value, brd.default_value) AS resolved_value,
  CASE
    WHEN tbr.rule_value IS NOT NULL THEN 'tenant'
    ELSE 'default'
  END AS source
FROM public.business_rule_definitions brd
LEFT JOIN public.tenant_business_rules tbr
  ON tbr.rule_key = brd.rule_key
  AND tbr.tenant_id = $1
  AND tbr.is_active = true
WHERE brd.rule_key = ANY($2)
  AND brd.is_active = true;
```

**Query futura (após contract_business_rules existir — hierarquia `global → tenant → contrato`):**
```sql
-- Resolução com hierarquia completa — entra junto com o plano de acesso por contrato
SELECT
  brd.rule_key,
  COALESCE(cbr.rule_value, tbr.rule_value, brd.default_value) AS resolved_value,
  CASE
    WHEN cbr.rule_value IS NOT NULL THEN 'contract'
    WHEN tbr.rule_value IS NOT NULL THEN 'tenant'
    ELSE 'default'
  END AS source
FROM public.business_rule_definitions brd
LEFT JOIN public.tenant_business_rules tbr
  ON tbr.rule_key = brd.rule_key
  AND tbr.tenant_id = $1
  AND tbr.is_active = true
LEFT JOIN public.contract_business_rules cbr
  ON cbr.rule_key = brd.rule_key
  AND cbr.tenant_id = $1
  AND cbr.contract_id = $2
  AND cbr.is_active = true
WHERE brd.rule_key = ANY($3)
  AND brd.is_active = true;
```

### 4.4 Operação server-side upsert_business_rule_override

Nenhuma rota de API deve aceitar `rule_value` diretamente no banco sem passar por esta função. Toda gravação de override de regra ocorre exclusivamente via `upsert_business_rule_override`.

```sql
-- Assinatura conceitual (não executável ainda — será migration futura)
CREATE OR REPLACE FUNCTION public.upsert_business_rule_override(
  p_scope_type    TEXT,     -- 'tenant' ou 'contract'
  p_scope_id      UUID,     -- tenant_id (se scope=tenant) ou contract_id (se scope=contract)
  p_tenant_id     UUID,     -- sempre obrigatório para validação de pertencimento
  p_rule_key      TEXT,
  p_rule_value    TEXT,     -- serializado como text; função valida o tipo internamente
  p_changed_by    UUID,
  p_reason        TEXT DEFAULT NULL
  -- Sem p_valid_from / p_valid_until em V1 — decisão D3
) RETURNS JSONB SECURITY DEFINER
```

Validações obrigatórias executadas dentro da função (em ordem):
1. `p_rule_key` existe e está ativo em `business_rule_definitions`
2. `value_type` da definição determina como validar `p_rule_value`:
   - `boolean`: aceita apenas `'true'` ou `'false'`
   - `number`: deve ser parseable como número
   - `enum`: deve estar dentro de `allowed_values`
   - `string`: comprimento e caracteres conforme definição
   - `json`: deve ser JSON válido
3. `p_rule_value` está dentro de `allowed_values` (quando `allowed_values` não é NULL)
4. `p_scope_type` está dentro de `allowed_scopes` da definição
5. Quando `p_scope_type = 'contract'`: verificar que `p_scope_id` (contract_id) pertence ao `p_tenant_id` via query em `public.contract`
6. `editable_by` da definição permite a operação pelo papel do usuário chamante
7. `requires_change_reason = true` implica que `p_reason` não pode ser NULL ou string vazia
8. Insere em `rule_audit_logs` com `action = 'INSERT'` ou `'UPDATE'` conforme o caso
9. Invalida cache via `pg_notify('business_rules_invalidated', p_tenant_id::text)` ou incrementa flag de versão no tenant

### 4.5 Cache e limitações do Vercel

Arquivo sugerido: `src/lib/server/businessRulesCache.ts`

O sistema já tem cache de auth em memória (`Map` com TTL 45s em `appUsersAdmin.ts`) e cache de catálogos (`Map` com TTL de 5 minutos em `src/server/modules/programacao/catalogs.ts`). O mesmo padrão Map+TTL deve ser usado para regras:

```typescript
// Cache server-side por tenant+contract
// TTL: 60s (escolhido para limitar inconsistência entre instâncias serverless)
// Chave: `${tenantId}:${contractId ?? ""}:${ruleKeys.sort().join(",")}`
// Máximo: 200 entradas (regras por tenant são poucas)
// Padrão: { data: Record<string,string>; expiresAt: number }
// Mesmo padrão de CatalogCacheEntry<T> em catalogs.ts
```

**Limitações do cache in-process no Vercel (obrigatório documentar):**

- Cada instância serverless tem memória própria e completamente isolada.
- Um cache atualizado em instância A **não é visível** na instância B.
- O TTL de 60s é o mecanismo de consistência eventual entre instâncias: após esse intervalo, todas as instâncias re-fetcharão do banco.
- Após alterar uma regra via `upsert_business_rule_override`: o servidor invalida o cache local da instância que gravou, mas outras instâncias ativas só atualizam no próximo TTL (até 60s de defasagem).

**Estratégia de invalidação:**
1. Após `upsert_business_rule_override`: invalidar cache local da instância que gravou imediatamente.
2. TTL de 60s como fallback automático para as demais instâncias.
3. Alternativa futura: versão incrementada por tenant via Supabase Realtime ou Redis compartilhado.
4. **Regras com `criticality = 'critical'`: sempre re-fetchar do banco** antes de operações de faturamento, conclusão e aprovação — nunca confiar apenas no cache para estas decisões.

### 4.6 Separação de responsabilidades por camada

| Camada | Responsabilidade |
|--------|-----------------|
| `business_rule_definitions` | Define quais regras existem, seus tipos, defaults e metadados de governança |
| `tenant_business_rules` | Override por tenant — configurado pela equipe de implementação ou admin do SaaS |
| `contract_business_rules` | **FUTURA** — override por contrato; não existe nas Fases 1-10; entra após Fases A+B do plano de acesso por contrato |
| `src/lib/server/businessRules.ts` | Resolução server-side com hierarquia e tipagem |
| `src/lib/server/businessRulesCache.ts` | Cache in-process (TTL 60s) com limitações de isolamento por instância |
| `src/hooks/useBusinessRules.ts` | Hook React — consome apenas regras `frontend_exposable = true` via endpoint |
| `src/app/api/business-rules/route.ts` | Endpoint autenticado para regras que o frontend precisa; filtra por `frontend_exposable` |
| `rule_audit_logs` | Rastro imutável append-only de toda mudança de configuração |
| `upsert_business_rule_override` | Único ponto de escrita de overrides — valida tudo antes de persistir |

### 4.7 Snapshot de regras em fluxos críticos

**DECISÃO D4 — Snapshot em tabelas de histórico, não nas tabelas principais.**

Para garantir rastreabilidade e auditoria sem poluir as tabelas de operação principal, o snapshot é adicionado nas tabelas de histórico ou como coluna separada na própria tabela de operação (que é imutável após determinado estado):

```sql
-- Em project_programming_history: regras que influenciaram conclusão, antecipação, bloqueio
-- A coluna applied_rules_snapshot é adicionada na Fase 5 (próximo número disponível — não 281)
ALTER TABLE public.project_programming_history
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido quando action_type = 'CONCLUIDO' ou 'ANTECIPADO_AUTO'

-- Em project_measurement_orders: não existe tabela de histórico dedicada (verificado)
-- Usar coluna na própria tabela de medição + tabela de log de aplicação de regras
ALTER TABLE public.project_measurement_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;

-- Em project_asbuilt_measurement_orders: tabela existe (migration 177), sem histórico separado
-- NOME REAL CONFIRMADO: project_asbuilt_measurement_orders (NÃO measurement_asbuilt_orders)
ALTER TABLE public.project_asbuilt_measurement_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;

-- Em project_billing_orders: nome real verificado; sem tabela de histórico separada
ALTER TABLE public.project_billing_orders
  ADD COLUMN IF NOT EXISTS applied_rules_snapshot JSONB;
-- Preenchido em: fechar faturamento, aprovar (quando require_approval_before_billing = true), cancelar
```

Formato esperado do snapshot:

```json
{
  "resolved_at": "2026-06-27T10:00:00Z",
  "rules": {
    "programacao.intermediate_completion_policy": {
      "value": "mark_future_as_anticipated",
      "source": "tenant",
      "rule_key": "programacao.intermediate_completion_policy"
    },
    "programacao.require_sgd_fields": {
      "value": "true",
      "source": "default",
      "rule_key": "programacao.require_sgd_fields"
    }
  }
}
```

O campo `source` indica de onde o valor foi resolvido: `"default"`, `"tenant"` ou `"contract"`. Isso permite auditoria futura de "qual regra estava vigente quando X aconteceu".

---

## 5. Segurança

### 5.1 RLS nas tabelas de regras

As tabelas de regras seguem o princípio de menor privilégio. Escrita direta por usuários é bloqueada — todo write ocorre via `upsert_business_rule_override` (SECURITY DEFINER).

Padrão RLS confirmado no sistema: função `public.user_can_access_tenant(tenant_id)` (migration 045). Todas as policies novas devem usar esse padrão.

```sql
-- business_rule_definitions: SEM SELECT para authenticated
-- Leitura apenas via service_role (backend) — a tabela expõe metadados internos
-- (criticality, editable_by, defaults) que não devem ser visíveis ao navegador.
-- Regras frontend_exposable = true chegam ao front via /api/business-rules (filtradas).
-- Sem política de INSERT/UPDATE/DELETE para roles de usuário (apenas migration)

-- tenant_business_rules: leitura scoped por tenant usando padrão do sistema
CREATE POLICY "tenant_rules_select" ON public.tenant_business_rules
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
-- Sem política de INSERT/UPDATE/DELETE para roles de usuário
-- Escrita ocorre APENAS via upsert_business_rule_override (SECURITY DEFINER)

-- contract_business_rules: ARQUITETURA FUTURA — tabela não existe nas Fases 1-10.
-- RLS abaixo é referência para quando a tabela for criada (após Fases A+B do plano de acesso por contrato).
-- CREATE POLICY "contract_rules_select" ON public.contract_business_rules
--   FOR SELECT USING (public.user_can_access_tenant(tenant_id));
-- Sem política de INSERT/UPDATE/DELETE para roles de usuário

-- rule_audit_logs: leitura para admins; sem UPDATE/DELETE jamais
CREATE POLICY "audit_logs_select_admin" ON public.rule_audit_logs
  FOR SELECT USING (public.user_can_access_tenant(tenant_id));
-- Insert via trigger de auditoria (SECURITY DEFINER) — usuário nunca insere diretamente
```

**Nota sobre a policy de `tenant_business_rules`:** O documento anterior usava `(auth.jwt()->>'tenant_id')::uuid`. O padrão real do sistema é `public.user_can_access_tenant(tenant_id)` — corrigido aqui. Não usar claims JWT para scoping de tenant neste projeto.

### 5.2 Fluxo administrativo obrigatório

O fluxo que a rota administrativa futura deve implementar (Fase 9):

```
1. Usuário autenticado com sessão válida
2. tenant_id resolvido da sessão via resolveAuthenticatedAppUser() (nunca do payload)
3. Permissão administrativa verificada (ex: 'manage_business_rules' no perfil)
4. rule_key verificada em business_rule_definitions (existe? is_active?)
5. editable_by da definição permite o papel do usuário chamante
6. allowed_scopes inclui o scope_type solicitado
7. Valor validado: value_type e allowed_values
8. requires_change_reason = true → reason não pode ser vazio
9. upsert_business_rule_override executa (SECURITY DEFINER via service_role)
10. Auditoria inserida em rule_audit_logs
11. Cache local invalidado
12. Resposta ao cliente com novo valor resolvido
```

### 5.3 Validação do tenant no backend

`tenant_id` nunca vem do payload do cliente. O fluxo `resolveAuthenticatedAppUser()` é a única fonte de `tenant_id` para todas as operações de regra.

### 5.4 Proteção contra payload malicioso

A função `upsert_business_rule_override` valida `p_rule_value` contra `value_type` e `allowed_values` antes de persistir. Nenhuma rota HTTP deve passar `rule_value` diretamente para uma query de UPDATE.

### 5.5 Auditoria

Todo INSERT e UPDATE em `tenant_business_rules` gera entrada em `rule_audit_logs` via trigger (ou diretamente via `upsert_business_rule_override`). O log é append-only — sem política de DELETE ou UPDATE na tabela. Quando `contract_business_rules` existir (Fases A+B), receberá o mesmo trigger de auditoria.

### 5.6 intermediate_completion_policy e triggers do banco

**DECISÃO D7 — intermediate_completion_policy = reject e allow_without_anticipation bloqueados até ajuste do banco.**

A migration 275 criou o trigger `project_programming_active_stage_valid_check` (DEFERRED, AFTER INSERT OR UPDATE de status/etapa_number/etapa_unica/etapa_final) que valida **apenas integridade de ETAPA**, não toca em `work_completion_status`. Portanto a migration 275 não conflita diretamente com `intermediate_completion_policy`.

Porém, os valores `reject` e `allow_without_anticipation` afetam funções de banco:
- O valor `reject` exige validação no handler TypeScript — o banco não bloqueia automaticamente CONCLUIDO em etapa não-final (a migration 275 valida ETAPA, não status de work_completion).
- O valor `allow_without_anticipation` exige que o handler TypeScript NÃO chame a RPC `mark_project_programming_future_stages_anticipated`.
- A migration 258 (`enforce_interrupted_programming_completed_work_status`) iniciou o bloqueio de ADIADA/CANCELADA com CONCLUIDO; a migration 284 recria a mesma guarda para limpar qualquer Estado Trabalho em ADIADA/CANCELADA. Nao conflita com intermediate_completion_policy.
- A migration 272 reescreve `mark_project_programming_future_stages_anticipated` com lógica endurecida — deve ser respeitada como está para o valor `mark_future_as_anticipated`.

**Fases que dependem de ajuste para liberar reject/allow_without_anticipation:** A Fase 5 (programação completa) precisa documentar que esses dois valores requerem teste completo do checklist antes de serem ativados em produção. O handler TypeScript é o único ponto de controle — não há guarda de banco adicional a criar.

---

## 6. Performance

### 6.1 Cache in-process e limitações serverless

- TTL de 60s (reduzido de 120s para limitar inconsistência entre instâncias Vercel).
- Mesmo padrão de `Map<string, { data: T; expiresAt: number }>` usado em `catalogs.ts`.
- Regras com `criticality = 'critical'` devem sempre re-fetchar do banco antes de operações críticas.
- Cache é por instância serverless — não compartilhado entre instâncias.

### 6.2 Índices necessários

```sql
-- business_rule_definitions
CREATE INDEX idx_brd_module_active ON public.business_rule_definitions (module, is_active);

-- tenant_business_rules
CREATE INDEX idx_tbr_tenant_key_active ON public.tenant_business_rules (tenant_id, rule_key, is_active);

-- contract_business_rules: FUTURA — índice a criar junto com a tabela (Fases A+B do plano de acesso por contrato)
-- CREATE INDEX idx_cbr_tenant_contract_key_active ON public.contract_business_rules (tenant_id, contract_id, rule_key, is_active);

-- rule_audit_logs
CREATE INDEX idx_ral_tenant_key_changed ON public.rule_audit_logs (tenant_id, rule_key, changed_at DESC);
```

### 6.3 Risco de N+1

- Usar `resolveBusinessRules()` em lote no início do handler — nunca dentro de loops.
- A query de resolução retorna todas as chaves solicitadas em uma única roundtrip ao banco.

### 6.4 Queries adicionais estimadas

- Número esperado de regras por tenant: 10–50 (não centenas).
- Com cache TTL 60s: 1 query ao banco a cada 60s por tenant ativo por instância.
- Sem cache: +1-2ms por request (índice + join em tabela pequena).

---

## 7. Governança

### 7.1 Quem pode alterar regras

| Ação | Quem pode | Mecanismo |
|------|-----------|-----------|
| Criar/editar `business_rule_definitions` | Desenvolvedor | Migration SQL — `editable_by = 'none'` para regras que nunca devem ser editadas via UI |
| Configurar `tenant_business_rules` (editable_by = 'admin') | Admin do SaaS ou equipe de implementação | Via `upsert_business_rule_override` server-side |
| Configurar `tenant_business_rules` (editable_by = 'tenant_admin') | Admin do tenant | Via tela administrativa (Fase 9) |
| Configurar `contract_business_rules` | **FUTURA** — Admin do tenant (scope de contrato) | Via tela administrativa futura (após Fases A+B — não entra na Fase 9 atual) |
| Ler `rule_audit_logs` | Admin do SaaS e admin do tenant | Via query RLS-scoped |

### 7.2 Fluxo administrativo futuro

Ver seção 5.2 para o fluxo completo obrigatório da rota administrativa.

### 7.3 Auditoria e rastreabilidade

Toda mudança em `tenant_business_rules` gera (e futuramente em `contract_business_rules`, quando existir):
1. Entrada em `rule_audit_logs` com `old_value`, `new_value`, `old_record` e `new_record`.
2. `changed_by` e `reason` obrigatórios para regras com `requires_change_reason = true`.
3. Histórico consultável via tela administrativa (Fase 9).

---

## 8. Decisões Técnicas — Registradas e Fechadas

1. **Usar `text` para `rule_value`**: mais simples, indexável, alinhado ao padrão de `status` e `reason` já usados no projeto.
2. **Hierarquia em 3 níveis** (global → tenant → contract): o sistema já tem a entidade `contract` e usuários multi-tenant.
3. **Resolução via query SQL com LEFT JOIN** em vez de 3 queries separadas: reduz latência e é mais fácil de testar.
4. **Não expor `business_rule_definitions` sem autenticação**: mesmo sendo catálogo, contém detalhes de implementação.
5. **Criar tela administrativa apenas na Fase 9**: antes disso, configurar via migrations de seed.
6. **Manter `isCompletedWorkStatus()` em utilitário centralizado**: hoje está duplicada em 5 locais. A Fase 10 centraliza em `normalizers.ts` como única fonte.
7. **Status legado `COMPLETO`**: novas gravações aceitam apenas `CONCLUIDO`. Leitura: `isCompletedWorkStatus()` aceita `CONCLUIDO` e `COMPLETO` como alias legado. Limpeza histórica é fase futura. Esta compatibilidade NÃO é configurável por tenant.
8. **`rule_key` com namespace de módulo**: toda chave usa o formato `<modulo>.<nome>`. Constante TypeScript em `src/lib/server/businessRuleKeys.ts` evita strings mágicas.
9. **`programacao.require_sgd_fields` como primeira regra a implementar**: campos SGD são NULLABLE no banco (verificado — migrations 087, 110, 151). Nenhuma migration de schema é necessária para ativar esta regra com valor `false`.
10. **TTL de cache: 60s** (não 120s): escolha conservadora dado o ambiente serverless com instâncias isoladas.
11. **D1 — Integridade contrato-tenant via trigger (Opção B) — REFERÊNCIA FUTURA**: `contract_business_rules` não existe nas Fases 1-10. Esta decisão é preservada para quando a tabela for criada (Fases A+B do plano de acesso por contrato). Após a Fase A (adição de UNIQUE(tenant_id, id) em `contract`), a FK composta se tornará viável e o trigger poderá ser substituído.
12. **D2 — RLS real**: função `public.user_can_access_tenant(tenant_id)` — não usar claims JWT.
13. **D3 — Sem vigência em V1**: `valid_from`/`valid_until` removidos. UNIQUE(tenant_id, rule_key) sem ambiguidade.
14. **D4 — Snapshot em histórico e tabelas de operação**: `project_programming_history` para programação; colunas nas tabelas de operação para medição, as built e faturamento.
15. **D5 — Modelo de aprovação de faturamento**: Opção A (campos na `project_billing_orders`) — o fluxo atual é simples, sem histórico de decisão. Se no futuro for necessário reaprovação ou múltiplas etapas, migrar para tabela dedicada.
16. **D6 — `frontend_exposable = false` como default**: apenas `programacao.require_sgd_fields` e `programacao.export_layout` recebem `true`.
17. **D7 — `reject` e `allow_without_anticipation` documentados como requerem teste completo** antes de ativação em produção.

---

## 9. Pontos que exigem validação humana

1. **`contract` como nível futuro de configuração**: hoje `public.contract` tem um contrato por tenant (`tenant_id UNIQUE` — migration 032). Nas Fases 1 a 10, a hierarquia de resolução de regras é apenas `global → tenant`. A camada `global → tenant → contrato` só será criada após a evolução para N contratos por tenant, com `app_user_contracts`, `activeContractId`, `user_can_access_scope()` e `contract_business_rules` criada com o próximo número disponível (não reservado). Essa evolução futura não bloqueia a Fase 1 atual — `contract_business_rules` não existe nas Fases 1 a 10.

2. **Campos ENEL nullable confirmados**: `sgd_type_id`, `campo_eletrico` e `electrical_eq_catalog_id` são nullable no banco. Ativar `programacao.require_sgd_fields = false` é seguro sem migration de schema.

3. **Layout `ENEL-EXCEL`**: o botão e layout de exportação são claramente voltados a um cliente específico. Definir: deve ser controlado por `programacao.export_layout`? As colunas exportadas devem vir do catálogo `programming_export_column_definitions` (proposto na Correção 10)?

4. **`isCompletedWorkStatus()` aceita `COMPLETO`**: confirmado nas migrations e código. O token `COMPLETO` ainda existe em múltiplas funções de banco (migrations 217, 229, 255, 256, 257, 258, 272, 274). Limpeza histórica é fase futura.

5. **Política `intermediate_completion_policy`**: confirmar com o negócio se o valor `reject` (bloquear CONCLUIDO em etapa não-final) é desejado para algum tenant. O default `mark_future_as_anticipated` preserva o comportamento atual.

6. **TTL do cache de auth (45s)**: o cache atual implica que usuários desativados têm até 45s de acesso residual. Confirmar se isso é aceitável para todos os tenants ou se algum exige invalidação imediata.

7. **Tela administrativa de regras (Fase 9)**: confirmar quem é o público-alvo — time interno do SaaS, admin do tenant, ou ambos. Isso define `editable_by` em cada regra do catálogo.

8. **Snapshot em `project_programming_history`**: confirmar se a coluna `applied_rules_snapshot JSONB` deve ser preenchida apenas em conclusões (action_type=CONCLUIDO), ou também em cancelamentos e adiamentos.

9. **CHECK constraint de `export_column`** (migration 087): o constraint atual `('SGD_AT_MT_VYP', 'SGD_BT', 'SGD_TET')` só pode ser removido após o catálogo `programming_export_column_definitions` estar criado, populado e o código migrado para consumi-lo. Confirmar sequência de execução.

10. **Modelo de aprovação de faturamento (D5)**: o fluxo atual de `project_billing_orders` tem status `ABERTA/FECHADA/CANCELADA` sem campo de aprovação. Para a regra `faturamento.require_approval_before_billing`, a Fase 7 precisará adicionar colunas `approved_by UUID` e `approved_at TIMESTAMPTZ` na tabela `project_billing_orders`. Confirmar se a migration de schema de aprovação precisa ser feita antes ou durante a Fase 7.
