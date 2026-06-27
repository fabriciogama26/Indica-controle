# Acesso por Tenant e Contrato — Plano de Implementação Futuro
Revisado em: 2026-06-27

**REGRA ABSOLUTA:** Este documento descreve trabalho FUTURO. Nenhuma das fases aqui deve ser iniciada sem aprovação explícita. Nenhuma migration, nenhum código funcional e nenhuma RLS foram alterados durante a elaboração deste plano.

Todas as informações sobre campos, funções e tabelas foram verificadas diretamente nas migrations e código-fonte do repositório.

---

## Pré-requisito

Este plano só pode ser iniciado APÓS todas as condições abaixo estarem atendidas:

- [ ] Fases 1 a 10 do plano de regras configuráveis concluídas e estáveis em produção
  - Fase 1: migrations 276, 277, 279, 280 (somente essas quatro)
  - Fases 5/6/7: migrations de snapshot para Programação, Medição/As Built e Faturamento (números a confirmar)
  - Migration 278 (`contract_business_rules`): **CANCELADA DEFINITIVAMENTE** — nunca será criada com esse número (migrations 279 e 280 já existem; inserção fora de ordem é inválida)
- [ ] Sem regressões em Programação, Medição, As Built e Faturamento por pelo menos 2 semanas após estabilização das regras configuráveis
- [ ] Decisões de negócio das seções 11.1 a 11.8 do estudo técnico respondidas e documentadas
- [ ] Aprovação explícita do responsável pelo produto para iniciar este plano
- [ ] Ambiente de staging disponível para testar cada fase antes de produção

**Número da próxima migration disponível para este plano:**
- **Não reservar número agora.** No momento da implementação da Fase A, verificar qual é o próximo número disponível na sequência real (provavelmente 284+ considerando as migrations das fases 5, 6 e 7 das regras configuráveis).
- Migration 278: cancelada — não usar jamais.
- Não assumir que 283 está disponível — pode já ter sido usado por outras migrations entre hoje e a data da implementação.

---

## Fase A — Preparar contract para 1:N

**Objetivo:** Remover `UNIQUE(tenant_id)` de `public.contract` e adicionar suporte a N contratos por tenant, com `is_default` para identificar o contrato padrão.

**Nome sugerido da migration:** `<proxima_migration>_contract_remove_unique_tenant_add_is_default.sql`

> **Numeração:** Não usar 278 jamais. Não assumir 283 — confirmar próximo número disponível no momento de criação (`SELECT MAX(...) FROM schema_migrations`). As migrations das Fases 5, 6 e 7 das regras configuráveis podem ter ocupado números antes deste plano.

**O que a migration faz:**

1. Identificar o nome real da constraint UNIQUE(tenant_id) criada na migration 032:
   ```sql
   -- Executar antes de criar a migration:
   SELECT conname FROM pg_constraint
   WHERE conrelid = 'public.contract'::regclass AND contype = 'u' AND conkey::text LIKE '%tenant_id%';
   ```
   O nome provável é gerado automaticamente pelo Postgres (ex: `contrato_tenant_id_key` ou `contract_tenant_id_key`).

2. Remover a constraint UNIQUE(tenant_id):
   ```sql
   ALTER TABLE public.contract DROP CONSTRAINT IF EXISTS contrato_tenant_id_key;
   -- se o nome for diferente, usar o nome real encontrado no passo 1
   ```

3. Adicionar coluna `is_default`:
   ```sql
   ALTER TABLE public.contract
     ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
   ```

4. Adicionar UNIQUE(tenant_id, id) — necessário para FKs compostas futuras:
   ```sql
   ALTER TABLE public.contract
     ADD CONSTRAINT contract_tenant_id_id_unique UNIQUE (tenant_id, id);
   ```

