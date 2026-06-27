# Acesso por Tenant e Contrato — Estudo Técnico
Revisado em: 2026-06-27

Escopo: repositório `Indica-controle` com stack Next.js 16 + Supabase/Postgres + Vercel.
Propósito: mapear a arquitetura atual de tenant, autenticação, contrato e RLS com base nos campos e funções reais encontrados nas migrations e código; identificar limitações do modelo 1:1 contrato-tenant; propor arquitetura futura para N contratos por tenant com controle de acesso granular por usuário e contrato.

**REGRA ABSOLUTA**: Este documento é leitura e proposta apenas. Nenhuma migration, nenhum código funcional e nenhuma RLS foram alterados durante sua elaboração.

Todas as informações abaixo foram verificadas diretamente nas migrations e no código-fonte do repositório, não por presunção.

---

## 1. Resumo Executivo

O sistema possui multi-tenant sólido baseado em `tenant_id` + RLS no Supabase, com 284+ migrations versionadas, 68 rotas de API, e uma camada de autenticação robusta via `resolveAuthenticatedAppUser()`. O contrato (`public.contract`) é hoje uma entidade 1:1 com o tenant — cada tenant tem exatamente um contrato, imposto pela constraint `UNIQUE(tenant_id)` criada na migration 032.

A evolução futura desejada é suportar N contratos por tenant, com controle de acesso granular: cada usuário pode ter acesso a um subconjunto dos contratos do seu tenant, e operações devem ser scoped por contrato ativo além do tenant ativo.

Este estudo mapeia:
- O que existe hoje (verificado diretamente nas migrations e código)
- As limitações que impedem a evolução imediata
- A arquitetura futura recomendada
- A ordem de execução das fases

---

## 2. Situação Atual

### 2.1 Modelo de Usuários e Tenants (campos reais de app_users)

**Tabela `public.app_users`** (migration 000, evoluída nas migrations 015, 016, 023):

Schema real verificado na migration 000:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `tenant_id UUID NOT NULL` — tenant nativo do usuário; FK para `tenants.id` adicionada na migration 045
- `auth_user_id UUID UNIQUE` — vínculo com `auth.users` do Supabase; este é o campo cruzado com `auth.uid()` nas functions RLS
- `matricula TEXT NOT NULL`
- `email TEXT NOT NULL`
- `role TEXT NOT NULL DEFAULT 'user'` — coluna legada; substituída por `role_id` na migration 023
- `ativo BOOLEAN NOT NULL DEFAULT true` — campo de status ativo; não existe campo `is_active` na tabela
- `admin_pin_hash TEXT` — PIN admin
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `UNIQUE(tenant_id, matricula)`
- `UNIQUE(tenant_id, email)`

Campos adicionados em migrations posteriores:
- `created_by UUID REFERENCES public.app_users(id)` (migration 015)
- `updated_by UUID REFERENCES public.app_users(id)` (migration 015)
- `login_name TEXT` (migration 016)
- `display TEXT` (migration 016)
- `role_id UUID NOT NULL REFERENCES public.app_roles(id)` (migration 023 — substituiu coluna `role TEXT`)

**Campo de status ativo confirmado: `ativo BOOLEAN` — NÃO existe campo `is_active` em `app_users`.**

**Tabela `public.app_roles`** (migration 023):
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `role_key TEXT NOT NULL UNIQUE` — valores padrão: `'admin'`, `'master'`, `'user'`
- `name TEXT NOT NULL`
- `description TEXT`
- `is_admin BOOLEAN NOT NULL DEFAULT false`
- `ativo BOOLEAN NOT NULL DEFAULT true`
- Roles com `is_admin = true`: `'admin'` e `'master'`

**Tabela `public.tenants`** (migration 045):
- `id UUID PRIMARY KEY` — mesmo UUID usado como `tenant_id` nas tabelas de negócio
- `name TEXT NOT NULL`
- `ativo BOOLEAN NOT NULL DEFAULT true`
- Populada no seed da migration 045 a partir dos `tenant_id` existentes em `app_users` e `contract`

