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
2. Criar `.env` ou `.env.local` com base em `.env.example`.
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
- `NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES`
- `LOCAL_AUTH_USERNAME`
- `LOCAL_AUTH_PASSWORD`
- `LOCAL_USER_ID`
- `LOCAL_ROLE`
- `LOCAL_TENANT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PASSWORD_REDIRECT_URL`
- `AUTH_RECOVER_DEBUG`

---

## Estrutura de pastas
- `src/app`: rotas, grupos de rota e layouts do App Router.
- `src/modules`: implementacao visual e composicao das telas.
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
  - `(public)/login/page.tsx`: wrapper fino da rota publica de login.
  - `(public)/recuperar-senha/page.tsx`: wrapper fino da rota publica de recuperacao de senha.
  - `(dashboard)/layout.tsx`: shell protegido do dashboard.
  - `(dashboard)/home/page.tsx`: wrapper fino da home autenticada.
  - `(dashboard)/cadastro-base/page.tsx`: placeholder de Cadastro Base.
  - `(dashboard)/pessoas/page.tsx`: placeholder de Pessoas.
  - `(dashboard)/materiais/page.tsx`: placeholder de Materiais.
  - `(dashboard)/entrada/page.tsx`: placeholder de Entrada.
  - `(dashboard)/saida/page.tsx`: placeholder de Saida.
  - `(dashboard)/estoque/page.tsx`: placeholder de Estoque Atual.
  - `(dashboard)/permissoes/page.tsx`: tela administrativa base para permissoes por pagina.
  - `api/app-users/search/route.ts`: busca usuarios reais do tenant autenticado para a tela de permissoes com filtro de tenant no backend.
  - `api/app-users/[userId]/permissions/route.ts`: carrega e salva role, status e permissoes por tela do usuario selecionado.
  - `api/auth/session-access/route.ts`: devolve role, tenant e telas liberadas do usuario autenticado para montar o shell.
  - `api/auth/local-login/route.ts`: login local via variaveis de ambiente.
- `src/modules/auth/login/`
  - `LoginPageView.tsx`: implementacao visual da tela de login.
  - `LoginPageView.module.css`: estilo do login.
- `src/modules/auth/recovery/`
  - `RecoveryPasswordPageView.tsx`: solicitacao de recuperacao e definicao da nova senha.
  - `RecoveryPasswordPageView.module.css`: estilo da tela de recuperacao.
- `src/modules/dashboard/home/`
  - `HomePageView.tsx`: implementacao visual da home.
  - `HomePageView.module.css`: estilo da home.
- `src/modules/dashboard/permissoes/`
  - `PermissionsPageView.tsx`: front administrativo para pesquisar usuario por `login_name` ou `matricula`, ajustar role, status e permissoes por tela.
  - `PermissionsPageView.module.css`: estilo da tela de permissoes.
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
- `src/lib/auth/`
  - `authorization.ts`: helper de role, fallback de telas por perfil e bloqueio/liberacao de rotas conforme `pageAccess`.
- `src/services/auth/`
  - `auth.service.ts`: login remoto/local e logout.
- `supabase/edge_functions/`
  - `auth-login-web/index.ts`: login remoto por `login_name`.
  - `auth-recover/index.ts`: recuperacao de senha por `login_name`.
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
  - `Tela_Permissoes_SaaS.txt`: base da futura tela de permissao por pagina.
  - `Tela_Recuperacao_Senha_SaaS.txt`: recuperacao e definicao de senha.
- `.env`: variaveis locais do ambiente, ignoradas pelo Git.
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
2. A rota `src/app/(public)/login/page.tsx` monta a tela implementada em `src/modules/auth/login/`.
3. Em modo remoto, o frontend chama `auth-login-web` no Supabase.
4. Em modo local, o frontend usa `/api/auth/local-login`.
5. O backend busca `login_name` em `public.app_users`, que precisa estar vinculado ao `auth.users`.
6. As migrations `017_sync_auth_users_to_app_users.sql` e `018_make_auth_user_sync_fail_open.sql` sincronizam `auth.users` com `app_users` por e-mail unico ou metadata minima no Auth, sem bloquear o Invite User do Supabase.
7. A migration `020_harden_rls_auth_uid_active.sql` reforca as policies para liberar dados somente quando `auth.uid()` estiver vinculado a um `app_users` ativo do mesmo tenant.
8. A migration `021_rls_to_authenticated.sql` limita as policies multi-tenant ao role `authenticated`.
9. A migration `023_normalize_roles_to_app_roles.sql` normaliza os perfis em `app_roles` e passa `app_users` e `role_page_permissions` para `role_id`.
10. A migration `024_create_user_page_permissions.sql` cria a matriz por usuario e por tela, com `access`, `select`, `insert` e `update`.
11. O backend continua retornando `role` como `role_key` para o frontend, mesmo com a modelagem normalizada.
12. O frontend persiste a sessao e redireciona para `/home`.
13. A rota `src/app/(dashboard)/home/page.tsx` monta a home implementada em `src/modules/dashboard/home/`.
14. O shell principal libera navegacao para os modulos do SaaS.
15. A migration `025_app_users_admin_tenant_select.sql` libera leitura de `app_users` do mesmo tenant apenas para perfis administrativos autenticados.
16. O shell agora reserva `/permissoes` para perfis administrativos e expoe esse acesso por uma engrenagem no topo, ao lado de `Sair`.
17. A tela `/permissoes` busca usuarios do tenant por `login_name` ou `matricula`.
18. Ao selecionar um usuario, o frontend carrega `role`, `status` e as telas liberadas em `app_user_page_permissions`.
19. Ao salvar, o backend atualiza `app_users.role_id`, `app_users.ativo` e faz `upsert` da matriz por tela sem `delete`.
20. No login remoto e na reidratacao da sessao, o frontend consulta `/api/auth/session-access` para descobrir as telas realmente liberadas ao usuario.
21. O shell filtra a sidebar e protege as rotas com base em `pageAccess` quando existirem permissoes customizadas por usuario.
22. O link `Esqueci minha senha` usa o `login_name` digitado na tela de login e chama a Edge Function `auth-recover`.
23. O Supabase envia o email de recuperacao para o email vinculado ao `login_name`.
24. A rota `src/app/(public)/recuperar-senha/page.tsx` valida `token_hash`, `code` ou tokens do Supabase e permite definir a nova senha.
25. O `AuthContext` renova os tokens remotos persistidos, reidrata `pageAccess`, encerra a sessao por inatividade e devolve o usuario ao login quando o token expira.

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
  - Solucao: preencher `.env` ou `.env.local`.