5. Adicionar índice parcial para contrato padrão único por tenant:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS ux_contract_tenant_default
     ON public.contract (tenant_id)
     WHERE is_default = true AND ativo = true;
   ```

6. Backfill — marcar o único contrato existente de cada tenant como default:
   ```sql
   UPDATE public.contract SET is_default = true WHERE ativo = true;
   -- Seguro porque hoje é 1:1 (um contrato por tenant)
   ```

**Tabelas afetadas:** `contract` apenas. As tabelas operacionais não têm FK para `contract` hoje.

**Rollback (apenas antes da Fase E — depois de project ter FK para contract não é possível sem cascata):**
```sql
ALTER TABLE public.contract DROP CONSTRAINT IF EXISTS contract_tenant_id_id_unique;
DROP INDEX IF EXISTS public.ux_contract_tenant_default;
ALTER TABLE public.contract DROP COLUMN IF EXISTS is_default;
-- Recriar UNIQUE(tenant_id) — só funciona se ainda há 1 contrato por tenant
ALTER TABLE public.contract ADD CONSTRAINT contrato_tenant_id_key UNIQUE(tenant_id);
```

**Testes:**
- [ ] `SELECT count(*) FROM contract GROUP BY tenant_id HAVING count(*) > 1` — deve retornar 0 antes (para confirmar que rollback é seguro)
- [ ] Após migration: tentativa de INSERT de segundo contrato para mesmo tenant deve funcionar (não há mais UNIQUE)
- [ ] Após migration: `SELECT * FROM contract WHERE is_default = true AND ativo = true` — deve retornar 1 linha por tenant
- [ ] Tentativa de INSERT de segundo contrato com `is_default = true` no mesmo tenant deve falhar pelo índice parcial
- [ ] `SELECT * FROM contract WHERE tenant_id = X AND ativo = true` continua retornando dados

**Critério de aceite:** N contratos por tenant são possíveis. Dados existentes preservados. `is_default` identifica o contrato atual de cada tenant.

**Dependências:** Fases 1 a 10 das regras configuráveis concluídas e estáveis. Fase 1 inclui as migrations 276, 277, 279 e 280. As migrations das Fases 5, 6 e 7 (snapshots) usam o próximo número disponível no momento de cada implementação — não reservar numeração agora.

---

## Fase B — Criar tabela de acesso por contrato

**Objetivo:** Criar `app_user_contracts` com semântica de `contract_id = NULL` para acesso global e índices parciais que impedem mistura de modos.

**Nome sugerido da migration:** `<proxima_migration>_create_app_user_contracts.sql`

**O que a migration faz:**

1. Cria tabela:
```sql
CREATE TABLE IF NOT EXISTS public.app_user_contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contract(id) ON DELETE RESTRICT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES public.app_users(id),
  updated_by  UUID REFERENCES public.app_users(id)
);
```

2. Cria índices parciais para separação de modos:
```sql
-- Acesso global: no máximo 1 registro ativo por usuário por tenant
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_contracts_global
  ON public.app_user_contracts (user_id, tenant_id)
  WHERE contract_id IS NULL AND is_active = true;

-- Acesso específico: no máximo 1 registro ativo por usuário por tenant por contrato
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_contracts_specific
  ON public.app_user_contracts (user_id, tenant_id, contract_id)
  WHERE contract_id IS NOT NULL AND is_active = true;

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_app_user_contracts_user_active
  ON public.app_user_contracts (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_app_user_contracts_tenant_contract
  ON public.app_user_contracts (tenant_id, contract_id);
```

3. Cria trigger de validação de modo (global vs específico não podem coexistir):
```sql
CREATE OR REPLACE FUNCTION public.validate_contract_access_mode()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.app_user_contracts
      WHERE user_id = NEW.user_id
        AND tenant_id = NEW.tenant_id
        AND contract_id IS NOT NULL
        AND is_active = true
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Usuário já possui acesso específico a contratos neste tenant.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.app_user_contracts
      WHERE user_id = NEW.user_id
        AND tenant_id = NEW.tenant_id
        AND contract_id IS NULL
        AND is_active = true
        AND id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION 'Usuário já possui acesso global neste tenant.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_contract_access_mode
BEFORE INSERT OR UPDATE ON public.app_user_contracts
FOR EACH ROW EXECUTE FUNCTION public.validate_contract_access_mode();
```

4. Ativa RLS:
```sql
ALTER TABLE public.app_user_contracts ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado vê apenas os seus próprios registros
CREATE POLICY app_user_contracts_self_select ON public.app_user_contracts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.auth_user_id = auth.uid()  -- cruzamento CORRETO: auth_user_id, não id
      AND au.id = app_user_contracts.user_id
      AND au.ativo = true
  )
);