**Tabela `public.app_user_tenants`** (migration 045):
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE`
- `tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`
- `is_default BOOLEAN NOT NULL DEFAULT false`
- `ativo BOOLEAN NOT NULL DEFAULT true`
- `UNIQUE(user_id, tenant_id)`
- Índice parcial: `UNIQUE ON (user_id) WHERE is_default = true AND ativo = true` — garante apenas um tenant default por usuário
- Permite que um usuário acesse múltiplos tenants (vinculação N:N com restrição de default único)

### 2.2 Fluxo de Autenticação e Resolução do Tenant Ativo

Toda requisição protegida passa por `resolveAuthenticatedAppUser()` em `src/lib/server/appUsersAdmin.ts`.

**Fluxo completo (verificado no código):**

1. Extrai Bearer token do header `Authorization` (não do payload, não de cookie)
2. Verifica cache em memória `_authCache` com TTL de 45s — chave exata: `${token}:${requestedTenantId ?? ""}`
3. Chama `supabase.auth.getUser(token)` via cliente `service_role`
4. Busca `app_users` pelo `auth_user_id` — retorna `id, tenant_id, role_id, login_name, display, ativo`
5. Rejeita com 403 se usuário sem `role_id` ou com role inativa
6. Rejeita com 403 se `ativo = false`
7. Busca `app_roles` pelo `role_id` para obter `role_key`, `name`, `is_admin`
8. Busca `app_user_tenants` filtrando `user_id = currentUser.id AND ativo = true`
9. Constrói lista `availableTenantIds` a partir dos links ativos; define `activeTenantId` pelo link com `is_default = true` (ou primeiro da lista)
10. Se header `x-tenant-id` presente: valida se está na lista de tenants permitidos; rejeita com 403 se não estiver; sobrescreve `activeTenantId`
11. Retorna `AuthenticatedAppUserContext` com `appUser.tenant_id` sempre igual ao `activeTenantId` resolvido

**Tipo retornado (código real):**
```typescript
export type AuthenticatedAppUserContext = {
  supabase: SupabaseClient;          // cliente service_role
  authUserId: string;                // auth.users.id
  appUser: CurrentUserRow;           // tenant_id já sobrescrito com activeTenantId
  tenantAccess: {
    activeTenantId: string;
    availableTenantIds: string[];
  };
  role: { roleKey: string; roleName: string; isAdmin: boolean; };
};
```

**Ponto crítico:** Não existe `contract_id` no contexto retornado. O sistema não possui resolução de contrato ativo em nenhuma etapa da autenticação.

**Cache:** TTL de 45s. Chave exata: `${token}:${requestedTenantId ?? ""}`. Inclui tenantId mas NÃO inclui contractId. Trocar de tenant invalida o cache; trocar de contrato (que ainda não existe) não invalidaria sem ajuste na chave.

### 2.3 Função RLS Atual (user_can_access_tenant — assinatura e lógica reais)

**Função `public.user_can_access_tenant(p_tenant_id uuid)`** (migration 045):

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
        or au.tenant_id = p_tenant_id
      )
  )
$$;
```

**Pontos críticos da lógica real:**
- Cruza por `au.auth_user_id = auth.uid()` — não usa `user_id = auth.uid()` diretamente
- Obtém `au.id` a partir de `app_users` e depois cruza com `app_user_tenants.user_id = au.id`
- Usa `au.ativo` (campo real) — não usa `is_active`
- Marcada como `STABLE` — pode ser cacheada pelo Postgres dentro da mesma query
- Não recebe `p_contract_id` — escopo atual é apenas o tenant
- Usada em TODAS as policies RLS das migrations 021+ como: `USING (public.user_can_access_tenant(tabela.tenant_id))`

**Funções auxiliares relacionadas encontradas nas migrations:**
- `public.current_app_user_id()` (migration 015) — retorna `au.id` do usuário autenticado via `auth.uid()`; usada no trigger de auditoria `apply_audit_fields()`
- `public.user_is_admin_in_tenant(p_tenant_id uuid)` (migrations 022/023) — verifica se o usuário autenticado é admin no tenant; usada nas policies de escrita de permissões
- `public.apply_audit_fields()` (migration 015) — trigger de auditoria padrão; preenche `created_by`/`updated_by`/`created_at`/`updated_at`

**Não existem funções:** `get_current_app_user_id`, `is_master`, `is_admin` (standalone). O check de admin é via `app_roles.is_admin` na função `user_is_admin_in_tenant`.

**Políticas RLS confirmadas nas tabelas principais:**
- `contract`: `contract_tenant_select` e `contract_tenant_write` (migration 033)
- `project`: `project_tenant_select` e `project_tenant_write` (migration 029)
- `project_programming`: usando `user_can_access_tenant` (migration 067+)
- `project_measurement_orders`: usando `user_can_access_tenant` (migration 112)
- `project_billing_orders`: usando `user_can_access_tenant` (migration 176)
- `project_asbuilt_measurement_orders`: usando `user_can_access_tenant` (migration 177)
- `teams`, `materials`, `people`, todos os catálogos: usando `user_can_access_tenant`

**Padrão de acesso server-side:** Toda query do backend usa `.eq("tenant_id", tenantId)` onde `tenantId` vem de `resolution.tenantAccess.activeTenantId` (nunca do payload do cliente). RPCs recebem `p_tenant_id` explicitamente. A migration 251 revogou EXECUTE de `public`, `anon` e `authenticated` em todas as RPCs SECURITY DEFINER — único caller válido é `service_role`.

### 2.4 Permissões Funcionais Atuais

O sistema possui dois níveis de permissão por página:

