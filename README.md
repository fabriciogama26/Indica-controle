# RQM SaaS

Frontend web do SaaS para login, shell principal, operacao de estoque e cadastros base integrados ao Supabase, com hospedagem web prevista no Vercel.

---

## Visao geral
- Problema resolvido: separar o frontend web do app Android e manter o contexto tecnico do SaaS em uma estrutura propria.
- Solucao proposta: projeto Next.js publicado no Vercel para servir a interface web, mantendo Auth, banco, RLS e Edge Functions no Supabase.
- Contexto de uso: painel web multi-tenant para autenticacao, navegacao principal e evolucao dos modulos de Operacao, Almoxarifado, Cadastros e Cadastro Base, acessado por dominio web publico.

---

## Tecnologias
- Next.js 16
- React 19
- TypeScript
- CSS Modules
- Vercel
- Supabase JS
- Supabase Edge Functions
- TanStack React Query
- ESLint

---

## Requisitos
- Node.js instalado
- npm disponivel
- Conta/projeto no Vercel para publicacao do frontend
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
1. Validar o build local:
```bash
npm run build
```
2. Publicar o frontend no Vercel como projeto `Next.js` apontando para a raiz deste repositorio.
3. Configurar no Vercel as mesmas variaveis listadas em `.env.example`, inclusive as variaveis server-side usadas pelas rotas `src/app/api/*`.
4. Definir `PASSWORD_REDIRECT_URL` com o dominio publico do frontend:
```bash
https://SEU-DOMINIO/recuperar-senha
```
5. Manter as Edge Functions no Supabase e atualizar no proprio Supabase os secrets usados por elas (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `PASSWORD_REDIRECT_URL`).
6. Se publicar pela CLI do Vercel:
```bash
vercel
vercel --prod
```

---

## Variaveis de ambiente
- Frontend publico / browser:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_AUTH_MODE`
  - `NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES`
- Rotas server-side do Next no Vercel:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PASSWORD_REDIRECT_URL`
  - `AUTH_RECOVER_DEBUG`
- Modo local:
  - `LOCAL_AUTH_USERNAME`
  - `LOCAL_AUTH_PASSWORD`
  - `LOCAL_USER_ID`
  - `LOCAL_ROLE`
  - `LOCAL_TENANT_ID`
- Observacao tecnica:
  - `PASSWORD_REDIRECT_URL` deve apontar para a rota publica `/recuperar-senha` do dominio publicado no Vercel.
  - Os mesmos segredos usados pelas Edge Functions continuam sendo configurados no Supabase, nao no Vercel.

---

## Estrutura de pastas
- `src/app`: rotas, grupos de rota e layouts do App Router.
- `src/modules`: implementacao visual e composicao das telas.
- `src/components`: shell e componentes visuais.
- `src/context`: estado de autenticacao.
- `src/lib`: cliente Supabase e React Query.
- `src/services`: integracoes do frontend.
- `docs`: handoff e documentacao funcional do SaaS.
- `vercel.json`: declaracao minima do deploy web no Vercel.

---

