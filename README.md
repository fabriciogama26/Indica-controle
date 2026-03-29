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
- SheetJS (XLSX)
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
4. Se precisar reproduzir especificamente com Turbopack:
```bash
npm run dev:turbopack
```
5. Abrir `http://localhost:3000`.

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
  - `(dashboard)/projetos/page.tsx`: rota da tela de Projetos com cadastro, filtros, listagem, materiais previstos e atividades previstas por projeto.
  - `(dashboard)/locacao/page.tsx`: rota da tela de Locacao com filtro por municipio, busca por SOB, visao previa com filtros/lista de locacoes, 4 blocos operacionais, validacao obrigatoria na aba principal, controle de concorrencia por `updated_at` e atividades previstas/materiais previstos com regras finais centralizadas em RPC.
  - `(dashboard)/programacao/page.tsx`: rota legada desativada; mantida no codigo apenas para redirecionar automaticamente para `/programacao-simples`.
  - `(dashboard)/programacao-simples/page.tsx`: rota da nova tela de Programacao no padrao de cadastro, com selecao de multiplas equipes, campos estruturais (`POSTE`, `ESTRUTURA`, `TRAFO`, `REDE`), acoes de linha (`Detalhes`, `Edicao`, `Historico`), submit em lote e exportacao `ENEL-EXCEL`.
  - `(dashboard)/medicao/page.tsx`: rota da tela de Medicao com `cadastro + filtros + lista` paginada, modos `Com producao` e `Sem producao`, persistencia transacional em banco, cadastro independente da programacao, match automatico por `Projeto + Equipe + Data`, status visual `Programada/Nao programada` e alerta para mudanca posterior de `CONCLUIDO/PARCIAL` na programacao.
  - `(dashboard)/materiais/page.tsx`: rota da tela de Materiais com cadastro, filtros e listagem.
  - `(dashboard)/atividades/page.tsx`: rota da tela de Atividades com cadastro, filtros, listagem paginada e acoes de detalhe/historico/status.
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
  - `(dashboard)/pessoas/page.tsx`: rota da tela de Pessoas com cadastro, filtros, listagem, historico, exportacao e troca de status.
  - `(dashboard)/equipes/page.tsx`: rota da tela de Equipes com base, tipo, encarregado, filtros, historico e troca de status.
  - `(dashboard)/permissoes/page.tsx`: tela administrativa base para permissoes por pagina.
  - `api/app-users/search/route.ts`: busca usuarios reais do tenant autenticado para a tela de permissoes com filtro de tenant no backend.
  - `api/app-users/[userId]/permissions/route.ts`: carrega e salva role, status e permissoes por tela do usuario selecionado.
  - `api/app-users/[userId]/invite/route.ts`: envia convite de primeiro acesso para usuario pre-cadastrado em `app_users` e registra auditoria do invite via RPC.
  - `api/projects/route.ts`: cadastra, edita, cancela/ativa, lista e consulta historico de projetos por tenant, bloqueando inativacao quando houver agenda operacional pendente.
  - `api/projects/meta/route.ts`: carrega opcoes de apoio da tela de projetos (SOB base, prioridades, municipios e responsaveis).
  - `api/projects/forecast/route.ts`: lista, adiciona e edita materiais previstos por projeto com controle de concorrencia por `updated_at` na edicao.
  - `api/projects/forecast/catalog/route.ts`: pesquisa materiais ativos para inclusao manual no previsto do projeto.
  - `api/projects/activity-forecast/route.ts`: lista, adiciona e edita atividades previstas por projeto com controle de concorrencia por `updated_at` na edicao.
  - `api/projects/activity-forecast/catalog/route.ts`: pesquisa atividades ativas para inclusao no previsto do projeto.
  - `api/locacao/route.ts`: inicializa, carrega e atualiza a Locacao por projeto, delegando a persistencia validada para RPC no banco e enviando `expectedUpdatedAt` no salvar da aba principal.
  - `api/locacao/meta/route.ts`: carrega municipios, catalogo de projetos ativos por SOB e a lista resumida de locacoes com status, responsavel e data da tela de locacao.
  - `api/locacao/materials/route.ts`: adiciona e edita materiais previstos da locacao via RPC com bloqueio de quantidade invalida e controle de concorrencia por `updated_at`.
  - `api/locacao/materials/catalog/route.ts`: pesquisa materiais ativos por codigo/descricao para inclusao na locacao.
  - `api/locacao/activities/route.ts`: adiciona e edita atividades previstas da locacao via RPC com bloqueio de quantidade invalida e controle de concorrencia por `updated_at`.
  - `api/locacao/activities/catalog/route.ts`: pesquisa atividades ativas por codigo/descricao para inclusao na locacao.
  - `api/medicao/route.ts`: lista, detalha, historiza, salva, fecha/cancela e importa em massa ordens de medicao, incluindo os modos `Com producao` e `Sem producao`.
  - `api/medicao/meta/route.ts`: carrega motivos ativos de `Sem producao` da Medicao por tenant.
  - `api/medicao/activities/catalog/route.ts`: pesquisa atividades ativas para inclusao manual ou importacao da Medicao.
  - `api/teams/route.ts`: cadastra, edita, cancela/ativa, lista e consulta historico de equipes, incluindo a base vinculada por centro de servico.
  - `api/teams/meta/route.ts`: carrega bases, tipos e encarregados validos para a tela de Equipes.
  - `api/programacao/route.ts`: lista projetos/equipes/programacoes do periodo, resume a carga semanal por equipe, consome o catalogo proprio de apoio da Programacao com auto-preenchimento a partir da locacao, salva a agenda real da tela de Programacao, suporta cadastro em lote (`action = BATCH_CREATE`) para multiplas equipes via RPC transacional, exige motivo na reprogramacao e altera status de programacoes com motivo, historico e controle de concorrencia.
  - `api/materials/route.ts`: cadastra, edita, cancela/ativa, lista e consulta historico de materiais por tenant.
  - `api/activities/route.ts`: cadastra, edita, cancela/ativa, lista e consulta historico de atividades por tenant com precheck de codigo duplicado e paginacao.
  - `api/auth/session-access/route.ts`: devolve role, tenant ativo, tenants permitidos e telas liberadas do usuario autenticado para montar o shell.
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
  - `ProjectsPageView.tsx`: tela de projetos com cadastro, filtros, listagem, materiais previstos e atividades previstas em abas.
  - `ProjectsPageView.module.css`: estilos da tela de projetos.