-- Admin do tenant pode ver e gerenciar os registros do seu tenant
CREATE POLICY app_user_contracts_admin_select ON public.app_user_contracts
FOR SELECT TO authenticated
USING (public.user_is_admin_in_tenant(app_user_contracts.tenant_id));
```

5. Seed inicial — todo usuário ativo existente recebe acesso global (preserva comportamento atual):
```sql
INSERT INTO public.app_user_contracts (tenant_id, user_id, contract_id, is_active)
SELECT
  au.tenant_id,
  au.id,
  NULL,  -- acesso global
  true
FROM public.app_users au
WHERE au.ativo = true
ON CONFLICT DO NOTHING;
```

6. Trigger de auditoria:
```sql
CREATE TRIGGER trg_app_user_contracts_audit
BEFORE INSERT OR UPDATE ON public.app_user_contracts
FOR EACH ROW EXECUTE FUNCTION public.apply_audit_fields();
```

**Rollback:**
```sql
DROP TABLE IF EXISTS public.app_user_contracts;
-- Sem impacto em dados existentes pois a tabela é aditiva
```

**Testes:**
- [ ] Seed verificado: todo `app_users.id` ativo tem pelo menos um registro em `app_user_contracts`
- [ ] Seed verificado: todos os registros iniciais têm `contract_id IS NULL`
- [ ] Usuário autenticado consegue SELECT dos próprios registros via RLS
- [ ] Usuário autenticado NÃO consegue SELECT de registros de outro usuário
- [ ] Admin consegue SELECT de todos os registros do seu tenant
- [ ] Tentativa de INSERT de acesso global quando existe específico ativo retorna exceção do trigger
- [ ] Tentativa de INSERT de acesso específico quando existe global ativo retorna exceção do trigger

**Critério de aceite:** Tabela criada, seed aplicado (todos os usuários com acesso global), RLS funcionando, triggers validados.

**Dependências:** Fase A concluída.

---

## Fase C — Adaptar resolveAuthenticatedAppUser para activeContractId

**Objetivo:** Adaptar `resolveAuthenticatedAppUser()` em `src/lib/server/appUsersAdmin.ts` para suportar o header `x-contract-id` e retornar `activeContractId` no contexto.

**Arquivo afetado:** `src/lib/server/appUsersAdmin.ts`

**Mudanças propostas:**

1. Ler header `x-contract-id` (opcional):
```typescript
const requestedContractId = normalizeHeaderTenantId(request.headers.get("x-contract-id"));
```

2. Atualizar chave de cache para incluir contractId:
```typescript
const cacheKey = `${token}:${requestedTenantId ?? ""}:${requestedContractId ?? ""}`;
```

3. Resolver `activeContractId` após resolver `activeTenantId`:

**Algoritmo de resolução (5 casos — ver estudo técnico seção 3.4):**
```typescript
// Buscar contratos disponíveis para o usuário no tenant ativo
const { data: userContracts } = await supabase
  .from("app_user_contracts")
  .select("contract_id, is_active")
  .eq("user_id", currentUser.id)
  .eq("tenant_id", activeTenantId)
  .eq("is_active", true);

const hasGlobalAccess = userContracts?.some(r => r.contract_id === null) ?? false;

let activeContractId: string | null = null;