**Nível 1 — Por Role (`public.role_page_permissions`, migration 022/023):**
- `tenant_id UUID NOT NULL`
- `role_id UUID NOT NULL REFERENCES public.app_roles(id)`
- `page_key TEXT NOT NULL REFERENCES public.app_pages(page_key)`
- `can_access BOOLEAN NOT NULL DEFAULT true`
- `UNIQUE(tenant_id, role_id, page_key)`

**Nível 2 — Por Usuário (`public.app_user_page_permissions`, migration 024/026):**
- `tenant_id UUID NOT NULL`
- `user_id UUID NOT NULL REFERENCES public.app_users(id)`
- `page_key TEXT NOT NULL REFERENCES public.app_pages(page_key)`
- `can_access BOOLEAN NOT NULL DEFAULT false`
- `UNIQUE(tenant_id, user_id, page_key)`
- Após migration 026: apenas `can_access` (removidos `can_select`, `can_insert`, `can_update`)

As permissões funcionais são globais ao tenant — não existe hoje granularidade por contrato.

### 2.5 Contratos Hoje (campos reais de public.contract)

**Tabela `public.contract`** (criada como `contrato` na migration 032, renomeada para `contract` na migration 033):

Schema real verificado:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `tenant_id UUID NOT NULL UNIQUE` — constraint que impõe o modelo 1:1; nome da constraint gerado pelo Postgres na migration 032 (nome implícito, não declarado explicitamente como `CONSTRAINT <nome>`)
- `name TEXT NOT NULL` — com CHECK `btrim(name) <> ''` (migration 032)
- `valor TEXT GENERATED ALWAYS AS (tenant_id::text) STORED` — campo calculado legado
- `ativo BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `created_by UUID REFERENCES public.app_users(id)`
- `updated_by UUID REFERENCES public.app_users(id)`
- FK para `tenants.id` adicionada na migration 045: `CONSTRAINT contract_tenant_id_fk`
- Índice: `idx_contract_tenant_active ON (tenant_id, ativo)`

**NÃO existe campo `is_default` em `public.contract` hoje.** Este campo precisará ser criado na Fase A.

**A constraint UNIQUE(tenant_id) não tem nome explícito declarado na migration 032** — o Postgres gerou automaticamente. O nome real no banco pode ser verificado com: `SELECT conname FROM pg_constraint WHERE conrelid = 'public.contract'::regclass AND contype = 'u'`.

A migration 032 semeia a tabela com um contrato por tenant existente, usando o `tenant_id::text` como nome inicial. Portanto cada tenant existente já possui exatamente um contrato.

**Vinculação em tabelas operacionais:** Nenhuma tabela operacional (`project`, `project_programming`, `project_measurement_orders`, `project_billing_orders`, `project_asbuilt_measurement_orders`, `teams`, `materials`, etc.) possui coluna `contract_id`.

### 2.6 Limitações Atuais (lista de fatos confirmados)

1. **Modelo 1:1 tenant-contrato:** A constraint `UNIQUE(tenant_id)` na tabela `contract` impede que um tenant tenha mais de um contrato.

2. **Sem resolução de contrato ativo:** `resolveAuthenticatedAppUser()` não resolve nem retorna `contract_id`. O tipo `AuthenticatedAppUserContext` não tem `activeContractId`. Não existe header `x-contract-id`.

3. **Sem controle de acesso por contrato:** Não existe tabela de vínculo usuário-contrato. Um usuário tem acesso a todo o tenant — não é possível restringir um usuário a contratos específicos.

4. **Tabelas operacionais sem `contract_id`:** `project`, `project_programming`, `project_measurement_orders`, `project_billing_orders`, `project_asbuilt_measurement_orders` e todas as demais tabelas operacionais não têm coluna `contract_id`.

5. **RLS sem escopo de contrato:** `user_can_access_tenant()` valida apenas o vínculo usuário-tenant. Não existe função equivalente que valide acesso por contrato.

6. **Sem `is_default` em contract:** Não existe flag que identifique qual contrato é o ativo/padrão quando houver múltiplos. A futura tela de seleção de contexto precisará desta informação.

7. **Cache de auth sem contractId:** A chave atual do cache é `${token}:${requestedTenantId ?? ""}`. Com a introdução de `x-contract-id`, a chave precisará incluir o contractId para invalidar corretamente ao trocar de contrato.

8. **Sem TanStack Query nos módulos operacionais:** O projeto usa `@tanstack/react-query` (instalado) mas os módulos operacionais usam `useState` + `useEffect` + fetch manual — sem `useQuery`/`queryKey`. Não existe padrão de queryKey para invalidar ao trocar de contrato. A futura invalidação de cache ao trocar de contrato precisará ser implementada no padrão de fetch manual existente.

---

## 3. Modelo Futuro

### 3.1 Tenant 1:N Contratos

**Mudança necessária na tabela `public.contract`:**

A constraint `UNIQUE(tenant_id)` (criada na migration 032) deve ser removida. No lugar, deve ser criado um índice composto `UNIQUE(tenant_id, id)` — necessário para permitir FKs compostas futuras referenciando `contract` a partir das tabelas operacionais.

Schema futuro de `public.contract` (após Fase A):
- **Remover:** constraint `UNIQUE(tenant_id)` (verificar nome real com `pg_constraint` antes da migration)
- **Adicionar:** `UNIQUE(tenant_id, id)` — permite FKs compostas `FOREIGN KEY (tenant_id, contract_id) REFERENCES contract(tenant_id, id)`
- **Adicionar:** `is_default BOOLEAN NOT NULL DEFAULT false` — flag para contrato padrão do tenant
- **Adicionar:** índice parcial `UNIQUE ON (tenant_id) WHERE is_default = true AND ativo = true` — garante apenas um contrato padrão ativo por tenant
- **Manter:** todos os campos existentes sem alteração para compatibilidade retroativa

**Backfill:** O contrato existente de cada tenant deve ser marcado como `is_default = true` na migration de Fase A.

### 3.2 Tabela app_user_contracts

Tabela nova proposta `public.app_user_contracts`:

```sql
CREATE TABLE public.app_user_contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contract(id) ON DELETE RESTRICT,
  -- contract_id NULL = acesso global (todos os contratos do tenant)
  -- contract_id preenchido = acesso apenas a esse contrato específico
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES public.app_users(id),
  updated_by  UUID REFERENCES public.app_users(id)
);
```

**Por que sem can_read/can_update/can_approve:** Esses campos são permissões funcionais, não permissões de escopo. Permissões funcionais já são gerenciadas por `app_user_page_permissions` e `role_page_permissions`. A tabela `app_user_contracts` define apenas ESCOPO DE DADOS (quais contratos), não o que o usuário pode fazer dentro do contrato. Misturar os dois conceitos nesta tabela criaria redundância e contradições com o sistema de permissões existente.

**Semântica de `contract_id = NULL`:**
- Registro com `contract_id IS NULL`: usuário tem acesso a todos os contratos do tenant (acesso global — ex: Diretor)
- Registro com `contract_id` preenchido: usuário tem acesso apenas a esse contrato específico
- Um usuário pode ter apenas UM modo: ou global (NULL) ou específico (um ou mais contract_ids)

**Restrição de modo global vs específico:** Um usuário não pode ter simultaneamente um registro global (NULL) e um registro específico. Isso seria semanticamente contraditório. A restrição é implementada por:

**Índices parciais:**
```sql
-- Garante: no máximo um registro de acesso global por usuário por tenant
CREATE UNIQUE INDEX ux_app_user_contracts_global
  ON public.app_user_contracts (user_id, tenant_id)
  WHERE contract_id IS NULL AND is_active = true;

