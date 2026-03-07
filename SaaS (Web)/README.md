# RQM SaaS

Frontend web do SaaS para login, shell principal, cadastros base e modulos de estoque integrados ao Supabase.

---

## Visao geral
- Problema resolvido: separar o frontend web do app Android e manter o contexto tecnico do SaaS em uma estrutura propria.
- Solucao proposta: projeto Next.js em `SaaS (Web)/` com docs, backlog e contratos de backend dentro da propria pasta.
- Contexto de uso: painel web multi-tenant para autenticacao, navegacao principal e evolucao dos modulos de Pessoas, Materiais e Estoque.

---

## Tecnologias
- Next.js 16
- React 19
- TypeScript
- CSS Modules
- Supabase JS
- TanStack React Query
- ESLint

---

## Requisitos
- Node.js instalado
- npm disponivel
- Projeto Supabase configurado para o modo remoto
- Edge Functions e migrations publicadas quando o ambiente nao estiver em modo local

---

## Como rodar o projeto

### Ambiente de desenvolvimento
1. Instalar dependencias:
```bash
npm install
```
2. Criar `.env.local` com base em `.env.example`.
3. Rodar o ambiente:
```bash
npm run dev
```
4. Abrir `http://localhost:3000`.

---

### Build / Producao
```bash
npm run build
npm run start
```

---

## Variaveis de ambiente
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_AUTH_MODE`
- `LOCAL_AUTH_USERNAME`
- `LOCAL_AUTH_PASSWORD`
- `LOCAL_USER_ID`
- `LOCAL_ROLE`
- `LOCAL_TENANT_ID`

---

## Estrutura de pastas
- `src/app`: rotas do App Router.
- `src/components`: shell e componentes visuais.
- `src/context`: estado de autenticacao.
- `src/lib`: cliente Supabase e React Query.
- `src/services`: integracoes do frontend.
- `docs`: handoff e documentacao funcional do SaaS.

---

## Estrutura completa de pastas
- `src/app/`
  - `layout.tsx`: layout raiz com providers.
  - `page.tsx`: redirect inicial para `/login` ou `/home`.
  - `login/page.tsx`: tela de login do SaaS.
  - `login/page.module.css`: estilo da tela de login.
  - `(dashboard)/layout.tsx`: shell protegido do dashboard.
  - `(dashboard)/home/page.tsx`: home inicial.
  - `(dashboard)/cadastro-base/page.tsx`: placeholder de Cadastro Base.
  - `(dashboard)/pessoas/page.tsx`: placeholder de Pessoas.
  - `(dashboard)/materiais/page.tsx`: placeholder de Materiais.
  - `(dashboard)/entrada/page.tsx`: placeholder de Entrada.
  - `(dashboard)/saida/page.tsx`: placeholder de Saida.
  - `(dashboard)/estoque/page.tsx`: placeholder de Estoque Atual.
  - `api/auth/local-login/route.ts`: login local via variaveis de ambiente.
- `src/components/layout/`
  - `AppShell.tsx`: sidebar, topbar e protecao client-side.
  - `AppShell.module.css`: estilos do shell.
- `src/components/ui/`
  - `ModulePlaceholder.tsx`: componente de pagina em construcao.
  - `ModulePlaceholder.module.css`: estilos do placeholder.
- `src/context/`
  - `AuthContext.tsx`: hidrata e gerencia a sessao.
- `src/hooks/`
  - `useAuth.ts`: acesso ao contexto de autenticacao.
- `src/lib/react-query/`
  - `provider.tsx`: provider do React Query.
- `src/lib/supabase/`
  - `client.ts`: cliente Supabase do frontend.
- `src/services/auth/`
  - `auth.service.ts`: login remoto/local e logout.
- `src/types/`
  - `auth.ts`: tipos de usuario e sessao.
- `public/`
  - `indica.png`: logo da tela de login.
  - demais `.svg`: assets padrao do scaffold.
- `docs/`
  - `00_Indice_SaaS.txt`: indice do material de handoff.
  - `Arquitetura_SaaS.txt`: arquitetura e stack atual.
  - `Backend_Contratos_SaaS.txt`: migrations/functions e dependencias do Supabase.
  - `Handoff_SaaS.txt`: resumo tecnico para continuar o projeto em outra task/repositorio.
  - `Layout_Principal_SaaS.txt`: shell principal.
  - `Tela_Home_SaaS.txt`: home inicial.
  - `Tela_Login_SaaS.txt`: login do SaaS.
- `.env.example`: variaveis de ambiente esperadas.
- `TASKS.md`: backlog do SaaS separado do app Android.
- `package.json`: scripts e dependencias.
- `tsconfig.json`: configuracao TypeScript.
- `eslint.config.mjs`: configuracao do lint.

---

## Verificacao de dados em (caso exista):
D:\Fabricio\Projetos SaaS\API-Estoque\supabasebackup
- Referencia externa opcional. Nao e usada diretamente por este frontend.

## Fluxo principal
1. Usuario acessa `/login`.
2. Informa `login_name` e `senha`.
3. Em modo remoto, o frontend chama `auth-login-web` no Supabase.
4. Em modo local, o frontend usa `/api/auth/local-login`.
5. O frontend persiste a sessao e redireciona para `/home`.
6. O shell principal libera navegacao para os modulos do SaaS.

---

## Testes
- Nao existem testes automatizados neste projeto web neste momento.
- Validacoes atuais:
```bash
npm run lint
npm run build
```

---

## Troubleshooting
- `Missing NEXT_PUBLIC_SUPABASE_URL`:
  - Causa: ambiente remoto sem variaveis.
  - Solucao: preencher `.env.local`.
- `Login local nao configurado.`:
  - Causa: `LOCAL_AUTH_USERNAME` ou `LOCAL_AUTH_PASSWORD` ausentes.
  - Solucao: preencher as variaveis locais.
- `Falha ao autenticar.`:
  - Causa: `auth-login-web` nao publicada ou `login_name` nao cadastrado em `app_users`.
  - Solucao: aplicar a migration `016` e revisar o usuario no Supabase.

---

## Status do projeto
- 🟡 Em desenvolvimento

---

## Licenca
- Nao definida no repositorio.
