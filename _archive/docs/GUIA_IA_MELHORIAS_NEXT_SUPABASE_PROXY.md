# Guia para IA — Melhorias em SaaS Next.js + TypeScript + Supabase + Vercel

> **Finalidade:** orientar uma IA a pesquisar, priorizar e propor melhorias reais para um SaaS, sem transformar o projeto em uma arquitetura excessivamente complexa.
>
> **Inclui:** Next.js, TypeScript, Supabase, RLS, multi-tenant, Vercel, Server Components, Server Actions, Route Handlers, Data Access Layer, Proxy — antigo Middleware — segurança, desempenho, observabilidade e qualidade.
>
> **Atualização de referência:** 11/07/2026. A IA deve confirmar as versões do projeto e consultar documentação oficial atual antes de recomendar sintaxe, migração ou recurso dependente de versão.

---

## 1. Papel da IA

Você é uma IA atuando como arquiteta e revisora técnica.

Seu objetivo não é adicionar tecnologia por adicionar.

Você deve propor melhorias que:

- resolvam problema comprovado;
- reduzam risco;
- reduzam duplicação;
- melhorem segurança;
- melhorem desempenho;
- facilitem manutenção;
- mantenham isolamento multi-tenant;
- tenham validação objetiva;
- tenham custo proporcional ao benefício.

Não propor “boas práticas” genéricas sem ligar a recomendação a uma evidência do repositório.

---

## 2. Contexto inicial

Considere este cenário, mas confirme no código:

- Next.js 16.1.6 ou versão próxima;
- App Router;
- TypeScript;
- Supabase/Postgres;
- Vercel;
- SaaS multi-tenant;
- `tenant_id`;
- RLS;
- `app_user_tenants`;
- função semelhante a `resolveAuthenticatedAppUser()`;
- header `x-tenant-id`;
- possibilidade futura de `x-contract-id`;
- `service_role` apenas no backend;
- regras configuráveis por tenant;
- migrations versionadas;
- módulos com regras de operação, medição, faturamento e almoxarifado.

---

## 3. Regra de priorização

Para cada melhoria, calcule qualitativamente:

```text
Benefício:
- segurança;
- confiabilidade;
- desempenho;
- custo;
- manutenção;
- experiência do usuário.

Custo:
- horas de implementação;
- risco de regressão;
- necessidade de migration;
- necessidade de testes;
- impacto operacional;
- complexidade permanente.
```

Classifique:

### FAZER AGORA

- vulnerabilidade;
- vazamento multi-tenant;
- segredo exposto;
- ausência de RLS;
- autenticação incorreta;
- corrupção ou inconsistência de dados;
- build quebrado;
- erro recorrente de produção.

### PRÓXIMO CICLO

- duplicação importante;
- consulta cara;
- arquitetura difícil de manter;
- falta de testes em regra crítica;
- observabilidade insuficiente;
- autorização espalhada.

### QUANDO HOUVER EVIDÊNCIA

- cache;
- filas;
- event bus;
- microserviços;
- busca externa;
- abstrações genéricas;
- troca de biblioteca;
- grande migração arquitetural.

### NÃO COMPENSA AGORA

- complexidade sem problema real;
- reescrita total;
- microserviços para baixa escala;
- Redis sem necessidade demonstrada;
- abstração para uma única implementação;
- otimização sem medição;
- mover toda lógica para RPC;
- mover toda lógica para Server Actions;
- colocar banco no Proxy;
- adicionar camada duplicada de autorização sem clareza.

---

# PARTE A — PESQUISA OBRIGATÓRIA

## 4. Fontes oficiais

Antes de recomendar algo dependente de versão, pesquise nas fontes oficiais:

- Next.js: documentação de App Router, Proxy, autenticação, Server/Client Components, Route Handlers, Server Actions, caching e upgrade;
- Supabase: SSR, Auth, `@supabase/ssr`, `getClaims`, RLS, policies, service role, migrations, database functions e performance;
- Vercel: runtime, functions, logs, routing, regiões, limites e variáveis de ambiente;
- TypeScript: configuração e recursos usados na versão instalada;
- Postgres: índices, constraints, RLS, planos de execução e transações.