- `src/modules/dashboard/locacao/`
  - `LocationPageView.tsx`: tela de locacao com filtro por municipio, busca por SOB, visao previa com filtros/lista de locacoes, modal de detalhes, 4 blocos operacionais, feedback local de salvamento, atividades previstas e materiais previstos.
  - `LocationPageView.module.css`: estilos da tela de locacao.
- `src/modules/dashboard/programacao/`
  - `ProgrammingPageView.tsx`: implementacao legada da tela antiga de Programacao (desativada no fluxo atual e mantida sem exclusao de codigo).
  - `ProgrammingPageView.module.css`: estilos da tela de programacao.
- `src/modules/dashboard/programacao-simples/`
  - `ProgrammingSimplePageView.tsx`: tela da nova Programacao em formato de cadastro, com formulario, multi-selecao de equipes, quantidades estruturais (`POSTE`, `ESTRUTURA`, `TRAFO`, `REDE`), filtros, lista com `Detalhes`/`Edicao`/`Historico`, exportacao CSV e exportacao `ENEL-EXCEL`.
  - `ProgrammingSimplePageView.module.css`: estilos da nova tela de Programacao.
- `src/modules/dashboard/medicao/`
  - `MeasurementPageView.tsx`: tela de Ordem de Medicao com cadastro independente da programacao, lista paginada, modos `Com producao` e `Sem producao`, motivo estruturado por tenant, inclusao de atividades da medicao, taxa unica por ordem com coluna `Taxa aplicada` na edicao, cadastro em massa CSV com suporte aos dois tipos, detalhe por item com `taxa` visivel, importacao reforcada por match exato/univoco do codigo da atividade e bloqueio de atividade duplicada na mesma ordem com validacao tambem na RPC.
  - `MeasurementPageView.module.css`: estilos da tela de medicao.
- `src/modules/dashboard/equipes/`
  - `TeamsPageView.tsx`: tela de equipes com cadastro, filtros, listagem, base por centro de servico, historico e cancelamento/ativacao.
  - `TeamsPageView.module.css`: estilos da tela de equipes.
- `src/modules/dashboard/materiais/`
  - `MaterialsPageView.tsx`: tela de materiais com cadastro, filtros, listagem, historico e cancelamento/ativacao.
  - `MaterialsPageView.module.css`: estilos da tela de materiais.
- `src/modules/dashboard/atividades/`
  - `ActivitiesPageView.tsx`: tela de atividades com cadastro de `codigo`, `descricao`, `valor`, `unidade`, listagem paginada e acoes `Detalhes`, `Editar`, `Historico`, `Cancelar/Ativar`.
  - `ActivitiesPageView.module.css`: estilos da tela de atividades.
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
- `src/lib/server/`
  - `appUsersAdmin.ts`: resolve sessao autenticada, usuario e tenant ativo nas rotas server-side.
  - `concurrency.ts`: normaliza `expectedUpdatedAt` e padroniza respostas `409` para conflitos de concorrencia.
  - `locationPlanning.ts`: consolida bootstrap, leitura, apoio de execucao, riscos, wrappers das RPCs e historico tecnico da locacao.
  - `projectForecastXlsx.ts`: parse e template XLSX de materiais previstos do projeto.
- `src/services/auth/`
  - `auth.service.ts`: login remoto/local e logout.
- `supabase/edge_functions/`
  - `auth-login-web/index.ts`: login remoto por `login_name`.
  - `auth-recover/index.ts`: recuperacao de senha por `login_name`.
  - `get_project_forecast_template/index.ts`: modelo XLSX de materiais previstos por projeto.
  - `import_project_forecast/index.ts`: importacao em massa de materiais previstos por projeto.
  - `get_project_activity_forecast_template/index.ts`: modelo XLSX de atividades previstas por projeto.
  - `import_project_activity_forecast/index.ts`: importacao em massa de atividades previstas por projeto.