## Estrutura completa de pastas
- `src/app/`
  - `layout.tsx`: layout raiz com providers.
  - `page.tsx`: redirect inicial para `/login` ou `/home`.
  - `(public)/login/page.tsx`: wrapper fino da rota publica de login.
  - `(public)/recuperar-senha/page.tsx`: wrapper fino da rota publica de recuperacao de senha.
  - `(dashboard)/layout.tsx`: shell protegido do dashboard.
  - `(dashboard)/home/page.tsx`: wrapper fino da home autenticada.
  - `(dashboard)/projetos/page.tsx`: rota da tela de Projetos com cadastro, filtros e listagem.
  - `(dashboard)/locacao/page.tsx`: placeholder de Locacao.
  - `(dashboard)/programacao/page.tsx`: placeholder de Programacao.
  - `(dashboard)/medicao/page.tsx`: placeholder de Medicao.
  - `(dashboard)/materiais/page.tsx`: placeholder de Materiais.
  - `(dashboard)/cargo/page.tsx`: placeholder de Cargo.
  - `(dashboard)/estoque/page.tsx`: placeholder de Estoque Atual.
  - `(dashboard)/entrada/page.tsx`: placeholder de Entrada Estoque.
  - `(dashboard)/saida/page.tsx`: placeholder de Saida Estoque.
  - `(dashboard)/cadastro-base/page.tsx`: placeholder de Cadastro Base.
  - `(dashboard)/prioridade/page.tsx`: placeholder de Prioridade.
  - `(dashboard)/centro-servico/page.tsx`: placeholder de Centro de Servico.
  - `(dashboard)/contrato/page.tsx`: placeholder de Contrato.
  - `(dashboard)/imei/page.tsx`: placeholder de Imei.
  - `(dashboard)/tipo-servico/page.tsx`: placeholder de Tipo de Servico.
  - `(dashboard)/nivel-tensao/page.tsx`: placeholder de Nivel de Tensao.
  - `(dashboard)/porte/page.tsx`: placeholder de Porte.
  - `(dashboard)/responsavel-distribuidora/page.tsx`: placeholder de Responsavel Distribuidora.
  - `(dashboard)/municipio/page.tsx`: placeholder de Municipio.
  - `(dashboard)/pessoas/page.tsx`: placeholder de Pessoas.
  - `(dashboard)/permissoes/page.tsx`: tela administrativa base para permissoes por pagina.
  - `api/app-users/search/route.ts`: busca usuarios reais do tenant autenticado para a tela de permissoes com filtro de tenant no backend.
  - `api/app-users/[userId]/permissions/route.ts`: carrega e salva role, status e permissoes por tela do usuario selecionado.
  - `api/app-users/[userId]/invite/route.ts`: envia convite de primeiro acesso para usuario pre-cadastrado em `app_users`.
  - `api/projects/route.ts`: cadastra, edita, cancela/ativa, lista e consulta historico de projetos por tenant.
  - `api/projects/meta/route.ts`: carrega opcoes de apoio da tela de projetos (SOB base, prioridades, municipios e responsaveis).
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
- `src/modules/dashboard/projetos/`
  - `ProjectsPageView.tsx`: tela de projetos com cadastro, filtros e listagem em colunas.
  - `ProjectsPageView.module.css`: estilos da tela de projetos.
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
  - `Tela_Projetos_SaaS.txt`: tela de projetos com cadastro, filtros e listagem.
  - `Tela_Locacao_SaaS.txt`: placeholder do modulo de locacao.
  - `Tela_Programacao_SaaS.txt`: placeholder do modulo de programacao.
  - `Tela_Medicao_SaaS.txt`: placeholder do modulo de medicao.
  - `Tela_Cargo_SaaS.txt`: placeholder do modulo de cargo.
  - `Tela_Cadastro_Base_SaaS.txt`: placeholders das telas de cadastro base por dominio.
  - `Tela_Permissoes_SaaS.txt`: base da futura tela de permissao por pagina.
  - `Tela_Recuperacao_Senha_SaaS.txt`: recuperacao e definicao de senha.
- `.env`: variaveis locais do ambiente, ignoradas pelo Git.
- `.env.example`: variaveis de ambiente esperadas.
- `vercel.json`: identifica o projeto como `nextjs` no Vercel.
- `TASKS.md`: backlog do SaaS separado do app Android.
- `package.json`: scripts, dependencias e versao minima de Node.js.
- `tsconfig.json`: configuracao TypeScript.
- `eslint.config.mjs`: configuracao do lint.

---

## Verificacao de dados em (caso exista):
D:\Fabricio\Projetos SaaS\API-Estoque\supabasebackup
- Referencia externa opcional. Nao e usada diretamente por este frontend.