Referências iniciais:

- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://nextjs.org/docs/app/guides/authentication
- https://nextjs.org/docs/app/guides/upgrading/version-16
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://vercel.com/docs/routing-middleware
- https://vercel.com/docs/functions
- https://vercel.com/docs/logs/runtime

A IA deve preferir documentação oficial a blog, vídeo ou resposta antiga.

---

## 5. Confirmar versões antes de agir

Registrar:

```text
Node:
Next.js:
React:
TypeScript:
@supabase/supabase-js:
@supabase/ssr:
Supabase CLI:
Postgres:
Gerenciador de pacotes:
```

Verificar:

```bash
node --version
npm --version
npm ls next react typescript @supabase/supabase-js @supabase/ssr
```

Não recomendar `middleware.ts` como padrão para Next.js 16 sem justificar compatibilidade específica.

---

# PARTE B — PROXY, ANTIGO MIDDLEWARE

## 6. Nome correto

No Next.js 16:

- a convenção `middleware.ts` foi renomeada para `proxy.ts`;
- a função `middleware` foi renomeada para `proxy`;
- `middleware` está depreciado para o fluxo padrão;
- Proxy roda antes da renderização da rota;
- o runtime do Proxy do Next.js 16 é Node.js;
- o arquivo deve ficar na raiz do projeto ou dentro de `src`, no mesmo nível de `app` ou `pages`.

Exemplo:

```text
src/
  app/
  proxy.ts
```

Não criar um `proxy.ts` dentro de cada módulo. O Next.js usa uma entrada principal.

É possível delegar para funções menores importadas.

---

## 7. Para que o Proxy compensa

Proxy compensa quando a lógica precisa ocorrer antes da rota e é leve.

### Casos adequados

- renovação de sessão Supabase SSR;
- leitura e atualização de cookies;
- redirect de usuário sem sessão;
- redirect de usuário autenticado para fora do login;
- redirect de rotas antigas;
- rewrite;
- headers de resposta;
- request ID;
- manutenção simples;
- seleção de idioma;
- subdomínio;
- verificação otimista;
- bloqueio inicial de rota;
- normalização leve de URL.

### No Supabase SSR

Server Components não escrevem cookies diretamente. O Proxy pode:

1. validar/renovar o token;
2. atualizar cookies da requisição;
3. atualizar cookies da resposta;
4. permitir que Server Components recebam a sessão renovada.

A documentação atual do Supabase recomenda usar `getClaims()` para proteger páginas e dados. Não confiar em `getSession()` no servidor como prova definitiva de identidade.

---

## 8. Para que o Proxy não compensa

Não colocar no Proxy:

- consulta pesada ao banco;
- carregamento de perfil completo;
- busca de todas as permissões;
- resolução complexa de tenant;
- resolução complexa de contrato;
- cálculo de produção;
- geração de relatório;
- leitura de Excel;
- upload;
- operações com `service_role`;
- criação ou alteração de dados;
- regra de negócio;
- agregações;
- múltiplas chamadas de rede;
- logs volumosos;
- autorização definitiva;
- processamento que pode ficar em Server Action, Route Handler ou serviço.

Motivos:

- Proxy executa antes das rotas;
- pode executar em muitas requisições;
- pode ser acionado em prefetch;
- qualquer chamada lenta aumenta a latência;
- banco no Proxy multiplica custo;
- falha no Proxy pode bloquear toda a aplicação.

---

## 9. Segurança: Proxy não é a defesa final

Use esta separação:

```text
Proxy:
- sessão;
- cookie;
- redirect;
- verificação otimista.

Data Access Layer / resolver autenticado:
- identidade válida;
- usuário da aplicação;
- tenant;
- contrato;
- papel;
- permissão.

Service / Server Action / Route Handler:
- regra de negócio;
- validação de entrada;
- autorização da operação;
- transação.

Supabase RLS:
- isolamento final dos dados.
```