- `src/types/`
  - `auth.ts`: tipos de usuario e sessao.
  - `xlsx.d.ts`: declaracao local para destravar type-check do pacote `xlsx`.
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
  - `Tela_Materiais_SaaS.txt`: tela de materiais com cadastro, filtros, historico e cancelamento/ativacao.
  - `Tela_Atividades_SaaS.txt`: tela de atividades com cadastro, filtros e listagem.
  - `Tela_Equipes_SaaS.txt`: tela de equipes com base, tipo, encarregado, historico e troca de status.
  - `Tela_Locacao_SaaS.txt`: tela de locacao com bootstrap por projeto, 4 blocos operacionais, materiais previstos e atividades previstas.
  - `Tela_Programacao_SaaS.txt`: tela de programacao com timeline operacional, backlog pendente, resumo semanal via RPC, catalogo proprio de apoio integrado com a locacao, validacao por RPC, adiamento/cancelamento persistente e modal de programacao.
  - `Tela_Programacao_Simples_SaaS.txt`: tela de cadastro simples de Programacao com submit em lote para multiplas equipes.
  - `Tela_Medicao_SaaS.txt`: documentacao da tela de Ordem de Medicao com cadastro, lista, importacao em massa e regras operacionais do modulo.
  - `Tela_Cargo_SaaS.txt`: placeholder do modulo de cargo.
  - `Tela_Cadastro_Base_SaaS.txt`: placeholders das telas de cadastro base por dominio.
  - `Tela_Padrao_Cadastros_SaaS.txt`: referencia obrigatoria de padrao visual/comportamental para telas de cadastro.
  - `Tela_Permissoes_SaaS.txt`: base da futura tela de permissao por pagina.
  - `Tela_Recuperacao_Senha_SaaS.txt`: recuperacao e definicao de senha.
- `.env`: variaveis locais do ambiente, ignoradas pelo Git.
- `.env.example`: variaveis de ambiente esperadas.
- `vercel.json`: identifica o projeto como `nextjs` no Vercel.
- `TASKS.md`: backlog do SaaS separado do app Android.
- `package.json`: scripts, dependencias e versao minima de Node.js.
- `tsconfig.json`: configuracao TypeScript.
- `eslint.config.mjs`: configuracao do lint.
- `supabase/migrations/077_create_admin_write_rpcs.sql`: RPCs transacionais para escrita de `Projetos`, `Materiais`, `Atividades`, `Equipes` e `Permissoes`.
- `supabase/migrations/078_create_programming_history_append_rpc.sql`: RPC para registrar o historico complementar da `Programacao` sem `insert` direto na route.
- `supabase/migrations/079_create_people_and_invite_write_rpcs.sql`: RPCs transacionais para escrita/status de `Pessoas` e para auditoria de `Invite`.
- `supabase/migrations/082_create_programming_batch_create_rpc.sql`: RPC transacional `save_project_programming_batch` para cadastrar Programacao em lote (multiplas equipes).
- `supabase/migrations/083_add_programacao_simples_page_permissions.sql`: backfill da nova pagina de `Programacao` (`page_key` `programacao-simples`) em `app_pages`, `role_page_permissions` e `app_user_page_permissions`.
- `supabase/migrations/084_deactivate_legacy_programacao_page.sql`: desativa a pagina legada `programacao` e bloqueia acesso nas tabelas de permissao.
- `supabase/migrations/085_add_programming_structure_fields_and_actions_support.sql`: adiciona colunas estruturais de quantidade em `project_programming` e atualiza RPCs para persistir esses campos.
- `supabase/migrations/086_add_service_activities_is_active_compat.sql`: cria compatibilidade entre `ativo` e `is_active` em `service_activities`, estabilizando as RPCs de Programacao em lote.

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
  16. A rota `/projetos` permite cadastrar, editar, cancelar/ativar e filtrar projetos no tenant atual usando as rotas `/api/projects` e `/api/projects/meta`, limitando `Projeto (SOB)` a `10` caracteres e mantendo a regra de formato por prioridade.
  - Em `Projetos`, `Materiais`, `Atividades`, `Equipes`, `Pessoas` e `Permissoes`, a escrita agora envia `expectedUpdatedAt`; se outro usuario salvar antes, o frontend recusa a sobrescrita e recarrega o estado atual.
  - A migration `077_create_admin_write_rpcs.sql` centraliza no banco as escritas administrativas desses modulos por meio das RPCs `save_project_record`, `set_project_record_status`, `save_material_record`, `set_material_record_status`, `save_service_activity_record`, `set_service_activity_record_status`, `save_team_record`, `set_team_record_status` e `save_user_permissions`.
 17. A aba `Materiais previstos` em `/projetos` permite selecionar projeto, pesquisar material ativo, incluir manualmente, editar quantidade/observacao na linha, baixar modelo XLSX via Edge Function `get_project_forecast_template`, importar previsao via Edge Function `import_project_forecast` (colunas `codigo` e `quantidade`) e filtrar/listar materiais previstos por codigo, descricao e tipo via `/api/projects/forecast`.