## Fluxo principal
1. Usuario acessa o dominio publicado no Vercel.
2. O App Router do Next resolve `/login`.
3. A rota `src/app/(public)/login/page.tsx` monta a tela implementada em `src/modules/auth/login/`.
4. Em modo remoto, o frontend chama `auth-login-web` no Supabase.
5. Em modo local, o frontend usa `/api/auth/local-login`.
6. O backend busca `login_name` em `public.app_users`, que precisa estar vinculado ao `auth.users`.
7. As migrations `017_sync_auth_users_to_app_users.sql` e `018_make_auth_user_sync_fail_open.sql` sincronizam `auth.users` com `app_users` por e-mail unico ou metadata minima no Auth, sem bloquear o Invite User do Supabase.
8. A migration `020_harden_rls_auth_uid_active.sql` reforca as policies para liberar dados somente quando `auth.uid()` estiver vinculado a um `app_users` ativo do mesmo tenant.
9. A migration `021_rls_to_authenticated.sql` limita as policies multi-tenant ao role `authenticated`.
10. A migration `023_normalize_roles_to_app_roles.sql` normaliza os perfis em `app_roles` e passa `app_users` e `role_page_permissions` para `role_id`.
11. A migration `024_create_user_page_permissions.sql` cria a matriz por usuario e por tela, com `access`, `select`, `insert` e `update`.
12. O backend continua retornando `role` como `role_key` para o frontend, mesmo com a modelagem normalizada.
13. O frontend persiste a sessao e redireciona para `/home`.
14. A rota `src/app/(dashboard)/home/page.tsx` monta a home implementada em `src/modules/dashboard/home/`.
15. O shell principal libera navegacao para as secoes `Visao Geral`, `Operacao`, `Almoxarifado`, `Cadastros` e `Cadastro Base`.
16. A rota `/projetos` permite cadastrar, editar, cancelar/ativar e filtrar projetos no tenant atual usando as rotas `/api/projects` e `/api/projects/meta`.
17. No cadastro de projetos, o campo `Parceira` e preenchido automaticamente no backend usando `contract.name` do tenant ativo.
18. A migration `029_create_project_table.sql` cria a tabela `project` com auditoria (`created_by`, `updated_by`, `created_at`, `updated_at`), RLS e indices de filtro.
19. A migration `034_use_people_for_project_contractor_responsible.sql` remove o lookup dedicado de `Responsavel Contratada` e passa a usar `people` com cargo `SUPERVISOR`.
20. A migration `036_create_project_history_and_cancellation.sql` adiciona `project.is_active` e cria `project_history` e `project_cancellation_history` para registrar edicoes e cancelamentos.
21. A migration `037_project_activation_history_rules.sql` permite eventos de ativacao (`ACTIVATE`) e classifica cancelamento/ativacao em `project_cancellation_history.action_type`.
22. As migrations `032_create_contrato_table.sql` e `033_rename_contrato_to_contract.sql` criam a tabela de contrato por tenant e padronizam o nome final como `contract`, com coluna `name`, `valor` derivado do `tenant_id`, RLS e auditoria.
23. A migration `025_app_users_admin_tenant_select.sql` libera leitura de `app_users` do mesmo tenant apenas para perfis administrativos autenticados.
24. O shell agora reserva `/permissoes` para perfis administrativos e expoe esse acesso por uma engrenagem no topo, ao lado de `Sair`.
25. A tela `/permissoes` busca usuarios do tenant por `login_name` ou `matricula`.
26. Ao selecionar um usuario, o frontend carrega `role`, `status` e as telas liberadas em `app_user_page_permissions`.
27. Ao salvar, o backend atualiza `app_users.role_id`, `app_users.ativo`, faz `upsert` da matriz por tela sem `delete` e registra historico em `app_user_permission_history`.
28. Quando o pre-cadastro ja estiver completo em `app_users`, a tela `/permissoes` tambem permite enviar o invite do Supabase Auth para o email do usuario.
29. No login remoto e na reidratacao da sessao, o frontend consulta `/api/auth/session-access` para descobrir as telas realmente liberadas ao usuario.
30. O shell filtra a sidebar e protege as rotas com base em `pageAccess` quando existirem permissoes customizadas por usuario.
31. O link `Esqueci minha senha` usa o `login_name` digitado na tela de login e chama a Edge Function `auth-recover`.
32. O Supabase envia o email de recuperacao para o email vinculado ao `login_name`, usando `PASSWORD_REDIRECT_URL` apontando para o frontend publicado no Vercel.
33. A rota `src/app/(public)/recuperar-senha/page.tsx` valida `token_hash`, `code` ou tokens do Supabase e permite definir a nova senha.
34. O `AuthContext` renova os tokens remotos persistidos, reidrata `pageAccess`, encerra a sessao por inatividade e devolve o usuario ao login quando o token expira.
35. Quando a sessao expira por token vencido, o frontend ainda tenta registrar `LOGOUT` no `login_audit` usando o `session_ref` salvo.
36. A migration `040_reorganize_menu_sections_and_page_permissions.sql` reorganiza `app_pages` por secao e faz backfill das novas telas em `role_page_permissions` e `app_user_page_permissions`.

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
- `Falha ao listar projetos.` ou `relation "project" does not exist`:
  - Causa: migration de projetos nao aplicada no banco remoto.
  - Solucao: aplicar `029_create_project_table.sql` antes de usar a tela `/projetos`.