Nunca considerar o redirect do Proxy como autorização suficiente.

Um usuário pode chamar uma URL, Server Action ou endpoint diretamente.

---

## 10. Arquitetura recomendada para Proxy

```text
src/
  proxy.ts

  lib/
    supabase/
      client.ts
      server.ts
      proxy.ts

    auth/
      resolve-authenticated-app-user.ts
      permissions.ts
      tenant-context.ts
```

`src/proxy.ts` deve ser pequeno:

```ts
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Esse é um esqueleto. A IA deve conferir a versão instalada de `@supabase/ssr` e copiar/adaptar a implementação oficial atual de `updateSession`.

---

## 11. Matcher

Sem matcher adequado, Proxy pode atingir:

- arquivos estáticos;
- imagens;
- favicon;
- assets públicos;
- endpoints que não precisam dele.

Analise quais rotas realmente precisam de sessão Supabase.

Exemplo amplo para autenticação:

```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Exemplo restrito:

```ts
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/programacao/:path*',
    '/medicao/:path*',
    '/faturamento/:path*',
  ],
}
```

A escolha depende do fluxo de renovação de sessão e das rotas públicas.

O matcher deve ser constante para análise estática.

---

## 12. Migração de Middleware para Proxy

Checklist:

1. confirmar Next.js 16;
2. localizar `middleware.ts`;
3. verificar runtime usado;
4. verificar dependências compatíveis com Node.js;
5. renomear arquivo;
6. renomear função;
7. atualizar testes;
8. atualizar documentação;
9. atualizar flags com nome `middleware`;
10. validar matcher;
11. validar login/logout;
12. validar refresh de sessão;
13. validar assets;
14. validar deploy Vercel.

Exemplo:

```bash
mv src/middleware.ts src/proxy.ts
```

Antes:

```ts
export function middleware(request: NextRequest) {}
```

Depois:

```ts
export function proxy(request: NextRequest) {}
```

Também existe codemod oficial, mas não executar automaticamente sem revisar o diff:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

---

## 13. Quando manter Middleware temporariamente

Somente após confirmar necessidade real, por exemplo:

- integração que só suporta Edge Runtime;
- limitação específica da biblioteca;
- migração gradual;
- incompatibilidade documentada.

Registrar claramente:

- motivo;
- versão;
- risco;
- plano de saída;
- teste.

Não manter apenas por costume.

---

# PARTE C — AUTENTICAÇÃO, AUTORIZAÇÃO E MULTI-TENANT

## 14. Resolver autenticado

A aplicação deve ter uma função central, semelhante a:

```ts
resolveAuthenticatedAppUser()
```

Responsabilidades possíveis:

1. criar cliente Supabase de servidor;
2. validar identidade;
3. obter usuário da aplicação;
4. ler tenant solicitado;
5. confirmar vínculo em `app_user_tenants`;
6. resolver tenant ativo;
7. resolver contrato ativo quando aplicável;
8. carregar permissões mínimas;
9. retornar contexto autenticado;
10. falhar de forma explícita.

Exemplo conceitual:

```ts
type AuthenticatedContext = {
  authUserId: string
  appUserId: string
  tenantId: string
  contractId?: string
  roles: string[]
  permissions: string[]
}
```

Não retornar dados desnecessários.

---

## 15. `x-tenant-id`

O header pode ser usado como contexto solicitado, não como prova.

Fluxo correto:

```text
x-tenant-id recebido
  -> usuário autenticado
  -> vínculo usuário/tenant consultado
  -> tenant autorizado
  -> operação executada
  -> RLS valida novamente
```

Fluxo incorreto:

```text
x-tenant-id recebido
  -> query direta com esse valor
```

A IA deve procurar todos os pontos que leem esse header.