18. A aba `Atividades previstas` em `/projetos` permite selecionar projeto, pesquisar atividades ativas, incluir manualmente, editar quantidade/observacao na linha, baixar modelo XLSX via Edge Function `get_project_activity_forecast_template`, importar previsao via Edge Function `import_project_activity_forecast` (colunas `codigo` e `quantidade`) e exportar CSV via `/api/projects/activity-forecast`.
19. A rota `/locacao` exibe, antes da abertura, um bloco de filtros e uma lista resumida com status da locacao, responsavel, data de registro e acoes `Editar` e `Ver detalhes`.
20. Ao clicar em `Editar` ou em `Abrir locacao`, os blocos de filtro/lista previa ficam ocultos e a tela passa a trabalhar o projeto selecionado.
21. A aba principal da `Locacao` exige os radios obrigatorios, normaliza os campos numericos com `0` por padrao, exige `Observacoes` quando houver revisao de projeto ou desligamento, bloqueia salvar com todas as equipes zeradas ou com `ETAPAS PREVISTAS = 0` e salva observacoes, radios, quantidades, observacao da previsao, selecao de apoio de execucao e status dos riscos em um unico `Salvar locacao`.
22. Ao salvar a aba principal da `Locacao` com sucesso, o dashboard volta ao topo do conteudo para recolocar em destaque as abas operacionais da tela.
23. Na `Locacao`, as listas de apoio de execucao e riscos partem de todos os itens incluidos; o usuario so alterna `Remover`/`Incluir` e a persistencia acontece ao clicar em `Salvar locacao`.
24. As abas `Atividades previstas` e `Materiais previstos` nao usam auto-save: a inclusao persiste em `Adicionar ...` e a edicao persiste no botao `Salvar` de cada linha, com `expectedUpdatedAt` para evitar sobrescrita concorrente.
25. A base inicial de `Atividades previstas` da `Locacao` passa a ser seedada de `project_activity_forecast` quando existir previsao cadastrada no projeto e a lista da locacao ainda estiver vazia.
26. As quantidades de `Materiais previstos` e `Atividades previstas` ja contam com protecao estrutural no banco (`planned_qty > 0`) e agora passam tambem por RPC antes de inserir/editar, com limite superior de `100000`.
27. A migration `059_create_location_planning.sql` cria `project_location_plans`, `project_location_materials`, `project_location_activities` e o RPC `initialize_project_location_plan` para bootstrap do projeto na locacao.
28. A migration `060_add_project_has_locacao.sql` adiciona `project.has_locacao` para marcar projetos que ja passaram por salvamento real na tela `/locacao`.
29. As migrations `061_create_location_risks.sql` e `062_create_location_execution_support_items.sql` preparam as tabelas de riscos e de apoio de execucao consumidas pela aba principal da `Locacao`.
30. A migration `063_create_location_save_rpcs.sql` centraliza as regras finais de bloqueio e persistencia da `Locacao`, `Materiais previstos` e `Atividades previstas` no banco.
31. A migration `064_create_project_activity_forecast.sql` cria `project_activity_forecast`, a RPC `save_project_activity_forecast` e integra o bootstrap da `Locacao` com essa nova base.
32. A migration `065_project_forecast_manual_and_activity_import.sql` cria a RPC `save_project_material_forecast` e protege a importacao em massa de `Atividades previstas` por RPC.
33. A migration `066_harden_location_and_project_forecast_rpcs.sql` adiciona controle de concorrencia por `updated_at`, limites maximos e obrigatoriedade condicional de observacao nas RPCs de `Locacao` e dos previstos do projeto.
34. A rota `/materiais` permite cadastrar, editar, cancelar/ativar e filtrar materiais no tenant atual usando a rota `/api/materials`, com persistencia e historico delegados para as RPCs `save_material_record` e `set_material_record_status`.
35. A rota `/medicao` opera `Ordem de Medicao` com persistencia transacional via `/api/medicao`, lista paginada no servidor, modos `Com producao` e `Sem producao`, motivo estruturado por tenant para ordens sem producao, taxa unica por ordem reaplicada a todos os itens na edicao, match automatico opcional por `Projeto + Equipe + Data`, historico, exportacoes e cadastro em massa CSV com suporte aos dois tipos de ordem.
36. A rota `/atividades` permite cadastrar, editar, consultar detalhes/historico e cancelar/ativar atividades no tenant atual, exigindo apenas `codigo`, `descricao`, `valor` e `unidade`, usando `/api/activities` com listagem paginada no servidor e escrita delegada para as RPCs `save_service_activity_record` e `set_service_activity_record_status`.
37. A rota `/programacao` passa a usar `project_programming_history` como timeline operacional dedicada da agenda, com `REPROGRAMADA` salvo fisicamente em `project_programming` e historico de `CREATE/UPDATE/RESCHEDULE/BATCH_CREATE` gravado dentro das RPCs transacionais full, sem depender de `app_entity_history` nem de historico complementar pos-commit na API.
38. A rota `/pessoas` permite cadastrar, editar, consultar detalhes/historico e cancelar/ativar pessoas no tenant atual, usando `/api/people` com escrita delegada para as RPCs `save_person_record` e `set_person_record_status`.
39. A rota `/permissoes` continua enviando convite pelo backend, mas a auditoria do invite passa a ser gravada pela RPC `append_user_invite_history`.
40. A migration `050_activity_code_precheck_and_optional_fields.sql` torna `grupo/alcance` opcionais em `service_activities` e adiciona o RPC `precheck_activity_code_conflict` para bloquear codigo duplicado por tenant.
41. A migration `051_create_app_entity_history_and_activity_status.sql` cria `app_entity_history` (historico generico reutilizavel por outras telas) e adiciona em `service_activities` os campos de cancelamento/ativacao com motivo e data.
42. A migration `042_materials_price_status_and_history.sql` adiciona `unit_price`, status ativo/inativo e historicos de materiais, alem de remover `lp` e `serial` do cadastro base.
43. No cadastro de projetos, o campo `Parceira` e preenchido automaticamente no backend usando `contract.name` do tenant ativo.
44. A migration `029_create_project_table.sql` cria a tabela `project` com auditoria (`created_by`, `updated_by`, `created_at`, `updated_at`), RLS e indices de filtro; o fluxo operacional atual da tela usa apenas `Projeto (SOB)` e limita esse campo a `10` caracteres.
45. A migration `034_use_people_for_project_contractor_responsible.sql` remove o lookup dedicado de `Responsavel Contratada` e passa a usar `people` com cargo `SUPERVISOR`.
43. A migration `036_create_project_history_and_cancellation.sql` adiciona `project.is_active` e cria `project_history` e `project_cancellation_history` para registrar edicoes e cancelamentos.
44. A migration `037_project_activation_history_rules.sql` permite eventos de ativacao (`ACTIVATE`) e classifica cancelamento/ativacao em `project_cancellation_history.action_type`.
45. As migrations `032_create_contrato_table.sql` e `033_rename_contrato_to_contract.sql` criam a tabela de contrato por tenant e padronizam o nome final como `contract`, com coluna `name`, `valor` derivado do `tenant_id`, RLS e auditoria.
46. A migration `025_app_users_admin_tenant_select.sql` libera leitura de `app_users` do mesmo tenant apenas para perfis administrativos autenticados.
47. O shell agora reserva `/permissoes` para perfis administrativos e expoe esse acesso por uma engrenagem no topo, ao lado de `Sair`.
48. A tela `/permissoes` busca usuarios do tenant por `login_name` ou `matricula`.
49. Ao selecionar um usuario, o frontend carrega `role`, `status` e as telas liberadas em `app_user_page_permissions`.
50. Ao salvar, o backend valida o payload, chama a RPC `save_user_permissions` e deixa a transacao no banco atualizar `app_users.role_id`, `app_users.ativo`, `app_user_page_permissions` e `app_user_permission_history`.
51. Quando o pre-cadastro ja estiver completo em `app_users`, a tela `/permissoes` tambem permite enviar o invite do Supabase Auth para o email do usuario.
52. No login remoto e na reidratacao da sessao, o frontend consulta `/api/auth/session-access` para descobrir as telas realmente liberadas ao usuario.
53. O shell filtra a sidebar e protege as rotas com base em `pageAccess` quando existirem permissoes customizadas por usuario.
54. O link `Esqueci minha senha` usa o `login_name` digitado na tela de login e chama a Edge Function `auth-recover`.
55. O Supabase envia o email de recuperacao para o email vinculado ao `login_name`, usando `PASSWORD_REDIRECT_URL` apontando para o frontend publicado no Vercel.
56. A rota `src/app/(public)/recuperar-senha/page.tsx` valida `token_hash`, `code` ou tokens do Supabase e permite definir a nova senha.
57. O `AuthContext` renova os tokens remotos persistidos, reidrata `pageAccess`, encerra a sessao por inatividade e devolve o usuario ao login quando o token expira.
58. Quando a sessao expira por token vencido, o frontend ainda tenta registrar `LOGOUT` no `login_audit` usando o `session_ref` salvo.
59. A migration `040_reorganize_menu_sections_and_page_permissions.sql` reorganiza `app_pages` por secao e faz backfill das novas telas em `role_page_permissions` e `app_user_page_permissions`.
60. A migration `043_project_forecast_import_guards.sql` adiciona RPC de pre-check e RPC de append para bloquear codigos duplicados no arquivo e codigos ja importados no projeto.
61. A migration `045_create_tenants_and_user_tenant_access.sql` formaliza `tenants`, cria o vinculo `app_user_tenants` (usuario com multiplos contratos/tenants) e atualiza `user_can_access_tenant`.
62. As rotas API que usam `resolveAuthenticatedAppUser` passam a aceitar `x-tenant-id` para trocar o tenant ativo da requisicao, validando permissao no vinculo do usuario.

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
- `Falha ao salvar programacao em transacao unica.` ou `Falha ao cadastrar programacao em lote.`:
  - Causa: ambiente com RPC full da `Programacao` desatualizada ou ainda dependente da migration `090_add_programming_service_description.sql`.
  - Solucao: aplicar `091_create_programming_full_save_rpcs.sql`, `094_add_programming_stage_and_completion_fields.sql`, `095_harden_programming_time_and_document_validations.sql`, `099_harden_programming_batch_full_self_contained.sql`, `100_harden_programming_full_self_contained.sql` e `106_move_programming_save_history_into_full_rpcs.sql`.
