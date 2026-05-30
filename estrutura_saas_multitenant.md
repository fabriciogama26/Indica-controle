# Estrutura base de um SaaS multi-tenant

## Objetivo

Este documento define uma estrutura padrão para um SaaS multi-tenant, com separação clara entre frontend, backend, domínio, infraestrutura, autenticação, autorização, tenant isolation, observabilidade e testes.

A ideia é evitar bagunça, acoplamento alto e crescimento desorganizado do projeto.

---

## Princípios da arquitetura

### 1. Separação por responsabilidade
Cada pasta deve existir por um motivo claro:
- **ui**: renderização
- **hooks**: lógica reutilizável no frontend
- **context**: estado global/controlado
- **services**: integrações e chamadas externas
- **repositories**: acesso a dados
- **domain**: regras de negócio
- **middleware**: regras transversais
- **types/schemas**: contratos e validações

### 2. Multi-tenant de verdade
Todo fluxo precisa respeitar isolamento por tenant:
- autenticação identifica o usuário
- usuário pertence a um tenant
- toda consulta, escrita, cache e permissão precisa respeitar esse tenant
- nunca confiar só no frontend para filtrar tenant

### 3. Escalabilidade por módulo
Cada domínio do sistema deve poder crescer sem virar um caos. Exemplo:
- estoque
- usuários
- permissões
- acidentes
- financeiro
- relatórios

### 4. Padrão antes de velocidade
Se cada módulo for feito de um jeito, o sistema quebra com o tempo.

---

## Estrutura recomendada

```txt
saas-app/
├─ apps/
│  ├─ web/
│  ├─ api/
│  └─ worker/
├─ packages/
│  ├─ ui/
│  ├─ types/
│  ├─ utils/
│  ├─ config/
│  ├─ auth/
│  ├─ database/
│  └─ observability/
├─ docs/
├─ scripts/
├─ infra/
├─ tests/
├─ .env.example
├─ package.json
├─ turbo.json / pnpm-workspace.yaml
└─ README.md
```

---

## Visão por camada

# 1. `apps/`
Aqui ficam as aplicações principais.

## `apps/web/`
Frontend do sistema.

### Estrutura sugerida
```txt
apps/web/
├─ public/
├─ src/
│  ├─ app/
│  ├─ pages/                 # se usar pages router
│  ├─ components/
│  │  ├─ ui/
│  │  ├─ layout/
│  │  ├─ forms/
│  │  └─ shared/
│  ├─ modules/
│  │  ├─ auth/
│  │  ├─ dashboard/
│  │  ├─ inventory/
│  │  ├─ accidents/
│  │  ├─ users/
│  │  └─ settings/
│  ├─ hooks/
│  ├─ context/
│  ├─ services/
│  ├─ lib/
│  ├─ utils/
│  ├─ constants/
│  ├─ types/
│  ├─ schemas/
│  ├─ providers/
│  ├─ styles/
│  └─ middleware/
├─ tests/
└─ package.json
```

### O que vai em cada pasta

#### `components/`
Componentes visuais reutilizáveis.