---

## 16. Futuro `x-contract-id`

Aplicar a mesma regra:

- contrato solicitado;
- tenant do contrato;
- vínculo do usuário;
- contrato ativo;
- permissão;
- escopo da operação;
- RLS ou função segura;
- sem fallback inseguro.

Evitar espalhar a regra de contrato em páginas.

Criar resolução central e testes dos cenários de contrato ativo.

---

## 17. RLS

RLS é a última barreira.

Verificar:

- RLS habilitada;
- policies por operação;
- `USING`;
- `WITH CHECK`;
- tenant correto;
- usuário correto;
- inserts;
- updates;
- deletes;
- RPCs;
- funções `security definer`;
- storage;
- tabelas auxiliares;
- joins;
- tabelas novas;
- service role.

Exemplo conceitual:

```sql
using (
  tenant_id = current_tenant_id()
  and user_can_access_tenant(tenant_id)
)
```

A implementação real deve ser revisada quanto a segurança, volatilidade, search path e custo.

---

## 18. Service role

Regras:

- nunca no navegador;
- nunca com prefixo `NEXT_PUBLIC_`;
- nunca em componente client;
- nunca em resposta;
- nunca em log;
- não usar para operação comum;
- usar apenas em backend controlado;
- aplicar escopo e validação antes;
- preferir cliente do usuário com RLS quando possível.

A IA deve procurar:

```bash
rg -n "SERVICE_ROLE|service_role"
rg -n "NEXT_PUBLIC_.*SERVICE"
```

---

# PARTE D — CAMADAS E ORGANIZAÇÃO

## 19. Separação recomendada

Uma estrutura possível:

```text
src/
  app/
    (dashboard)/
    api/

  components/
    ui/

  modules/
    medicao/
      application/
      domain/
      infrastructure/
      ui/

  lib/
    auth/
    supabase/
    validation/
    errors/
    logging/

  types/
```

Não criar todas as pastas se o projeto não precisa.

A regra é separar responsabilidades, não copiar arquitetura de livro.

---

## 20. Data Access Layer

Uma DAL compensa quando:

- autorização está espalhada;
- várias telas repetem consultas;
- há risco multi-tenant;
- existem DTOs;
- há múltiplos consumidores;
- regras de acesso são complexas.

Responsabilidades:

- validar sessão;
- validar contexto;
- buscar dados;
- retornar apenas campos necessários;
- centralizar acesso;
- evitar duplicação.

Não transformar DAL em um arquivo gigante.

Exemplo:

```ts
import 'server-only'

export async function getOrderById(
  context: AuthenticatedContext,
  orderId: string,
) {
  // query escopada e retorno mínimo
}
```

---

## 21. Services

Service compensa para:

- regra de negócio;
- transação;
- múltiplas tabelas;
- validação de estado;
- cálculo;
- auditoria;
- integração;
- reaproveitamento entre Server Action e Route Handler.

Exemplo:

```ts
export async function cancelOrder(
  context: AuthenticatedContext,
  input: CancelOrderInput,
) {
  // autorização
  // regra de status
  // persistência
  // auditoria
}
```

---

## 22. Server Actions

Compensam para:

- mutation acionada pela interface;
- formulário;
- operação interna do App Router;
- integração próxima da página;
- revalidação.

Não usar como única barreira de segurança.

Sempre:

- validar input;
- autenticar;
- autorizar;
- aplicar tenant;
- tratar erro;
- evitar retorno excessivo.

---

## 23. Route Handlers

Compensam para:

- webhook;
- integração externa;
- API pública ou privada;
- download;
- upload;
- endpoint consumido por cliente externo;
- respostas HTTP específicas.

Não criar Route Handler para Server Component chamar via HTTP quando uma função de servidor direta resolve.

---

## 24. Server Components e Client Components

### Server Component por padrão

Usar para:

- leitura;
- composição;
- autenticação;
- carregamento inicial;
- acesso seguro ao banco;
- redução de JavaScript no client.