-- Garante: no máximo um registro por contrato específico por usuário por tenant
CREATE UNIQUE INDEX ux_app_user_contracts_specific
  ON public.app_user_contracts (user_id, tenant_id, contract_id)
  WHERE contract_id IS NOT NULL AND is_active = true;
```

**Trigger de validação de modo:**
```sql
-- Antes de INSERT/UPDATE: verificar que não existe modo oposto ativo
CREATE OR REPLACE FUNCTION public.validate_contract_access_mode()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_id IS NULL THEN
    -- Tentando inserir acesso global: verificar que não existe acesso específico ativo
    IF EXISTS (
      SELECT 1 FROM public.app_user_contracts
      WHERE user_id = NEW.user_id
        AND tenant_id = NEW.tenant_id
        AND contract_id IS NOT NULL
        AND is_active = true
        AND id != COALESCE(NEW.id, gen_random_uuid())
    ) THEN
      RAISE EXCEPTION 'Usuário já possui acesso específico a contratos neste tenant. Remova os acessos específicos antes de conceder acesso global.';
    END IF;
  ELSE
    -- Tentando inserir acesso específico: verificar que não existe acesso global ativo
    IF EXISTS (
      SELECT 1 FROM public.app_user_contracts
      WHERE user_id = NEW.user_id
        AND tenant_id = NEW.tenant_id
        AND contract_id IS NULL
        AND is_active = true
        AND id != COALESCE(NEW.id, gen_random_uuid())
    ) THEN
      RAISE EXCEPTION 'Usuário já possui acesso global neste tenant. Remova o acesso global antes de conceder acesso específico a contratos.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

### 3.3 Separação: Permissão Funcional vs Escopo por Contrato

São dois eixos independentes que se complementam:

**Permissão Funcional** (o que o usuário pode fazer):
- Gerenciada por `app_user_page_permissions` + `role_page_permissions`
- Responde: "pode o usuário acessar a tela de Programação?"
- Escopo: tenant (não por contrato)
- Exemplo: usuário com `can_access = true` para `programacao` pode criar programações