if (requestedContractId) {
  // CASO 1: x-contract-id informado — validar
  const contractValid = await supabase
    .from("contract")
    .select("id")
    .eq("id", requestedContractId)
    .eq("tenant_id", activeTenantId)
    .eq("ativo", true)
    .maybeSingle();

  if (!contractValid.data) {
    return { error: { status: 403, message: "Contrato não pertence ao tenant ativo." } };
  }

  const userHasAccess = hasGlobalAccess ||
    userContracts?.some(r => r.contract_id === requestedContractId) ?? false;

  if (!userHasAccess) {
    return { error: { status: 403, message: "Usuário não tem acesso ao contrato informado." } };
  }

  activeContractId = requestedContractId;
} else {
  // x-contract-id ausente: resolver automaticamente
  const tenantContracts = await supabase
    .from("contract")
    .select("id, is_default")
    .eq("tenant_id", activeTenantId)
    .eq("ativo", true);

  const availableContracts = tenantContracts.data ?? [];

  if (hasGlobalAccess) {
    if (availableContracts.length === 1) {
      // CASO 3: acesso global + 1 contrato no tenant → automático
      activeContractId = availableContracts[0].id;
    } else {
      // CASO 4: acesso global + N contratos → usar is_default
      const defaultContract = availableContracts.find(c => c.is_default);
      if (defaultContract) {
        activeContractId = defaultContract.id;
      }
      // Se nenhum is_default: activeContractId = null (tela pode não exigir contrato)
    }
  } else {
    const specificContracts = userContracts?.filter(r => r.contract_id !== null) ?? [];
    if (specificContracts.length === 1) {
      // CASO 2: exatamente 1 contrato específico → automático
      activeContractId = specificContracts[0].contract_id!;
    }
    // CASO 5: N contratos específicos → null; handler exige x-contract-id
  }
}
```

4. Atualizar tipo retornado:
```typescript
export type AuthenticatedAppUserContext = {
  supabase: SupabaseClient;
  authUserId: string;
  appUser: CurrentUserRow;
  tenantAccess: {
    activeTenantId: string;
    availableTenantIds: string[];
    activeContractId: string | null;   // null = sem contrato operacional ativo
    availableContractIds: string[];    // IDs dos contratos acessíveis pelo usuário
  };
  role: { roleKey: string; roleName: string; isAdmin: boolean; };
};
```

**Rollback:** A adição de `activeContractId` é aditiva — callers que não usam o campo não quebram. Reverter via git revert.

**Testes:**
- [ ] Requisição sem `x-contract-id` com 1 contrato disponível → resolve automaticamente
- [ ] Requisição sem `x-contract-id` com N contratos e `is_default` → usa default
- [ ] Requisição com `x-contract-id` inválido (não pertence ao tenant) → retorna 403
- [ ] Requisição com `x-contract-id` sem acesso (não em app_user_contracts) → retorna 403
- [ ] Requisição com `x-contract-id` válido + acesso global (NULL) → funciona
- [ ] Requisição com `x-contract-id` válido + acesso específico → funciona
- [ ] Chave de cache inclui contractId → trocar contrato invalida cache
- [ ] Código existente que não usa `activeContractId` continua funcionando sem regressão

**Critério de aceite:** `activeContractId` resolvido em todas as requisições protegidas. Backward compatible.

**Dependências:** Fases A e B concluídas.

---

## Fase D — Criar função RLS user_can_access_scope

**Objetivo:** Criar `public.user_can_access_scope(p_tenant_id uuid, p_contract_id uuid)` para uso futuro nas policies de tabelas operacionais.

**Nome sugerido da migration:** `<proxima_migration>_create_user_can_access_scope_function.sql`

**O que a migration faz:**
```sql
CREATE OR REPLACE FUNCTION public.user_can_access_scope(p_tenant_id uuid, p_contract_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    -- 1. Usuário tem acesso ao tenant (reutiliza função existente)
    public.user_can_access_tenant(p_tenant_id)
    -- 2. Contrato existe e pertence ao tenant
    AND EXISTS (
      SELECT 1 FROM public.contract c
      WHERE c.id = p_contract_id
        AND c.tenant_id = p_tenant_id
        AND c.ativo = true
    )
    -- 3. Usuário tem acesso ao contrato (global ou específico)
    AND EXISTS (
      SELECT 1 FROM public.app_users au
      -- CORRETO: auth.uid() → auth_user_id → id (NÃO user_id = auth.uid())
      WHERE au.auth_user_id = auth.uid()
        AND au.ativo = true
        AND (
          EXISTS (
            SELECT 1 FROM public.app_user_contracts auc
            WHERE auc.user_id = au.id
              AND auc.tenant_id = p_tenant_id
              AND auc.contract_id IS NULL
              AND auc.is_active = true
          )
          OR
          EXISTS (
            SELECT 1 FROM public.app_user_contracts auc
            WHERE auc.user_id = au.id
              AND auc.tenant_id = p_tenant_id
              AND auc.contract_id = p_contract_id
              AND auc.is_active = true
          )
        )
    )
$$;

COMMENT ON FUNCTION public.user_can_access_scope(uuid, uuid) IS
'Retorna true quando auth.uid() tem acesso ao tenant E ao contrato informados. '
'Verifica: (1) vínculo com o tenant via user_can_access_tenant, (2) contrato ativo '
'pertence ao tenant, (3) usuário tem registro em app_user_contracts com contract_id '
'NULL (acesso global) ou igual ao contrato específico. '
'Cruzamento correto: auth.uid() → app_users.auth_user_id → app_users.id.';

-- Revogar execute de anon e authenticated (padrão da migration 251)
REVOKE ALL ON FUNCTION public.user_can_access_scope(uuid, uuid) FROM anon, authenticated;
```

**Nota:** Esta função NÃO é adicionada a nenhuma policy ainda — isso é Fase J. A função retorna `false` para `p_contract_id = NULL` (pois `contract.id` nunca é NULL).

**Rollback:**
```sql
DROP FUNCTION IF EXISTS public.user_can_access_scope(uuid, uuid);
-- Sem impacto pois não está em uso em nenhuma policy ainda
```

**Testes:**
- [ ] `SELECT user_can_access_scope(tenant_id_teste, contract_id_teste)` retorna `true` para usuário com acesso global (NULL em app_user_contracts)
- [ ] Retorna `true` para usuário com acesso específico ao contrato
- [ ] Retorna `false` para usuário sem registro em app_user_contracts para o contrato
- [ ] Retorna `false` se contract não pertence ao tenant
- [ ] Retorna `false` com `p_contract_id = NULL`

**Critério de aceite:** Função criada, testada, pronta para uso. Nenhuma policy alterada.

**Dependências:** Fase B concluída (app_user_contracts deve existir).

---

## Fase E — Adicionar contract_id na tabela project

**Objetivo:** Adicionar `contract_id UUID` em `public.project` como âncora operacional principal. As demais tabelas operacionais herdarão o escopo por JOIN com project.

**Nome sugerido da migration:** `<proxima_migration>_add_contract_id_to_project.sql`

**O que a migration faz:**
```sql
-- Adicionar coluna nullable inicialmente (backfill na Fase F)
ALTER TABLE public.project
  ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES public.contract(id) ON DELETE RESTRICT;

-- Índice de performance para queries por tenant + contrato
CREATE INDEX IF NOT EXISTS idx_project_tenant_contract
  ON public.project (tenant_id, contract_id);

-- FK composta para validar que contract pertence ao mesmo tenant (opcional — requer UNIQUE(tenant_id, id) da Fase A)
-- Adicionar apenas se UNIQUE(tenant_id, id) foi criado na Fase A:
-- ALTER TABLE public.project
--   ADD CONSTRAINT project_contract_tenant_match
--   FOREIGN KEY (tenant_id, contract_id) REFERENCES public.contract(tenant_id, id);
```

**Estratégia:** `project.contract_id` nullable inicialmente para backward compatibility. Backfill na Fase F. NOT NULL em migration futura após confirmação de dados.

**Rollback:**
```sql
ALTER TABLE public.project DROP COLUMN IF EXISTS contract_id;
-- Sem impacto em dados operacionais (coluna nullable, não usada em queries ainda)
```

**Testes:**
- [ ] Coluna existe após migration
- [ ] Valor NULL aceito — todos os projetos existentes continuam funcionando
- [ ] Queries existentes de Programação, Medição, Faturamento não quebram
- [ ] INSERT de project sem `contract_id` continua funcionando

**Critério de aceite:** Coluna criada, nullable, dados existentes preservados.

**Dependências:** Fase A concluída (para a FK composta opcional).

---

## Fase F — Migrar dados existentes

**Objetivo:** Preencher `project.contract_id` em todos os registros com o contrato padrão do tenant correspondente.

**Nome sugerido da migration:** `<proxima_migration>_backfill_project_contract_id.sql`

**Verificação prévia obrigatória (executar antes de criar a migration):**
```sql
-- Verificar tenants sem contrato padrão ativo:
SELECT p.tenant_id
FROM public.project p
WHERE p.tenant_id NOT IN (
  SELECT c.tenant_id FROM public.contract c
  WHERE c.is_default = true AND c.ativo = true
);
-- Deve retornar 0 linhas. Se retornar algo: corrigir is_default antes de prosseguir.
```

**O que a migration faz:**
```sql
UPDATE public.project p
SET contract_id = c.id
FROM public.contract c
WHERE c.tenant_id = p.tenant_id
  AND c.is_default = true
  AND c.ativo = true
  AND p.contract_id IS NULL;
```

**Rollback:**
```sql
UPDATE public.project SET contract_id = NULL;
-- Apenas para staging. Em produção: avaliar caso a caso.
```

**Testes:**
- [ ] `SELECT count(*) FROM project WHERE contract_id IS NULL` deve retornar 0 após backfill
- [ ] Todos os `project.contract_id` apontam para contratos ativos do mesmo tenant
- [ ] Nenhuma regressão em Programação, Medição, As Built (`project_asbuilt_measurement_orders`), Faturamento

**Critério de aceite:** 100% dos projetos com `contract_id` preenchido. Zero projetos órfãos.

**Dependências:** Fase E concluída e aprovada.

---

## Fase G — Adaptar APIs, RPCs e handlers

**Objetivo:** Propagar `activeContractId` nas queries e RPCs de todas as rotas que operam em dados por projeto.

**Arquivos principais a adaptar:**
- `src/app/api/programacao/route.ts`
- `src/app/api/medicao/route.ts`
- `src/app/api/faturamento/route.ts`
- `src/app/api/medicao-asbuilt/route.ts`
- `src/app/api/projects/route.ts`
- `src/server/modules/programacao/handlers.ts`
- `src/server/modules/programacao/queries.ts`

**Padrão obrigatório (validação explícita — service_role ignora RLS):**
```typescript
const resolution = await resolveAuthenticatedAppUser(request);
if ("error" in resolution) return NextResponse.json(resolution.error, { status: resolution.error.status });

const tenantId = resolution.tenantAccess.activeTenantId;
const contractId = resolution.tenantAccess.activeContractId;

// Se a rota exige contrato e activeContractId é null:
if (!contractId) {
  return NextResponse.json({ message: "Contrato ativo não resolvido." }, { status: 400 });
}

// Filtro explícito obrigatório (mesmo com service_role):
const { data } = await resolution.supabase
  .from("project")
  .select("*")
  .eq("tenant_id", tenantId)
  .eq("contract_id", contractId);
```

**Para tabelas que herdam contract_id via JOIN com project:**
```typescript
// Filtrar via JOIN com project
const { data } = await resolution.supabase
  .from("project_programming")
  .select("*, project!inner(id, contract_id)")
  .eq("tenant_id", tenantId)
  .eq("project.contract_id", contractId);
```

**RPCs security definer:** Adicionar parâmetro `p_contract_id UUID` e validação interna de pertencimento ao tenant. As migrations para alterar assinaturas são novas migrations a partir de 288+.

**Rollback:** Reverter arquivos TypeScript via git.

**Testes:**
- [ ] Programação filtrada por contrato: usuário vê apenas programações de projetos do contrato ativo
- [ ] Trocar contrato via `x-contract-id` muda os dados exibidos
- [ ] Usuário com acesso global (NULL) vê todos os dados do tenant
- [ ] `project_asbuilt_measurement_orders` filtrado corretamente via JOIN com project
- [ ] Nenhuma regressão nos fluxos existentes

**Critério de aceite:** Todas as rotas operacionais filtram por `contract_id`. Sem vazamento de dados entre contratos.

**Dependências:** Fases C, E, F concluídas.

---

## Fase H — Adaptar telas e seletor de contexto

**Objetivo:** Adicionar seletor de contrato no cabeçalho da aplicação e propagar `activeContractId` para todas as chamadas de API.

**Componentes afetados:**
- `src/context/AuthContext.tsx` — adicionar `activeContractId` e `availableContractIds`
- Novo componente: `src/components/TenantContractSelector.tsx`
- `src/services/auth/auth.service.ts` — persistir `activeContractId` na sessão local
- Layout principal — inserir seletor no cabeçalho
- Todos os hooks de fetch nos módulos — incluir header `x-contract-id`

**Fluxo de UX:**
1. Login → carregar contratos disponíveis via API
2. Se 1 contrato: selecionar automaticamente, sem seletor visível
3. Se N contratos: exibir seletor; default = contrato com `is_default = true`
4. Ao trocar contrato: invalidar fetch dos hooks ativos e recarregar

**Nota sobre ausência de TanStack Query nos módulos:** Os módulos usam `useState` + `useEffect` + fetch manual. A invalidação ao trocar de contrato deve ser implementada via estado no `AuthContext` — ao mudar `activeContractId`, os hooks que dependem do contrato devem disparar um novo fetch (via dependência no `useEffect`).

**Rollback:** Reverter componentes via git.

**Testes:**
- [ ] Login com 1 contrato → sem seletor, contrato selecionado automaticamente
- [ ] Login com N contratos → seletor visível, default é o `is_default = true`
- [ ] Trocar contrato → dados da tela atualizam
- [ ] `x-contract-id` incluído em todas as requisições de API operacionais
- [ ] Refresh de página mantém o contrato selecionado (persistência local)
- [ ] Tentativa de trocar contrato com formulário não salvo → bloqueio com aviso

**Critério de aceite:** UX de seleção de contexto funcionando para todos os cenários documentados na seção 8 do estudo técnico.

**Dependências:** Fase C e Fase G concluídas.

---

## Fase I — Relatórios e dashboards consolidados

**Objetivo:** Suportar visão consolidada por tenant (todos os contratos) em dashboards para usuários com acesso global.

**Mudanças:**
- Modo "consolidado" no seletor: opção "Todos os contratos" apenas para usuários com `contract_id IS NULL` em `app_user_contracts`
- Quando consolidado: `x-contract-id` não enviado → backend retorna dados de todos os contratos do tenant
- Queries de dashboard: sem filtro por `contract_id`, agrupamento por contrato nos resultados

**Rollback:** Remoção de feature, sem impacto em dados.

**Testes:**
- [ ] Diretor vê dados de todos os contratos no modo consolidado
- [ ] Gerente de contrato não tem opção "Todos os contratos"
- [ ] Performance: dashboard consolidado com N contratos retorna em tempo aceitável

**Critério de aceite:** Visão consolidada funcionando. Sem impacto em usuários com acesso restrito.

**Dependências:** Fases G e H concluídas.

---

## Fase J — Ativar RLS por contrato

**Objetivo:** Substituir `user_can_access_tenant()` por `user_can_access_scope()` nas tabelas operacionais que têm `contract_id` em `project`.

**ATENÇÃO:** Esta é a fase de maior risco. Executar APENAS após todas as fases G e H estarem estáveis e verificadas em staging por pelo menos 2 semanas.

**O que a migration faz:**
Para a tabela `project` (âncora operacional principal):
```sql
DROP POLICY IF EXISTS project_tenant_select ON public.project;
DROP POLICY IF EXISTS project_tenant_write ON public.project;

CREATE POLICY project_scope_select ON public.project
  FOR SELECT TO authenticated
  USING (public.user_can_access_scope(project.tenant_id, project.contract_id));

CREATE POLICY project_scope_write ON public.project
  FOR ALL TO authenticated
  USING (public.user_can_access_scope(project.tenant_id, project.contract_id))
  WITH CHECK (public.user_can_access_scope(project.tenant_id, project.contract_id));
```

Para tabelas que herdam via JOIN com `project`: as policies existentes via `user_can_access_tenant` são suficientes enquanto as queries sempre fazem JOIN com `project`. Avaliar caso a caso.

**Tabelas globais do tenant:** NÃO alterar — continuam usando `user_can_access_tenant()`.

**Rollback:**
```sql
DROP POLICY IF EXISTS project_scope_select ON public.project;
DROP POLICY IF EXISTS project_scope_write ON public.project;
CREATE POLICY project_tenant_select ON public.project
  FOR SELECT TO authenticated USING (public.user_can_access_tenant(project.tenant_id));
CREATE POLICY project_tenant_write ON public.project
  FOR ALL TO authenticated
  USING (public.user_can_access_tenant(project.tenant_id))
  WITH CHECK (public.user_can_access_tenant(project.tenant_id));
```

**Testes:**
- [ ] Usuário com acesso global (NULL) ainda consegue SELECT de todos os projetos do tenant
- [ ] Usuário com acesso específico a 1 contrato não consegue SELECT de projetos de outros contratos
- [ ] Todas as RPCs de Programação continuam funcionando
- [ ] Todas as rotas de API não retornam 403 inesperado
- [ ] Performance: comparar latência com e sem nova policy

**Critério de aceite:** RLS por contrato ativa. Sem regressões. Isolamento de dados entre contratos confirmado.

**Dependências:** Todas as fases anteriores (A-I) concluídas e estáveis.

---

## Tabelas que receberão contract_id direto

| Tabela | Estratégia | Observação |
|--------|------------|------------|
| `project` | **Coluna direta** (Fase E/F) | Âncora operacional — todas as demais herdam por JOIN |

## Tabelas que herdam por relacionamento

| Tabela | Via | Observação |
|--------|-----|------------|
| `project_programming` | `project_id → project.contract_id` | JOIN já existe nas queries |
| `project_programming_history` | `project_id → project.contract_id` | JOIN já existe |
| `project_measurement_orders` | `project_id → project.contract_id` | JOIN já existe |
| `project_billing_orders` | `project_id → project.contract_id` | JOIN já existe |
| `project_asbuilt_measurement_orders` | `project_id → project.contract_id` | Nome real: `project_asbuilt_measurement_orders` (migration 177) |
| `project_material_forecast` | `project_id → project.contract_id` | JOIN já existe |
| `project_activity_forecast` | `project_id → project.contract_id` | JOIN já existe |
| `location_planning` | `project_id → project.contract_id` | JOIN já existe |

## Tabelas globais do tenant (sem contract_id)

Catálogos, configurações, materiais, pessoas, equipes, estoque — todos permanecem scoped apenas por `tenant_id`. Ver tabela completa na seção 4 do estudo técnico.

---

## Checklist de Aceite Final

- [ ] N contratos por tenant são possíveis (Fase A)
- [ ] `is_default` identifica o contrato padrão por tenant (Fase A)
- [ ] Usuário pode ter acesso global OU específico — nunca ambos (Fase B)
- [ ] Seed inicial preserva o comportamento atual: todos os usuários com acesso global (Fase B)
- [ ] `resolveAuthenticatedAppUser()` retorna `activeContractId` e `availableContractIds` (Fase C)
- [ ] Chave de cache inclui contractId (Fase C)
- [ ] `user_can_access_scope()` existe, testada, com cruzamento correto `auth_user_id` → `id` (Fase D)
- [ ] `project.contract_id` preenchido em 100% dos registros (Fase F)
- [ ] Todas as APIs de operação filtram por `contract_id` explicitamente (Fase G — service_role ignora RLS)
- [ ] UX de seleção de contrato funcionando, com invalidação de fetch ao trocar (Fase H)
- [ ] Visão consolidada para acesso global (Fase I)
- [ ] RLS por contrato ativa em `project` (Fase J)
- [ ] Testes end-to-end passando para todos os perfis (Diretor, Gerente, Planejador)
- [ ] Zero regressões nos fluxos existentes de Programação, Medição, As Built e Faturamento
- [ ] Sem uso de `measurement_asbuilt_orders` — usar `project_asbuilt_measurement_orders` (nome real)
- [ ] `contract_business_rules` criada e integrada à hierarquia de resolução de regras
- [ ] Documentação atualizada com estado final
- [ ] TASKS.md atualizado com status do plano