- `Projeto inativo nao pode ser editado.`:
  - Causa: tentativa de editar obra ja cancelada/inativada.
  - Solucao: editar somente projetos ativos ou criar novo projeto conforme processo operacional.
- `Projeto cancelado/ativado, mas falhou ao registrar historico...`:
  - Causa: migrations de historico de status nao aplicadas no banco remoto.
  - Solucao: aplicar `036_create_project_history_and_cancellation.sql` e `037_project_activation_history_rules.sql` e repetir a operacao.
- `Para esta prioridade, Projeto (SOB) deve iniciar ...` ou `Para FUSESAVER, Projeto (SOB) deve iniciar ...`:
  - Causa: `SOB` informado fora do formato exigido pela prioridade selecionada.
  - Solucao: aplicar o padrao: `A` + 9 numeros para prioridades de fluxo/DRP-DRC, ou `ZX/FS` + 8 numeros para `FUSESAVER`.
- `Falha ao carregar opcoes de projetos.`:
  - Causa: tabelas de dominio da tela `Projetos` nao existem no banco.
  - Solucao: aplicar a migration `031_create_project_lookup_tables.sql` e recarregar a pagina.
- `Responsavel Contratada` sem opcoes no cadastro de projetos:
  - Causa: cargos/pessoas de supervisor nao configurados no tenant.
  - Solucao: garantir `job_titles.code = SUPERVISOR` ativo e pessoas ativas vinculadas em `people.job_title_id`.
- `Nao foi encontrado contrato ativo com campo name para preencher Parceira automaticamente.`:
  - Causa: tabela `contract` sem registro ativo para o tenant autenticado.
  - Solucao: cadastrar/ativar um contrato por tenant com `name` preenchido.
- `relation "contract" does not exist`:
  - Causa: migrations da tabela de contrato por tenant nao aplicadas no banco remoto.
  - Solucao: aplicar `032_create_contrato_table.sql` e `033_rename_contrato_to_contract.sql` e repetir a operacao.
- `Missing NEXT_PUBLIC_SUPABASE_URL`:
  - Causa: ambiente remoto sem variaveis.
  - Solucao: preencher `.env` ou `.env.local`.
- `Login local nao configurado.`:
  - Causa: `LOCAL_AUTH_USERNAME` ou `LOCAL_AUTH_PASSWORD` ausentes.
  - Solucao: preencher as variaveis locais.
- `Environment Variable "SUPABASE_SERVICE_ROLE_KEY" references Secret that does not exist` no Vercel:
  - Causa: variavel server-side nao cadastrada no projeto Vercel.
  - Solucao: cadastrar `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` e `PASSWORD_REDIRECT_URL` no ambiente correto (`Preview`/`Production`).
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
- O email de recuperacao abre `localhost` ou dominio antigo:
  - Causa: `PASSWORD_REDIRECT_URL` configurada no Vercel ou no Supabase com URL desatualizada.
  - Solucao: atualizar `PASSWORD_REDIRECT_URL` para `https://SEU-DOMINIO/recuperar-senha` no Vercel e tambem nos secrets da Edge Function `auth-recover`.
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
- `Falha ao enviar convite do usuario.`:
  - Causa: usuario sem email, sem `matricula`, sem `login_name` ou ja vinculado ao Auth do Supabase.
  - Solucao: revisar o pre-cadastro em `app_users` antes de usar o botao `Enviar convite` na tela `/permissoes`.
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