- **ui/**: botão, modal, card, input, select
- **layout/**: sidebar, header, shell, menu
- **forms/**: componentes de formulário
- **shared/**: blocos comuns entre módulos

**Não colocar regra de negócio pesada aqui.**

#### `modules/`
Cada módulo do sistema organizado por domínio.

Exemplo:
```txt
modules/inventory/
├─ components/
├─ hooks/
├─ services/
├─ context/
├─ schemas/
├─ types/
├─ utils/
└─ pages/
```

Isso evita jogar tudo em pasta global.

#### `hooks/`
Hooks reutilizáveis.

Exemplos:
- `useAuth()`
- `useTenant()`
- `useDebounce()`
- `usePermissions()`
- `usePagination()`
- `useSyncQueue()`

**Hook serve para lógica de interface e composição de estado.**
Não deve virar depósito de regra de negócio crítica do sistema.

#### `context/`
Estado global ou escopo compartilhado.

Exemplos:
- `AuthContext`
- `TenantContext`
- `ThemeContext`
- `PermissionContext`

Use context para estado global controlado. Não usar para tudo.

#### `services/`
Camada de comunicação com API/backend.

Exemplos:
- `auth.service.ts`
- `inventory.service.ts`
- `report.service.ts`

Responsabilidade:
- montar request
- tratar response
- encapsular chamadas HTTP
- nunca colocar renderização aqui

#### `lib/`
Clientes e integrações base.

Exemplos:
- `apiClient.ts`
- `supabaseClient.ts`
- `queryClient.ts`
- `logger.ts`

#### `utils/`
Funções utilitárias puras.

Exemplos:
- formatadores
- parsers
- helpers de data
- normalizadores

#### `types/`
Tipos TypeScript do frontend.

Exemplos:
- DTOs de tela
- tipos de resposta
- tipos auxiliares

#### `schemas/`
Validação com Zod/Yup/Valibot.

Exemplos:
- login
- cadastro
- filtros
- payload de criação/edição

#### `providers/`
Registro de providers de alto nível.

Exemplo:
- Query provider
- Theme provider
- Auth provider

#### `middleware/`
Só se o framework suportar middleware no frontend/edge.

Exemplo:
- proteção de rota
- resolução inicial de tenant por domínio/subdomínio

---

## `apps/api/`
Backend principal.

### Estrutura sugerida
```txt
apps/api/
├─ src/
│  ├─ routes/
│  ├─ controllers/
│  ├─ use-cases/
│  ├─ domain/
│  ├─ repositories/
│  ├─ services/
│  ├─ middleware/
│  ├─ policies/
│  ├─ validators/
│  ├─ schemas/
│  ├─ types/
│  ├─ lib/
│  ├─ config/
│  ├─ jobs/
│  ├─ events/
│  ├─ queues/
│  ├─ cache/
│  ├─ audit/
│  └─ index.ts
├─ tests/
└─ package.json
```

### O que vai em cada pasta

#### `routes/`
Define endpoints e liga rota ao controller.

Exemplo:
```txt
routes/
├─ auth.routes.ts
├─ inventory.routes.ts
├─ users.routes.ts
└─ reports.routes.ts
```

**Rota não deve conter regra de negócio.**

#### `controllers/`
Recebe request, chama caso de uso e devolve response.

Responsabilidade:
- ler params/body/query
- chamar validação
- acionar use-case
- mapear erro/resposta

**Controller não deve acessar banco direto.**

#### `use-cases/`
Casos de uso do sistema.

Exemplos:
- `createInventoryMovement`
- `approveRequest`
- `getDashboardSummary`
- `inviteUserToTenant`

Essa é a camada mais importante da aplicação.

#### `domain/`
Regras de negócio puras.

Exemplos:
- entidades
- value objects
- regras de cálculo
- políticas de estoque
- regras de saldo
- regras de fechamento

Aqui fica a engenharia de negócio.

#### `repositories/`
Acesso ao banco.

Exemplos:
- `inventory.repository.ts`
- `user.repository.ts`
- `tenant.repository.ts`

Responsabilidade:
- query SQL/ORM
- leitura e escrita
- nada de regra de negócio complexa

#### `services/`
Integrações externas ou serviços internos auxiliares.

Exemplos:
- e-mail
- storage
- geração de PDF
- gateway de pagamento
- provedor de autenticação

#### `middleware/`
Regras transversais do backend.

Exemplos:
- auth
- tenant resolver
- permission check
- request id
- rate limit
- idempotência
- auditoria
- tratamento de erro

#### `policies/`
Autorização.

Exemplos:
- quem pode ver
- quem pode editar
- quem pode aprovar
- quem pode exportar

Muito útil para RBAC/ABAC.

#### `validators/` e `schemas/`
Validação dos dados de entrada.

- `schemas/`: contrato formal
- `validators/`: execução da validação por endpoint

#### `jobs/`
Processos assíncronos.

Exemplos:
- recalcular indicadores
- sincronizar filas offline
- envio de e-mail
- geração de relatórios

#### `events/`
Eventos do sistema.

Exemplos:
- `inventory.movement.created`
- `user.invited`
- `tenant.created`

#### `queues/`
Filas e consumidores.

Exemplos:
- fila de e-mail
- fila de importação
- fila de sincronismo offline

#### `cache/`
Estratégias de cache.

Exemplos:
- cache por tenant
- cache de dashboard
- invalidação por módulo

#### `audit/`
Logs de auditoria.

Exemplos:
- quem alterou saldo
- quem aprovou movimentação
- quem exportou relatório

---

## `apps/worker/`
Serviço separado para tarefas pesadas ou assíncronas.

Exemplos:
- processar fila
- importação em lote
- gerar PDF
- processar imagem
- sincronização
- notificação

Separar worker do backend principal evita travar API.

---

# 2. `packages/`
Pacotes compartilhados entre apps.

## `packages/ui/`
Biblioteca de componentes compartilhados.

Use quando o mesmo componente serve para mais de um app.

Exemplos:
- botão
- tabela
- modal
- card de métrica

## `packages/types/`
Tipos compartilhados.

Exemplos:
- `User`
- `Tenant`
- `InventoryMovement`
- `ApiResponse`

## `packages/utils/`
Funções puras compartilhadas.

Exemplos:
- formatar moeda
- formatar data
- parser de filtros
- helpers matemáticos

## `packages/config/`
Configuração central.

Exemplos:
- env parser
- constantes globais
- feature flags
- nomes de eventos

## `packages/auth/`
Lógica compartilhada de autenticação/autorização.

Exemplos:
- decoder de token
- helpers de sessão
- papéis e permissões

## `packages/database/`
Conexão, migrations, seeds, helpers SQL.

Exemplo:
```txt
packages/database/
├─ migrations/
├─ seeds/
├─ policies/
├─ functions/
├─ views/
└─ client/
```

## `packages/observability/`
Tudo que é logging, métricas e tracing.

Exemplos:
- logger
- integração Sentry
- OpenTelemetry
- métricas por tenant

---

# 3. `infra/`
Infraestrutura do projeto.

Exemplos:
```txt
infra/
├─ docker/
├─ nginx/
├─ terraform/
├─ vercel/
├─ supabase/
├─ ci-cd/
└─ monitoring/
```

### O que deve ter
- arquivos de deploy
- configuração de ambiente
- provisionamento
- observabilidade
- banco e políticas

---

# 4. `docs/`
Documentação interna.

Exemplos:
```txt
docs/
├─ architecture/
├─ database/
├─ api/
├─ tenancy/
├─ security/
├─ flows/
└─ decisions/
```

### Tipos de documentação
- arquitetura geral
- padrão de pastas
- fluxo de autenticação
- engenharia multi-tenant
- convenções de código
- ADRs (Architecture Decision Records)

---

# 5. `scripts/`
Scripts utilitários.

Exemplos:
- seed de permissões
- criação de tenant
- importação de dados
- limpeza de cache
- migração de arquivos

---

# 6. `tests/`
Testes globais e integrados.

Exemplo:
```txt
tests/
├─ integration/
├─ e2e/
├─ performance/
└─ security/
```

---

## Estrutura interna por módulo

O melhor padrão para crescer é repetir o mesmo desenho em cada módulo.

Exemplo: `inventory`

```txt
inventory/
├─ components/
├─ hooks/
├─ context/
├─ services/
├─ schemas/
├─ types/
├─ utils/
├─ controllers/
├─ use-cases/
├─ repositories/
├─ policies/
└─ tests/
```

### Regra prática
- frontend usa `components`, `hooks`, `context`
- backend usa `controllers`, `use-cases`, `repositories`, `policies`
- ambos podem compartilhar `types`, `schemas`, `utils`

---

## Arquivos importantes e finalidade

### Hooks
Arquivos com prefixo `use`.

Exemplos:
- `useAuth.ts`
- `useTenant.ts`
- `useInventoryFilters.ts`

Servem para encapsular:
- estado
- efeito colateral
- comunicação com serviços
- composição de comportamento de UI

### Context
Arquivos de contexto global.

Exemplos:
- `AuthContext.tsx`
- `TenantContext.tsx`

Servem para:
- sessão atual
- tenant atual
- permissões carregadas
- tema

### Services
Arquivos que conversam com API/externos.

Exemplos:
- `inventory.service.ts`
- `payment.service.ts`
- `email.service.ts`

### Repositories
Arquivos de acesso ao banco.

Exemplos:
- `tenant.repository.ts`
- `movement.repository.ts`

### Use-cases
Arquivos de regra aplicada.

Exemplos:
- `createMovement.use-case.ts`
- `syncOfflineQueue.use-case.ts`

### Schemas
Validação de payload.

Exemplos:
- `createTenant.schema.ts`
- `login.schema.ts`
- `inventoryFilter.schema.ts`

### Policies
Arquivos de autorização.

Exemplos:
- `inventory.policy.ts`
- `billing.policy.ts`

### Lib
Infra técnica compartilhada.

Exemplos:
- http client
- db client
- logger
- cache client

---

## Engenharia multi-tenant

Aqui está o ponto crítico.

## Formas comuns de multi-tenant

### 1. Banco por tenant
Maior isolamento, maior custo operacional.

### 2. Schema por tenant
Bom isolamento, operação moderada.

### 3. Tabela compartilhada com `tenant_id`
Mais simples de operar e escalar no início.

Na maioria dos SaaS B2B, começa-se com:
- **banco compartilhado**
- **tabelas compartilhadas**
- **coluna `tenant_id` ou `account_owner_id`**
- **RLS/policies no banco**

---

## Regras obrigatórias de multi-tenant

### 1. Toda entidade de negócio precisa carregar tenant
Exemplos:
- usuários vinculados ao tenant
- estoque vinculado ao tenant
- movimentações vinculadas ao tenant
- permissões vinculadas ao tenant ou papel global

### 2. Toda query precisa filtrar tenant
Nunca depender só da interface.

### 3. Permissão vem depois de autenticação e junto do tenant
Fluxo ideal:
1. autenticar usuário
2. resolver tenant
3. carregar papel/permissão
4. executar ação

### 4. Cache precisa ser segmentado por tenant
Nunca usar cache global para dado tenant-specific.

### 5. Logs e auditoria precisam registrar tenant
Senão depois ninguém sabe quem fez o quê.

### 6. Filas e jobs também precisam carregar tenant
Processo assíncrono sem tenant é risco de vazamento de dado.

---

## Estrutura mínima para tenancy

```txt
src/
├─ tenancy/
│  ├─ tenant-resolver.ts
│  ├─ tenant-context.ts
│  ├─ tenant-guard.ts
│  ├─ tenant-types.ts
│  └─ tenant-policy.ts
```

### Papéis desses arquivos
- **tenant-resolver**: descobre tenant pelo usuário, subdomínio, header ou sessão
- **tenant-context**: injeta tenant no fluxo atual
- **tenant-guard**: bloqueia acesso cruzado
- **tenant-types**: contratos do tenant
- **tenant-policy**: regras específicas de isolamento

---

## Estrutura de autenticação e autorização

```txt
auth/
├─ auth.controller.ts
├─ auth.service.ts
├─ auth.repository.ts
├─ auth.middleware.ts
├─ session.service.ts
├─ permission.service.ts
├─ role.repository.ts
└─ policies/
```

### O que deve existir
- login
- sessão
- refresh/reauth
- papéis
- permissões
- associação usuário-tenant
- trilha de auditoria

---

## Convenções de nomes

### Pastas
- minúsculas
- sem espaço
- nome claro

Exemplos:
- `inventory`
- `tenant`
- `permissions`
- `audit`

### Arquivos
Usar padrão previsível:
- `nome.tipo.ts`

Exemplos:
- `inventory.service.ts`
- `tenant.repository.ts`
- `create-tenant.use-case.ts`
- `auth.middleware.ts`
- `user.schema.ts`

---

## O que não fazer

### 1. Não misturar regra de negócio dentro de componente
Componente não é lugar para cálculo crítico.

### 2. Não acessar banco direto no controller
Isso destrói organização.

### 3. Não deixar `utils` virar lixo geral
Se a função tem contexto de domínio, ela vai para o módulo.

### 4. Não deixar multi-tenant só na UI
Isolamento tem que estar no backend e no banco.

### 5. Não usar context para tudo
Context mal usado vira gargalo de render e bagunça de estado.

### 6. Não criar pasta genérica `helpers` para tudo
Prefira nome por função real.

---

## Exemplo de fluxo de requisição bem estruturado

### Criar movimentação de estoque
1. rota recebe request
2. controller lê payload
3. schema valida
4. middleware autentica usuário
5. tenant resolver identifica tenant
6. policy verifica permissão
7. use-case aplica regra de negócio
8. repository grava no banco com tenant
9. audit registra evento
10. response devolve resultado

---

## Estrutura mínima viável para começar certo

Se quiser começar mais enxuto, dá para usar isso:

```txt
src/
├─ modules/
│  ├─ auth/
│  ├─ tenant/
│  ├─ users/
│  ├─ inventory/
│  └─ reports/
├─ shared/
│  ├─ components/
│  ├─ hooks/
│  ├─ context/
│  ├─ lib/
│  ├─ utils/
│  ├─ types/
│  └─ schemas/
├─ middleware/
├─ config/
└─ tests/
```

Esse modelo já funciona bem e é mais simples que um monorepo completo.

---

## Recomendação final

Para um SaaS multi-tenant, a estrutura ideal precisa garantir 4 coisas:

1. **isolamento por tenant**
2. **padronização por módulo**
3. **separação clara entre UI, regra e dados**
4. **facilidade de escalar sem refatoração traumática**

Se a base já nascer organizada, fica muito mais fácil colocar:
- novos módulos
- permissões complexas
- app mobile
- sincronismo offline
- billing
- auditoria
- integrações externas

---

## Estrutura final resumida

```txt
saas-app/
├─ apps/
│  ├─ web/
│  ├─ api/
│  └─ worker/
├─ packages/
│  ├─ ui/
│  ├─ types/
│  ├─ utils/
│  ├─ config/
│  ├─ auth/
│  ├─ database/
│  └─ observability/
├─ infra/
├─ docs/
├─ scripts/
├─ tests/
└─ README.md
```

---

## Checklist de validação da estrutura

- Existe separação entre frontend, backend e jobs?
- Existe pasta específica para domínio e casos de uso?
- Existe camada clara de acesso a dados?
- Existe pasta para autenticação, tenant e permissão?
- Toda query está preparada para tenant?
- Logs, cache e filas carregam tenant?
- Os módulos seguem um padrão repetível?
- Os nomes dos arquivos estão previsíveis?
- Existe documentação interna da arquitetura?

---

## Fechamento

Essa estrutura não é a única possível, mas é uma base forte para um SaaS multi-tenant profissional.

Ela te dá organização, previsibilidade, segurança e espaço para crescer sem desmontar o projeto depois.