- `A ETAPA informada ja existe ou esta abaixo do historico encontrado...`:
  - Causa: o usuario tentou salvar uma programacao com `ETAPA` igual ou menor do que etapas ja registradas para o mesmo projeto/equipe.
  - Solucao: fechar o modal de confronto/alerta, corrigir o campo `ETAPA` no formulario e salvar novamente com uma etapa coerente com o historico.
- `A ETAPA informada ja existe...` mostrando etapa menor do que a etapa atual da propria edicao:
  - Causa: a validacao tambem considera a etapa atual da programacao que esta sendo editada para impedir reducao silenciosa de etapa.
  - Solucao: ajustar o campo `ETAPA` para um valor coerente com a maior etapa ja encontrada para a obra/equipe e salvar novamente.
- Programacao adiada reaparece como `PROGRAMADA` em vez de `REPROGRAMADA`:
  - Causa: o banco ainda nao recebeu a migration que promove `REPROGRAMADA` a status fisico em `project_programming`.
  - Solucao: aplicar `101_create_project_programming_history.sql` e `102_use_programming_history_only_and_physical_rescheduled_status.sql`, recarregar a agenda e refazer a leitura da programacao.
- Historico da Programacao aparece misturado com outros modulos:
  - Causa: o ambiente ainda nao migrou a timeline operacional da `Programacao` para `project_programming_history`.
  - Solucao: aplicar `101_create_project_programming_history.sql` e `102_use_programming_history_only_and_physical_rescheduled_status.sql`; a `Programacao` passa a usar somente `project_programming_history` como fonte do historico operacional.