**Permissão de Escopo** (em quais dados o usuário pode operar):
- Gerenciada por `app_user_contracts` (futura)
- Responde: "em quais contratos o usuário pode ver e operar dados?"
- Escopo: tenant + contrato

**Combinação — ambas são necessárias:**
- Usuário precisa ter permissão funcional PARA A TELA + escopo para o contrato
- Exemplo: usuário com acesso funcional à Programação mas escopo apenas no Contrato A não verá dados do Contrato B
- A RLS garante o escopo; a permissão funcional bloqueia a tela antes da query

**O que NÃO vai para app_user_contracts:** can_approve, can_create, can_update — esses pertencem ao sistema de permissões funcionais existente.

### 3.4 Resolução do Contrato Ativo

**Algoritmo de 5 casos (ordem de avaliação):**

```
Entrada: x-contract-id (opcional), activeTenantId (já resolvido)

CASO 1 — x-contract-id informado:
  a. Validar que o contrato pertence ao activeTenantId:
     SELECT FROM contract WHERE id = x-contract-id AND tenant_id = activeTenantId AND ativo = true
  b. Validar que o usuário tem acesso (global ou específico):
     Existe registro em app_user_contracts com user_id = appUser.id
     AND tenant_id = activeTenantId
     AND (contract_id IS NULL OR contract_id = x-contract-id)
     AND is_active = true
  c. Se válido: activeContractId = x-contract-id
  d. Se inválido: retornar 403

CASO 2 — x-contract-id ausente E usuário tem exatamente 1 contrato permitido:
  - Usuário com acesso específico a 1 único contrato ativo
  - Selecionar automaticamente: activeContractId = esse contrato
  - Sem necessidade de seletor na tela

CASO 3 — x-contract-id ausente E usuário tem acesso global E tenant tem 1 contrato ativo:
  - Selecionar automaticamente: activeContractId = o único contrato ativo do tenant
  - Sem necessidade de seletor na tela

CASO 4 — x-contract-id ausente E usuário tem acesso global E tenant tem N contratos ativos:
  - Usar o contrato com is_default = true no tenant
  - Se nenhum is_default: retornar 400 exigindo x-contract-id

CASO 5 — x-contract-id ausente E usuário tem N contratos permitidos (acesso específico a vários):
  - Retornar 400 exigindo seleção explícita de contrato
  - O frontend deve apresentar seletor de contrato

REGRA EXTRA — Telas que não requerem contrato:
  - activeContractId = null (catálogos, configurações globais do tenant)
  - Não enviar x-contract-id; backend não exige

NUNCA: selecionar contrato não acessível ao usuário como default.
NUNCA: confiar em contract_id vindo do payload do body.
```

### 3.5 Função RLS Futura user_can_access_scope

**Assinatura proposta:**
```sql
CREATE OR REPLACE FUNCTION public.user_can_access_scope(p_tenant_id uuid, p_contract_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    -- 1. Usuário tem acesso ao tenant
    public.user_can_access_tenant(p_tenant_id)
    -- 2. Contrato existe e pertence ao tenant
    AND EXISTS (
      SELECT 1
      FROM public.contract c
      WHERE c.id = p_contract_id
        AND c.tenant_id = p_tenant_id
        AND c.ativo = true
    )
    -- 3. Usuário tem acesso ao contrato (global ou específico)
    AND EXISTS (
      SELECT 1
      FROM public.app_users au
      -- Cruzamento CORRETO: auth.uid() → app_users.auth_user_id → app_users.id
      WHERE au.auth_user_id = auth.uid()
        AND au.ativo = true
        AND (
          -- Acesso global ao tenant (contract_id IS NULL = todos os contratos)
          EXISTS (
            SELECT 1 FROM public.app_user_contracts auc
            WHERE auc.user_id = au.id
              AND auc.tenant_id = p_tenant_id
              AND auc.contract_id IS NULL
              AND auc.is_active = true
          )
          OR
          -- Acesso específico ao contrato
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
```

**CRÍTICO:** O cruzamento usa `au.auth_user_id = auth.uid()` (igual ao padrão real de `user_can_access_tenant`), NÃO `user_id = auth.uid()`. O campo de cruzamento com o Supabase Auth em `app_users` é `auth_user_id`, não `id`.

**Uso nas policies (futuro — apenas após Fase J):**
```sql
CREATE POLICY project_scope_select ON public.project
  FOR SELECT TO authenticated
  USING (public.user_can_access_scope(project.tenant_id, project.contract_id));
```

### 3.6 Restrição: Acesso Global vs Específico Não Podem Coexistir

Um usuário não pode ter simultaneamente:
- Um registro com `contract_id IS NULL` (acesso global)
- Um registro com `contract_id` preenchido (acesso específico)

no mesmo tenant.

**Implementação (dupla proteção):**