### Client Component apenas onde necessário

Usar para:

- estado interativo;
- eventos;
- APIs do navegador;
- drag-and-drop;
- formulários interativos;
- realtime;
- widgets client-only.

Evitar `'use client'` no topo de uma página grande quando apenas um botão precisa de interatividade.

---

# PARTE E — DADOS E DESEMPENHO

## 25. Consultas

Melhorias que geralmente compensam:

- selecionar colunas necessárias;
- paginar;
- filtrar no banco;
- ordenar no banco;
- agrupar no banco quando adequado;
- evitar N+1;
- executar consultas independentes em paralelo;
- adicionar índices baseados em workload;
- usar constraints;
- reduzir payload;
- evitar round-trips.

Não otimizar sem medir.

---

## 26. Índices

Criar índice compensa quando:

- query frequente;
- filtro seletivo;
- join frequente;
- foreign key precisa de suporte;
- ordenação frequente;
- plano mostra ganho.

Não compensa:

- indexar toda coluna;
- duplicar prefixos;
- criar índice por intuição;
- remover por advisor sem workload;
- ignorar custo de escrita.

Registrar:

- query;
- plano antes;
- plano depois;
- tamanho;
- impacto em insert/update;
- rollback.

---

## 27. Cache

Cache compensa quando:

- dados mudam pouco;
- leitura é repetida;
- custo de consulta é alto;
- isolamento está claro;
- invalidar é possível.

Não compensa quando:

- dado é altamente dinâmico;
- risco de misturar tenants;
- invalidação é incerta;
- resposta possui cookie/sessão;
- consulta já é barata;
- consistência precisa ser imediata.

Toda chave deve incluir o escopo necessário:

```text
tenantId
contractId
userId, quando aplicável
filtros
versão da regra
```

---

## 28. Realtime

Compensa quando:

- mudança precisa aparecer imediatamente;
- múltiplos usuários colaboram;
- polling causa custo;
- há necessidade operacional.

Não compensa:

- dado raramente muda;
- refresh manual basta;
- subscription fica aberta em muitas telas;
- não há cleanup;
- eventos não são filtrados por tenant;
- payload é excessivo.

---

# PARTE F — TYPESCRIPT E VALIDAÇÃO

## 29. Melhorias prioritárias

- `strict`;
- schemas de entrada;
- tipos gerados do Supabase;
- DTOs;
- unions para status;
- erros tipados;
- remoção gradual de `any`;
- validação de ambiente;
- funções puras para regra;
- discriminated unions;
- evitar casts forçados.

Exemplo:

```ts
const WorkStatusSchema = z.enum([
  'PENDENTE',
  'EM_ATENDIMENTO',
  'CONCLUIDO',
  'CANCELADO',
])

type WorkStatus = z.infer<typeof WorkStatusSchema>
```

Caso exista status legado `COMPLETO`, definir estratégia explícita de compatibilidade.

---

## 30. Variáveis de ambiente

Criar validação na inicialização:

```ts
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})
```

Separar esquema server/client.

Nunca importar variável secreta em módulo client.

---

# PARTE G — ERROS, LOGS E OBSERVABILIDADE

## 31. Erros

Definir categorias:

- validação;
- não autenticado;
- não autorizado;
- não encontrado;
- conflito;
- regra de negócio;
- banco;
- integração;
- inesperado.

Não retornar detalhes internos ao usuário.

---

## 32. Logs

Campos úteis:

```text
requestId
tenantId
contractId
appUserId
operation
entity
entityId
duration
result
errorCode
```

Não logar:

- JWT;
- senha;
- refresh token;
- service role;
- dados sensíveis sem necessidade;
- corpo completo de documentos.

---

## 33. Vercel

Pesquisar e avaliar:

- runtime logs;
- build logs;
- duração de funções;
- região;
- falhas;
- timeouts;
- cold starts;
- consumo;
- rotas lentas;
- erro de variável;
- tamanho de bundle;
- tráfego;
- deploy preview.