- `101_create_project_programming_history.sql` falha com FK de `programming_id` inexistente:
  - Causa: existem historicos legados orfaos em `app_entity_history` apontando para programacoes que ja nao existem mais em `project_programming`.
  - Solucao: usar a versao atualizada da migration `101`, que ignora esses registros orfaos no backfill e preserva apenas historicos com vinculo valido.
- `102_use_programming_history_only_and_physical_rescheduled_status.sql` ainda nao refletiu `REPROGRAMADA` na agenda:
  - Causa: a migration `102` nao foi aplicada ou a leitura da tela ainda esta cacheada com dados anteriores.
  - Solucao: aplicar a migration `102`, recarregar a pagina e confirmar no banco que `project_programming.status` passou a aceitar `REPROGRAMADA`.
- `Programacao` salva, mas o historico de cadastro/edicao/reprogramacao nao aparece em `project_programming_history`:
  - Causa: o ambiente ainda nao recebeu a migration que move o historico de `save` para dentro das RPCs full.
  - Solucao: aplicar `106_move_programming_save_history_into_full_rpcs.sql`; depois disso, `CREATE`, `UPDATE`, `RESCHEDULE` e `BATCH_CREATE` passam a ser registrados na mesma transacao do save principal.
- A programacao foi salva no banco, mas nao apareceu na lista da `Programacao Simples`:
  - Causa: o registro pode ter sido salvo fora dos filtros ativos de `Data`, `Projeto`, `Equipe` ou `Status`.
  - Solucao: revisar o feedback de sucesso da tela, que agora informa quando o item ficou fora do recorte filtrado, ou ajustar os filtros para incluir a nova `Data execucao`.
- `Projeto inativo nao pode ser editado.`:
  - Causa: tentativa de editar obra ja cancelada/inativada.
  - Solucao: editar somente projetos ativos ou criar novo projeto conforme processo operacional.
- `foi alterado por outro usuario. Recarregue os dados...`:
  - Causa: outro usuario salvou o mesmo registro antes do envio atual em `Projetos`, `Materiais`, `Atividades`, `Equipes`, `Pessoas` ou `Permissoes`.
  - Solucao: revisar os dados recarregados na tela e repetir a alteracao a partir da versao mais recente.
- Validacao do adiamento, cadastro ou edicao da `Programacao Simples` parece “nao fazer nada”:
  - Causa: o fluxo agora usa modal de alerta para concentrar erros de validacao e conflitos operacionais, alem do feedback no topo.
  - Solucao: revisar o modal aberto, corrigir os campos indicados e tentar novamente.
- O modal de `Adiamento` mostra apenas `Falha ao adiar programacao.`:
  - Causa: a RPC de adiamento falhou sem detalhe suficiente ou a visualizacao que roda depois do commit quebrou.
  - Solucao: aplicar `105_fix_postpone_history_signature.sql`; a RPC passa a usar a assinatura correta de `append_project_programming_history_record`, devolve `reason/detail` real da falha e o `PATCH` evita transformar falha de recarga da grade em erro falso.
- `function public.save_person_record(...) does not exist`, `set_person_record_status` ou `append_user_invite_history`:
  - Causa: migration `079_create_people_and_invite_write_rpcs.sql` ainda nao aplicada no banco remoto.
  - Solucao: aplicar a migration `079_create_people_and_invite_write_rpcs.sql` e repetir a operacao.
- `Projeto (SOB) deve ter no maximo 10 caracteres.`:
  - Causa: digitacao de mais de `10` caracteres no `SOB` no cadastro/edicao de projetos.
  - Solucao: manter o `SOB` em ate `10` caracteres e respeitar tambem a mascara exigida pela prioridade.