- `Login local nao configurado.`:
  - Causa: `LOCAL_AUTH_USERNAME` ou `LOCAL_AUTH_PASSWORD` ausentes.
  - Solucao: preencher as variaveis locais.
- `Falha ao autenticar.`:
  - Causa: `auth-login-web` nao publicada ou `login_name` nao cadastrado em `app_users`.
  - Solucao: aplicar a migration `016` e revisar o usuario no Supabase.
- `Usuario criado no Auth nao entra no SaaS.`:
  - Causa: `app_users` nao foi sincronizado por falta de email unico ou metadata minima (`tenant_id` e `matricula`).
  - Solucao: aplicar as migrations `017` e `018` e revisar o cadastro no `auth.users` ou em `app_users`.
- `Failed to invite user` no painel do Supabase:
  - Causa: trigger de sincronizacao em `auth.users` levantando erro ao tentar tocar `app_users`.
  - Solucao: aplicar a migration `018`, repetir o invite e depois revisar se o vinculo em `app_users` foi feito por e-mail ou se exige complemento manual.
- `Falha ao enviar email de recuperacao.`:
  - Causa: `auth-recover` nao publicada, email ausente no `app_users` ou redirect invalido.
  - Solucao: publicar a function, revisar o email do usuario e conferir `PASSWORD_REDIRECT_URL` nos secrets da function.
- `Sua sessao expirou por inatividade. Entre novamente.`:
  - Causa: tempo configurado em `NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES` atingido sem atividade do usuario.
  - Solucao: entrar novamente e revisar o timeout configurado para o ambiente.
- `Sua sessao expirou. Entre novamente.`:
  - Causa: token remoto invalido/expirado durante a reidratacao ou no ciclo de autenticacao do Supabase.
  - Solucao: entrar novamente e revisar a configuracao do projeto Supabase se o problema for recorrente.
- `Permissoes` nao aparece no menu:
  - Causa: a tela nao faz parte da navegacao principal e so aparece como engrenagem no topo para perfis administrativos.
  - Solucao: revisar `app_users.role_id` vinculado a `app_roles` e usar um perfil administrativo (`admin` ou `master`) quando o acesso precisar ser liberado.
- `Usuario logou, mas continua vendo telas bloqueadas na configuracao de permissoes`:
  - Causa: a sessao local foi criada antes da leitura de `app_user_page_permissions` ou o frontend ainda nao reidratou `pageAccess`.
  - Solucao: entrar novamente apos salvar as permissoes e confirmar que `/api/auth/session-access` retorna `pageAccess` com as telas liberadas.
- `Usuario autenticado nao enxerga dados do tenant.`:
  - Causa: `app_users.auth_user_id` nao vinculado ao `auth.users`, `tenant_id` divergente ou usuario com `ativo = false`.
  - Solucao: revisar o vinculo em `app_users`, aplicar as migrations `020_harden_rls_auth_uid_active.sql` e `021_rls_to_authenticated.sql` e confirmar o tenant correto do usuario.
- `Informe seu login para enviar o email de recuperacao.`:
  - Causa: clique em `Esqueci minha senha` sem preencher o `login_name`.
  - Solucao: informar o `login_name` na tela de login antes de solicitar a recuperacao.
- `Link invalido ou expirado. Solicite uma nova recuperacao.`:
  - Causa: `token_hash`, codigo ou token do Supabase expirado, ausente ou redirect incorreto para `/recuperar-senha`.
  - Solucao: solicitar um novo link e revisar a URL de redirect configurada no projeto Supabase.

---

## Status do projeto
- 🟡 Em desenvolvimento

---

## Licenca
- Nao definida no repositorio.