1. **Índices parciais únicos** (Seção 3.2) — garantem unicidade no banco
2. **Trigger BEFORE INSERT OR UPDATE** (Seção 3.2) — bloqueia na escrita com mensagem de erro clara
3. **Validação server-side no handler** — rejeitar a operação antes de chegar ao banco

**Semântica do campo `is_active = false`:** Registros desativados não contam para a restrição. O índice parcial filtra `WHERE is_active = true`. Portanto é possível "arquivar" um acesso global e criar acessos específicos sem apagar o histórico.

---

## 4. Classificação de Tabelas

| Tabela | tenant_id? | contract_id hoje? | Deve ter contract_id direto? | Estratégia |
|--------|-----------|-------------------|------------------------------|------------|
| `tenants` | é a PK | não | não | Global — entidade raiz |
| `app_users` | sim | não | não | Global — pertence ao tenant |
| `app_roles` | não | não | não | Global — catálogo global |
| `app_user_tenants` | sim | não | não | Global — vínculo usuário-tenant |
| `app_pages` | não | não | não | Global — catálogo global |
| `role_page_permissions` | sim | não | não | Global — permissão por role no tenant |
| `app_user_page_permissions` | sim | não | não | Global — permissão por usuário no tenant |
| `contract` | sim | não (é a PK) | não | Global — evolui: remover UNIQUE(tenant_id), adicionar is_default |
| `people` | sim | não | não | Global — cadastro do tenant |
| `materials` | sim | não | não | Global — catálogo do tenant |
| `inventory_balance` | sim | não | não | Global — saldo global do tenant |
| `job_titles` | sim | não | não | Global — catálogo do tenant |
| `service_activities` | sim | não | não | Global — catálogo de atividades do tenant |
| `programming_sgd_types` | sim | não | não | Global do tenant — catálogo configurável |
| `programming_reason_catalog` | sim | não | não | Global do tenant — catálogo configurável |
| `programming_work_completion_catalog` | sim | não | não | Global do tenant — catálogo configurável |
| `programming_eq_catalog` | sim | não | não | Global do tenant — catálogo configurável |
| **`project`** | sim | não | **SIM — âncora operacional** | Operacional — adicionar `contract_id` (Fase E); todas as filhas herdam por JOIN |
| `project_programming` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_programming_history` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_measurement_orders` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_billing_orders` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_asbuilt_measurement_orders` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_material_forecast` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `project_activity_forecast` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `location_planning` | sim | não | não diretamente | Herança via `project_id → project.contract_id` |
| `teams` | sim | não | **DECISÃO PENDENTE** | Global do tenant ou por contrato? Ver seção 11.1 |
| `trafo_instances` | sim | não | **DECISÃO PENDENTE** | Global do tenant ou por contrato? Ver seção 11.2 |
| `measurement_meta_targets` | sim | não | **DECISÃO PENDENTE** | Por tenant ou por contrato? Ver seção 11.3 |

**Conclusão de escopo:** `project` é a âncora operacional. Se `project` receber `contract_id`, todas as tabelas com FK para `project` herdam o escopo do contrato por join. Não é necessário adicionar `contract_id` em todas as tabelas operacionais — apenas em `project`.

**Nome real confirmado (migration 177):** A tabela de Medição As Built chama-se `project_asbuilt_measurement_orders` — NÃO `measurement_asbuilt_orders`. Todo documento futuro deve usar o nome real.

---

## 5. Perfis de Acesso

Com a arquitetura futura `app_user_contracts`, os perfis operariam assim:

**Diretor (acesso a todos os contratos):**
- `app_user_contracts`: registro com `contract_id IS NULL, is_active = true`
- Permissões funcionais: definidas em `app_user_page_permissions` (independente do escopo)
- Vê todos os projetos e operações do tenant, independente do contrato
- Dashboard consolidado: dados de todos os contratos do tenant

**Gerente de Contrato (acesso a contratos específicos):**
- `app_user_contracts`: um registro por contrato sob sua gestão com `is_active = true`
- Permissões funcionais: definidas em `app_user_page_permissions` (independente do escopo)
- Vê apenas projetos do(s) contrato(s) sob sua gestão
- Não vê dados de outros contratos do mesmo tenant

**Planejador / Operador de Programação:**
- `app_user_contracts`: registros com `is_active = true` para contratos específicos
- Permissões funcionais: acesso a telas de programação (sem aprovar, se aplicável)
- Acesso operacional limitado a contratos específicos

**Almoxarifado:**
- Gerencia estoque que é global do tenant (`materials`, `inventory_balance`)
- `app_user_contracts` não afeta o estoque — estoque permanece scoped apenas por tenant
- Permissão funcional: telas de estoque. Sem necessidade de contrato ativo para estas telas.

**Admin do SaaS (acesso multi-tenant):**
- Acesso via `app_user_tenants` a qualquer tenant
- `user_can_access_tenant()` já cobre o acesso; `app_user_contracts` pode ser dispensada para admin do SaaS (definir por política de negócio)

---

## 6. Impacto em APIs e RPCs (service_role ignora RLS — validação explícita obrigatória)

**Ponto crítico:** O backend usa cliente `service_role` que ignora RLS. A validação de escopo (tenant + contrato) DEVE ser feita explicitamente no código TypeScript — não pode depender apenas da RLS de banco.

**Headers adicionados:**
- `x-contract-id`: novo header que o frontend envia junto com `x-tenant-id`

**Padrão obrigatório no backend:**
```typescript
// Em cada route handler que opera em dados por contrato:
const resolution = await resolveAuthenticatedAppUser(request);
if ("error" in resolution) return NextResponse.json(resolution.error, { status: resolution.error.status });