- `Projeto cancelado/ativado, mas falhou ao registrar historico...`:
  - Causa: migrations de historico de status nao aplicadas no banco remoto.
  - Solucao: aplicar `036_create_project_history_and_cancellation.sql` e `037_project_activation_history_rules.sql` e repetir a operacao.
- `Para esta prioridade, Projeto (SOB) deve iniciar ...` ou `Para FUSESAVER, Projeto (SOB) deve iniciar ...`:
  - Causa: `SOB` informado fora do formato exigido pela prioridade selecionada.
  - Solucao: aplicar o padrao: `A` + 9 numeros para prioridades de fluxo/DRP-DRC, ou `ZX/FS` + 8 numeros para `FUSESAVER`.
- `Falha ao carregar opcoes de projetos.`:
  - Causa: tabelas de dominio da tela `Projetos` nao existem no banco.
  - Solucao: aplicar a migration `031_create_project_lookup_tables.sql` e recarregar a pagina.
- `Projeto nao encontrado para inicializar a locacao.` ou `Locacao nao encontrada para o projeto.`:
  - Causa: projeto inexistente no tenant ativo ou migration da locacao nao aplicada.
  - Solucao: aplicar `059_create_location_planning.sql`, confirmar o tenant selecionado e recarregar a rota `/locacao`.
- `Projeto inativo nao pode ser carregado na locacao.` ou `Projeto inativo nao pode ser alterado na locacao.`:
  - Causa: a obra foi inativada em `Projetos` depois de ja existir locacao.
  - Solucao: reativar a obra em `/projetos` antes de voltar a operar a locacao, ou manter a locacao antiga apenas como historico.
- `Atividade ja adicionada no previsto deste projeto.`:
  - Causa: tentativa de incluir a mesma atividade duas vezes no previsto do projeto.
  - Solucao: editar a quantidade da linha existente em `Atividades previstas` em vez de inserir duplicado.
- `Material ja adicionado no previsto deste projeto.`:
  - Causa: tentativa de incluir o mesmo material duas vezes no previsto do projeto.
  - Solucao: editar a quantidade da linha existente em `Materiais previstos` em vez de inserir duplicado.
- `Importacao bloqueada: codigo ja importado anteriormente para este projeto.`:
  - Causa: a planilha de materiais ou atividades traz item que ja existe no previsto do projeto.
  - Solucao: editar a linha existente manualmente ou importar apenas codigos novos.
- `Importacao bloqueada: codigo duplicado dentro da planilha.`:
  - Causa: o mesmo `codigo` foi repetido na planilha XLSX de materiais ou atividades.
  - Solucao: consolidar a quantidade em uma unica linha por codigo antes de importar.
- `A quantidade do material previsto do projeto deve ser maior que zero.`:
  - Causa: tentativa de incluir ou editar material previsto do projeto com quantidade `0`, negativa ou invalida.
  - Solucao: informar quantidade maior que `0`; a validacao final e feita pela RPC `save_project_material_forecast`.
- `A quantidade da atividade prevista do projeto deve ser maior que zero.`:
  - Causa: tentativa de incluir ou editar atividade prevista do projeto com quantidade `0`, negativa ou invalida.
  - Solucao: informar quantidade maior que `0`; a validacao final e feita pela RPC `save_project_activity_forecast`.
- `Preencha os campos obrigatorios de Locacao antes de salvar.`:
  - Causa: os radios `Necessario revisao de projeto?` e/ou `Com desligamento?` nao foram definidos na aba principal da locacao.
  - Solucao: selecionar `Sim` ou `Nao` para os dois campos e salvar novamente.
- `As quantidades da locacao devem ser numericas e nao podem ser negativas.`:
  - Causa: envio manual de valor invalido ou negativo nos campos numericos da aba principal da locacao.
  - Solucao: usar apenas inteiros maiores ou iguais a `0`; a tela ja normaliza vazio para `0`.
- `Informe pelo menos uma equipe com quantidade maior que zero antes de salvar a locacao.`:
  - Causa: todos os campos de `Equipes para execucao` foram mantidos em `0`.
  - Solucao: informar valor maior que `0` em pelo menos uma equipe antes de salvar.
- `ETAPAS PREVISTAS deve ser maior que zero antes de salvar a locacao.`:
  - Causa: o campo `ETAPAS PREVISTAS` permaneceu em `0`.
  - Solucao: informar quantidade maior que `0` antes de salvar.
- `A quantidade do material previsto deve ser maior que zero.` ou `A quantidade da atividade prevista deve ser maior que zero.`:
  - Causa: tentativa de incluir ou editar item da locacao com quantidade negativa, zero ou invalida.
  - Solucao: informar quantidade maior que `0`; a API agora delega essa validacao para RPC e o banco ainda mantem `planned_qty > 0` como protecao estrutural.
- `Informe observacoes da locacao quando houver revisao de projeto ou desligamento.`:
  - Causa: `Necessario revisao de projeto?` ou `Com desligamento?` foi marcado como `Sim` sem preencher `Observacoes`.
  - Solucao: registrar uma justificativa em `Observacoes` antes de salvar.
- `Esta locacao foi alterada por outro usuario. Reabra o projeto antes de salvar.` ou `...foi alterado por outro usuario. Atualize a lista antes de salvar.`:
  - Causa: conflito de concorrencia por `updated_at` entre dois usuarios ou duas abas abertas.
  - Solucao: recarregar o projeto/lista e repetir a alteracao sobre a versao mais recente.