Não alterar região sem considerar proximidade do Supabase.

---

# PARTE H — TESTES

## 34. O que testar primeiro

Prioridade:

1. isolamento multi-tenant;
2. RLS;
3. autenticação;
4. autorização;
5. troca de tenant;
6. contrato ativo;
7. regras financeiras;
8. status;
9. concorrência;
10. migrations;
11. importação;
12. exportação.

Cenários mínimos multi-tenant:

```text
- usuário A acessa tenant A;
- usuário A tenta tenant B;
- usuário sem vínculo;
- usuário com dois tenants;
- tenant inexistente;
- header alterado manualmente;
- Server Action chamada diretamente;
- Route Handler chamado diretamente;
- RLS impede leitura cruzada;
- RLS impede escrita cruzada.
```

---

# PARTE I — O QUE COMPENSA E O QUE NÃO COMPENSA

## 35. Matriz prática

| Melhoria | Normalmente compensa? | Condição |
|---|---:|---|
| Proxy para refresh de sessão Supabase | Sim | SSR com cookies |
| Redirect leve no Proxy | Sim | Rotas bem definidas |
| Consulta ao banco no Proxy | Não | Evitar; somente exceção comprovada |
| RLS em todas as tabelas de tenant | Sim | Obrigatório |
| Resolver usuário/tenant central | Sim | SaaS multi-tenant |
| DAL | Sim | Acesso e autorização repetidos |
| DTO | Sim | Evitar exposição e payload excessivo |
| Microserviços | Geralmente não | Só com necessidade operacional |
| Redis | Depende | Só com carga e caso de cache/lock |
| Reescrita total | Não | Alto risco e baixo retorno |
| `use client` em tudo | Não | Aumenta bundle |
| Server Components por padrão | Sim | App Router |
| RPC para toda regra | Não | Use quando transação/dados justificarem |
| Server Action para tudo | Não | Webhook/API exigem Route Handler |
| Índice em toda coluna | Não | Basear em query e plano |
| Remover índice “unused” automaticamente | Não | Exigir workload |
| Atualizar todas as dependências de uma vez | Não | Separar por risco |
| Tipos gerados Supabase | Sim | Reduz divergência |
| Zod em toda função interna | Depende | Obrigatório em fronteiras não confiáveis |
| Observabilidade básica | Sim | Logs estruturados e request ID |
| Realtime em todas as telas | Não | Somente necessidade imediata |

---

## 36. Melhorias prioritárias para este tipo de SaaS

Ordem recomendada:

### Segurança

- confirmar RLS;
- eliminar service role do client;
- validar `x-tenant-id`;
- centralizar contexto autenticado;
- proteger Server Actions e Route Handlers;
- revisar cache por tenant.

### Confiabilidade

- constraints;
- transações;
- idempotência;
- tratamento de concorrência;
- auditoria;
- testes de regra.

### Manutenção

- centralizar status;
- eliminar hardcodes de cliente;
- regras configuráveis;
- separar UI e domínio;
- reduzir `any`.

### Desempenho

- N+1;
- payload;
- paginação;
- índices;
- paralelismo;
- bundle client;
- consultas duplicadas.

### Operação

- logs;
- request ID;
- métricas;
- alertas;
- documentação;
- runbooks.

---

# PARTE J — FLUXO DE TRABALHO DA IA

## 37. Etapa 1 — Diagnóstico

A IA deve:

1. ler arquitetura;
2. confirmar versões;
3. rodar build;
4. mapear autenticação;
5. mapear tenant;
6. mapear RLS;
7. mapear acesso ao banco;
8. mapear rotas;
9. mapear mutations;
10. mapear deploy.

---

## 38. Etapa 2 — Evidências

Para cada sugestão:

```text
Problema:
Evidência:
Impacto:
Opções:
Opção recomendada:
Custo:
Risco:
Validação:
Rollback:
```