const tenantId = resolution.tenantAccess.activeTenantId;
const contractId = resolution.tenantAccess.activeContractId; // novo campo

// NUNCA: const contractId = body.contract_id; — NÃO confiar no payload

// Validação explícita em queries (mesmo com service_role):
const { data } = await resolution.supabase
  .from("project")
  .select("*")
  .eq("tenant_id", tenantId)
  .eq("contract_id", contractId); // filtro explícito obrigatório
```

**Em edição de registros:** `contract_id` é buscado do registro existente — nunca do payload do cliente:
```typescript
// NUNCA confiar no contract_id do body
const existing = await supabase.from("project").select("contract_id").eq("id", id).single();
const contractId = existing.data.contract_id; // fonte de verdade
```

**RPCs `security definer`:**
- Assinatura deve incluir `p_contract_id UUID`
- Função valida internamente: `SELECT 1 FROM project WHERE id = p_project_id AND tenant_id = p_tenant_id AND contract_id = p_contract_id`

**Tabelas globais do tenant (catálogos, materiais, etc.):**
- Sem impacto — continuam usando apenas `tenant_id` nas queries

---

## 7. Cache e TanStack Query por Contrato

**Cache de auth (appUsersAdmin.ts):**

Chave atual: `${token}:${requestedTenantId ?? ""}`

Chave futura necessária: `${token}:${requestedTenantId ?? ""}:${requestedContractId ?? ""}`

**Impacto:** Ao trocar de contrato, a chave muda automaticamente e o cache não é reutilizado. O TTL de 45s permanece adequado.

**TanStack Query nos módulos:**

O projeto usa `@tanstack/react-query` instalado, mas os módulos operacionais (programação, medição, faturamento, etc.) usam `useState` + `useEffect` + fetch manual — sem `useQuery` nem `queryKey`.

**Não existe padrão de queryKey** para invalidar ao trocar de contrato. A futura invalidação de dados ao trocar de contrato precisará ser implementada no padrão de fetch manual existente: ao trocar de contrato, triggar um `reload()` nos hooks afetados (similar ao que já acontece ao trocar filtros).

**Padrão de invalidação recomendado (sem TanStack Query):**
- `activeContractId` deve ser parte do `AuthContext` (ou novo `ContractContext`)
- Ao trocar `activeContractId`: disparar um evento ou state change que cause re-mount/re-fetch dos componentes afetados
- Bloquear troca de contrato com formulário não salvo (verificar `isDirty` antes de trocar)

---

## 8. UX Futura de Seleção de Contexto

**Cenário 1: 1 tenant, 1 contrato (padrão atual):**
- Sem seletor de contrato — contrato é implícito
- Login → dashboard direto
- `x-contract-id` enviado automaticamente

**Cenário 2: 1 tenant, N contratos, usuário com acesso global:**
- Após login: seletor de contrato no cabeçalho
- Default: contrato com `is_default = true`
- Usuário pode trocar sem relogin

**Cenário 3: 1 tenant, N contratos, usuário com acesso a subconjunto:**
- Seletor mostra apenas os contratos disponíveis para o usuário
- Se apenas 1 disponível: sem seletor, contrato implícito

**Cenário 4: N tenants por usuário (já existe):**
- Seletor de tenant (já existe via `x-tenant-id`)
- Após selecionar tenant: seletor de contrato dentro do tenant

**Cenário 5: Telas globais do tenant (catálogos, estoque):**
- Sem necessidade de contrato ativo
- Backend não exige `x-contract-id`; `activeContractId = null`

---

## 9. Estratégia de contract_business_rules

**Decisão: CANCELADO — migration 278 não será criada**

A tabela `contract_business_rules` NÃO será criada nas Fases 1 a 10 do plano de regras configuráveis.

**Justificativa técnica:**
1. A tabela `contract_business_rules` tem utilidade real apenas quando existir mais de um contrato por tenant. Com o modelo 1:1 atual, ela seria funcionalmente equivalente a `tenant_business_rules` (toda regra de contrato = regra do único contrato = regra do tenant).
2. Criar a tabela sem endpoints, sem tela e sem uso nos handlers gera código morto que aumenta a superfície de manutenção sem valor operacional.
3. A hierarquia de resolução de regras nas Fases 1 a 10 é `global → tenant`. A camada `contrato` só faz sentido após a Fase A (remoção do UNIQUE tenant-contrato) e após a Fase B (app_user_contracts).
4. O trigger `validate_contract_tenant_match` referencia `public.contract` — funciona em ambos os modelos (1:1 e 1:N). Portanto NÃO é necessário criar a tabela agora para garantir compatibilidade futura.

**O que isso significa para a migration 278:**
- A migration 278 está **cancelada definitivamente** — não será criada nunca com esse número
- Motivo: as migrations 279 e 280 já existem no plano; inserir 278 depois quebraria a sequência (migrations são aplicadas por ordem numérica crescente)
- A Fase 1 inclui apenas as migrations: **276, 277, 279, 280** (quatro, sem snapshots)
- Snapshots entram nas Fases 5, 6 e 7 com os próximos números disponíveis naquele momento
- Quando `contract_business_rules` for necessária (após Fase A+B deste plano), usar o **próximo número disponível** naquele momento — não reservar número agora

**`allowed_scopes` em `business_rule_definitions`:**
- Durante as Fases 1 a 10: `allowed_scopes` nunca inclui `'contract'` — apenas `'global'` e `'tenant'`
- Após criação de `contract_business_rules` (plano de acesso por contrato, Fase A+B): `allowed_scopes` pode incluir `'contract'` para as regras que façam sentido por contrato

---

## 10. Riscos

1. **Migração de dados existentes:** Os projetos existentes não têm `contract_id`. O backfill deve atribuir o contrato padrão (único contrato existente). Verificar antes do backfill que todos os tenants têm `is_default = true` em algum contrato.

2. **Performance de RLS por contrato:** `user_can_access_scope()` faz múltiplas EXISTS em `app_user_contracts`. Para tabelas com muitos registros, índices em `app_user_contracts(user_id, tenant_id, contract_id)` são obrigatórios.

3. **N+1 em consultas consolidadas:** Queries de dashboard consolidado (todos os contratos) precisam de CTEs ou subqueries eficientes.

4. **Compatibilidade retroativa na transição:** Durante as fases A-F, projetos sem `contract_id` devem continuar funcionando. A coluna deve ser adicionada como nullable e preenchida via backfill antes de tornar NOT NULL.

5. **Semântica de NULL em UNIQUE:** No Postgres, `UNIQUE(user_id, tenant_id, contract_id)` com NULL tem comportamento específico — dois NULLs não são duplicatas. Por isso os índices parciais são usados em vez de constraint UNIQUE simples.

6. **Regressão em RLS (Fase J):** Adicionar `user_can_access_scope()` pode bloquear queries existentes. Ativar apenas após todas as fases G e H estáveis e testadas.

7. **service_role ignora RLS:** O backend usa service_role que bypassa toda RLS. A validação explícita de tenant + contrato no código TypeScript é a principal proteção na transição — não depender da RLS durante as fases intermediárias.

8. **Ausência de TanStack Query:** A invalidação de cache ao trocar de contrato precisará ser implementada manualmente em cada hook que faz fetch. Risco de hooks que não invalidam quando o contrato muda.

---

## 11. Decisões que Precisam de Validação Humana

1. **Equipes por contrato ou globais?** A tabela `teams` é global do tenant hoje. Equipes podem ser reutilizadas em múltiplos contratos ou dedicadas a um contrato. Se dedicadas: `contract_id` em `teams`. Se compartilhadas: `teams` permanece global.

2. **Transformadores (trafo_instances) por contrato?** Ativos físicos compartilhados. Decisão: rastreamento de posição de trafo é por tenant ou por contrato?

3. **Metas (measurement_meta_targets) por contrato?** Metas de medição são por contrato ou por tenant?

4. **Dashboard consolidado:** Usuários com acesso global precisam de dashboards que agreguem todos os contratos. Definir antes da Fase I.

5. **Contrato padrão para acesso global:** Quando usuário tem `contract_id IS NULL`, qual contrato é selecionado automaticamente? O `is_default = true` do tenant, ou o usuário sempre seleciona manualmente quando há N contratos?

6. **Permissões por contrato vs funcionais — combinação:** As permissões funcionais são por tenant. Se um usuário tem `can_access = true` para Programação no tenant mas `contract_id` específico, ele vê apenas programações do seu contrato. Como comunicar isso na UX sem confundir com "sem permissão"?

7. **Migração gradual vs big-bang:** A adição de `contract_id` em `project` pode ser gradual (nullable + backfill) ou imediata. Estratégia recomendada: gradual.

8. **Estoque por contrato:** Estoque atual é global do tenant. Se um contrato tiver estoque próprio, seria uma separação adicional complexa. Decisão de negócio: estoque é compartilhado entre contratos?