- A aba principal de `/locacao` nao exibe riscos ou apoio de execucao:
  - Causa: migrations auxiliares nao aplicadas no banco ou tabelas sem registros.
  - Solucao: aplicar `061_create_location_risks.sql` e `062_create_location_execution_support_items.sql` e cadastrar os itens necessarios.
- `Material ja adicionado na locacao deste projeto.` ou `Atividade ja adicionada na locacao deste projeto.`:
  - Causa: tentativa de incluir novamente o mesmo item na mesma locacao.
  - Solucao: editar a quantidade do item existente em vez de inserir duplicado.
- `Falha ao listar materiais.` ou `column materials.unit_price does not exist`:
  - Causa: migration de materiais ainda nao aplicada no banco remoto.
  - Solucao: aplicar `042_materials_price_status_and_history.sql` antes de usar a tela `/materiais`.
- `function public.save_project_record(...) does not exist`, `save_material_record`, `save_service_activity_record`, `save_team_record` ou `save_user_permissions`:
  - Causa: migration `077_create_admin_write_rpcs.sql` ainda nao aplicada no banco remoto.
  - Solucao: aplicar a migration `077_create_admin_write_rpcs.sql` e repetir a operacao.
- `Ative a atividade antes de editar.`:
  - Causa: tentativa de editar atividade com status inativo.
  - Solucao: usar a acao `Ativar` na lista de atividades e depois editar.
- `Informe o motivo do cancelamento.` ou `Informe o motivo da ativacao.`:
  - Causa: tentativa de alterar status sem preencher motivo.
  - Solucao: informar motivo no modal de `Cancelar/Ativar`.
- `Falha ao carregar historico da atividade.`:
  - Causa: migration de historico generico nao aplicada no banco remoto.
  - Solucao: aplicar `051_create_app_entity_history_and_activity_status.sql` e recarregar a tela `/atividades`.
- `Ja existe atividade com este codigo no tenant atual.`:
  - Causa: tentativa de cadastrar/editar `codigo` ja existente no mesmo tenant.
  - Solucao: informar outro `codigo` ou editar o registro ja existente.
- `Ative o material antes de editar.`:
  - Causa: tentativa de editar material inativo.
  - Solucao: ativar o material na acao `Ativar` e refazer a edicao.
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
- `FATAL: An unexpected Turbopack error occurred` com panic de escrita em `.next/dev/...` e `os error 1224`:
  - Causa: arquivo de chunk bloqueado no Windows durante o modo dev com Turbopack.
  - Solucao: usar `npm run dev` (agora com `webpack`), encerrar processos Node antigos e remover `.next/dev` antes de reiniciar o ambiente. Usar `npm run dev:turbopack` apenas quando precisar depurar especificamente com Turbopack.
- `Sua sessao expirou. Entre novamente.`:
  - Causa: token remoto invalido/expirado durante a reidratacao ou no ciclo de autenticacao do Supabase.
  - Solucao: entrar novamente e revisar a configuracao do projeto Supabase se o problema for recorrente.
- `Permissoes` nao aparece no menu:
  - Causa: a tela nao faz parte da navegacao principal e so aparece como engrenagem no topo para perfis administrativos.
  - Solucao: revisar `app_users.role_id` vinculado a `app_roles` e usar um perfil administrativo (`admin` ou `master`) quando o acesso precisar ser liberado.
- `Usuario logou, mas continua vendo telas bloqueadas na configuracao de permissoes`:
  - Causa: a sessao local foi criada antes da leitura de `app_user_page_permissions` ou o frontend ainda nao reidratou `pageAccess`.
  - Solucao: entrar novamente apos salvar as permissoes e confirmar que `/api/auth/session-access` retorna `pageAccess` com as telas liberadas.
- `As credenciais do usuario ... foram alteradas por outro administrador.`:
  - Causa: dois administradores editaram `role`, `status` ou a matriz de paginas do mesmo usuario ao mesmo tempo.
  - Solucao: aguardar a tela recarregar os dados atuais do usuario e repetir a alteracao desejada.
- `Falha ao enviar convite do usuario.`:
  - Causa: usuario sem email, sem `matricula`, sem `login_name` ou ja vinculado ao Auth do Supabase.
  - Solucao: revisar o pre-cadastro em `app_users` antes de usar o botao `Enviar convite` na tela `/permissoes`.
- `Usuario autenticado nao enxerga dados do tenant.`:
  - Causa: `app_users.auth_user_id` nao vinculado ao `auth.users`, `tenant_id` divergente ou usuario com `ativo = false`.
  - Solucao: revisar o vinculo em `app_users`, aplicar as migrations `020_harden_rls_auth_uid_active.sql` e `021_rls_to_authenticated.sql` e confirmar o tenant correto do usuario.
- `Tenant nao permitido para o usuario autenticado.`:
  - Causa: envio de `x-tenant-id` sem vinculo ativo em `app_user_tenants`.
  - Solucao: aplicar a migration `045_create_tenants_and_user_tenant_access.sql`, conferir backfill e liberar o tenant para o usuario em `app_user_tenants`.
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