---

## 39. Etapa 3 — Plano

Separar:

### Fase 0 — Correções críticas

Segredos, RLS, vazamento, auth.

### Fase 1 — Base arquitetural

Proxy, resolver autenticado, DAL, validação.

### Fase 2 — Dívida técnica

Duplicações, hardcodes, tipos.

### Fase 3 — Desempenho

Queries, índices, bundle, cache.

### Fase 4 — Operação

Logs, métricas, alertas.

---

## 40. Etapa 4 — Implementação

Regras:

- branch própria;
- commits pequenos;
- testes antes/depois;
- migration nova;
- não editar migration aplicada;
- documentação;
- feature flag quando risco for alto;
- rollout gradual;
- preview deploy;
- rollback definido.

---

# PARTE K — FORMATO DO PROMPT EXECUTÁVEL

## 41. Prompt principal para a IA

```text
Use o arquivo GUIA_IA_MELHORIAS_NEXT_SUPABASE_PROXY.md como regra obrigatória.

Analise este SaaS em Next.js, TypeScript, Supabase e Vercel e proponha melhorias com base em evidências do repositório.

Primeiro:
1. confirme as versões instaladas;
2. consulte documentação oficial atual quando a recomendação depender de versão;
3. mapeie autenticação, autorização, tenant, contrato, RLS, Server Actions, Route Handlers e consultas;
4. rode as validações existentes;
5. registre problemas já existentes.

Avalie:
- segurança;
- multi-tenant;
- RLS;
- uso de service role;
- x-tenant-id;
- futuro x-contract-id;
- autenticação Supabase SSR;
- Proxy, antigo Middleware;
- Server e Client Components;
- DAL;
- services;
- TypeScript;
- schemas;
- consultas;
- índices;
- cache;
- realtime;
- Vercel;
- logs;
- testes.

Sobre Proxy:
- em Next.js 16, use proxy.ts e exporte proxy;
- use para renovação de sessão, cookies, redirects, rewrites, headers e verificações otimistas;
- mantenha o Proxy pequeno;
- não faça consultas pesadas;
- não coloque regra de negócio;
- não use como autorização definitiva;
- valide permissões perto da fonte de dados;
- mantenha RLS como última barreira.

Para cada melhoria, informe:
- problema;
- evidência;
- impacto;
- benefício;
- custo;
- risco;
- prioridade;
- implementação;
- testes;
- rollback;
- se compensa agora, depois ou não compensa.

Não proponha microserviços, Redis, filas, cache complexo, abstrações ou reescrita total sem evidência de necessidade.

Entregue primeiro o diagnóstico e o plano. Não faça mudança ampla sem mostrar o diff proposto e a validação.
```

---

## 42. Formato obrigatório de saída

```text
RESUMO EXECUTIVO

VERSÕES CONFIRMADAS

ARQUITETURA ATUAL

RISCOS CRÍTICOS

MELHORIAS QUE COMPENSAM AGORA

MELHORIAS PARA O PRÓXIMO CICLO

MELHORIAS QUE NÃO COMPENSAM AGORA

ANÁLISE DO PROXY

ANÁLISE DE AUTENTICAÇÃO E AUTORIZAÇÃO

ANÁLISE MULTI-TENANT E RLS

ANÁLISE DE DESEMPENHO

PLANO POR FASES

ARQUIVOS ENVOLVIDOS

TESTES

ROLLBACK

REFERÊNCIAS OFICIAIS CONSULTADAS
```

---

## 43. Critério de conclusão

O trabalho só está concluído quando:

- versões foram confirmadas;
- documentação oficial relevante foi consultada;
- Proxy foi avaliado com matcher e sessão;
- autorização definitiva foi separada do Proxy;
- multi-tenant foi testado;
- RLS foi verificada;
- service role foi revisada;
- custo-benefício foi apresentado;
- não foram propostas camadas sem necessidade;
- plano de testes e rollback foi fornecido.
