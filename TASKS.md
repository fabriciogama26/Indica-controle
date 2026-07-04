- [x] [Medicao][Feature] Trocar o filtro padrao de `Data inicial`/`Data final` de ano inteiro para mes corrente (`monthRange` substitui `yearRange` em `MeasurementPageView.tsx`), aplicado tanto no carregamento inicial quanto no botao `Limpar`. Usuario continua podendo digitar qualquer intervalo manualmente. Testado no navegador e aprovado pelo usuario. Doc atualizada em `docs/Tela_Medicao_SaaS.txt`.
- [x] [UI][Refactor] Fase 1 (PR7 - piloto) do plano de paginacao/exportacao: migrar Equipes (`TeamsPageView.tsx`) e Medicao (`MeasurementPageView.tsx`) para `usePagination`/`Pagination` compartilhados, reaproveitando o CSS Module de cada tela via `className`/`actionsClassName`/`buttonClassName` (sem alterar nenhum `.module.css`). Testado no navegador e aprovado pelo usuario nas duas telas antes de replicar para as demais.
- [x] [UI][Refactor] Fase 1 (PR6) do plano de paginacao/exportacao: criar `usePagination` (`src/hooks/usePagination.ts`) e `Pagination` (`src/components/ui/Pagination.tsx` + CSS Module proprio), com `className`/`actionsClassName`/`buttonClassName` injetaveis para a migracao (PR7) reaproveitar exatamente o CSS Module de cada tela sem regressao visual. Nenhuma tela migrada ainda; PR autocontido, sem uso ainda no app.
- [x] [Exportacao][Fix] Fase 0 (PR5) do plano de paginacao/exportacao: corrigir rotulo "Exportar Excel" para "Exportar CSV" nos 2 botoes de dispersao do Dash Estoque (`StockDashboardPageView`), unico caso real de rotulo visivel ao usuario prometendo Excel enquanto gera `.csv` (decisao de produto confirmada com o usuario). Verificado que Programacao Simples ("Extracao ENEL"/"Extracao ENEL NOVO") e as demais telas com "(CSV)" no rotulo ja estao corretas; nao precisaram de mudanca.
- [x] [Exportacao][Refactor] Fase 0 (PR4) do plano de paginacao/exportacao: substituir o cooldown de exportacao reimplementado manualmente (`lastExportAt` + `Date.now() - lastExportAt < 10_000`) em `DashboardTeamsPageView` por `useExportCooldown` compartilhado (`src/hooks/useExportCooldown.ts`), mantendo um unico cooldown compartilhado entre os dois exports da tela (projetos e contribuicoes por equipe), igual ao comportamento anterior.
- [x] [Exportacao][Refactor] Fase 0 (PR3) do plano de paginacao/exportacao: remover reimplementacoes locais de escape/BOM/download de CSV e usar `src/lib/utils/csv.ts` (`buildCsvContent`/`downloadCsvFile`) em `ProjectConsumptionPageView`, `DashboardMeasurementPageView`, `TeamStockPageView` (via `estoque-equipes/utils.ts`) e `TrafoPositionPageView` (via `posicao-trafo/utils.ts`). `AprControlPageView` (Controle APR) foi verificado e nao precisa de mudanca: gera `.xlsx` real via SheetJS, sem escape/CSV manual.
- [x] [Performance][Refactor] Fase 0 (PR2) do plano de paginacao/exportacao: adotar `parsePagination` em todas as rotas que reimplementavam localmente o parsing de `page`/`pageSize` (`composicao-equipe`, `estornos`, `job-titles`, `controle-apr`, `faturamento`, `medicao`, `medicao-asbuilt`, `stock-balance`, `trafo-positions`, `team-stock-balance`, `team-stock-operations`, `materials`, `projects`), removendo as funcoes locais `normalizePositiveInteger`/`parsePositiveInteger` duplicadas. Mantidas de proposito as reimplementacoes de `parsePositiveInteger` usadas para `historyPage`/`historyPageSize` (nomes de parametro que `parsePagination` nao cobre) em `composicao-equipe`, `job-titles` e `materials`.
- [x] [Performance][Refactor] Fase 0 (PR1) do plano de paginacao/exportacao: estender `parsePagination` (`src/lib/server/apiHelpers.ts`) com `options { defaultPageSize, maxPageSize, maxPage }` no lugar de argumentos posicionais, preparando o helper para receber rotas com limites divergentes (ex.: Medicao) sem quebrar `teams`/`people`/`activities`.
- [x] [UI][Exportacao] Padronizar o modal de geracao em todos os botoes de exportacao: `ExportProgressModal` compartilhado, `CsvExportButton` com modal integrado e cobertura das exportacoes locais em Medicao, dashboards, cadastros, Mapa de Programacao, Projetos, Faturamento, Asbuilt, APR, Consumo, Estornos e Apuracao.
- [x] [Performance][Medicao] Iniciar exportacao server-side: criar `GET /api/medicao/export` para CSV de lista, detalhamento e pontuacao com permissao `medicao/export`, e alterar os botoes da tela para baixar o arquivo sem montar o CSV no navegador.
- [x] [Programacao] Criar transferencia de equipe entre programacoes: status interno de linha `TRANSFERIDA`, RPC transacional `transfer_project_programming_team`, acao `Transferir equipe` na Programacao Simples, historico `TRANSFER_TEAM`, rastreio no Mapa de Programacao com exportacao CSV e exclusao de `TRANSFERIDA` das extracoes ENEL.
- [x] [Programacao][Permissoes] Corrigir GETs compartilhados da Visualizacao Programacao para aceitar `programacao-visualizacao/read` ou `programacao-simples/read`, mantendo `POST`/`PUT`/`PATCH` restritos a `programacao-simples` e documentando a regra nas telas.
- [x] [MedicaoAsbuilt] Corrigir regressao da migration 259 na importacao em massa: migration 285 recompila `save_project_asbuilt_measurement_order_batch_partial` para repassar `serviceCoverageEndDate` ao salvar cada ordem Asbuilt, preservando limite de 500 registros.
- [x] [MedicaoAsbuilt] Padronizar cadastro em massa com Medicao/Faturamento: CSV aceita `;` ou `,` com aspas, aliases de cabecalho, limite de 5MB, modal atualizado com `servicos_considerados_ate` e erro server-side por coluna quando faltar data de corte.
- [x] [MedicaoAsbuilt] Remover modal de confirmacao do botao `Fechar`: a acao agora altera para `FECHADA` diretamente pela listagem, mantendo modal com motivo para `Abrir` e `Cancelar`; documentado em `docs/Tela_Medicao_Asbuilt_SaaS.txt`.
- [x] [P0.10][Programacao] Limpar e bloquear `Estado Trabalho` em programacoes `ADIADA`/`CANCELADA`: migration 284 remove `work_completion_status` e `work_completion_status_id` de linhas interrompidas com historico, recria a guarda para limpar automaticamente novos preenchimentos e preserva o bloqueio de adiamento/cancelamento quando o projeto ou a linha esta `CONCLUIDO`.
- [x] [P0.9][Programacao] Permitir `Estado Trabalho = CONCLUIDO` em todas as equipes ativas do mesmo `programming_group_id`: migration 283 remove o indice unico global por projeto, serializa conclusoes por tenant/projeto com advisory lock, bloqueia CONCLUIDO em outro grupo operacional ativo do mesmo projeto e volta a sincronizar CONCLUIDO dentro do grupo com historico.
- [x] [Programacao] Ajustar `Extracao ENEL NOVO`: `STATUS` passa a exportar `REPROGRAMADO` para programacoes reprogramadas via mapeamento central, e coluna `km` passa a ser celula numerica no XLSB, convertendo REDE com virgula ou ponto.
- [x] [Performance][Programacao] Split do GET /api/programacao: parallelizar supportDefaults+activities+rescheduleHistory+userMap em um unico Promise.all; novo endpoint /api/programacao/meta para catalogos (projects, teams, sgdTypes, eqCatalog, reasonOptions, workCompletionCatalog); frontend chama meta e schedules em paralelo; .limit(500) em fetchRescheduledProgrammingIds.
- [x] [Performance][MedicaoAsbuilt] P4: paginacao real no banco no GET de listagem (count+range, allIdsQuery paralelo para summary global, aggregate via chunk, userMap da pagina); .limit(50) em loadHistory.
- [x] [Performance][Medicao] P1-A: unificar paginacao real no banco para todos os filtros — remover caminho legado `fetchPagedSupabaseRows` que carregava todas as ordens em memoria; `activityId` vira filtro nativo (pre-resolucao de IDs); `programmingMatch`/`workCompletionStatus`/`completionAlert` viram pos-filtros leves na pagina; dados auxiliares carregados apenas para IDs da pagina atual.
- [ ] [Segurança] Habilitar Leaked Password Protection manualmente no Dashboard Supabase (Authentication > Settings) — nao pode ser feito por migration.
- [x] [P0.8b][Programacao] Corrigir falso bloqueio de integridade CONCLUIDO ao editar qualquer campo em linha com Estado Trabalho vazio (NULL): migration 282 corrige armadilha de boolean NULL em PL/pgSQL — expressao `NULL OR NULL OR NULL` avalia para NULL (nao FALSE), impedindo o early-return do trigger e disparando exception incorreta. Fix: `COALESCE(..., false)` em todas as atribuicoes booleanas do trigger. Causa raiz documentada em `docs/arquitetura/plpgsql-null-boolean-armadilha.md`. Script diagnostico usado: `scripts/debug-trigger-capture-281.sql`.
- [x] [P0.8a][Programacao] Corrigir Bypass 2 do trigger de integridade CONCLUIDO para comparar codigo canonico resolvido em vez de valores brutos UUID (migration 281): `work_completion_status_id` podia ser preenchido de NULL para UUID pelo trigger de sync durante o UPDATE, fazendo `old.uuid != new.uuid` quebrar o bypass mesmo sem mudanca real de estado.
- [x] [P0.8][Programacao] Corrigir falso bloqueio de integridade CONCLUIDO ao REPROGRAMAR para nova data: migration 280 adiciona bypass quando work_completion_status nao mudou (herdado do OLD) mas programming_group_id foi recalculado pelo trigger 273 para o novo grupo. Script de diagnostico: `scripts/audit-completed-group-reprogram-280-readonly.sql`.
- [x] [Segurança] Corrigir alertas do Supabase Advisor via migration 278: fix `search_path` de `normalize_minimum_billing_token`, revogar `anon` de `save_project_billing_order` e `user_has_page_action`, adicionar validacao de chamador por `auth.uid()` em `save_project_billing_order`, e guard de admin em `save_user_permissions`. Pendente manual: habilitar Leaked Password Protection no Dashboard Supabase.
- [x] [P0.7][Programacao] Normalizar `PARCIAL` legado para `PARCIAL_NAO_PLANEJADO`, manter catalogo ativo apenas com estados canonicos, sincronizar Estado Trabalho por `programming_group_id` sem propagar `CONCLUIDO`/`ANTECIPADO`, bloquear `CONCLUIDO` quando houver outra linha ativa no mesmo grupo, ajustar ENEL NOVO para `ANTECIPADA` e dar cor/legenda propria no calendario (migration 277).
- [x] [P0.6][Programacao] Corrigir revalidacao de `ANTECIPADO` ao reabrir `CONCLUIDO`, sanear duplicados legados, forcar constraints diferidas antes do indice unico, garantir um unico `CONCLUIDO` ativo por projeto, encerrar `ANTECIPADO` como `ANTECIPADA` para liberar agenda, bloquear copia para data anterior/igual com patch idempotente da RPC, remover excecao de copia em projeto concluido e blindar `programming_group_id` contra alteracao direta (migration 276).
- [ ] [P1][Programacao] Permitir encerramento formal do projeto por `ETAPA UNICA` e `ETAPA FINAL`, definindo quando marca ou nao etapas futuras como `ANTECIPADO`.
- [ ] [P1][Programacao] Validar no backend e banco a coexistencia entre `ETAPA UNICA`, `ETAPA FINAL` e etapas numericas ativas do mesmo projeto.
- [ ] [P1][Programacao] Criar escolha explicita de escopo ao editar Data, Projeto ou ETAPA de uma linha com varias equipes no mesmo `programming_group_id`.
- [ ] [P1][Programacao] Validar concorrencia de todas as linhas afetadas em operacoes de grupo: adiar, cancelar, sincronizar campos e reprogramar grupo inteiro.
- [ ] [P2][Programacao] Fechar regra documental para SGD, PI e PEP em copia, adiamento e reprogramacao, incluindo flag de revisao quando Data, Horario, N EQ, Tipo de SGD ou Projeto mudarem.
- [x] [Arquitetura] Estudo tecnico completo de tenant, autenticacao, contrato e RLS: mapeamento do modelo atual (usuario, tenant, contrato 1:1, RLS, permissoes), classificacao de tabelas por escopo (global/operacional/indefinido), proposta de arquitetura futura para N contratos por tenant com `app_user_contracts`, `user_can_access_scope()`, header `x-contract-id` e fases A-J documentadas. Gerados: `docs/arquitetura/acesso-por-tenant-e-contrato-estudo.md` e `docs/arquitetura/acesso-por-tenant-e-contrato-plano-futuro.md`. Atualizados: estudo de regras configuraveis, plano de regras, inventario e pre-implantacao. Nenhuma migration ou codigo funcional alterado.
- [x] [P0.5][Programacao] Fechar integridade de ETAPA ativa no banco: migration 275 endurece a constraint trigger diferida para aceitar exatamente uma classificacao (`etapa_number > 0` sem flags, `ETAPA UNICA` ou `ETAPA FINAL`) e bloquear escrita direta/RPC/importacao/edicao com combinacoes invalidas.
- [x] [P0.4][Programacao] Tornar `COPY_TO_DATES` 100% transacional: migration 274 recria `copy_project_programming_to_dates` com `teamIds` por destino, valida o lote inteiro no banco e garante que conflito em uma unica equipe nao cria nenhuma linha nova nem lote parcial.
- [x] Definir grupo operacional persistido da Programacao com `programming_group_id`: auditoria read-only de Projeto + Data com multiplas ETAPAs, migration 273 com backfill por ETAPA numerica/UNICA/FINAL/grupo proprio, cancelamento/adiamento/sincronizacao operacional por grupo e duplicidade de adicionar equipe dentro do mesmo grupo.
- [x] Sincronizar campos operacionais da Programacao ao editar uma linha, replicando Alimentador, Nº EQ, Tipo de SGD, clientes afetados, desligamento, Apoio e quantidades para equipes ativas do mesmo Projeto + Data via RPC transacional com historico.
- [x] Proteger a edicao da Programacao contra perda de atividades quando o snapshot carregar incompleto, com bloqueio no frontend, botao de recarregar no modal e rejeicao defensiva no backend (`PROGRAMMING_ACTIVITIES_NOT_LOADED`).
- [x] Adicionar acao `Fazer medicao` na Composicao de Equipe, abrindo a Medicao com cabecalho pre-preenchido por projeto, equipe e data da composicao.
- [x] Exibir o nome do encarregado no modal `Detalhes da Programacao` da Programacao Simples/Visualizacao usando os dados de equipe ja carregados no payload.
- [x] Permitir mais de um projeto por Composicao de Equipe, criando `team_composition_projects`, atualizando a RPC `save_team_composition_record`, API, formulario, listagem, detalhes, CSVs e documentacao da tela.
- [x] Corrigir cadastro individual e cadastro em massa de Faturamento para schema legado de producao em `project_billing_order_items`, adicionando colunas atuais via migration `263`, destravando `paid_value` legado via `263/264/265`, fallback de detalhe/edicao, registro detalhado de erros, texto do modal e docs da tela.
- [x] Estruturar o frontend do SaaS em `SaaS (Web)/` com Next.js 16, React 19, TypeScript e App Router.
- [x] Ampliar auditoria read-only de `Estado Trabalho` da Programacao para cobrir catalogo, brancos ativos, divergencia por Projeto + Data, copia/adicao/reprogramacao, etapa obrigatoria, regra `CONCLUIDO -> ANTECIPADO`, resumo agrupado por status/sugestao, brancos sem sugestao automatica e programacoes com projeto nao encontrado.
- [x] Criar migration de backfill automatico para preencher `Estado Trabalho` em branco da Programacao com sugestao segura da auditoria, mantendo casos operacionais fora da correcao automatica.
- [x] Criar migration complementar para preencher `Estado Trabalho` em branco de Programacoes `ADIADA` e `CANCELADA`, mantendo o status operacional original e registrando historico.
- [x] Criar SQL read-only de auditoria para Estado Trabalho em branco na Programacao, com resumo por tenant/status/projeto, detalhe com causa provavel e sugestao de preenchimento sem alterar dados.
- [x] Padronizar Estado Trabalho antecipado como `ANTECIPADO`, migrando referencias antigas de `ANTECIPADA`, desativando o catalogo legado e mantendo auditoria para localizar duplicidades visuais.
- [x] Adicionar regra de Estado Trabalho `ANTECIPADO` na Programacao Simples: ao salvar uma etapa como `CONCLUIDO`, a propria etapa permanece `CONCLUIDO` e as etapas ativas posteriores do mesmo projeto (`etapa_number` maior) sao atualizadas para `ANTECIPADO` via RPC com historico.
- [x] Criar acao `Adicionar equipe` na Programacao Simples para incluir nova equipe em uma programacao ativa existente, copiando a linha modelo sem substituir a equipe original.
- [x] Ajustar o `Adiar` da Programacao Simples para operar por `Projeto + Data`: criado `postpone_project_programming_group`, `PATCH /api/programacao` passa a adiar todas as equipes ativas do mesmo projeto/data em uma unica transacao, com rollback total se qualquer linha falhar.
- [x] Corrigir `COPY_TO_DATES` da Programacao Simples com selecao de equipes para herdar o ultimo `Estado Trabalho` valido do projeto, usando `PARCIAL` como fallback quando nao houver historico valido.
- [x] Adicionar cancelamento por escopo na Programacao Simples: modal permite cancelar somente a equipe clicada ou todas as equipes ativas do mesmo Projeto + Data via RPC transacional `cancel_project_programming_group`.
- [x] Preencher rastreio estruturado no `COPY_TO_DATES` usando `project_programming.copied_from_programming_id` existente, gravado dentro da RPC full para vincular origem -> copia sem criar coluna duplicada.
- [x] Implementar login web com `login_name`, suporte a modo local (`/api/auth/local-login`) e modo remoto (`auth-login-web`).
- [x] Implementar persistencia/hidratacao de sessao no frontend com `AuthContext` e Supabase Auth.
- [x] Reforcar o fluxo de `login_audit` para registrar entrada e saida do SaaS web como eventos imutaveis em duas linhas.
- [x] Adicionar observabilidade no `auth-login-web` para expor detalhes da falha de auditoria nos logs da Edge Function.
- [x] Isolar o client administrativo da `auth-login-web` para impedir que o insert em `login_audit` caia no RLS depois do `signInWithPassword`.
- [x] Endurecer RLS multi-tenant com base em `auth.uid()` e `app_users.ativo = true`.
- [x] Restringir as policies multi-tenant ao role `authenticated`.
- [x] Revisar RLS de cadastros/permissoes para remover `FOR ALL` e `DELETE`, padronizando escrita em `INSERT` e `UPDATE` (migration `058_enforce_rls_no_all_no_delete.sql`).
- [x] Implementar shell principal protegido, navegacao lateral e Home inicial.
- [x] Reorganizar o layout principal para o padrao de sidebar fixa, barra superior horizontal e bloco do usuario no topo direito.
- [x] Ajustar o shell para scroll interno no conteudo das telas (`mainContent`), mantendo sidebar e topbar fixos no desktop.
- [x] Ajustar bloco `Conectado` para exibir o nome a partir de `app_users.display`.
- [x] Criar placeholders iniciais para `Cadastro Base`, `Pessoas`, `Materiais`, `Entrada`, `Saida` e `Estoque Atual`.
- [x] Expandir a navegacao de `Operacao` com `Projetos`, `Locacao`, `Programacao` e mover `Materiais` para a mesma secao.
- [x] Criar placeholders iniciais para `Projetos`, `Locacao` e `Programacao` no dashboard.
- [x] Reorganizar a navegacao lateral em `Visao Geral`, `Operacao`, `Almoxarifado`, `Cadastros` e `Cadastro Base`.
- [x] Criar placeholders iniciais para `Medicao`, `Cargo` e telas de `Cadastro Base` (`Prioridade`, `Centro de Servico`, `Contrato`, `Imei`, `Tipo de Servico`, `Nivel de Tensao`, `Porte`, `Responsavel Distribuidora`, `Municipio`).
- [x] Atualizar matriz de permissao por pagina (frontend + migration `040_reorganize_menu_sections_and_page_permissions.sql`) para o novo menu.
- [x] Implementar tela de `Projetos` com cadastro, filtros e listagem em colunas integrada a `/api/projects`.
- [x] Criar migration `029_create_project_table.sql` com auditoria (`created_by`, `updated_by`, `created_at`, `updated_at`) para persistencia de projetos.
- [x] Ajustar a tela de `Projetos` removendo a legenda redundante de campos no topo.
- [x] Ajustar a tela de `Projetos` removendo o bloco de titulo interno acima de `Cadastro de Projeto`.
- [x] Padronizar marcador `*` de campo obrigatorio em vermelho (`.requiredMark`) na tela de `Projetos`.
- [x] Renomear o campo `Data limite da execucao` para `Data limite` na tela de `Projetos`.
- [x] Atualizar lista de `Projetos` removendo coluna `Parceira` e adicionando coluna `Acoes` com botoes de operacao.
- [x] Reordenar lista de `Projetos` para exibir `Atualizado em` antes da coluna `Acoes`.
- [x] Atualizar lista de `Projetos` para exibir `Registrado em` no lugar de `Atualizado em`.
- [x] Atualizar lista de `Projetos` removendo colunas `Prioridade` e `Responsavel Contratada` e adicionando `Registrado por`.
- [x] Ajustar `Registrado por` da lista de `Projetos` para exibir `app_users.login_name`.
- [x] Adicionar botao de exportacao `Exportar Excel (CSV)` na lista de `Projetos` com base nos filtros ativos.
- [x] Adicionar bloco `Status da Carteira de Projetos` no topo da tela de `Projetos` com 2 cards (`Total de projetos` e `Concluidas`) e resumo agregado por filtros no `GET /api/projects`, contando apenas projetos ativos por `SOB` unico e `Concluidas` baseado em `Estado Trabalho = CONCLUIDO` na programacao.
- [x] Adicionar no cadastro de `Projetos` o marcador `Obra de teste`, com persistencia em `project.is_test`, tag visual na lista/detalhes e exclusao dessa obra dos cards de carteira.
- [x] Adicionar no cadastro de `Projetos` o marcador `RETIRADO DA CARTEIRA`, com persistencia em `project.is_withdrawn`, tag visual na lista/detalhes e exclusao dessa obra dos cards de carteira.
- [x] Adicionar filtro de `Status` na tela de `Projetos` com opcoes `Cancelado`, `Ativo` e `Concluido`.
- [x] Adicionar filtro de `Status` na tela de `Atividades` com opcoes `Todos`, `Ativo` e `Inativo`, com suporte correspondente no `GET /api/activities`.
- [x] Desabilitar cache nas chamadas autenticadas de `Projetos` para evitar dados antigos apos troca de sessao.
- [x] Aplicar regra de SOB por prioridade em `Projetos` (frontend + API + constraint SQL).
- [x] Mover `Prioridade` para antes de `Projeto (SOB)` no formulario de cadastro.
- [x] Criar tabelas de dominio de `Projetos` por tenant e fazer a tela puxar opcoes dessas tabelas.
- [x] Refatorar `project` para armazenar somente UUID nos campos de dominio e expor labels por `view` (`project_with_labels`).
- [x] Bloquear edicao de `Projeto (SOB)` ate selecionar `Prioridade` no cadastro de `Projetos`.
- [x] Criar tabela `contrato` por tenant com `valor` derivado do `tenant_id`, RLS e auditoria.
- [x] Incluir coluna `name` na tabela `contrato` com backfill para tenants existentes.
- [x] Renomear a tabela `contrato` para `contract` com ajuste de index/policies/trigger.
- [x] Remover lookup de `Responsavel Contratada` em projetos e usar `people` filtrado por cargo `SUPERVISOR`.
- [x] Reordenar campos de endereco em `Projetos` para `Municipio`, `Logradouro`, `Bairro` e reforcar fallback das selectboxes no `/api/projects/meta`.
- [x] Adicionar coluna `matriculation` na tabela `people` via migration versionada.
- [x] Remover campo `Parceira` do front de Projetos e preencher `partner` automaticamente no backend por `contract.name`.
- [x] Implementar acoes da lista de Projetos (`Editar`, `Detalhes`, `Historico`, `Cancelar`) com modais e fluxo completo no frontend.
- [x] Implementar `PUT` e `PATCH` em `/api/projects` para edicao e troca de status (cancelamento/ativacao) com motivo obrigatorio.
- [x] Endurecer `Projetos` com controle de concorrencia por `expectedUpdatedAt` no `PUT` e no `PATCH`, bloqueando sobrescrita silenciosa e troca de status com registro stale.
- [x] Corrigir falso conflito de concorrencia em `Projetos` ao comparar `updated_at` por instante (epoch), destravando `Salvar alteracoes` quando o timestamp eh equivalente em formato diferente.
- [x] Ajustar `saveProjectViaRpc` para fallback de compatibilidade sem `p_fob` e retorno detalhado de erro, evitando `500` generico em `Salvar alteracoes`.
- [x] Adicionar migration de compatibilidade `jsonb_object_length(jsonb)` para evitar falha de RPC em ambientes Postgres sem essa funcao nativa.
- [x] Migrar as escritas de `Projetos` para RPC transacional (`save_project_record` e `set_project_record_status`) para consolidar update + historico + concorrencia no banco.
- [x] Criar migration `036_create_project_history_and_cancellation.sql` com `project.is_active`, `project_history` e `project_cancellation_history`.
- [x] Remover `FOB` do fluxo operacional de `Projetos` e limitar `Projeto (SOB)` a `10` caracteres no frontend e na API.
- [x] Remover na tela/API de `Projetos` a regra de formato por prioridade e o limite de `10` caracteres do campo `Projeto (SOB)`, com migration para retirar a constraint `chk_project_sob_priority_format`.
- [x] Paginar o modal de `Historico` de Projetos e exibir `ID do projeto` abaixo do titulo no modal de detalhes.
- [x] Implementar reativacao de projeto pelo botao `Ativar` (no lugar de `Cancelar` quando inativo) com motivo obrigatorio e historico.
- [x] Criar base de `Materiais previstos` por projeto com migration `041_create_project_material_forecast.sql` (RLS, auditoria e constraint unica por material no projeto).
- [x] Implementar API `/api/projects/forecast` para listagem de previsao por projeto.
- [x] Implementar aba `Materiais previstos` em `Projetos` com acao na lista, modal de importacao em massa e download de modelo.
- [x] Ajustar aba `Materiais previstos` para exibir filtros e lista de materiais proprios da aba (ocultando filtros/lista de projetos quando ativa).
- [x] Ajustar modelo de importacao de `Materiais previstos` para aceitar somente `codigo` e `quantidade`, usando descricao/umb/tipo do cadastro base `materials`.
- [x] Implementar Edge Functions `get_project_forecast_template` e `import_project_forecast` para download/importacao de previstos no fluxo da tela.
- [x] Criar migration `043_project_forecast_import_guards.sql` com RPC de pre-check e append para bloquear codigos duplicados e codigos ja importados.
- [x] Evoluir `materials` com `preco`, `status ativo`, `cancelamento/ativacao` e historico via migration `042_materials_price_status_and_history.sql`.
- [x] Implementar tela `Materiais` no padrao de `Projetos`, com cadastro, filtros, listagem paginada e acoes `Editar`, `Historico` e `Cancelar/Ativar`.
- [x] Destacar modo de edicao em `Projetos` e `Materiais` com borda amarela no bloco de cadastro e rolagem para o topo ao clicar em `Editar`.
- [x] Corrigir rolagem para topo de `Editar` em `Projetos` e `Materiais` para usar o container de scroll interno do dashboard.
- [x] Ajustar selecao de projeto em `Materiais previstos` para campo de texto com sugestao (datalist), no padrao digitavel.
- [x] Implementar API `/api/materials` com `GET` (lista/historico), `POST`, `PUT` e `PATCH`.
- [x] Proteger cadastro/edicao de materiais com RPC `precheck_material_code_conflict` para bloquear codigo duplicado por tenant.
- [x] Endurecer `Materiais` com controle de concorrencia por `expectedUpdatedAt` na edicao e no cancelamento/ativacao, com recarga do estado atual no frontend.
- [x] Migrar as escritas de `Materiais` para RPC transacional (`save_material_record` e `set_material_record_status`) para consolidar update + historico + concorrencia no banco.
- [x] Formalizar `tenant` como entidade (`tenants`) e vinculo de acesso multi-tenant por usuario (`app_user_tenants`) com backfill e ajuste de `user_can_access_tenant`.
- [x] Garantir FK de `tenant_id` para `tenants(id)` em todas as tabelas publicas com coluna `tenant_id`.
- [x] Criar migration `047_create_job_title_types_and_people_type_link.sql` para vincular tipos por cargo e permitir `people.job_title_type_id` com consistencia de tenant + cargo.
- [x] Criar migration `048_create_job_levels_and_people_level_link.sql` para disponibilizar niveis (`text`) por tenant e permitir `people.job_level` consumindo esse catalogo.
- [x] Criar migration `049_create_service_activities_and_page_permissions.sql` para tabela `service_activities` e para incluir a pagina `atividades` na matriz de permissao.
- [x] Implementar tela `Atividades` com cadastro, filtros e listagem integrada a `/api/activities`.
- [x] Criar migration `050_activity_code_precheck_and_optional_fields.sql` para tornar `grupo/alcance` opcionais em `service_activities` e bloquear codigo duplicado via RPC `precheck_activity_code_conflict`.
- [x] Implementar paginacao server-side na lista de `Atividades` (`page`, `pageSize`, `total`) com navegacao `Anterior/Proxima` na tela.
- [x] Padronizar botoes da tela `Atividades` conforme baseline de `Projetos` e documentar o guia em `docs/Tela_Padrao_Cadastros_SaaS.txt`.
- [x] Adicionar acoes `Detalhes`, `Historico` e `Cancelar/Ativar` na lista de `Atividades`, com modais e motivo obrigatorio na troca de status.
- [x] Criar migration `051_create_app_entity_history_and_activity_status.sql` com historico generico (`app_entity_history`) reutilizavel por outras telas e suporte de status em `service_activities`.
- [x] Endurecer `Atividades` com controle de concorrencia por `expectedUpdatedAt` na edicao e no cancelamento/ativacao, bloqueando `last-write-wins`.
- [x] Migrar as escritas de `Atividades` para RPC transacional (`save_service_activity_record` e `set_service_activity_record_status`) para consolidar update + historico + concorrencia no banco.
- [x] Padronizar modais de `Historico` para paginacao de `5` registros por pagina (`Projetos`, `Materiais` e `Atividades`).
- [x] Incluir campo obrigatorio `Tipo` na tela de `Atividades`, consumindo `team_types` (mesmo cadastro base de `Equipes`) em formulario, filtro, lista e exportacao.
- [x] Criar catalogo `types_service_activities` e coluna `service_activities.type_service` com vinculo por tenant (migration `145_create_types_service_activities_and_link_service_activities.sql`), incluindo seed dos tipos `POSTE`, `ESTRUTURA`, `CONDUTOR(REDE)`, `EMENDA`, `EQUIPAMENTO`, `MQS CHAVES/PARA-RAIO`, `MANUTENÇÃO`, `RAMAL / CAIXA DAE`, `GERADOR`, `PODA` e `OUTROS`.
- [x] Incluir campo obrigatorio `Categoria` na tela de `Atividades`, consumindo `types_service_activities` em formulario, filtro, lista, detalhes e exportacao, com persistencia via RPC (migration `146_require_service_activity_category_and_update_rpc.sql`).
- [x] Ordenar alfabeticamente as opcoes de `Categoria` no cadastro e no filtro da tela de `Atividades`, mantendo carregamento restrito ao tenant autenticado.
- [x] Gerar script SQL de carga de `atividades.xlsx` para `service_activities` com upsert por `code`, atualizando `description/group_name/type_service` e inserindo codigos faltantes (migration `147_upsert_service_activities_from_atividades_xlsx.sql`).
- [x] Endurecer a migration `147_upsert_service_activities_from_atividades_xlsx.sql` para resolver `type_service` por UUID ou nome normalizado (sem acento/pontuacao) e detalhar no erro os codigos/categorias nao resolvidos.
- [x] Corrigir compatibilidade da migration `147_upsert_service_activities_from_atividades_xlsx.sql` com ambientes Postgres sem `min(uuid)`, trocando a inferencia de tenant para `array_agg(order by)[1]`.
- [x] Criar migration `148_update_service_activities_voice_fields_ja10183409.sql` para atualizar `unit`, `voice_point` (Pontos da Voz) e `unit_value` (Valor do Ponto por `group_name`) para os codigos informados do JA10183409.
- [x] Exibir `voice_point` como `Pontos` na lista, detalhes e exportacao CSV da tela de `Atividades`.
- [x] Incluir `Pontos` (`voice_point`) no cadastro/edicao de `Atividades` com persistencia por RPC e historico de alteracao.
- [x] Incluir `Grupo *` e `Alcance` no cadastro/edicao de `Atividades`, exigindo `Grupo` no frontend, API e RPC transacional, e deixando `Alcance` como texto longo opcional (migration `180_require_service_activity_group_in_rpc.sql`).
- [x] Criar migration `149_deactivate_service_activities_not_in_147.sql` para desativar atividades fora da lista de codigos da migration `147` (com motivo de cancelamento e historico em `app_entity_history`).
- [x] Formalizar checklist obrigatorio de permissao para nova tela (migration + backfill + `permissionCatalog` + `AppShell`).
- [x] Criar tela `Equipes` em `Cadastros` com campos `Nome da equipe`, `Placa do veiculo` e `Encarregado` (filtro por cargo `ENCARREGADO`).
- [x] Criar migration `052_create_teams_and_page_permissions.sql` para tabela `teams` e para incluir a pagina `equipes` em `app_pages`, `role_page_permissions` e `app_user_page_permissions`.
- [x] Adicionar campo obrigatorio `Tipo` no cadastro de `Equipes`, com consumo de `team_types` no frontend/API.
- [x] Criar migration `053_create_team_types_and_link_teams.sql` para tabela `team_types`, vinculo obrigatorio em `teams.team_type_id` e pagina `tipo-equipe` em `Cadastro Base`.
- [x] Proteger cadastro/edicao de `Equipes` contra duplicidade pela combinacao `Nome da equipe + Encarregado + Placa` com constraint dedicada em banco e retorno `409` na API.
- [x] Vincular `Equipes` ao `Centro de Servico` e expor a base real em cadastro, filtros, listagem e detalhe.
- [x] Endurecer `Equipes` com controle de concorrencia por `expectedUpdatedAt` na edicao e no cancelamento/ativacao, com refresh da lista ao detectar conflito.
- [x] Migrar as escritas de `Equipes` para RPC transacional (`save_team_record` e `set_team_record_status`) para consolidar update + historico + concorrencia no banco.
- [x] Ajustar regra de `Equipes` para permitir reutilizar `Encarregado` quando o vinculo anterior estiver inativo, mantendo bloqueio de duplicidade apenas entre equipes ativas (API + RPC de cadastro/edicao/reativacao).
- [x] Padronizar o modal de `Cancelar/Ativar` da tela `Equipes` para o mesmo layout dos modais padrao (`modalCard` + botao `Fechar` no cabecalho e nas acoes).
- [x] Adicionar no modal de `Ativar` da tela `Equipes` o fluxo de troca de encarregado quando houver conflito (`DUPLICATE_TEAM_FOREMAN`), com suporte no `PATCH /api/teams` e na RPC `set_team_record_status`.
- [x] Vincular `Supervisor` opcional ao cadastro de `Equipes` usando `teams.supervisor_person_id`, permitindo que o mesmo supervisor acompanhe varias equipes.
- [x] Adicionar `Permutar encarregado` na tela `Equipes` para trocar encarregados entre duas equipes ativas do mesmo tenant via RPC transacional, com motivo obrigatorio, concorrencia nas duas equipes, historico e sincronizacao de vigencia para Medicao.
- [x] Padronizar todas as listas ativas (`Projetos`, `Materiais`, `Atividades`, `Equipes` e `Materiais previstos`) com botao `Exportar Excel (CSV)` e remover o texto fixo de paginacao no cabecalho.
- [x] Criar componentes compartilhados de padrao de tela (`ActionIcon` e `CsvExportButton`) e aplicar na tela `Materiais` para reduzir duplicacao e garantir consistencia nas novas telas.
- [x] Criar base de ambiente com `.env.example`, `.env` local e `.gitignore` para segredos/artefatos do projeto.
- [x] Reorganizar `src/app` para manter rotas/layouts finos e mover Login/Home para `src/modules`.
- [x] Versionar base Supabase com migrations de autenticacao, auditoria, RLS multi-tenant, materiais, saldo, conflitos, rate limit, pessoas e cargos.
- [x] Implementar Edge Function `auth-recover` para recuperar senha a partir de `login_name`.
- [x] Criar migration `017_sync_auth_users_to_app_users.sql` para sincronizar `auth.users` com `app_users`.
- [x] Criar migration `018_make_auth_user_sync_fail_open.sql` para impedir que o Invite User do Supabase seja bloqueado por falha de sync com `app_users`.
- [x] Disponibilizar Edge Functions ja existentes para login, logout, log de erro, sincronismo, materiais, responsaveis e saldo de estoque.
- [x] Documentar handoff, arquitetura, contratos de backend, login, home e layout principal em `docs/`.

- [x] [Obsoleto/Substituido] Implementar consumo real no frontend para `get_materials`, `get_responsaveis` e `get_inventory_balance`: o frontend operacional atual usa APIs Next (`/api/materials`, `/api/stock-balance`, metas por `/api/*/meta`) e as Edge Functions em `supabase/functions/*` ficam como integracoes externas/legadas documentadas.
- [x] Implementar CRUD de `Pessoas` integrado a `people`, `job_titles`, `job_title_types` e `job_levels`, com historico, status e exportacao CSV.
- [x] Aplicar trava de 10 segundos nos botoes `Exportar Excel (CSV)` das listagens para evitar multiplos disparos de exportacao.
- [x] Ampliar todos os `Exportar Excel (CSV)` para incluir campos obrigatorios de cadastro por tela e metadados extras de auditoria/disponibilidade (`Status`, `Criado/Atualizado por`, `Criado/Atualizado em`, quando disponiveis).
- [x] Garantir fallback de auditoria (`Nao identificado`) quando `Criado por`/`Atualizado por` vier vazio e exibir esses campos no modal de `Detalhes da Programacao` (alinhando o padrao nos detalhes das telas).
- [x] Exibir autor por evento no `Historico da Programacao` (`quem editou o que`) via `changedByName` resolvido de `project_programming_history.created_by`.
- [x] Proteger cadastro/edicao de `Pessoas` contra duplicidade pela combinacao `Nome + Matricula + Cargo + Tipo + Nivel` com validacao na API e trigger no banco.
- [x] Ajustar duplicidade de `Pessoas` para bloquear `Matricula` unica por tenant na API e no banco, independente de nome, cargo, tipo ou nivel.
- [x] Adicionar `Cadastro em massa` na tela de `Pessoas` no padrao da tela de `Materiais`, com modelo CSV, validacao parcial, retorno por linha e CSV de erros.
- [x] Adicionar campo opcional `CPF` em `Pessoas`, com migration versionada, validacao quando preenchido, tela, exportacao e cadastro em massa.
- [x] Ajustar `Pessoas` para CPF unico por tenant, trava `CPF + Matricula`, campo opcional `Telefone` e obrigatoriedade condicional de `Tipo` por cargo.
- [x] Endurecer `Pessoas` com controle de concorrencia por `expectedUpdatedAt` na edicao e no cancelamento/ativacao, com refresh da lista ao detectar conflito.
- [x] Migrar as escritas de `Pessoas` para RPC transacional (`save_person_record` e `set_person_record_status`) para consolidar update + historico + concorrencia no banco.
- [x] Implementar CRUD de `Materiais` integrado a `materials`.
- [x] Corrigir exibicao da coluna `UMB` na lista de `Materiais`, normalizando vazio/espacos e aplicando fallback tecnico de `requisicao_itens.umb` quando o cadastro base estiver sem valor.
- [x] Atualizar cadastro de `Materiais` para permitir `is_transformer`, tornar `Preco` opcional e limitar `Tipo` ao select `NOVO`/`SUCATA` com validacao na API/RPC.
- [x] Adicionar `Cadastro em massa` na tela de `Materiais` no padrao da tela de `Medicao`, com modelo CSV, processamento parcial, CSV de erros e `UMB` obrigatorio no cadastro manual/lote/API/RPC.
- [x] Implementar tela de `Entrada` com formulario, validacoes, auditoria e integracao ao fluxo de estoque (transferencia entre centros com debito/credito transacional, cadastro em massa CSV e historico em `material_history`).
- [x] Evoluir estoque para tela unica de movimentacao (`Entrada`, `Saida`, `Transferencia`) com regra de centro `OWN`/`THIRD_PARTY`, filtro automatico de `DE/PARA`, `Tipo` automatico pelo material (nao selecionavel), bloqueio de `DE/PARA` iguais, `Serial/LP` apenas para TRAFO, cadastro em massa modal e lista com modais de `Detalhes`/`Historico`.
- [x] Implementar a rota `/saida` como tela operacional propria de `Operacoes de Equipe`, com `Requisicao`/`Devolucao`, cadastro manual, cadastro em massa, historico e estorno.
- [x] Vincular `Equipes` a um `Centro de estoque proprio` e reutilizar esse vinculo no fluxo operacional de requisicao/devolucao.
- [x] Integrar `Operacoes de Equipe` ao `Estoque Atual`, refletindo requisicoes/devolucoes no historico consolidado do saldo.
- [x] Adicionar `Retorno de campo` em `Operacoes de Equipe`, com centro tecnico `CAMPO / INSTALADO`, `entry_type` conforme o tipo cadastrado do material, historico filtravel no `Estoque Atual` e leitura correspondente no `Rastreio de TRAFO`.
- [x] Corrigir regra de `Retorno de campo` em `Operacoes de Equipe` para respeitar o tipo cadastrado do material (`NOVO`/`SUCATA`) no manual, importacao e RPC, sem considerar todo codigo como sucata.
- [x] Automatizar a criacao/backfill do `Centro de estoque proprio` no cadastro de `Equipes`, removendo a selecao manual no frontend.
- [x] Persistir snapshot de `Equipe` e `Encarregado` nas `Operacoes de Equipe` e refletir esse dado tambem no historico do `Estoque Atual`.
- [x] Restringir `Operacoes de Equipe` para usar apenas equipes ativas e impedir que `Centro de estoque` aceite centros vinculados a equipes.
- [x] Endurecer o cadastro em massa de `Operacoes de Equipe` com pre-validacao sequencial de saldo/TRAFO, rollback total do lote, modal de alerta e `CSV` de erros por linha/coluna.
- [x] Ajustar o cadastro manual da `/saida` para o padrao de itens adicionados da `Medicao`, permitindo montar uma lista local de materiais antes do save final da operacao.
- [x] Separar visualmente o bloco de materiais da `/saida` em um sub-card proprio, no mesmo padrao de leitura da `Medicao`.
- [x] Especificar melhor os alertas da `/saida`, citando o codigo do material afetado e destacando o erro visualmente no modal.
- [x] Endurecer migrations de estoque para normalizar `stock_centers.center_type` legados e aplicar validacao transacional de `movement_type` no banco (`ENTRY`, `EXIT`, `TRANSFER`, com `TRANSFER` apenas entre `OWN`).
- [x] Endurecer movimentacao de estoque com avisos em portugues, bloqueio de edicao direta (`PUT` bloqueado + trigger no banco) e validacao de `entry_date` nao futura.
- [x] Implementar estorno de movimentacao de estoque com botao na lista, modal de motivo obrigatorio, endpoint dedicado (`/api/stock-transfers/reversal`) e RPC transacional com bloqueio de duplo estorno.
- [x] Evoluir tela de Movimentacao de Estoque com filtro de estorno, historico de estorno no modal, data de estorno no fluxo de reversao e exportacao CSV com status/vinculos de estorno.
- [x] Renomear menu/titulo de `/entrada` para `Movimentacao de Estoque`, remover `Tipo/Operacao` da lista e incluir `Exportar Excel (CSV)` no padrao das outras telas.
- [x] Ajustar cadastro em massa da Movimentacao de Estoque para modelo CSV didatico com colunas em portugues, opcoes de `operacao` explicitas, `LP` documentado (equivalente a `lot_code`) e `observacao` opcional com retrocompatibilidade para cabecalhos antigos em ingles.
- [x] Alinhar cadastro em massa da Movimentacao de Estoque ao padrao da Medicao com geracao/download de `CSV` de erros (`linha;coluna;valor;erro`) para falhas de validacao e salvamento.
- [x] Corrigir validacao de data no cadastro em massa da `Movimentacao de Estoque` e `Operacoes de Equipe` com normalizacao para `YYYY-MM-DD` (aceitando `YYYY-M-D`, `DD/MM/YYYY` e data com hora), evitando falso bloqueio de data.
- [x] Corrigir catalogo de materiais ativos em `Movimentacao de Estoque` e `Operacoes de Equipe` para carregar resultados paginados no `meta`, evitando que codigos existentes em `Materiais` fiquem fora do cadastro manual e do CSV por limite da API.
- [x] Liberar estorno para perfil `user` na UI e nas rotas `/api/stock-transfers/reversal` e `/api/team-stock-operations/reversal`, mantendo validacoes de motivo e integridade.
- [x] Padronizar motivo de estorno da Movimentacao de Estoque com catalogo (`reason_code` + `reason_notes`), criando tabela seed de motivos e validacao hard no banco para exigir observacao quando `reason_code = OTHER`.
- [x] Implementar tela de `Estoque Atual` com filtros, paginacao, resumo, exportacao CSV e consulta read-only por `stock_center_balances`/`stock_centers`.
- [x] Ajustar `Estoque Atual` para mostrar apenas estoques fisicos/proprios, excluir centros de equipe da tela, exibir saldo zero por padrao e manter materiais historicos visiveis no centro fisico mesmo com saldo atual `0`.
- [x] Ajustar a Movimentacao de Estoque para rotular `entry_date` conforme a operacao no formulario/modais (`entrada`, `saida`, `transferencia`) e rebalancear o layout de `Descricao`/`Quantidade` na UI.
- [x] Melhorar leitura operacional de `Movimentacao de Estoque` e `Estoque Atual` com sinalizacao visual por `Entrada/Saida/Transferencia/Estorno`, destaque de linhas estornadas e historicos com titulos/valores legiveis em vez de IDs brutos.
- [x] Endurecer TRAFO na `Movimentacao de Estoque` com `quantity = 1`, `Serial + LP` obrigatorios em todos os fluxos e validacao transacional da unidade exata no centro de origem via RPC.
- [x] Bloquear duplicidade funcional de TRAFO por `material + serial + lp` em centros `OWN` e antecipar erro de repeticao no mesmo arquivo CSV/importacao.
- [x] Criar `trafo_instances` como fonte unitaria de verdade de TRAFO, com backfill inicial e migracao da RPC de estoque para validar a unidade pela tabela atual em vez de reconstruir o estado a cada chamada.
- [x] Implementar botao `Movimentar este TRAFO` nas acoes da Movimentacao de Estoque com pre-preenchimento de `material + serial + lp + centro` e modo dedicado de `Saida/Transferencia`.
- [x] Remover `Serial` e `LP` da grade da Movimentacao de Estoque, mantendo esses campos apenas em `Detalhes` e no fluxo operacional de TRAFO.
- [x] Separar a `Movimentacao de Estoque` com sub-card `Materiais da Movimentacao`, mantendo o padrao visual das `Operacoes de Equipe`.
- [x] Evoluir a `Movimentacao de Estoque` para lista local em `Materiais da Movimentacao`, com `Adicionar material`, resumo por itens e save unico com `items[]`.
- [x] Padronizar os alertas manuais da `Movimentacao de Estoque` com modal operacional e mensagens por `material_code`, no mesmo modelo da tela `Operacoes de Equipe`.
- [x] Separar semanticamente `Movimentacao de Estoque` e `Operacoes de Equipe`, ocultando requisicoes/devolucoes/retornos da lista fisica, bloqueando centros de equipe em `DE/PARA`, resumindo cadastro inicial no historico de equipe e aceitando quantidade decimal com virgula ou ponto.
- [x] Permitir estorno independente por item/linha em `Movimentacao de Estoque` e `Operacoes de Equipe`, evitando que o estorno de uma linha reverta todos os materiais da mesma transferencia.
- [x] Adicionar `Compra direta` no cadastro de `Movimentacao de Estoque` somente para `Entrada`, permitindo salvar sem `Projeto` com `stock_transfers.direct_purchase = true` e mantendo `Projeto` obrigatorio para `Saida` e `Transferencia`.
- [x] Renomear a tela `Rastreio de TRAFO` no shell, catalogo de permissao e documentacao, substituindo o nome anterior `Posicao Unitaria TRAFO`.
- [x] Remover `Operacao cancelada` e `Outro` do catalogo de motivo padrao do estorno e bloquear esses codigos tambem no backend/RPC.
- [x] Endurecer `GET /api/stock-transfers` para nao derrubar a lista quando consultas auxiliares de detalhes/metadados falharem.
- [x] Criar tela/consulta de posicao unitaria de TRAFO consumindo `trafo_instances`, mantendo uma linha por unidade, centro fisico de referencia, status `Com equipe`, historico proprio da cadeia de movimentos e bloqueio do atalho de movimentacao fora do estoque fisico.
- [ ] Evoluir modulo de `Projetos` com status operacional e vinculo de materiais ao estoque.
- [x] Implementar primeira versao funcional de `Locacao` com filtro por `Municipio`, busca por `SOB`, observacoes gerais, materiais previstos e atividades previstas com persistencia propria.
- [x] Adicionar flag operacional `project.has_locacao` para marcar projetos com salvamento real na tela de `Locacao`.
- [x] Ajustar a tela de `Locacao` para separar `Atividades previstas` e `Materiais previstos` em cards distintos de cadastro e listagem, seguindo o padrao visual de `Projetos`.
- [x] Padronizar os blocos de filtro de `Atividades previstas` e `Materiais previstos` na `Locacao` com card `Filtros` e acoes `Aplicar`/`Limpar`.
- [x] Separar os filtros internos de `Atividades previstas` e `Materiais previstos` na `Locacao` em campos `Codigo`, `Descricao` e `Tipo`.
- [x] Criar a tabela `project_location_risks` para armazenar riscos da `Locacao` por projeto com `description`, `is_active`, RLS e auditoria.
- [x] Ajustar bootstrap da `Locacao` para seedar riscos de `Pre APR` em novos projetos a partir dos riscos ja cadastrados no tenant.
- [x] Criar o catalogo `location_execution_support_items` para apoio de execucao da `Locacao` por tenant com `description`, `is_active`, RLS e auditoria.
- [x] Reestruturar a aba `Locacao` em 4 blocos operacionais com questionario, quantidades de equipes, previsao de execucao, apoio de execucao e pre APR.
- [x] Ajustar a aba `Locacao` removendo prefixos `Bloco x` dos titulos e adicionando `Observacao` no `Pre APR`.
- [x] Validar a aba principal da `Locacao` com radios obrigatorios, campos numericos iniciando em `0`, bloqueio de negativos e feedback local no `Salvar locacao`.
- [x] Fazer o `Salvar locacao` retornar ao topo do container principal apos sucesso para recolocar as abas em evidência.
- [x] Ajustar feedback de sucesso de `Salvar locacao` para aparecer no topo da tela, mantendo erros de validacao no bloco local da aba.
- [x] Ajustar a tela de `Locacao` para voltar automaticamente aos cards `Filtros` e `Lista de Locacoes` apos `Salvar locacao` com sucesso.
- [x] Bloquear o salvar da `Locacao` quando todas as equipes estiverem zeradas ou quando `ETAPAS PREVISTAS` estiver em `0`.
- [x] Centralizar no banco via RPC as regras de bloqueio da `Locacao`, `Materiais previstos` e `Atividades previstas`.
- [x] Endurecer as RPCs de `Locacao` e dos previstos de `Projetos` com controle de concorrencia por `updated_at`, limites maximos e observacao obrigatoria quando houver revisao/desligamento.
- [x] Bloquear a `Locacao` para obras inativas em todas as rotas operacionais, inclusive quando o plano ja existia antes da inativacao.
- [x] Destacar visualmente no header da tela de `Locacao` tanto o estado vazio quanto o projeto selecionado.
- [x] Destacar visualmente no header da `Locacao`, abaixo do projeto selecionado, o resumo `Materiais atuais` e `Atividades atuais`.
- [x] Adicionar visao previa da `Locacao` com filtros, lista resumida de projetos, status, responsavel, data e acoes `Editar`/`Ver detalhes`, ocultando essa area ao abrir uma locacao.
- [x] Paginar a `Lista de Locacoes` da visao previa (10 por pagina, botoes `Anterior/Proxima`) e ampliar o `Ver detalhes` para exibir equipes, `ETAPAS PREVISTAS`, lista de `Previsao de execucao` e lista de `Pre APR`.
- [x] Corrigir fallback da visao previa de `Locacao`: quando `/api/locacao/meta` nao retornar `locationProjects`, montar a grade a partir de `projects` para evitar lista vazia.
- [x] Adicionar no `Planejamento / Vistoria` da `Locacao` os campos `Alimentador` (texto), `Tipo de SGD` (select) e `Elemento de corte` (numero), com persistencia em `questionnaireAnswers.planning`.
- [x] Estruturar `Locacao` com colunas fisicas (`feeder`, `sgd_type_id`, `cut_element`) em `project_location_plans`, criar historico dedicado `project_location_plan_history` e endurecer concorrencia com `expected_updated_at` obrigatorio no save principal.
- [x] Ajustar `/api/locacao/meta` para priorizar projetos recem-atualizados na carga do catalogo e evitar sumico de projetos novos na tela.
- [x] Padronizar os botoes de `Acoes` da lista previa da `Locacao` com os mesmos icones das outras telas de cadastro.
- [x] Adicionar aba `Atividades previstas` em `Projetos` com inclusao/edicao em linha e seed inicial da `Locacao` a partir dessa base.
- [x] Evoluir `Materiais previstos` e `Atividades previstas` em `Projetos` para suportar importacao em massa e inclusao manual, com edicao em linha e protecao via RPC.
- [x] Padronizar o posicionamento do botao `Adicionar atividade` em `Projetos` para seguir o mesmo layout de `Adicionar material`.
- [ ] Integrar aprovacao da previsao de materiais (locacao) e liberar saque no almoxarifado somente para lista aprovada.
- [x] Implementar modulo de `Locacao` com tela, APIs, RPCs transacionais, regras de periodo/custo, historico e docs; o item antigo de "status operacional" ficou obsoleto porque `docs/Tela_Locacao_SaaS.txt` registra que nao existe cancelamento/status operacional da locacao nesta etapa.
- [x] Implementar primeira versao visual de `Programacao` com painel de pendencias, timeline por equipe, drag and drop local e modal de programacao.
- [x] Ajustar a tela de `Programacao` para semana completa de segunda a domingo, melhor encaixe visual em 100% e padronizacao documental `PEP`.
- [x] Integrar `Programacao` com dados reais de projetos, equipes, atividades e persistencia da agenda por tenant.
- [x] Endurecer `Programacao` com RPC transacional, controle de concorrencia por `updated_at`, bloqueio de sobreposicao de horario e validacao de base da equipe.
- [x] Implementar cancelamento persistente de `Programacao` com motivo obrigatorio, soft cancel e auditoria de reagendamento.
- [x] Separar `Adiamento` de `Cancelamento` na `Programacao` e bloquear inativacao de projeto com agenda operacional pendente.
- [x] Exibir no card de projeto pendente da `Programacao` se a `Locacao` ja foi feita.
- [x] Exigir motivo minimo na reprogramacao/cancelamento da `Programacao` e avisar ao fechar a tela com alteracao pendente.
- [x] Tornar `/api/projects` tolerante a schema legado de `project_with_labels` sem `has_locacao`.
- [x] Mover a carga semanal da `Programacao` para RPC de resumo no backend e trocar `Apoio` para catalogo com sugestao automatica baseada na `Locacao`.
- [x] Criar catalogo proprio de `Apoio` da `Programacao` com vinculacao ao catalogo da `Locacao`.
- [x] Permitir filtrar quais `Equipes` aparecem na grade da `Programacao` e manter obras ja programadas visiveis na lateral para novas programacoes por dia.
- [x] Ajustar o resumo do topo da `Programacao` para manter `Programadas`, `Carga media` e um card de `Equipes` com barras internas para `Total`, `Livres` e `Selecionadas`.
- [x] Simplificar o card lateral da `Programacao` e destacar `Reprogramada` com cor propria na grade e na legenda.
- [x] Exibir no modal da `Programacao` o `ID da programacao` e os dados da ultima `Reprogramacao` a partir do historico.
- [x] Ajustar `Programacao Simples` e `Visualizacao` com `Data execucao`, blocos de `Equipes/Atividades/Documentos`, `Periodo Parcial` sugerindo `Hora termino = 12:00`, retorno para `17:00` no `Integral` e status visual `REPROGRAMADA`.
- [x] Manter `Cancelada` e `Adiada` visiveis na grade da `Programacao`, com estados proprios e possibilidade de `Programar novamente`.
- [x] Manter os cards da grade da `Programacao` sem texto de status e fazer o contador de `Projetos Pendentes` considerar apenas obras ainda nao programadas no periodo visivel.
- [x] Exibir no modal da `Programacao` o motivo do adiamento quando a programacao estiver `ADIADA`.
- [x] Simplificar a copia da `Programacao` para uma acao manual no toolbar, copiando a linha inteira da equipe no periodo visivel para outras equipes.
- [x] Implementar a nova `Programacao` no padrao de cadastro, com selecao de multiplas equipes e submit em lote via RPC transacional.
- [x] Desativar a tela legada `/programacao` sem exclusao de codigo, redirecionando para `/programacao-simples` e padronizando o texto da nova tela como `Programacao`.
- [x] Corrigir inclusao de atividades por codigo na nova Programacao e incluir campos de quantidade (`POSTE`, `ESTRUTURA`, `TRAFO`, `REDE`) com persistencia em banco.
- [x] Incluir botoes de acao `Detalhes`, `Edicao` e `Historico` na lista da nova Programacao.
- [x] Padronizar acoes da nova Programacao com o baseline de `Projetos` (icones, cancelamento com motivo, historico com campos alterados e destaque amarelo no modo de edicao).
- [x] Adicionar exportacao `ENEL-EXCEL` na nova Programacao com colunas no layout solicitado e preenchimento em branco para campos sem informacao.
- [x] Ajustar export `ENEL-EXCEL` da nova Programacao para preencher `Observação do Cancelamento / Parcial / Adiamento` com o motivo informado no cancelamento.
- [x] Ajustar mapeamento completo do `ENEL-EXCEL` na nova Programacao (Responsáveis Enel/Gestor/Endereco por Projeto, Tipo de SGD, Nº Clientes Afetados e roteamento do SGD por tipo).
- [x] Ajustar o `ENEL-EXCEL` da Programacao para: `Estrutura` por composicao de equipes (`MK/CESTO/LV`) por projeto/data, `Nº EQ` por total de equipes, `Data da programacao` por `created_at`, `Responsavel Execucao = INDICA`, `Tempo Previsto` em horas e `Periodo` em maiusculas.
- [x] Criar o campo obrigatorio `Campo eletrico` na Programacao, persistir em `project_programming` e usar esse valor na coluna `Nº EQ (RE, CO, CF, CC ou TR)` do `ENEL-EXCEL`, com reflexo no historico operacional.
- [x] Corrigir export `ENEL-EXCEL` da Programacao para preencher a coluna de `Encarregado` (`Mão de obra`) com o nome do encarregado da equipe programada.
- [x] Reordenar as colunas do `ENEL-EXCEL` da Programacao para o layout operacional solicitado, com `ENCARREGADO` apos `Estrutura` e `Mão de obra` mantida no bloco final.
- [x] Ajustar mapeamento do `ENEL-EXCEL` para preencher `SGD AT/MT/VyP`, `SGD BT` e `SGD TeT` com o valor de `Ponto eletrico`, incluindo regra agrupada de tipos (`SGD AT/MT`, `SGD AT`, `SGD MT`, `SGD VyP` -> `SGD AT/MT/VyP`).
- [x] Renomear no frontend o campo obrigatorio de `Campo eletrico` para `Ponto eletrico`, tornar o filtro de `Projeto` digitavel (`input + datalist`) e alinhar o `ENEL-EXCEL` para coluna `Encarregado` com nome do encarregado da equipe programada.
- [x] Incluir filtro de `Estado Trabalho` na Programacao Simples, com opcoes `Todos`, `Nao informado` e codigos ativos do catalogo por tenant, aplicando o filtro na lista e no aviso de registro salvo fora dos filtros.
- [x] Adicionar painel de prazos na Programacao Simples acima do cadastro, com cards-resumo (prioridade `Vence hoje`, `Vence em breve`, `Vencida`, `No prazo`) e cards por `SOB` em carrossel horizontal (6 por pagina, setas esquerda/direita), alternancia de janela (`15 dias` e `30 dias`), botao `Ver todos` com modal e exportacao CSV, exclusao de projetos com `Estado Trabalho = CONCLUIDO` e hierarquia visual (`>=30 dias` vermelho escuro, atrasada vermelho, hoje destaque, em breve laranja).
- [x] Ordenar a `Lista de Programacoes` da Programacao Simples por `Data execucao` decrescente (mais recente primeiro) e, em empate, pelo cadastro mais recente (`created_at` desc).
- [x] Sincronizar `Estado Trabalho` por `Projeto + Data` na Programacao ativa: ao editar uma equipe e mudar o valor, atualizar automaticamente todas as equipes `PROGRAMADA`/`REPROGRAMADA` do mesmo projeto/data, incluindo limpeza para todas quando o campo ficar vazio.
- [x] Remover a obrigatoriedade de `Ponto eletrico` na tela de Programacao e no backend, permitindo cadastro/edicao sem preencher esse campo.
- [x] Sincronizar documentos (`SGD`, `PI`, `PEP`) entre equipes da Programacao por `Projeto + Data de execucao`, com replicacao adicional para equipes `LV-xx` ate `+7` dias da data de execucao.
- [x] Corrigir a listagem/exportacao da Programacao para exibir nome/base/encarregado da equipe mesmo quando a equipe vinculada estiver inativa (sem fallback para UUID).
- [x] Exibir o nome do encarregado na lista de selecao de equipes da Programacao Simples, com layout em linhas (equipe/base/encarregado) para melhorar leitura.
- [x] Criar catalogo unico padronizado de motivos da Programacao (reutilizado em cancelamento, adiamento e reprogramacao) com seed inicial por tenant, RLS e auditoria para suportar troca de motivo livre por select.
- [x] Trocar os campos de motivo por `select` nos fluxos de `Cancelamento`, `Adiamento` e `Reprogramacao`, consumindo o catalogo `programming_reason_catalog` e exigindo observacao quando o motivo selecionar `OUTRO` (ou `requires_notes = true`).
- [x] Permitir na `Programacao Simples` a troca de equipe durante a edicao, com selecao unica, aviso visual (`Equipe original` x `Nova equipe`) e manutencao da exigencia de motivo de reprogramacao.
- [x] Mover o `Campo eletrico` para o mesmo fluxo transacional das RPCs full da Programacao (sem passo complementar de save na API) e ajustar a regra de reprogramacao para considerar mudanca de projeto/equipe/data/hora inicio/hora termino/periodo.
- [x] Implementar adiamento na nova Programacao com botao amarelo, motivo + nova data e geracao de novo registro na data informada (mantendo o antigo como `ADIADA`).
- [x] Tornar `Tipo de SGD` obrigatorio na nova Programacao, adicionar `Inicio/Termino de desligamento` e ajustar documentos para `Data Aprovada` + `Data Pedido` com persistencia e exportacao ENEL.
- [x] Criar campo `Descricao do servico` na nova Programacao, usar este valor na coluna `Descricao do servico` do ENEL-EXCEL e rolar ao topo ao clicar em `Editar`.
- [x] Adicionar campo `ETAPA` na Programacao para alimentar `INFO STATUS` do ENEL-EXCEL no formato `x ETAPA`, com `ETAPA` obrigatoria no cadastro novo e preservada automaticamente na edicao quando nao alterada; `Estado Trabalho` (`CONCLUIDO`/`PARCIAL`) fica disponivel na edicao.
- [x] Padronizar o campo `Projeto (SOB)` da Programacao Simples para o mesmo formato de selecao por `input + datalist` usado no SOB da Locacao.
- [x] Adicionar na Programacao Simples a acao `Copiar programacao`, com modal de multiplas datas, ETAPA por destino, bloqueio para `ETAPA UNICA`/`ETAPA FINAL` e copia transacional via RPC.
- [x] Incluir suporte ao tipo de SGD `AREA_LIVRE` no catalogo `programming_sgd_types`, ajustando constraint SQL e seed por tenant.
- [x] Destravar cadastro de novos `Tipo de SGD` removendo a unicidade por `tenant_id + export_column` em `programming_sgd_types` e definindo `AREA_LIVRE` como default de `export_column`.
- [x] Remover o bloqueio de valores fixos em `programming_sgd_types.export_column`, aceitando qualquer valor nao vazio para permitir novos Tipos de SGD.
- [x] Ajustar cards da visualizacao semanal da Programacao para mostrar `AREA LIVRE` em verde quando o `Tipo de SGD` for `AREA_LIVRE`, substituindo indicadores `SGD` e `PI`.
- [x] Ajustar a tela `Visualizacao Programacao` para exibir cartao em `verde escuro` quando `Estado Trabalho` estiver `CONCLUIDO` (`Completo`).
- [x] Incluir a legenda `Completo` no calendario semanal da tela `Visualizacao Programacao`, alinhada ao cartao em verde escuro.
- [x] Enxugar historico da nova Programacao para exibir somente mudanca de status (em `Adiamento/Cancelamento`) e campos realmente editados (sem cards de cadastro inicial).
- [x] Endurecer a Programacao Simples contra gravacao parcial e sobrescrita: validacao de reprogramacao antes do save, `PATCH` com `expectedUpdatedAt` obrigatorio e uso exclusivo das RPCs transacionais full.
- [x] Garantir compatibilidade da API de Programacao quando a migration `085` ainda nao estiver aplicada (fallback de leitura e de RPC em lote).
- [x] Adicionar compatibilidade em `service_activities` para `is_active` x `ativo`, evitando erro interno nas RPCs de Programacao em lote.
- [x] Criar migrations para persistir lotes de copia da `Programacao` e adaptar o schema ao modo `team_period`.
- [x] Mover a copia da linha da `Programacao` para uma RPC transacional, evitando lote parcial e reaproveitando as tabelas de rastreio ja existentes.
- [x] Ajustar o cadastro em lote da `Programacao simples` para fazer fallback da RPC full para a RPC base quando o ambiente estiver com migrations parciais, e simplificar o texto do botao principal.
- [x] Reforcar validacoes de horario, datas de documentos e campos numericos da `Programacao` no frontend e nas RPCs do banco.
- [x] Endurecer `copy_team_programming_period` para copiar apenas atividades ativas e replicar campos novos (estrutura/ENEL/desligamento/descricao) via `save_project_programming_full`.
- [x] Migrar o historico complementar da `Programacao` para a RPC `append_project_programming_history_record`, removendo `insert` direto em `app_entity_history` da route.
- [x] Endurecer o save principal e o save em lote da `Programacao` para exigir RPC full, evitar gravacao parcial e responder sucesso com aviso quando a recarga da grade falhar apos o commit.
- [x] Enriquecer conflito `409` da `Programacao` com `currentRecord`, `currentUpdatedAt`, `updatedBy` e `changedFields`, e mover o historico de `ADIADA/CANCELADA` para dentro das RPCs transacionais.
- [x] Formalizar no `AGENTS.md` o padrao obrigatorio de integridade transacional, conflito `409` rico e pos-save sem erro falso para fluxos operacionais criticos no padrao da `Programacao`.
- [x] Corrigir a protecao de adiamento da `Programacao` para aceitar apenas nova data posterior a data atual da programacao, no frontend, na API e na RPC do banco.
- [x] Ajustar o modal de historico da `Programacao Simples` para exibir a mudanca de `Data execucao` tambem nos eventos de `Adiamento`.
- [x] Destacar com contorno vermelho os campos invalidos/obrigatorios da `Programacao Simples` e corrigir o scroll para exibir a mensagem completa de feedback no topo.
- [x] Trocar a mensagem generica de campos obrigatorios do lote por erros especificos e preencher `ETAPA` automaticamente pela proxima etapa do projeto/equipes selecionadas.
- [x] Bloquear o save da `Programacao Simples` com modal de aviso quando a `ETAPA` informada conflitar com etapas ja existentes do mesmo projeto/equipe.
- [x] Impedir que a sugestao automatica sobrescreva a `ETAPA` digitada manualmente e repetir a protecao de conflito de etapa tambem na API da `Programacao`.
- [x] Ajustar o confronto de `ETAPA` na edicao da `Programacao Simples` para considerar a etapa atual da propria programacao editada e reforcar a marcacao de `REPROGRAMADA` apos adiamento.
- [x] Corrigir validacao de `ETAPA` na edicao para nao bloquear o save quando a etapa nao foi alterada, mantendo a validacao de conflito apenas quando houver mudanca real no campo.
- [x] Promover `REPROGRAMADA` a status fisico em `project_programming`, incluindo adiamento, edicao, copia, carga semanal e protecao de inativacao do projeto.
- [x] Criar `project_programming_history` como historico operacional proprio da `Programacao`, com backfill inicial a partir de `app_entity_history` e uso exclusivo na API/telas da agenda.
- [x] Mover o historico de `CREATE`, `UPDATE`, `RESCHEDULE` e `BATCH_CREATE` da `Programacao` para dentro das RPCs transacionais full, removendo o passo complementar pos-commit da API.
- [x] Ajustar o feedback de sucesso da `Programacao Simples` para avisar quando o registro foi salvo fora dos filtros ativos da lista e, por isso, nao aparecer imediatamente na visualizacao.
- [x] Endurecer o backfill da migration `101` para ignorar historicos orfaos de `Programacao` sem registro correspondente em `project_programming`.
- [x] Eliminar os warnings antigos de lint em `app-users/[userId]/permissions`, `materials` e `programacao`.
- [x] Abrir modal de alerta na `Programacao Simples` para erros e conflitos ao validar `Adiamento`, ao `Cadastrar programacao` e ao `Salvar edicao`.
- [x] Criar a migration `103_harden_postpone_patch_error_reporting.sql` e endurecer o `PATCH` de `Adiamento/Cancelamento` para devolver erro detalhado (`reason/detail`) e manter sucesso com aviso quando a recarga da visualizacao falhar apos o commit.
- [x] Criar a migration `104_fix_postpone_json_error_wrapper.sql` para remover o cast invalido de `SQLERRM -> jsonb` no adiamento e expor o erro real da RPC.
- [x] Criar a migration `105_fix_postpone_history_signature.sql` para corrigir a assinatura usada no historico do novo registro `REPROGRAMADA` durante o adiamento.
- [x] Corrigir a normalizacao de `Periodo` da `Programacao Simples` na API para aceitar `integral`/`partial` sem falso erro de campo obrigatorio.
- [x] Garantir que falhas inesperadas do `BATCH_CREATE` retornem JSON com a causa real, sem `500` generico no cadastro em lote da `Programacao Simples`.
- [x] Tornar a RPC `save_project_programming_batch_full` autocontida e orientar a aplicacao das migrations `091`, `094`, `095` e `099` quando o lote estiver desatualizado no banco.
- [x] Tornar a RPC `save_project_programming_full` autocontida, criando `service_description` quando faltar e removendo a dependencia indireta da migration `090` no save transacional da Programacao.
- [x] Criar visualizacao semanal da `Programacao Simples` (segunda a domingo) por equipe, com cards por dia contendo SOB, indicador de SGD/PI, cores de status e acoes de detalhe/historico.
- [x] Criar tela separada `/programacao-visualizacao` para consulta da Programacao (lista + calendario), com permissao dedicada e menu proprio.
- [x] Remover textos dos cards do calendario da Programacao (`SOB` e status textual) e paginar o modal de Historico.
- [x] Remover calendario da tela de cadastro de Programacao e manter o calendario no topo da tela de Visualizacao, com exibição de `ADIADA/CANCELADA` na lista.
- [x] Remover horario dos cards do calendario, trocar botoes por icones, deixar `SGD/PI` verdes por `Data aprovada` e adicionar botao `Atualizar`.
- [x] Trocar o `dev` local para `webpack` e documentar o workaround do panic do Turbopack no Windows.
- [x] Implementar primeira versao frontend de `Medicao` com origem por projeto/programacao, carga de atividades previstas, calculo local e fator ajustavel sem backend proprio.
- [x] Implementar modulo base de `Ordem de Medicao` com `cadastro + filtros + lista`, persistencia em banco, RLS multi-tenant, historico e RPC transacional (`save_project_measurement_order` e `set_project_measurement_order_status`).
- [x] Corrigir erro de build da tela `Medicao` (`Return statement is not allowed here`) removendo bloco duplicado no `MeasurementPageView.tsx` e ajustando tipagem da API `medicao`.
- [x] Ajustar `Medicao` para usar `voice_point` por atividade (origem em `service_activities`), removendo input manual de pontos no cabecalho da ordem.
- [x] Ajustar `Medicao` com pre-filtro de `Data da programacao` antes do campo `Programacao` e padronizar filtro de `Projeto` em `input + datalist`.
- [x] Reposicionar `Salvar ordem` para o final de `Atividades da Ordem`, remover botao `Limpar` do cadastro e endurecer auto-complete de atividade com fallback da programacao selecionada.
- [x] Adicionar fallback legado nas APIs de forecast/catalog para funcionar mesmo sem coluna `voice_point` aplicada no banco.
- [x] Corrigir falso erro no `Adicionar` da Medicao com fallback imediato no catalogo e match tolerante de codigo de atividade (incluindo variacao `O`/`0`).
- [x] Desacoplar atividades da `Medicao` da `Programacao`: criar tabela/catalogo proprio (`measurement_activities`) e vincular `project_measurement_order_items` a essa nova base.
- [x] Melhorar busca do botao `Adicionar` na Medicao com lookup por multiplos tokens (texto completo, prefixo antes de `|` e codigo antes de `-`) para eliminar falso `Atividade nao encontrada`.
- [x] Travar `Valor unitario` na grade `Atividades da Ordem` da Medicao (somente leitura).
- [x] Exibir campo `Status` (`ABERTA`, `FECHADA`, `CANCELADA`) no cadastro da Medicao.
- [x] Implementar `Cadastro em massa (CSV)` na Medicao com download de modelo e colunas obrigatorias (atual: `projeto,data,equipe,voz,quantidade`).
- [x] Ajustar o cadastro em massa da Medicao para aceitar medicao antiga via programacao historica (qualquer status), mantendo save + historico no mesmo RPC transacional.
- [x] Desacoplar cadastro da Medicao da Programacao, com identificacao automatica de match por `Projeto + Equipe + Data`, status visual `Programada/Nao programada` e alerta quando `CONCLUIDO/PARCIAL` da Programacao mudar apos a medicao.
- [x] Remover do formulario de cadastro da Medicao os campos de `Programacao (opcional)` e `Programacao da medicao`, mantendo essa informacao apenas na lista e em detalhes apos salvar.
- [x] Remover o campo visual `Data da medicao` do cadastro da Medicao e adotar `Data execucao` como origem automatica da data de medicao no cadastro novo; trocar `Projeto` para `input + datalist` no mesmo padrao do filtro.
- [x] Reposicionar `Taxa manual` no bloco `Atividades da Ordem` (entre `Atividade` e `Quantidade`) e reduzir a largura visual dos campos `Taxa manual` e `Quantidade`.
- [x] Ajustar a Medicao para remover `Status` do cadastro, remover `Quantidade total` do resumo, padronizar acoes da lista (`Detalhes`, `Historico`, `Editar`, `Cancelar`, `Fechar`) e exibir `Cancelar edicao` no modo de edicao.
- [x] Padronizar visual dos botoes de `Acoes` da lista da Medicao para o mesmo estilo das outras telas (icones circulares com tooltip e sem quebra em duas linhas).
- [x] Padronizar UX das `Acoes` da Medicao com modais (`Detalhes`, `Historico`, `Cancelar`) e rolagem ao topo ao clicar em `Editar`.
- [x] Padronizar Historico da Medicao (cards + paginacao), habilitar edicao de `Projeto/Equipe/Data execucao` com persistencia no RPC e mover `Cadastro em massa` para modal ao lado de `Salvar ordem`.
- [x] Corrigir campo digitavel `Projeto` no cadastro da Medicao, removendo limpeza automatica que impedia a digitacao antes da selecao.
- [x] Corrigir inclusao de atividades da Medicao para usar valores atualizados (`unit_value`/`voice_point`), priorizar match exato por codigo e evitar divergencia de valor unitario.
- [x] Ajustar campo `Projeto` da Medicao para o mesmo comportamento do `Projeto (SOB)` da Programacao Simples, com selecao por codigo exato e suporte a apagar com backspace sem reescrever valor automaticamente.
- [x] Corrigir catalogo de atividades da Medicao para sincronizar por `tenant_id + code` e retornar `unit_value/voice_point` sempre atualizados da `service_activities`.
- [x] Finalizar cadastro em massa da Medicao com arquivo de erros (`linha,coluna,valor,erro`), processamento parcial de linhas validas e feedback de status (`sucesso total`, `parcial` ou `sem sucesso`).
- [x] Refinar validacoes do cadastro em massa da Medicao para erros por campo (ex.: `Projeto nao encontrado`, `Data invalida`, `Atividade nao encontrada`, `Quantidade invalida`) e remover a mensagem generica de `programacao nao encontrada`.
- [x] Permitir importacao em massa da Medicao sem programacao vinculada: quando nao houver programacao para a data, salvar com `Projeto + Equipe da linha CSV + Data`, exibindo `Nao programada` na lista.
- [x] Ajustar lookup do campo `voz` no cadastro em massa da Medicao para entrada textual com tolerancia de variacao `0`/`O` no codigo da atividade.
- [x] Exibir no modal de cadastro em massa da Medicao um resumo de resultado (ordens salvas + linhas com erro) e botao para baixar o CSV de erros quando houver falhas.
- [x] Reforcar API de catalogo da Medicao com fallback de busca ampla e match normalizado para reduzir falso erro `Atividade nao encontrada no catalogo da medicao`.
- [x] Atualizar modelo e parser do cadastro em massa da Medicao para incluir coluna obrigatoria `equipe` e validar equipe por texto (nome/codigo), sem dependencia da equipe selecionada no formulario.
- [x] Atualizar o cadastro em massa da Medicao para exigir a coluna `taxa` no CSV, usar essa taxa por linha como `manualRate` da ordem e bloquear agrupamento com taxas divergentes para o mesmo `Projeto + Equipe + Data`.
- [x] Ajustar `Detalhes` da Medicao para exibir a `taxa` por item e usar `total_value` persistido, alem de endurecer o lookup do campo `voz` no import em massa para cruzar atividade por codigo exato.
- [x] Ajustar o modal `Detalhes` da Medicao para priorizar snapshots de `Equipe/Encarregado` da propria ordem (`team_name_snapshot/foreman_name_snapshot`), mantendo fallback tecnico para o mapa atual da equipe.
- [x] Corrigir falha de build TypeScript na Medicao declarando `teamName` e `foremanName` no tipo `OrderDetail` em `MeasurementPageView.tsx`.
- [x] Endurecer o lookup do campo `voz` no import em massa da Medicao para aceitar apenas match exato/univoco do codigo da atividade e falhar quando houver ambiguidade, evitando puxar `voice_point` de item parecido.
- [x] Proteger a Medicao contra atividade duplicada na mesma ordem: bloquear repeticao no save da API e avisar na edicao quando uma ordem antiga vier com linhas repetidas.
- [x] Levar a protecao de atividade duplicada da Medicao para a RPC `save_project_measurement_order`, garantindo a mesma regra no fluxo normal e no cadastro em massa mesmo com bypass da API.
- [x] Proteger sobreposicao no cadastro em massa da Medicao: quando ja existir ordem para `Projeto + Equipe + Data de execucao`, ignorar a linha, seguir com as demais e exibir no resumo `x linhas ja cadastradas`.
- [x] Migrar cadastro em massa da Medicao para RPC transacional parcial (`save_project_measurement_order_batch_partial`), salvando linhas validas e retornando por lote as invalidas/duplicadas.
- [x] Endurecer o cadastro manual da Medicao para bloquear ordem repetida por `Projeto + Equipe + Data de execucao`, independente de `programming_id`, preservando edicao da propria ordem, cadastro em massa, reprogramacao para outra data e escopo por `tenant_id`.
- [x] Adicionar botao `Exportar Excel (CSV)` na lista de Ordens de Medicao para exportar o resultado filtrado no padrao das outras telas.
- [x] Adicionar botao `Detalhamento (CSV)` na lista de Ordens de Medicao para exportar em nivel de item (linha a linha) com `Codigo atividade`.
- [x] Adicionar botao `Atualizar lista` na lista de Ordens de Medicao (ao lado de `Detalhamento (CSV)`), com recarga manual de lista/consolidacoes para refletir `Status execucao` e demais dados atualizados.
- [x] Paginar a `Lista de Ordens de Medicao` com `page`, `pageSize` e `total` no backend, navegacao `Anterior/Proxima` na tela e exportacao preservando o resultado filtrado completo.
- [x] Ampliar a Medicao para suportar `Com producao` e `Sem producao` na mesma tela, com motivo estruturado por tenant, save sem atividades para `Sem producao` e suporte correspondente no cadastro em massa.
- [x] Restringir `Motivo sem producao` para ficar ativo apenas quando `Tipo da medicao = Sem producao`, limpando no front fora desse tipo e validando na API para bloquear envio em `Com producao`.
- [x] Ajustar a Medicao para tratar a `taxa` como valor unico por ordem, reaplicando e recalculando todas as atividades ao editar o cabecalho.
- [x] Ajustar a UX da edicao da Medicao para ocultar `Cadastro em massa`, exibir `Taxa aplicada` na grade e oferecer acao explicita de `Recalcular totais`.
- [x] Incluir nos filtros da lista da Medicao os campos `Tipo` e `Motivo sem producao`, alinhando frontend e `/api/medicao` com a paginacao server-side.
- [x] Unificar Medicao para usar somente `service_activities` (sem dependencia operacional de `measurement_activities`), incluindo ajuste de FK/backfill e catalogo da API.
- [x] Corrigir ordem da migration `120_unify_measurement_with_service_activities` para remover a FK antiga antes do backfill dos IDs e evitar erro `23503` durante a unificacao.
- [x] Garantir no cadastro em massa da Medicao a geracao do CSV de erros mesmo quando a API retornar falha geral sem detalhamento por linha.
- [x] Adicionar na lista da Medicao o somatorio de `Valor total` respeitando os filtros aplicados.
- [x] Excluir obras marcadas como teste das consolidacoes da `Medicao` (contagem de ordens e somatorio de valor total).
- [x] Ajustar o resumo da lista da Medicao para considerar o resultado filtrado completo (todas as paginas), e nao apenas a pagina visivel.
- [x] Ajustar a cor do `Status` na lista da Medicao para exibir `FECHADA` em vermelho (mesma classe de destaque de `CANCELADA`).
- [x] Ajustar o layout de `Status execucao` na lista da Medicao para exibir `CONCLUIDO` e `Atualizado apos medicao` em linhas separadas.
- [x] Ajustar filtro `Estado Trabalho` da Medicao para consumir o catalogo por tenant (`programming_work_completion_catalog`), com opcoes dinamicas e `Nao informado`, integrado ao `GET /api/medicao`.
- [x] Adicionar filtro `Equipe` na lista da Medicao, integrado ao `GET /api/medicao`, paginacao, totalizacao e exportacoes.
- [x] Incluir `Centro de Servicos` nos CSVs de Medicao e exibir modal `Gerando...` com progresso durante exportacoes, bloqueando cliques na pagina ate concluir.
- [x] Criar metas de pontos por tipo (`MK`, `LV`, `CESTO`) e adicionar `Exportar pontuacao` na Medicao com status por pontos e compensatorio por meta financeira.
- [x] Corrigir heranca de `Estado Trabalho` na Medicao para aceitar qualquer codigo do catalogo e usar fallback de snapshot da ordem quando necessario.
- [x] Corrigir heranca de `Status execucao` na Medicao para fallback por `Projeto + Data` quando nao houver match de equipe, mantendo `Programacao` como `Nao programada` nesse caso.
- [x] Corrigir atualizacao de `Status execucao` na Medicao apos mudanca do `Estado Trabalho` na Programacao, usando o ultimo estado nao vazio do projeto e fallback por `Projeto + Equipe + Data execucao` / `Projeto + Data execucao`.
- [x] Implementar acao `Abrir` para ordens `FECHADA` na Medicao, com modal de motivo obrigatorio e registro transacional no banco/historico.
- [x] Ajustar regra de cancelamento da Medicao para permitir em `ABERTA` e `FECHADA`, mantendo bloqueio apenas para `CANCELADA` e registro de historico no RPC.
- [x] Adicionar suporte a quantidade composta (`MVA*hora`) na Medicao: campos `MVA` e `Horas` na tela/importacao, persistencia em `project_measurement_order_items` e calculo automatico de `quantity`.
- [x] Restringir atividades `MVA*hora` para nao aceitar `Quantidade` direta: exigir `MVA + Horas` no cadastro, importacao e validacao da RPC.
- [x] Sugerir automaticamente a `Taxa` no cadastro novo da Medicao ao selecionar projeto, priorizando a ultima medicao `COM_PRODUCAO` do mesmo projeto e mantendo fallback para preenchimento manual.
- [x] Preservar e corrigir o encarregado historico da Medicao: criar `team_foreman_history`, resolver snapshot por `Data execucao`, abrir vigencia anterior quando a primeira troca estiver no historico e backfillar ordens ja contaminadas.
- [ ] Concluir backfill/manual cleanup das equipes antigas sem base quando o tenant tiver mais de um centro de servico ativo.
- [x] Implementar modulo de `Medicao` com rota `/medicao`, APIs, RPCs, consolidacao por periodo/filtros, status `ABERTA`/`FECHADA`/`CANCELADA`, reabertura/cancelamento com motivo, historico e docs (`docs/Tela_Medicao_SaaS.txt`).
- [x] Implementar CRUD de `Cargo` integrado a `people/job_titles`, incluindo tipos por cargo, niveis do tenant, historico, status, exportacao CSV e controle de concorrencia.
- [ ] Implementar CRUDs de `Cadastro Base` (`Prioridade`, `Centro de Servico`, `Contrato`, `Imei`, `Tipo de Servico`, `Nivel de Tensao`, `Porte`, `Responsavel Distribuidora`, `Municipio`).
- [x] Revisao de cadastros (2026-03-20): bloquear submit de `Pessoas` com feedback explicito quando `job_titles` estiver vazio e orientar abertura do cadastro base de `Cargo`.
- [x] Revisao de cadastros (2026-03-20): bloquear submit de `Equipes` com feedback explicito quando `team_types`, `project_service_centers` ou lista de encarregados estiver vazia.
- [x] Revisao de cadastros (2026-03-20): validar se o filtro de encarregado/supervisor por cargo (`ENCARREGADO`/`SUPERVISOR`) cobre os codigos reais usados por tenant e ajustar fallback quando nao cobrir.
- [x] Revisao de cadastros (2026-03-20): melhorar diagnostico de erro em `POST/PUT/PATCH /api/teams` e aplicar fallback de escrita/status quando `save_team_record`/`set_team_record_status` nao estiverem disponiveis.
- [x] Revisao de cadastros (2026-03-20): bloquear `POST/PUT` de equipes quando ja existir outra equipe com o mesmo encarregado no tenant (retorno `409`).
- [x] Revisao de cadastros (2026-03-20): reforcar bloqueio de encarregado unico em `Equipes` no nivel de RPC (`save_team_record`) via migration `093_enforce_single_team_per_foreman_rpc.sql`.
- [x] Revisao de cadastros (2026-03-20): tornar `Matricula` e `Tipo` obrigatorios no cadastro/edicao de `Pessoas` (frontend + API).
- [x] Revisao de cadastros (2026-03-20): melhorar diagnostico de erro em `POST /api/people` e aplicar fallback de cadastro quando `save_person_record` nao estiver disponivel.
- [x] Revisao de cadastros (2026-03-20): tratar tambem o retorno `success=false` da RPC de pessoas quando houver incompatibilidade `matriculation numeric x text/varchar`, com fallback/cast para evitar `500`.
- [x] Revisao de cadastros (2026-03-29): estabilizar o filtro de `Matricula` em `Pessoas`, com fallback do `GET /api/people` para ambientes legados onde `people.matriculation` ainda esta `numeric`.
- [ ] Revisao de cadastros (2026-03-20): exibir diagnostico de prerequisitos vazios em `Atividades` (`team_types`) e `Projetos` (lookups de `Cadastro Base`) antes de permitir novo cadastro.
- [ ] Implementar controle de permissao no frontend por `role` para esconder/bloquear acoes sensiveis.
- [x] Endurecer `Permissoes` com controle de concorrencia por `app_users.updated_at`, bloqueando salvamento concorrente de role/status/telas para o mesmo usuario.
- [x] Migrar o save de `Permissoes` para RPC transacional (`save_user_permissions`) para consolidar `app_users`, `app_user_page_permissions` e historico em uma unica operacao.
- [x] Migrar a auditoria do `Invite` em `Permissoes` para RPC (`append_user_invite_history`), removendo `insert` direto de historico da route.
- [ ] Aplicar a regra de escrita via RPC transacional sempre que possivel nos modulos futuros (`Entrada`, `Medicao`, `Cargo` e `Cadastro Base`) conforme cada fluxo sair do placeholder.
- [ ] Implementar seletor de tenant/contrato no frontend e enviar `x-tenant-id` nas chamadas autenticadas para troca de contexto.
- [ ] Implementar gestao de sessao web com expiracao por inatividade, touch/revoke e tratamento de token expirado.
- [x] Implementar fluxo de "esqueci minha senha" no frontend web consumindo `auth-recover` e tela unica para definicao da senha.
- [x] Ajustar a UX de recuperacao para usar o `login_name` digitado na tela de login antes do envio do email pelo Supabase.
- [x] Adaptar `/recuperar-senha` para aceitar `token_hash` e validar links customizados de invite/reset com `verifyOtp`.
- [x] Evitar corrida de hidratacao em `AuthContext` para nao sobrescrever sessao recem-logada e reduzir efeito de tela piscando.
- [x] Garantir backfill das telas `Projetos`, `Locacao` e `Programacao` em permissoes (`app_pages`, `role_page_permissions`, `app_user_page_permissions`).
- [ ] Definir fluxo oficial de provisionamento de usuarios no Supabase Auth com metadata minima (`tenant_id`, `matricula`, `login_name`).
- [ ] Definir se o provisionamento padrao de usuarios sera por pre-cadastro em `app_users` + invite no Auth, ou por metadata obrigatoria no invite admin.
- [ ] Integrar `log_error` no frontend para registrar falhas por modulo.
- [ ] Adicionar testes automatizados para auth e fluxo base de navegacao.
- [x] [Obsoleto/Corrigido] Corrigir o `lint` atual em `supabase/edge_functions/get_responsaveis/index.ts` removendo o `any` explicito: o caminho atual e `supabase/functions/get_responsaveis/index.ts` e nao ha `any` explicito nesse arquivo.
- [x] Corrigir o `build` atual do Next destravando o type-check de `xlsx` usado em `src/lib/server/projectForecastXlsx.ts`.
- [x] Corrigir falha de type-check no `build` em `src/app/api/projects/route.ts` removendo uso de `delete` em propriedade nao-opcional no fallback legado de RPC.

- [ ] Definir uma fonte unica de verdade para `supabase/`, porque hoje existe copia na raiz do repositorio e outra em `SaaS (Web)/supabase`.
- [ ] Revisar README e docs que ainda assumem backend somente externo em `d:\\RQM\\supabase`, enquanto este repositorio ja contem artefatos Supabase versionados.
- [ ] Confirmar se o frontend web vai continuar consumindo Edge Functions service-role ou se parte dos acessos passara a usar cliente autenticado + RLS diretamente.
- [ ] Mapear quais operacoes sensiveis de estoque precisam gerar auditoria adicional alem de `login_audit` e `app_error_logs`.
- [ ] Definir backlog funcional do SaaS de engenharia eletrica alem do modulo atual de materiais/estoque.

- [x] [Consolidada] Pendencias de dependencia registradas em 2026-03-11: registros historicos substituidos pela pendencia mais recente de `npm outdated`; `package.json` ainda mantem as versoes antigas.
- [x] [Consolidada] Pendencias de dependencia registradas em 2026-06-01: registros historicos substituidos pela pendencia mais recente de `npm outdated`; `package.json` ainda mantem as versoes antigas.
- [x] Criar catalogo de Nº EQ (RE, CO, CF, CC ou TR) na Programacao, com coluna em project_programming, persistencia em fluxo full RPC e historico operacional por alteracao.
- [x] Adicionar botao Extracao ENEL NOVO na Programacao Simples, mantendo Extracao ENEL, com novo layout de colunas e mapeamentos operacionais (Placa, Responsáveis Ampla, AREA LIVRE, Número SGD normalizado, Nº EQ composto, Periodo por horario e STATUS combinado com Estado Trabalho).
- [x] Ajustar Extracao ENEL NOVO com formato operacional final: BASE apos  - , Data Execucao dd-mmm-yy, Dia da semana abreviado, INFO STATUS ordinal (xª ETAPA), Tempo previsto HH:MM:SS, Estrutura por equipes (|), Parceira antes de  - , Responsavel Execucao por encarregado, SOLICITACAO/AREA LIVRE por Tipo de SGD, TIPO DE SGD textual e fallback de Descricao do servico (Programacao > Projeto).
- [x] Corrigir falha de cadastro em lote apos suporte a Nº EQ removendo overload recursivo de RPC full e criando wrappers estaveis (save_project_programming_full_with_electrical_and_eq e save_project_programming_batch_full_with_electrical_and_eq) na migration 152.
- [x] Separar No EQ em dois campos obrigatorios na Programacao (No EQ - Numero + No EQ - Tipo), com validacao de digitos no numero e bloqueio de save quando qualquer um estiver ausente.
- [x] Corrigir lock da funcao set_project_programming_electrical_eq_catalog (FOR UPDATE OF pp) para eliminar erro em outer join no cadastro em lote (migration 153).
- [x] Implementar checkbox ETAPA UNICA na Programacao, persistir flag etapa_unica (single/lote) e usar ETAPA ÚNICA no INFO STATUS da Extracao ENEL quando marcado.
- [x] Refinar UI do checkbox ETAPA UNICA na Programacao (tamanho compacto, sem quebra de linha e alinhamento visual com o formulario).
- [x] Criar catalogo por tenant para `Estado do Projeto` (`programming_work_completion_catalog`) e migrar Programacao Simples (API + tela) para consumir opcoes dinamicas em vez de valores fixos.
- [x] Ajustar `Extracao ENEL NOVO` para manter em branco (temporario) as colunas `Tipo de cabo` e `Responsável cancelamento / Parcial / Adiamento`.
- [x] Exibir `Estado Trabalho` na coluna da `Lista de Programacoes` da Programacao Simples.
- [x] Exibir `Numero SGD` no modal `Detalhes da Programacao`.
- [x] Permitir `Nº EQ - Numero` alfanumerico (letras + numeros) no frontend e backend, e corrigir mapeamento da `Extracao ENEL NOVO` para manter `Tipo de cabo` em branco.
- [x] Ajustar nome do arquivo da `Extracao ENEL NOVO` para `PROGRAMAÇÃO_ANGRA_INDICA.XLSB`.
- [x] Excluir da `Extracao ENEL NOVO` registros com `Tipo de Serviço = EMERGENCIAL`.
- [x] Converter `Extracao ENEL NOVO` para workbook binario real `XLSB`, com nome fixo `PROGRAMAÇÃO_ANGRA_INDICA.xlsb`.
- [x] Ajustar `Extracao ENEL NOVO` para manter em branco (temporario) as colunas `Tipo de avanço` e `Tipo de serviço` (entre `Tipo de rede` e `Tipo de cabo`).
- [x] Padronizar a coluna Data Execução da Extracao ENEL NOVO para o formato dd/mm/yyyy (ex.: 10/11/2026).
- [x] Ajustar Extracao ENEL NOVO para consolidar uma unica linha por Projeto + Data e montar Responsável Execução com encarregados separados por  / .
- [x] Separar ETAPA em dois checkboxes (ETAPA ÚNICA e ETAPA FINAL) com exclusao mutua, persistencia no banco (etapa_final) e reflexo no INFO STATUS da extracao ENEL.
- [x] Corrigir filtro de Estado Trabalho na Programacao Simples com comparacao normalizada (sem diferenca por acento/espaco/caixa), evitando falso zero na listagem.
- [x] Adicionar compatibilidade de Estado Trabalho por UUID (work_completion_status_id) com backfill e trigger de sincronismo codigo/UUID, mantendo fallback legado para CONCLUIDO em /api/projects sem perda de historico.
- [x] Corrigir fallback de leitura em /api/programacao para ambientes sem coluna etapa_final, preservando work_completion_status e evitando filtro Estado Trabalho zerado por downgrade indevido de select.
- [x] Corrigir falha de "Sessao invalida para editar programacao" no submit da Programacao Simples, com refresh de token via `supabase.auth.getSession()` e retry unico no `PUT` quando houver `401`.
- [x] Corrigir agrupamento da `Extracao ENEL NOVO` para consolidar encarregados por `SOB + Data Execucao`, evitando multiplas linhas do mesmo projeto quando houver mais de um encarregado.



- [x] Substituir o filtro `Status` da tela de `Projetos` por `Estado Trabalho`, consumindo o catalogo por tenant (`programming_work_completion_catalog`) com opcao `Nao informado`.
- [x] Adicionar filtro `Tipo SGD` na tela de `Projetos`, com suporte no `GET /api/projects` e no `GET /api/projects/meta`.
- [x] Adicionar filtro `Centro de Servico *` na tela de `Projetos`, com suporte no `GET /api/projects`, exportacao CSV e resumo da carteira.
- [x] Adicionar filtro `Tipo SGD` na `Programacao Simples` e na `Visualizacao Programacao`, aplicando o recorte na lista e no aviso de registro salvo fora dos filtros.
- [x] Exibir o nome do `Encarregado` na linha de equipe do `Calendario Semanal de Programacao`.
- [x] Corrigir hotfix da edicao na Programacao Simples para preservar `Hora termino` real do registro (inclusive em `Parcial`) ao clicar em `Editar`, sem forcar `12:00`.
- [x] Hardening da Programacao para evitar perda silenciosa de atividades: quando a carga de atividades falhar, sinalizar erro na API/tela, bloquear edicao insegura e preservar atividades atuais no `PUT` quando o payload vier sem lista de atividades.
- [x] Preservar `Apoio` legado (texto) na edicao da Programacao quando nao houver `supportItemId`, evitando limpeza involuntaria em registros antigos.
- [x] Embutir persistencia de `ETAPA UNICA` e `ETAPA FINAL` nas RPCs full (`single` e `batch`) por overload transacional, mantendo fallback compativel para ambientes sem a migration nova.
- [x] Ajustar a Medicao para herdar `CONCLUIDO` por projeto global (independente de data/equipe), aplicando para ordens `Programada` e `Nao programada` e preservando alerta de alteracao apos medicao.
- [x] Ajustar a Medicao para consolidacao economica de Estado Trabalho por projeto com hierarquia `CONCLUIDO > PARCIAL`, aplicando em ordens Programada/Nao programada e limitando o filtro da tela a Concluido, Parcial e Nao informado.
- [x] Ajustar a Medicao para exibir e filtrar todos os estados ativos de `Estado Trabalho` vindos da Programacao no `Status execucao`, incluindo estados nao economicos como `PENDENCIA`, mantendo catalogo por tenant.

- [x] Corrigir wrappers da Programacao com ETAPA UNICA/FINAL para eliminar chamada recursiva/assinatura invalida apos a migration 158, reaproveitando as bases save_project_programming_full/save_project_programming_batch_full e mantendo Ponto eletrico + N EQ + flags no mesmo fluxo.
- [x] Enriquecer o erro de conflito de horario da Programacao para exibir Equipe e Encarregado no modal de falha (TEAM_TIME_CONFLICT), tanto no cadastro em lote quanto no save individual.
- [x] Adicionar filtro de Municipio na Programacao Simples e filtro por Status Cancelado (checkbox Somente cancelados) na tela de Projetos, com suporte no querystring/API de listagem e exportacao.
- [x] Corrigir persistencia de Estado Trabalho na Programacao Simples quando `work_completion_status_id` ja existe: trigger de sincronismo agora respeita update explicito por texto (inclusive limpeza), recalcula UUID e evita reverter `CONCLUIDO` para valor anterior (`PARCIAL`).

- [x] Criar tela Meta para cadastrar valor diario por tipo de equipe e dias uteis editaveis por ciclo 21 a 20, com migration multi-tenant, API /api/meta, menu/permissoes, docs e README.

- [x] Ajustar tela Meta para listar ciclos pelas datas reais de medicao, calcular meta diaria por valor x equipes ativas e salvar valores/ciclo em cadastro unico.

- [x] Adicionar lista operacional na tela Meta com detalhes, historico, edicao e bloqueio de duplicidade de ciclo na RPC de salvamento.

- [x] Corrigir salvamento da tela Meta com migration incremental 162 para recriar a RPC de cadastro por ciclo e expor detalhe tecnico de erro do Supabase.

- [x] Corrigir normalizacao monetaria da API Meta para preservar centavos quando o frontend envia valor diario como numero decimal.

- [x] Alinhar historico e edicao da tela Meta ao padrao da Medicao e mover Meta/Atividades para a secao Cadastros.

- [x] Aplicar borda amarela nos blocos da tela Meta durante a edicao, seguindo o padrao das demais telas cadastrais.

- [x] Salvar dias padrao segunda a sexta na Meta e exibir Meta ciclo padrao ao lado da Meta ciclo ajustada por dias uteis.

- [x] Adicionar Dias trabalhados na Meta pela media de dias com medicao por equipe e calcular Meta ciclo trabalhado.

- [x] Ajustar Meta para usar Equipes medida manual no calculo das metas e manter Equipes ativas como referencia.

- [x] [Consolidada] Pendencias de dependencia registradas em 2026-04-29: registros historicos substituidos pela pendencia mais recente de `npm outdated`; `package.json` ainda mantem as versoes antigas.

- [x] Clarificar e endurecer Dias trabalhados da Meta usando Data execucao distinta por equipe nas medicoes.

- [x] Arredondar Dias trabalhados da Meta e recalcular Meta ciclo trabalhado com o valor arredondado.

- [x] Filtrar Dias trabalhados da Meta somente por medicoes Com producao com base na Data execucao.

- [x] Corrigir migration 168 da Meta materializando a media de dias trabalhados em tabela temporaria.

- [x] Corrigir carregamento e soma de Equipes medida por ciclo salvo na tela Meta.

- [x] Adicionar Atualizar lista e Exportar Excel CSV na lista de metas salvas.

- [x] Corrigir edicao da Meta para salvar alteracoes por ciclo e recalcular metas por Equipes medida.

- [x] Criar primeira etapa do Dashboard Medicao com filtros, ciclo, valor versus meta e visao por encarregado.

- [x] Melhorar graficos do Dashboard Medicao com valores externos, modal ampliado, periodo mes/ano e seletor das tres metas nos encarregados.

- [x] Ajustar Dashboard Medicao para periodo De/Para independente do ciclo, seletor de meta no ciclo e dias dinamicos por meta.

- [x] Mover periodo De/Para para o grafico Concluidos x Parciais e adicionar legenda no grafico de encarregados.

- [x] Separar Concluidos x Parciais em graficos por ciclo e por periodo, trocar Projeto para filtro digitavel por SOB e permitir comparativo multiplo de metas nos encarregados.

- [x] Colocar graficos Concluidos x Parciais lado a lado e aplicar De/Para somente por botao Filtrar periodo.

- [x] Corrigir grafico Concluidos x Parciais por periodo para usar De/Para independente do ciclo selecionado.

- [x] Reorganizar Encarregados no ciclo em ranking de atingimento, bullet chart de metas e gap financeiro com tabela unica.

- [x] Adicionar expansao individual e titulo do ciclo em cada grafico de Encarregados no ciclo.

- [x] Definir De/Para inicial do grafico Concluidos x Parciais por periodo com o ano calendario corrente.

- [x] Ajustar filtros gerais do Dashboard Medicao para aplicar somente pelo botao Filtrar, sem recarregar automaticamente ao alterar campos.

- [x] Ajustar Projecao de fechamento do Dashboard Medicao para usar datas distintas de Data execucao e os dias da meta selecionada.
- [x] Adicionar no `Dashboard Medicao` o filtro e o grafico `Producao por supervisor`, somando a producao das equipes vinculadas em `teams.supervisor_person_id`.
- [x] Adicionar no `Dashboard Medicao` a alternancia da meta do supervisor entre `Equipes com producao` e `Todas vinculadas`, exibindo as duas bases na tabela.
- [x] Ajustar `Producao por supervisor` para exibir quadro grafico com `% atingimento`, `Bullet de meta` e `Gap financeiro`, respeitando a base `Equipes com producao` ou `Todas vinculadas`.
- [x] Adicionar filtro local por semana nos blocos `Encarregados no ciclo` e `Supervisor no ciclo`, sem alterar os filtros gerais do Dashboard Medicao.
- [x] Adicionar legendas nos graficos de ranking, bullet e gap dos blocos `Encarregados no ciclo` e `Supervisor no ciclo`.
- [x] Reposicionar legendas dos graficos de encarregados e supervisores acima do texto do ciclo/semana.
- [x] Ajustar bullet chart de metas com margem no eixo para exibir melhor o marcador de meta e remover a legenda global antiga dos encarregados.

- [x] Ocultar Projecao de fechamento no Ciclo da medicao quando a meta selecionada for Meta ciclo trabalhado.
- [x] Incluir Pendencias nos graficos Concluidos x Parciais do Dashboard Medicao, adicionar coluna de projetos nas tabelas de status/ciclo/encarregados/supervisor e card de Ticket medio no Ciclo da medicao.
- [x] Adicionar modal de projetos por Encarregado/Supervisor no Dashboard Medicao, com valor cobrado, centro, totalizador e exportacao Excel CSV.
- [x] Decisao arquitetural (2026-05-03): manter o SaaS como monolito modular, evitando microservicos/deploys separados e priorizando melhoria dos limites internos por modulo.
- [x] Iniciar modularizacao interna da `Programacao Simples` sem mudanca funcional, extraindo os contratos TypeScript para `src/modules/dashboard/programacao-simples/types.ts`.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair constantes para `constants.ts` mantendo comportamento e payloads atuais.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair utilitarios puros para `utils.ts`, sem mover funcao que dependa de CSS module, hook React, estado ou DOM.
- [x] Continuar modularizacao interna da `Programacao Simples`: separar regras de exportacao (`CSV`, `Extracao ENEL` e `Extracao ENEL NOVO`) em arquivo proprio, preservando layout e nomes de arquivo atuais.
- [x] Continuar modularizacao interna da `Programacao Simples`: separar chamadas HTTP locais em `api.ts` para carregamento, catalogo de atividades, sugestao/validacao de ETAPA, historico, save, cancelamento e adiamento sem alterar contratos da API.
- [x] Continuar modularizacao interna da `Programacao Simples`: criar fachada publica `index.ts`, importar a tela pela raiz do modulo e separar validadores locais em `validators.ts` sem alterar comportamento.
- [x] Continuar modularizacao interna da `Programacao Simples`: iniciar `hooks.ts` com `useProgrammingActivityCatalog` e `useProgrammingEtapaSuggestion`, preservando debounce, abort controller, loading e protecao contra sobrescrita manual da ETAPA.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair `useProgrammingBoardData` para carregamento principal, aplicacao de snapshot, loading da lista e refresh pos-save sem alterar contratos da API.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair componentes de modal para `components.tsx` (`Deadline`, `Details`, `History`, `Postpone`, `Cancel`, `Alert` e `StageConflict`) mantendo estados e regras operacionais no PageView.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair painel de prazos para `ProgrammingDeadlinePanel` em `components.tsx`, mantendo calculos, estado, API e payloads no PageView.
- [x] Integrar `useErrorLogger("programacao_simples")` na `Programacao Simples`, registrando falhas de carregamento, historico, save, cancelamento, adiamento, ETAPA e exportacoes em `app_error_logs` com contexto seguro.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair calendario semanal para `ProgrammingWeeklyCalendarPanel` em `components.tsx`, mantendo calculos e callbacks no PageView.
- [x] Continuar modularizacao interna da `Programacao Simples`: extrair formulario de cadastro/edicao para `ProgrammingFormPanel` em `components.tsx`, mantendo estado, validacao, submit, payload e API no PageView.
- [ ] Continuar modularizacao interna da `Programacao Simples`: extrair hooks de orquestracao de estado/carregamento e componentes de UI menores, mantendo o PageView como coordenador da tela.
- [ ] Continuar modularizacao interna da `Programacao Simples`: avaliar separacao posterior de hooks de dados, blocos de UI, exportacoes e regras locais de validacao.
- [x] Atualizar `docs/Tela_Programacao_Simples_SaaS.txt` a cada etapa estrutural da modularizacao, mapeando arquivos criados/alterados, funcoes tocadas e comportamento antes/depois.
- [x] Formalizar regra de monolito modular verdadeiro em `AGENTS.md` e `docs/Auditoria_Completa_SaaS.txt`: modulo precisa preservar fronteira de dependencia, fachada publica, shared apenas universal e backend espelhando dominio.
- [x] Generalizar rastreio unitario de materiais serializados para TRAFO, RELIGADOR e CHAVE, com serial_tracking_type, validacao de Serial/LP conforme tipo e tela Rastreio de SERIAL.
- [x] Criar botao `RET` no Rastreio de SERIAL para baixar 1 do saldo disponivel, manter a unidade fisica no rastreio, registrar auditoria e permitir movimentacao fisica posterior sem recompor disponibilidade.
- [x] Corrigir o GET do Rastreio de SERIAL apos a migration RET, desambiguando a FK de stock_centers para usar o centro atual da unidade.
- [x] Preservar e exibir saldo decimal no Estoque Atual, aceitando filtros com virgula ou ponto.
- [x] Corrigir validacao de Serial/LP em `Operacoes de Equipe`, separando origem real de `Requisicao` (centro de estoque -> equipe) e `Devolucao` (equipe -> centro de estoque), com autocomplete somente de unidades registradas em estoque.
- [x] Corrigir validacao de Serial/LP em `Movimentacao de Estoque`, mantendo `Entrada` para serial novo e restringindo `Saida`/`Transferencia` a unidades registradas no centro `DE` real.
- 2026-05-11: `npm outdated` registrou pendencias em @supabase/supabase-js, @tanstack/react-query, @types/node, eslint, eslint-config-next, next, react, react-dom e typescript; nenhuma dependencia foi atualizada nesta tarefa.
- [x] Revisar cadastro em massa para materiais rastreaveis, incluindo exemplos CSV de RELIGADOR, CHAVE e quantidade decimal.

- [x] Revisar RLS publica e criar hardening sem policies DELETE/ALL.

- [x] Corrigir edicao da Meta para recalcular Dias trabalhados do ciclo selecionado no backend antes de salvar.

- [x] Renomear Dias trabalhados da Meta para Media Dias trabalhados mantendo calculo por media de dias com medicao por equipe.
- [ ] Corrigir tela Meta para permitir gerar/salvar ciclo novo sem depender de medicao existente, e tratar ciclo ja cadastrado como edicao automatica quando selecionado no formulario.
- [x] Tratamento de seguranca Supabase (2026-05-07): criar migration versionada para fixar `search_path` das funcoes reportadas pelo linter (`function_search_path_mutable`) - atendido pelas migrations `210_harden_function_search_path_and_rpc_execute.sql`, `250_revoke_trigger_functions_from_public.sql`, `251_restrict_rpc_execute_to_service_role.sql` e reforcos posteriores.
- [x] Tratamento de seguranca Supabase (2026-05-07): criar migration versionada para revogar `EXECUTE` do role `anon` nas RPCs `SECURITY DEFINER` - atendido pelas migrations `210_harden_function_search_path_and_rpc_execute.sql`, `251_restrict_rpc_execute_to_service_role.sql` e `278_harden_security_advisor_warnings.sql`.
- [x] Tratamento de seguranca Supabase (2026-05-07): classificar RPCs `SECURITY DEFINER` acessiveis por `authenticated` entre uso intencional do app e uso exclusivo de `service_role` - consolidado na auditoria/migration `251` e no script `scripts/check-security-definer.ps1`.
- [x] [Duplicada] Tratamento de seguranca Supabase (2026-05-07): habilitar Leaked Password Protection no Supabase Auth e registrar evidencia de validacao apos novo linter sem alertas - pendencia manual mantida nas linhas especificas de Leaked Password Protection, pois nao pode ser resolvida por migration.

- [x] Implementar aviso obrigatorio para projeto com Estado Trabalho CONCLUIDO em Programacao (programar/reprogramar/adiar/cancelar), exigindo troca para status diferente de CONCLUIDO na edicao e propagando o novo estado para outros dias programados do mesmo projeto.
- [x] Exibir `Centro de servico` no modal `Todos os prazos das obras` da Programacao Simples e incluir a coluna na exportacao CSV de prazos.

- [x] Melhorar modal de conflito para projeto CONCLUIDO na Programacao: blocos visuais destacados + select de Estado Trabalho no proprio modal para ajuste rapido.
- [x] Adicionar botao `Salvar` no modal de conflito para projeto `CONCLUIDO` na Programacao Simples, persistindo a troca de `Estado Trabalho` sem exigir fechar o modal e acionar `Salvar edicao` no formulario principal.
- [x] Criar tela Faturamento baseada no fluxo da Medicao, com projeto, tipo, motivo sem producao, observacao, atividades pagas, valor por item, cadastro em massa, historico e status ABERTA/FECHADA/CANCELADA.
- [x] Criar migration 176_create_project_billing_module.sql com tabelas/RLS/RPCs transacionais para project_billing_orders, itens, historico, lote parcial e permissao da pagina faturamento.
- [x] Evoluir regra de Garantia de faturamento minimo para calculo automatico por tipo de grupo quando a regra de pontuacao for definida.
- [x] Padronizar UX do Faturamento com o bloco Atividades faturadas e Cadastro em massa no mesmo padrao visual da Medicao, removendo Status inicial do resumo do cadastro.
- [x] Ajustar a malha de colunas do bloco Atividades faturadas do Faturamento para igualar o espacamento do inlineForm da Medicao.
- [x] Adicionar respiro vertical entre campos de inclusao do Faturamento e a tabela de atividades para alinhar o botao Adicionar ao padrao visual da Medicao.
- [x] Ajustar espacamento dos botoes do Faturamento nos blocos de cadastro, filtros e lista para evitar elementos colados aos campos/resumos.
- 2026-05-09: Ajustado o rotulo do resumo da lista de faturamentos de Valor da pagina para Valor total.
- 2026-05-09: Faturamento ajustado para registrar apenas quantidade e taxa por atividade, com valor calculado automaticamente pela regra da Medicao.
- [x] Criar tela `Medicao Asbuilt` separada, baseada no fluxo do `Faturamento`, com rota, menu, permissao, API, tabelas/RLS/RPCs proprias, historico e status `ABERTA`, `FECHADA` e `CANCELADA`.
- [x] Ajustar o Faturamento para remover valor manual por item e calcular automaticamente o valor pela mesma regra da Medicao: `Pontos x Quantidade x Taxa x Valor unitario`, persistindo o total calculado no banco/RPC.
- [x] Alinhar o modelo de itens entre `Faturamento` e `Medicao Asbuilt` por `Projeto + Atividade + Pontos + Quantidade + Taxa + Valor unitario + Valor calculado`, preservando `tenant_id`, RLS, historico e `expectedUpdatedAt`.
- [x] Corrigir o resumo `Valor total filtrado` da lista de `Medicao Asbuilt` para somar todos os registros retornados pelos filtros, independente da pagina visivel.
- [x] Corrigir parser decimal do cadastro em massa em `Faturamento` e `Medicao Asbuilt` para aceitar `1,5`, `1.5`, `1.234,56` e `1,234.56` sem transformar decimal em inteiro.
- [x] Permitir registrar codigo de atividade inativo em `Faturamento` e `Medicao Asbuilt`, salvando snapshot `activity_active_snapshot` no item sem alterar a regra da tela `Medicao`.
- [x] Corrigir leitura de itens importados em massa no detalhe/edicao de `Faturamento` e `Medicao Asbuilt`, incluindo fallback para bancos sem `activity_active_snapshot` e migration incremental `178`.
- [x] Bloquear cadastro manual e em massa de `Medicao Asbuilt` para projetos inativos, filtrando o catalogo por projetos ativos e adicionando trava de banco na migration `184`.
- [x] Criar tela `Dash operacional e faturamento` para comparar, por projeto, os codigos de atividade usados em `Medicao`, `Medicao Asbuilt` e `Faturamento`, consolidando uma linha unica por codigo com somatorio de quantidade e valor por origem; filtros obrigatorios: Projeto, Codigo de atividade, Atividade ativa/inativa, Mostrar somente divergencias, Mostrar somente codigos ausentes em alguma base e Centro de servico; sem filtro de data e sem filtro de equipe.
- [x] Adicionar no `Dash operacional e faturamento` a tabela `Categorias cobradas no faturamento`, agrupando codigos faturados por categoria da atividade (`service_activities.type_service`) e somando quantidade e valor cobrado por projeto.
- [x] Criar `docs/Tela_Medicao_Asbuilt_SaaS.txt` e registrar que o dashboard comparativo fica para etapa futura.
- [x] Corrigir carregamento de `Operacoes de Equipe` apos a migration `179`, adicionando fallback de leitura para schema em transicao e logs tecnicos por etapa da API.





- [x] Ajustar Estado Trabalho da Programacao para salvar somente a programacao selecionada, removendo propagacao para outros dias do projeto e desativando o trigger legado de sincronizacao por Projeto + Data.

- [x] Ajustar Status execucao da Medicao para usar o ultimo Estado Trabalho nao vazio do projeto, sem hierarquia fixa entre CONCLUIDO, PARCIAL e demais estados.

- [x] Ajustar cascata de Estado Trabalho da Programacao para sincronizar somente outras equipes do mesmo Projeto + Data execucao, sem afetar outros dias.
- [x] Ajustar o filtro `Projeto` do `Dash operacional e faturamento` para funcionar no mesmo padrao do filtro de `Projeto` da `Programacao Simples`: `input + datalist`, digitacao por SOB, validacao por codigo exato, preenchimento automatico do centro de servico quando o projeto for reconhecido e bloqueio de filtro com texto digitado sem projeto valido.
- [x] Evoluir a tabela `Resumo por categoria` no `Dash operacional e faturamento` para exibir colunas dinamicas por categoria (`VOZ`, `POSTE`, `ESTRUTURA`, `CONDUTOR(REDE)`, `PODA` e demais usadas no resultado), com linhas por origem (`Medicao`, `Medicao Asbuilt`, `Faturamento`) e soma de quantidade/valor.
- [ ] Versionar no repositorio a carga refinada atual de `types_service_activities`, pois as migrations legadas ainda registram categorias agrupadas enquanto o banco operacional separa categorias como `POSTE (INSTALADO)`, `POSTE (RETIRADO)`, `CONDUTOR (REDE INSTALADO)` e `CONDUTOR (REDE RETIRADO)`.
- [x] Corrigir `Categorias cobradas no faturamento` do `Dash operacional e faturamento` para usar o mesmo agregado final de `Codigos por origem`, exibindo categorias sempre que houver quantidade/valor de Faturamento nas linhas filtradas.
- [x] Ajustar categorias do `Dash operacional e faturamento` para serem montadas a partir de todos os codigos exibidos em `Codigos por origem`, evitando tabela vazia quando ha Medicao/Asbuilt e ainda nao ha itens de Faturamento.
- [x] Remover coluna `Total qtd.` do `Resumo por categoria` do `Dash operacional e faturamento` e adicionar botao proprio de `Exportar CSV` para o resumo.
- [x] Transformar totais financeiros de `Medicao`, `Asbuilt` e `Faturamento` em cards dentro do bloco `Codigos por origem` no `Dash operacional e faturamento`.
- [x] Adicionar no `Dash operacional e faturamento` o grafico operacional com filtro proprio para comparar `Total medido`, `Medido (AS BUILT)`, `As Built` e `Faturado`, considerando `Medido (AS BUILT)` como o valor medido nos projetos que possuem registro em Medicao Asbuilt.
- [x] Adicionar tabela no `Grafico operacional` do `Dash operacional e faturamento` mostrando valor, quantidade de projetos e quantidade de medicoes para `Total medido`, `Medido (AS BUILT)`, `As Built` e `Faturado`.
- [x] Incluir `projeto` e `centro_servico` nas exportacoes CSV de `Codigos por origem` e `Resumo por categoria` do `Dash operacional e faturamento`.
- [x] Formatar como moeda (`R$`) as colunas de valor nas exportacoes CSV de `Codigos por origem` e `Resumo por categoria` do `Dash operacional e faturamento`.
- [x] Incluir o numero do Projeto (SOB) no nome dos arquivos CSV exportados em `Codigos por origem` e `Resumo por categoria` do `Dash operacional e faturamento`.
- [x] Mover o card `Filtros` do comparativo do `Dash operacional e faturamento` para ficar abaixo do `Grafico operacional`.
- [x] Adicionar abaixo de `Resumo por categoria` a tabela `Projetos por valor`, com valores consolidados de `Medicao`, `Asbuilt` e `Faturamento`, e filtros por `Asbuilt menor que Medicao` e `Faturamento menor que Asbuilt`.
- [x] Adicionar filtros por Centro de servico e Projeto e botao de exportacao CSV na tabela `Projetos por valor` do `Dash operacional e faturamento`.
- [x] Ajustar `Projetos por valor` para ignorar valores zerados nos filtros de menor que, adicionar filtro por Estado de trabalho e paginar a lista em 20 projetos por pagina.
- [x] Mover a tabela `Projetos por valor` do `Dash operacional e faturamento` para ficar abaixo do `Grafico operacional`.

- [x] Proteger Salvar operacao em Operacoes de Equipe e Movimentacao de Estoque contra duplo clique, travando submit antes das validacoes assincronas e exibindo estado visual de salvamento.

- [x] Adicionar cards de Saldo total por UMB na Lista de Estoque Atual, usando resumo filtrado antes da paginacao e priorizando M, UN e KG.
- [x] Corrigir exportacao CSV da Lista de Estoque Atual para respeitar o `pageSize` efetivo da API e exportar todos os registros filtrados; documentar que os cards usam resumo filtrado completo antes da paginacao.
- [x] Corrigir cards e exportacao CSV do Rastreio de SERIAL para usar resumo filtrado completo antes da paginacao e respeitar o `pageSize` efetivo da API.
- [x] Ampliar filtros do Rastreio de SERIAL por rastreio, ultima operacao, tipo material, descricao, projeto ultimo, equipe atual, encarregado atual e periodo da ultima movimentacao.

- [x] Ajustar Extracao ENEL NOVO para preencher km com o valor informado em REDE (quantidade) sem somar equipes do mesmo projeto/data, e permitir REDE decimal com virgula ou ponto na Programacao Simples.
- [x] Incluir a coluna `Prioridade` no modal `Todos os prazos das obras` da Programacao Simples e na exportacao CSV de prazos.
- [x] Adicionar filtros de `60 dias` e `90 dias` no painel `Prazos das Obras` da Programacao Simples, refletindo tambem no modal `Ver todos` e na exportacao CSV.

- [x] Definir e implementar escopo funcional inicial do `Dashboard Estoque` com 6 graficos: `Dispersao Requisicao/Devolucao`, `Materiais criticos e zerados`, `Top materiais por saldo`, `Materiais sem giro`, `Curva ABC do estoque` e `Evolucao de movimentacoes`; centro de estoque mantido apenas como filtro, sem ranking por centro.
- [x] Implementar o grafico de dispersao de materiais em `Operacoes de Equipe`, com alternancia por botao entre `Requisicao` e `Devolucao`, filtros por periodo, centro de estoque, equipe, projeto, material e tipo (`NOVO`/`SUCATA`), preservando escopo por `tenant_id`.
- [x] Implementar endpoint agregado para o `Dashboard Estoque` lendo `stock_transfers`, `stock_transfer_items`, `stock_transfer_team_operations`, `stock_center_balances`, `materials`, `teams` e `project`, sem recalcular saldo no frontend e sem expor centros de equipe na consulta publica de estoque.
- [x] Criar tela, rota, permissao, menu e documentacao `/docs/Tela_Dash_Estoque_SaaS.txt` para o `Dashboard Estoque`, seguindo o padrao dos dashboards existentes e registrando impacto multi-tenant/RLS.
- [x] Ajustar rotulos da navegacao para `/home` como `Home` e `/dash-estoque` como `Dashboard Estoque`, com modal ampliado e escala `Raiz`/`Linear` no grafico de dispersao de materiais.
- [x] Adicionar controle de zoom no modal expandido da dispersao de materiais do `Dashboard Estoque`, mantendo escala `Raiz`/`Linear` e separando melhor os circulos sobrepostos.
- [x] Melhorar a dispersao expandida do `Dashboard Estoque` com lista lateral rolavel, selecao de material para foco unico e eixo `Operacoes` por extenso.
- [x] Colorir os circulos da dispersao do `Dashboard Estoque` por faixa de quantidade, com legenda no grafico usando faixas `<= 50`, `51-100`, `101-200` e intervalos de 200 em 200.
- [x] Ajustar filtros do `Dashboard Estoque` para consultar somente pelo botao `Filtrar` e alterar `Evolucao de movimentacoes` para contar linhas mensais por tipo, sem somar UMB diferentes.
- [x] Adicionar modo `Quantidade` na `Curva ABC do estoque`, mantendo alternancia com o modo `Valor` no `Dashboard Estoque`.
- [x] Adicionar cards por UMB dentro da `Dispersao de materiais` do `Dashboard Estoque`, alternando a quantidade movimentada conforme `Requisicao` ou `Devolucao`.
- [x] Corrigir carregamento dos itens de movimentacao do `Dashboard Estoque`, separando leitura de `stock_transfer_items` e `materials` para evitar falha no carregamento da tela.
- [x] Reduzir lotes de filtros `.in(...)` do `Dashboard Estoque` para movimentacoes/estornos e registrar log tecnico quando `stock_transfer_items` falhar.
- [x] Agrupar os cards de saldo por UMB do `Dashboard Estoque` em um bloco visual `Estoque`.
- [x] Adicionar exportacao Excel (CSV) da tabela gerada na `Dispersao de materiais`, respeitando a operacao ativa `Requisicao` ou `Devolucao`.
- [x] Persistir `stock_transfers.operation_event_id` como regra de negocio por `tenant_id + data + equipe + projeto + status` e ajustar a evolucao do `Dashboard Estoque` para contar eventos operacionais unicos.

- [x] Corrigir Status execucao da Medicao para usar o ultimo Estado Trabalho por `Data + Projeto`, considerando Programacao do mesmo projeto com data menor ou igual a data da Medicao e desempate por `updated_at`.
- [x] Corrigir graficos do Dashboard Medicao para consolidar `Concluidos`, `Parciais` e `Pendencias` pelo Estado Trabalho vigente em `Data + Projeto`, sem aplicar estados futuros em ciclos passados.
- [x] Refinar a legenda de cores da dispersao do `Dashboard Estoque` para usar faixas de 10 em 10 ate 50, mantendo intervalos maiores acima disso.
- [x] Ajustar meta de encarregados/supervisores no Dashboard Medicao para usar historico de tipo da equipe por periodo real, somando valor diario do tipo x dias no tipo quando houver troca no ciclo.

- [x] Corrigir filtro de equipes selecionaveis na Programacao Simples para listar todas as equipes ativas do tenant, sem limitar pelo centro de servico do projeto.

- [x] Liberar a Programacao e a copia de Programacao para usar equipes ativas de qualquer centro de servico, mantendo validacoes por tenant, equipe ativa, conflito de horario e concorrencia.

- [x] Reordenar o modal `Todos os prazos das obras` da Programacao Simples e seu CSV para exibir `SOB`, `Centro de servico`, `Prioridade`, `Tipo de obra`, `Data limite`, `Data Programacao`, `Motivo`, `Status do prazo`, `Dias para vencimento` e `Faixa`.

- [x] Incluir a coluna `Estado Trabalho` depois de `Motivo` no modal `Todos os prazos das obras` da Programacao Simples e na exportacao CSV de prazos.

- [x] Preencher automaticamente `Estado Trabalho = PARCIAL` no primeiro cadastro de Programacao de cada projeto por tenant.

- [x] Ajustar `Status execucao` da Medicao para usar o ultimo `Estado Trabalho` global do projeto, independente da data da ordem de Medicao.

- [x] Ajustar cadastro em massa de Materiais previstos e Atividades previstas em Projetos para aceitar XLSX com `projeto`, `codigo` e `quantidade`, permitindo varios projetos no mesmo arquivo e gerando CSV de erros por linha/coluna.

- [ ] Publicar/recriar no banco remoto as RPCs `precheck_project_activity_forecast_import` e `append_project_activity_forecast`, pois o cadastro em massa de `Atividades previstas` na tela Projetos depende delas e o Supabase remoto respondeu `PGRST202` para ambas em 2026-06-05.

- [x] Padronizar o acionamento de importacao de Materiais previstos e Atividades previstas em Projetos como botao/modal Cadastro em massa, mantendo modelo XLSX e CSV de erros.

- [x] Remover botao externo Baixar modelo (.xlsx) das abas Materiais previstos e Atividades previstas, mantendo o download apenas no modal Cadastro em massa.

- [x] Ajustar importacao em massa de previstos em Projetos para ignorar codigos ja existentes no projeto e cadastrar somente os codigos novos, gerando CSV de erros/avisos para linhas ignoradas.

- [x] Corrigir selecao de Projeto (SOB) em Materiais previstos e Atividades previstas para usar catalogo completo do tenant e carregar a lista mesmo quando o projeto nao esta na pagina atual.

- [x] Criar tela `Consumo por Projeto` em Almoxarifado, com selecao de projeto, tabela de Codigo do Material, Descricao, Quantidade prevista, Quantidade Requisicao, Quantidade Devolucao, Qtd Liquida e Desvio, alem do grafico `Consumo x Previsto`.

- [x] Ajustar a tela `Consumo por Projeto` para sugerir `Codigo do material` por datalist, mantendo `Projeto` no padrao digitavel da Medicao, e adicionar botao `Extrair Excel` na tabela `Materiais do projeto`.

- [x] Evoluir `Consumo por Projeto` com colunas `Em estoque` e `Situacao`, usando cores por situacao sem criar tabela nova no Supabase.

- [x] Remover `Saldo necessario` e `Falta em estoque` da tabela e da exportacao de `Consumo por Projeto`, mantendo os calculos apenas para classificacao interna da situacao.

- [x] Remover o bloco `Resumo por situacao` de `Consumo por Projeto`, mantendo a situacao apenas na linha do material.

- [x] Ajustar os cards de `Consumo por Projeto` para exibir apenas contagens de materiais distintos: `Materiais`, `Requisicao`, `Devolucao`, `Em estoque` e `Falta em estoque`.

- [x] Adicionar filtros locais em `Materiais do projeto` para `Requisicao <> 0`, `Devolucao <> 0`, `Em estoque <> 0`, `Liquida <> 0` e `Situacao`, aplicando tambem na exportacao.

- [x] Reposicionar a coluna `Em estoque` antes de `Quantidade prevista` na tabela e na exportacao de `Consumo por Projeto`.

- [x] Incluir `Parcial planejado beneficio atingido` nos graficos/tabelas de status do Dashboard Medicao e abrir modal de projetos ao clicar nas linhas das tabelas de status.

- [x] Corrigir a Lista de Ordens de Medicao para buscar registros em lotes no backend e nao depender do limite padrao do Supabase/PostgREST, mantendo filtros por tenant, periodo, projeto, equipe e status.

- [x] Ampliar o modal de Detalhes da Ordem de Medicao para exibir mais colunas da tabela em telas largas, mantendo os demais modais no tamanho padrao.

- [x] Ajustar a duplicidade da Medicao para permitir nova ordem quando a mesma Programacao foi reprogramada para outra data, mantendo bloqueio por Programacao + Projeto + Equipe + Data.

- [x] Corrigir Operacoes de Equipe para chamar a assinatura atual de save_stock_transfer_record com p_direct_purchase => false, evitando erro generico em requisicao para equipe CESTO mesmo com saldo disponivel.

- [x] Corrigir o resumo `Valor total` da Lista de Ordens de Medicao para ignorar ordens com `Status = CANCELADA`, mantendo o valor individual da linha para conferencia.

- [x] Detalhar erros de saldo zerado/insuficiente ao salvar Movimentacao de Estoque e Operacoes de Equipe, listando materiais afetados, saldo atual, quantidade solicitada e falta.

- [x] Analisar impacto de alterar `materials.codigo` em materiais ja cadastrados, confirmando que o saldo de almoxarifado permanece vinculado por `material_id` e que as telas passam a exibir o codigo atual do cadastro.

- [x] Melhorar leitura do Grafico operacional no Dash operacional e faturamento, adicionando ajuda contextual por barra, diferencas reais entre Medido, AS Built e Faturado, e percentuais de conversao.
- [x] Adicionar entre `Grafico operacional` e `Projetos por valor` doze cards globais por categoria atual de postes, rede, equipamentos, transformadores, cruzetas e estruturas instalados/retirados, comparando quantidades de `Medidos`, `ASBUILT` e `Faturado` em todos os projetos ativos validos do tenant, com leitura paginada para nao truncar totais pelo limite padrao do PostgREST, grade desktop em duas linhas de seis cards e remocao do rodape tecnico duplicado.

- [x] Criar tela Composicao de Equipe com cadastro por Projeto + Equipe + Data, inclusao de pessoas, presenca por integrante, lista no formato operacional, detalhes em modal, historico e duas exportacoes CSV (lista e detalhes), preservando escopo por tenant_id.

- [x] Ajustar Patio da Composicao de Equipe para preencher automaticamente pelo Centro de Servico vinculado a equipe, mantendo o campo somente leitura e salvando snapshot a partir do backend.

- [x] Adicionar regras na Composicao de Equipe para listar campos obrigatorios pendentes no salvamento, bloquear matricula duplicada e impedir mais de um encarregado na mesma composicao.

- [x] Mover gravacao da Composicao de Equipe para RPC transacional save_team_composition_record, repetindo no banco as regras de campos obrigatorios, matricula duplicada e limite de um encarregado.

- [x] Corrigir salvamento da Composicao de Equipe para aceitar Patio manual como fallback quando a equipe nao possui Centro de Servico e evitar conflito falso quando expectedUpdatedAt vier nulo.

- [x] Melhorar diagnostico de erro da RPC de Composicao de Equipe e solicitar reload do schema cache na migration 201.

- [x] Ajustar Funcao da Composicao de Equipe para exibir e gravar somente o Cargo, removendo uso de tipo/nivel no snapshot.

- [x] Ajustar Telefone da Composicao de Equipe para repetir o telefone do encarregado em todos os integrantes, na tela, CSV e snapshot da RPC.

- [x] Blindar RPC de Composicao de Equipe com casts para text em matricula, CPF, telefone, projeto e placa para evitar erro numeric com string vazia.

- [x] Ajustar lista principal da Composicao de Equipe para exibir uma linha por composicao, mantendo integrantes em detalhes/edicao e no CSV detalhado.

- [x] Ajustar CSV Detalhes da Composicao de Equipe para exportar uma linha por integrante, repetindo os dados da composicao.

- [x] Ajustar CSV Detalhes da Composicao de Equipe para seguir o padrao operacional da planilha com colunas Data, PROJETO, Setor, Matricula, Colaborador, Funcao, CPF, TELEFONE, Patio, Placa, Hora inicial e Presente.

- [x] Exibir o encarregado junto ao nome da equipe nos selects de cadastro e filtro da Composicao de Equipe.

- [x] Permitir registrar na Composicao de Equipe a situacao `Nao atuou`, mantendo somente o encarregado da equipe marcado como ausente e exibindo a situacao na lista, detalhes e CSV.

- [x] Adicionar acima do cadastro da Composicao de Equipe um painel diario com cartoes vermelhos para equipes ativas pendentes e verdes para equipes com composicao cadastrada, incluindo contadores e selecao rapida da equipe pendente.

- [x] Corrigir a listagem e o painel da Composicao de Equipe para funcionar durante a transicao anterior a migration `224`, tratando registros sem `work_status` como `Atuando` sem interromper a consulta.

- [x] Adicionar filtro de data independente no painel de cartoes da Composicao de Equipe e permitir cadastro `Nao atuou` sem Projeto, mantendo Projeto obrigatorio para equipes atuando.

- [x] Remover do painel de cartoes o texto redundante `Acompanhamento de <data>`, mantendo somente o campo `Data do acompanhamento`.

- [x] Mover o filtro `Data do acompanhamento` para baixo do titulo `Composicoes das Equipes`, mantendo os contadores no lado direito do painel.

- [x] Adicionar filtro `Situacao da equipe` na lista da Composicao de Equipe, com opcoes `Todas`, `Atuando` e `Nao atuou`, aplicado no backend antes da paginacao/exportacao e preservando registros legados sem `work_status` como `Atuando`.

- [x] Ajustar Dashboard Medicao e Lista de Ordens de Medicao para priorizar o Estado Trabalho salvo na propria Medicao, usando a Programacao apenas como fallback para ordens antigas sem snapshot.

- [x] Corrigir normalizacao do Estado Trabalho na Medicao para preservar Parcial planejado beneficio atingido e permitir snapshots de estados normalizados alem de CONCLUIDO/PARCIAL.

- [x] Normalizar filtro de Estado Trabalho da Lista de Ordens de Medicao para encontrar Parcial planejado beneficio atingido mesmo quando o catalogo usa a grafia BENFICIO.

- [x] Alinhar fallback de Estado Trabalho entre Lista de Ordens de Medicao e Dashboard Medicao para ordens antigas sem snapshot.

- [x] Ajustar o botao principal da Programacao Simples para permanecer clicavel mesmo com campos obrigatorios pendentes, exibindo alerta e destaque visual dos campos faltantes no clique.

- [x] Corrigir `km` e `Qtd Postes` da `Extracao ENEL NOVO` para usar o primeiro valor preenchido do grupo consolidado em `REDE (quantidade)` e `POSTE (quantidade)`, preservando casas decimais de REDE sem arredondar para 2 casas.

- [x] Definir e implementar fluxo de Correcao de saldo dentro da Movimentacao de Estoque, registrando entrada/saida/transferencia de ajuste com marca propria, referencia da correcao, motivo obrigatorio e reflexo explicito no Estoque Atual.

- [x] Criar tela Estornos em Almoxarifado como consulta read-only dos estornos ja executados em Movimentacao de Estoque e Operacoes de Equipe, sem acao de estornar, com filtros, resumo, detalhes, exportacao CSV, API agregadora e permissao multi-tenant.

- [x] Analisar a regra do grafico `Concluidos X parciais por periodo` no Dashboard Medicao, identificando que a regra anterior priorizava o snapshot salvo na propria ordem de Medicao e precisava consolidar o status por projeto no recorte.

- [x] Ajustar o grafico `Concluidos X parciais` do Dashboard Medicao para consolidar qualquer status suportado por projeto no recorte: o ultimo Estado Trabalho ate o fim do ciclo/periodo vale para todas as medicoes do projeto dentro do recorte, mantendo snapshot da Medicao apenas como fallback sem Programacao.

- [x] Corrigir Operacoes de Equipe para chamar a assinatura completa atual de save_stock_transfer_record com p_operation_purpose NORMAL, evitando erro generico em Requisicao apos a migration 206, e mapear conflito tecnico de RPC para mensagem operacional clara.

- [x] Ajustar a Lista de Ordens de Medicao para consolidar qualquer Estado Trabalho por projeto no periodo filtrado: o ultimo status ate a Data fim vale para todas as ordens do projeto no recorte e no detalhe da ordem, mantendo snapshot da Medicao apenas como fallback sem Programacao.

- [x] Complementar correcao de Operacoes de Equipe com migration 209 para remover ambiguidade interna da wrapper save_stock_transfer_record apos operation_purpose, mantendo Requisicao como operacao NORMAL.

- [x] Corrigir estorno por item de Operacoes de Equipe e Movimentacao de Estoque para chamar a assinatura completa atual de `save_stock_transfer_record` com `p_operation_purpose = NORMAL`, evitando erro tecnico generico apos as migrations 206/209.

- [x] Corrigir alertas do Supabase Advisor para funcoes publicas: fixar `search_path` em funcoes legadas apontadas, revogar `EXECUTE` de `PUBLIC`/`anon`/`authenticated` para RPCs `SECURITY DEFINER` e manter execucao via `service_role` na migration 210.

- [x] Bloquear `Medicao Asbuilt` para projetos ja lancados no frontend, API e RPC, mantendo escopo por tenant e corrigindo o titulo da tela `/medicao-asbuilt` para nao herdar `Medicao`.

- [x] Normalizar codigos tecnicos legados de `Estado Trabalho` por tenant e proteger o snapshot da Medicao contra acentos, espacos e caracteres especiais, evitando falha ao salvar ordem com violacao de `project_measurement_orders_programming_completion_status_snapshot_check`.

- [x] Reparar cadastro multi-tenant da pagina `Estornos` em ambientes sem `page_key = estornos`, preenchendo somente permissoes ausentes sem sobrescrever configuracoes existentes.

- [x] Exibir lista inicial de usuarios do tenant na tela `Permissoes`, permitindo selecionar um usuario antes do formulario sem remover a busca por login ou matricula.

- [ ] Habilitar manualmente no Supabase Auth a protecao contra senhas vazadas (`Leaked password protection`) no painel/configuracao do projeto quando o plano permitir, pois nao ha `supabase/config.toml` ou setting versionado no repositorio atual.

- [x] Renomear o grafico por periodo do Dashboard Medicao para `Visao geral por periodo` e incluir `Garantia de faturamento minimo` como categoria financeira separada, sem alterar indicadores operacionais de ciclo, metas, encarregados e supervisores.

- [x] Ignorar Programacao com `status = CANCELADA` ao resolver o ultimo `Estado Trabalho` valido na Lista de Ordens de Medicao e no Dashboard Medicao, preservando o fim do ciclo para `Concluidos X parciais no ciclo` e o fim do filtro `De/Para` para `Visao geral por periodo`.

- [x] Adicionar na Lista de Ordens de Medicao a coluna `Composicao equipe` por Projeto + Equipe + Data de execucao e o card filtrado `Garantia de faturamento minimo`, ignorando ordens canceladas nos resumos.

- [x] Remover a coluna visual `Tipo` da Lista de Ordens de Medicao e exibir `Composicao equipe` tambem no modal de detalhes, preservando tipo no filtro, cadastro e exportacoes.

- [x] Separar metas do Dashboard Medicao em tabela oficial `Equipes no ciclo` por `team_id` e analise gerencial `Encarregados no ciclo`, exibindo somente encarregados salvos nas medicoes validas e rateando as tres metas conforme os dias medidos por equipe, com selecao independente de semana e metas nos dois blocos.

- [x] Colorir `Dif. prevista` no `Ciclo da medicao` do Dashboard Medicao: negativo em vermelho, positivo em verde e zero na cor padrao.

- [x] Separar `Ticket medio` do Dashboard Medicao em `Ticket medio / Projetos` e `Ticket medio / Servicos`, adicionando os dois cards tambem na `Visao geral por periodo` com base no recorte `De/Para`.

- [x] Adicionar no `Ciclo da medicao` o card `Ordens de Servicos no ciclo`, exibindo a quantidade de ordens `COM_PRODUCAO` do ciclo e filtros gerais aplicados.

- [x] Reposicionar os cards da `Visao geral por periodo` acima da tabela, incluir `Projetos no ciclo` e `Ordens de Servicos no ciclo` no periodo e adicionar linha de total nas tabelas de status.

- [x] Organizar os quatro cards da `Visao geral por periodo` em uma linha no desktop, com quebra responsiva para telas menores.

- [x] Adicionar no bloco `Indicadores operacionais medidos` do Dash operacional e faturamento os cards de `Ticket medio / Projetos` e `Ticket medio / Servicos` para `Medicao` e `Asbuilt`, usando a base global de projetos ativos validos do tenant.
- [x] Ajustar o Dash operacional e faturamento para calcular os tickets medios de `Medicao` e `Asbuilt` com valores de ordens dos projetos presentes nas duas bases, alem de adicionar filtro/coluna `Tipo de servico` vindo do cadastro de Projetos, linha `Total filtrado` e total no CSV da tabela `Projetos por valor`.
- [x] Corrigir `Asbuilt - Ticket medio / Servicos` no Dash operacional e faturamento para dividir o valor Asbuilt pela quantidade de ordens `COM_PRODUCAO` da Medicao nos projetos comparaveis, evitando que fique igual ao ticket por projeto quando ha uma ordem Asbuilt por projeto.
- [x] Adicionar na tabela `Projetos por valor` do Dash operacional e faturamento os checkboxes `Ocultar Medicao zerada` e `Ocultar Asbuilt zerado`, filtrando linhas com valor `0` na respectiva origem e reiniciando a paginacao local.
- [x] Adicionar na tabela `Projetos por valor` os filtros `Somente Medicao zerada` e `Somente Asbuilt zerado`, com exclusao mutua em relacao ao filtro `Ocultar` da mesma origem.
- [x] Adicionar `Servicos considerados ate` na Medicao Asbuilt, com migration, obrigatoriedade em novos registros, suporte a edicao/lista/detalhes/exportacoes/importacao CSV e historico, preservando registros legados sem backfill automatico.
- [x] Corrigir erro `42725` ao salvar Medicao Asbuilt apos a migration 218, renomeando a RPC antiga para helper interno e eliminando a ambiguidade de overload pela migration 219.
- [x] Versionar Medicao Asbuilt por `Projeto + Servicos considerados ate`, permitindo snapshots acumulados em cortes diferentes e fazendo o Dash operacional considerar somente o ultimo snapshot `FECHADA` por projeto.
- [ ] Evoluir a tela `Medicao Asbuilt` com nova visualizacao agrupada por projeto (linha por projeto exibindo ultimo Asbuilt, quantidade de fechamentos e valor acumulado; fechamentos expansiveis com itens internos) e alerta de duplicidade parecida ao salvar (mesmo projeto + codigos + quantidades + valores com data diferente — so alertar, nao bloquear).

- [x] [Consolidada] Pendencias registradas por `npm outdated` em 2026-06-02 antes de qualquer atualizacao: substituidas pela pendencia mais recente de 2026-06-11; `package.json` ainda mantem as versoes antigas.

- [x] Corrigir o campo `Valor estimado` em `Projetos` para aceitar valor monetario em formato brasileiro, evitando bloqueio do `input type=number` com `step=0.01` e normalizando entradas como `22.035,33` para `22035.33` antes de salvar.

- [x] Adicionar filtro `UMB` como select na tela de Materiais, carregando valores distintos do tenant, incluindo `Sem UMB` para registros legados e aplicando o recorte antes da paginacao e exportacao CSV.

- [x] Adicionar filtro `Tipo de Servico` na Medicao usando o catalogo ativo e o vinculo do projeto, aplicando o recorte antes da paginacao, totalizacao e exportacoes com escopo por tenant.

- [x] Adicionar filtro por Atividade na Medicao com autocomplete por codigo/descricao e recorte das ordens por item ativo antes da paginacao, totais e exportacoes.

- [x] Melhorar o `Dashboard Estoque`: mover a legenda `Quantidade` acima da area plotada da dispersao, exibir `UMB` na lista de materiais, remover o zoom e contar operacoes distintas por movimentacao na evolucao mensal e nos totais.

- [x] [Consolidada] Pendencias registradas por `npm outdated` em 2026-06-10 antes de qualquer atualizacao: substituidas pela pendencia mais recente de 2026-06-11; `package.json` ainda mantem as versoes antigas.

- [ ] Pendencias registradas por `npm outdated` em 2026-06-11 antes de qualquer atualizacao: `@supabase/supabase-js` `2.98.0 -> 2.108.1`, `@tanstack/react-query` `5.90.21 -> 5.101.0`, `@types/node` `20.19.37 -> 20.19.43` (`latest 25.9.3`), `@types/react` `19.2.14 -> 19.2.17`, `eslint` `9.39.4` (`latest 10.4.1`), `eslint-config-next` `16.1.6` (`latest 16.2.9`), `next` `16.1.6` (`latest 16.2.9`), `react` `19.2.3` (`latest 19.2.7`), `react-dom` `19.2.3` (`latest 19.2.7`) e `typescript` `5.9.3` (`latest 6.0.3`).

- [x] Corrigir o diagnostico do cadastro da `Programacao Simples` para preservar `reason/detail` das RPCs wrappers no retorno da API/modal e diferenciar falha HTTP/rede de erro do banco, evitando a mensagem generica `Falha ao cadastrar programacao em lote.`. Incluidos timeout de 30 segundos, codigos de transporte e migration 221 para preservar o detalhe SQL.

- [x] Corrigir a migration `221_preserve_programming_wrapper_error_details.sql` para selecionar somente as wrappers atuais com flags de etapa, ignorando os quatro overloads legados encontrados no banco sem remover funcoes existentes.

- [x] Corrigir o cadastro em massa de `Operacoes de Equipe` para reutilizar e limpar a tabela temporaria de seriais RET entre linhas da mesma transacao, evitando `relation "tmp_retired_serial_transfer_items" already exists` sem perder o rollback atomico.

- [x] Complementar a correcao do cadastro em massa de `Operacoes de Equipe` na funcao-base de estoque, reutilizando e limpando `tmp_stock_transfer_items` para evitar novo `relation already exists` depois da migration 222.

- [x] Endurecer o estorno por item da `Movimentacao de Estoque`, bloqueando antecipadamente linha ja estornada ou linha de estorno, falhando de forma segura se os vinculos nao puderem ser lidos e atualizando imediatamente o estado visual da linha.

- [x] Corrigir a listagem da `Movimentacao de Estoque` para carregar itens e vinculos de estorno em blocos de 100 IDs, evitando `TypeError: fetch failed` e o alerta de falha de validacao em tenants com muitas movimentacoes.

- [x] Exibir erros e impedimentos do estorno dentro do modal da `Movimentacao de Estoque`, detalhando saldo atual/solicitado/falta, orientando a regularizacao previa de `Operacoes de Equipe` e corrigindo o fechamento do modal apos sucesso.
- [x] [P1][Operacoes de Equipe][Estorno em lote] Ao selecionar uma linha, abrir modal agrupado pela requisicao, listar todos os materiais e seus status de estorno e permitir estornar atomicamente todos os itens ainda ativos, preservando o estorno individual, o escopo por tenant, a auditoria, a validacao de saldo/serial e a protecao contra concorrencia; base implementada pela migration `236_add_team_stock_operation_batch_reversal.sql` e agrupamento do import complementado pela migration `237_group_team_stock_imports_for_batch_reversal.sql`.
- [x] [P1][Operacoes de Equipe][Agrupamento do lote] Corrigir o estorno em lote do cadastro em massa, que criava um `transferId` por linha e mostrava somente um material no modal; adicionado `operation_batch_id`, backfill seguro dos lotes existentes e RPC `reverse_team_stock_operation_batch_v2` pela migration `237_group_team_stock_imports_for_batch_reversal.sql`.
- [x] [P1][Movimentacao de Estoque][Estorno em lote] Abrir o modal a partir da linha selecionada, listar todos os materiais da movimentacao ou do lote importado e permitir estorno individual ou atomico dos itens ainda ativos; importacoes novas recebem `operation_batch_id` pela migration `238_add_stock_transfer_batch_reversal.sql`, sem agrupamento retroativo inseguro por horario.
- [x] [P1][Movimentacao de Estoque][Backfill de lote] Corrigir movimentacoes importadas antes da migration 238 que exibiam somente um material no modal, agrupando apenas transferencias de item unico com mesmo tenant, ator, segundo e contexto operacional pela migration `239_backfill_stock_transfer_import_batches.sql`.
- [x] [P1][Movimentacao de Estoque][Lotes de cinco] Corrigir o backfill da migration 239, que separava a importacao por segundo e formava lotes de aproximadamente cinco materiais; a migration `240_merge_split_stock_transfer_import_batches.sql` une a sequencia continua do mesmo contexto sem alterar UUIDs de importacoes novas.
- [x] Auditar as regras de integridade, perda de dados e protecoes de banco de `Movimentacao de Estoque` e `Composicao de Equipe`, registrando os achados nas documentacoes das telas.
- [x] Bloquear em `Materiais` a alteracao/remocao acidental de rastreio por serial (`TRAFO`, `RELIGADOR`, `CHAVE`) quando o material ja possui `trafo_instances` ou movimentacoes com `serial_number`, protegendo `Movimentacao de Estoque` e `Operacoes de Equipe` contra divergencia entre saldo agregado e posicao unitaria.
- [x] [P1][Estoque seriado][Politica operacional] Definir e implementar o modelo de `estoque seriado pendente de identificacao` somente para materiais rastreaveis sem LP obrigatorio (`RELIGADOR`/`CHAVE` ou equivalentes) quando a regra operacional permitir pendencia; `TRAFO` permanece fora da flexibilizacao e continua exigindo `Serial + LP` em qualquer movimentacao.
- [x] [P1][Estoque seriado][Schema/RPC] Criar migration versionada para representar pendencias de serial sem violar `trafo_instances.serial_number/lot_code not null`, com constraints por tenant, indices por `tenant_id + material_id + stock_center_id + project_id`, auditoria e RPC transacional para identificar serial consumindo uma pendencia e criando/vinculando a unidade em `trafo_instances`; para `TRAFO`, a RPC rejeita pendencia e exige `Serial + LP`.
- [x] [P1][Estoque seriado][Configuracao futura] Preparar contrato interno para uma regra configuravel por Cadastro Base, sem criar a tela agora: `materials.allow_pending_serial_identification`; quando desmarcada, serial continua obrigatorio na entrada; quando marcada, entrada/transferencia fisica podem gerar pendencia; default inicial mantem `TRAFO = false` e permite configuracao futura para `RELIGADOR`/`CHAVE` sem refatorar a RPC.
- [x] [P1][Estoque seriado][Entrada/Transferencia] Ajustar `save_stock_transfer_record`, `/api/stock-transfers`, importacao CSV e `StockTransfersPageView` para aceitar serial opcional somente em `ENTRY` e em `TRANSFER` de quantidade pendente de materiais rastreaveis sem LP obrigatorio com pendencia permitida, preservando `TRAFO` com `Serial + LP` obrigatorios e preservando serial obrigatorio para `EXIT` normal e unidades ja identificadas.
- [x] [P1][Estoque seriado][Operacoes de Equipe][Guard] Manter `Requisicao`, `Devolucao` e `Retorno de campo` com serial obrigatorio para material rastreavel, incluindo bloqueio na RPC `save_team_stock_operation_record` para chamadas diretas sem serial.
- [ ] [P1][Estoque seriado][Operacoes de Equipe][Identificacao futura] Quando a quantidade solicitada exceder os seriais disponiveis, mostrar saldo fisico x seriais identificados x pendentes e oferecer fluxo `Identificar serial agora`, validando material, centro, disponibilidade, duplicidade e status antes de incluir a unidade na requisicao.
- [ ] [P1][Estoque seriado][Saida externa] Definir motivos/permissoes para saida externa de material rastreavel sem identificacao; o padrao deve exigir serial, e a excecao deve exigir permissao especifica, motivo, observacao, usuario responsavel e registro de auditoria.
- [ ] Exigir permissao de pagina/acao nas APIs de `Composicao de Equipe`, alem da autenticacao e do escopo de tenant; `Movimentacao de Estoque` e `Operacoes de Equipe` ja usam `requirePageAction` em leitura/criacao/estorno.
- [ ] Revogar escrita direta de `authenticated` em `stock_center_balances`, `stock_transfers`, `stock_transfer_items`, `team_compositions` e `team_composition_members`, mantendo gravacao apenas por RPC autorizada.
- [ ] Remover policies `FOR ALL` de `team_compositions` e `team_composition_members`, garantindo ausencia de `DELETE` direto apos migrations novas.
- [ ] Restringir RPCs `SECURITY DEFINER` de estorno ao `service_role` ou validar internamente `auth.uid()`, tenant, ator e permissao operacional.
- [ ] Adicionar chave de idempotencia ao cadastro em massa da `Movimentacao de Estoque`; o modo parcial, o identificador de lote e o status por linha ja estao implementados.
- [ ] Adicionar FKs compostas com `tenant_id` nas entidades do ledger de estoque e nos usuarios de auditoria.
- [ ] Criar reconciliacao automatizada entre `stock_center_balances`, ledger de transferencias e posicao unitaria de SERIAL.
- [ ] Mover o historico da `Composicao de Equipe` para dentro da RPC transacional e registrar diff detalhado dos integrantes.
- [ ] Preservar revisao da composicao usada pela `Medicao`, evitando que edicoes posteriores alterem retroativamente o contexto medido.
- [ ] Definir e aplicar a regra de uma pessoa presente em mais de uma equipe na mesma data.
- [ ] Validar o encarregado da composicao pelo `foreman_person_id` da equipe e definir se sua presenca e obrigatoria.
- [ ] Substituir o delete/reinsert de integrantes da composicao por sincronizacao ou versionamento imutavel.
- [x] Corrigir `Operacoes de Equipe` para carregar vinculos de estorno em blocos, bloquear linha ja estornada/linha de estorno no backend e atualizar imediatamente o estado visual apos o sucesso.
- [x] Garantir que todo erro do cadastro em massa de `Operacoes de Equipe`, inclusive arquivo invalido e falha tecnica sem linha identificada, gere CSV baixavel com linha, coluna, valor e erro.
- [x] Corrigir o resumo visual do cadastro em massa de `Operacoes de Equipe` para exibir importacao parcial e quantidade de erros quando houver CSV de erros, mesmo com linhas salvas.
- [x] Padronizar o filtro de Projeto em `Operacoes de Equipe` conforme `Medicao`, com datalist, validacao exata e filtro backend por `projectId`.
- [x] Corrigir a separacao entre `Movimentacao de Estoque` e `Operacoes de Equipe`, carregando os vinculos em blocos e impedindo que requisicoes e estornos de equipe aparecam como transferencias fisicas.
- [x] Corrigir o carregamento do `Estoque Atual` em tenants com muitas movimentacoes, consultando itens e relacoes historicas em blocos de ate 100 IDs.

- [x] Criar a tela `Controle de APR` no padrao visual da Medicao, com projeto cadastrado, ID APR globalmente unico, data sem futuro, equipe com encarregado, observacao, vinculo automatico com a Programacao do dia, situacoes Ativo/Cancelado/Divergente/Conferido, filtros, acoes Editar/Cancelar/Validar, historico transacional, RLS multi-tenant e extracao Excel.

- [x] Adicionar na Lista de Ordens de Medicao o card `Valor descontando garantia minima`, calculado pelo `Valor total - Garantia de faturamento minimo` sobre todas as paginas filtradas e ignorando ordens canceladas.
- [x] Criar tela `Estoque das Equipes` em Almoxarifado, com consulta read-only por equipe/material, filtros por encarregado/base/status/material/UMB/tipo/saldo, cards por UMB, detalhes, historico, exportacao CSV e permissao multi-tenant dedicada.
- [x] [P0][Programacao][Autorizacao] Criar helper server-side `requirePageAction` e aplicar `programacao-simples` + acao em todos os handlers de `/api/programacao`.
- [x] [P1][Permissoes][Granularidade] Evoluir a matriz persistida para diferenciar `read`, `create`, `update`, `cancel`, `reverse`, `import` e `export`. Migration 253 adiciona 6 colunas granulares (`can_create`, `can_update`, `can_cancel`, `can_reverse`, `can_import`, `can_export`) em `app_user_page_permissions`; backfill preserva comportamento atual (todas = `can_access`); `user_has_page_action()` mapeada para a coluna correta por acao; `save_user_permissions` sincroniza todas as colunas no toggle da UI; triggers de novo usuario/tela atualizados. Server-side `pageAuthorization.ts` agora seleciona todas as colunas e checa `can_access && ACTION_COLUMN[action]`. Edge Function `_shared/page_authorization.ts` corrigida: `PermissionRow` atualizado para colunas reais do banco (antes referenciava `can_select`/`can_insert` que nao existem). `role_page_permissions` permanece com `can_access` apenas (acesso por role = todas as acoes liberadas). UI granular por acao e tarefa futura dedicada.
- [x] [P0][Programacao][Transacao] Criar wrappers full decimais para gravar `rede_qty numeric` na mesma transacao, remover o ajuste pos-commit `applyProgrammingRedeQtyDecimal` e bloquear fallback parcial quando a migration 228 nao estiver aplicada.
- [x] [P0][Programacao][Historico] Criar RPC transacional para salvar Estado Trabalho com lock, `expectedUpdatedAt`, conflito estruturado e historico essencial no mesmo commit (migration 229).
- [x] [P0][Programacao][Seguranca] Revogar EXECUTE de authenticated em `copy_project_programming_to_dates`, fixar `search_path` seguro e manter somente `service_role` (migration 230).
- [ ] [P0][Multi-tenant] Revogar INSERT/UPDATE direto de authenticated nas tabelas operacionais criticas e migrar escrita para RPC/API autorizada.
- [x] [P0][Multi-tenant] Adicionar chaves/FKs compostas nas relacoes de Programacao, com preflight de dados legados, validacao das constraints e testes negativos de INSERT/UPDATE (migration 231).
- [x] [P0][Programacao][Concorrencia] Serializar insercoes por `tenant + equipe + data` com advisory transaction lock e trigger transacional (migration 232).
- [x] [P0][Projetos/Programacao][Concorrencia] Serializar inativacao de Projeto e gravacao de Programacao por `tenant + projeto` (migration 233).
- [x] [P0][Projetos][Autorizacao] Aplicar page/action guard nas rotas Next e imports XLSX.
- [x] [P0][Projetos/Programacao][Escrita] Remover escrita e EXECUTE diretos de authenticated no escopo das duas telas (migration 233).
- [x] [P0][Projetos][Multi-tenant] Aplicar FKs compostas nos historicos e previstos (migration 233).
- [x] [P1][Operacional] Criar infraestrutura generica de idempotencia para POST/PUT/PATCH criticos e registrar resposta de retries. Migration 252 cria tabela `idempotency_requests` (tenant_id, key, endpoint, response_status, response_body, expires_at, TTL 24h, RLS service_role). Helper `src/lib/server/idempotency.ts` exporta `withIdempotency(req, tenantId, endpoint, handler)`: verifica header `Idempotency-Key`, consulta cache, retorna resposta cacheada com `Idempotency-Replayed: true` em retentativas, ou executa handler e armazena resposta 2xx/4xx. Aplicado em `/api/programacao` POST BATCH_CREATE como endpoint canonico (duplo clique em Cadastrar programacao ja nao processa duas vezes). Padrão para aplicar nos demais: `withIdempotency(req, tenantId, '/api/<rota>:<ACAO>', handler)`. Frontend deve gerar UUID v4 por submit e reutilizar na retentativa.
- [x] [P1][Edge Functions] Atomicidade + _shared + guards nas importacoes XLSX: extraidos _shared/http.ts (CORS por ALLOWED_ORIGIN env, respond, getBearerToken), _shared/xlsx.ts (parseWorkbook, tipos, utilitarios), _shared/supabase.ts (createServiceClient); page_authorization.ts corrigido (action mapeado para coluna can_insert/can_select/etc, removido dead code role_page_permissions, adicionado requireActiveTenant); import_project_forecast e import_project_activity_forecast refatorados para usar shared; atomicidade por projeto: loop continua em erros individuais, retorna 207 com projectsSucceeded/projectsFailed em caso parcial; sem rate limit (requer Deno KV — fora de escopo).
- [x] [P1][Dados] Investigar project_programming_activities com zero registros: CONFIRMADO comportamento esperado. Atividades sao opcionais operacionalmente; operadores nao preenchem o campo na pratica. Permissao projects/read verificada (ok), campo visivel no form (ok), RPC de salvamento correto (ok). Nenhum backfill necessario. Documentado no CRC de programacao.
- [x] [P1][Supabase] Alinhar CLI ao projeto: criado supabase/config.toml (supabase init); criado scripts/supabase-check-link.ps1 que valida project-ref lcusxnhhrjosxqgiphgp em supabase/.temp/project-ref ou .supabase/state.toml antes de qualquer comando critico; adicionados npm scripts db:link, db:check-link, db:status, db:migration-list, db:lint com preflight obrigatorio; db:status valida o projeto remoto via projects list, sem depender da stack Docker local; migration list e db lint usam --linked apos validar o project-ref.
- [x] [P1][Supabase] CI SECURITY DEFINER: auditoria estatica de 25 migrations pos-210; duas violations reais encontradas: (1) migration 245 — 2 trigger functions sem REVOKE, corrigidas por migration 250 (REVOKE + search_path pg_temp); (2) migrations 212-247 — 11 RPCs com GRANT desnecessario a authenticated confirmado por check ao vivo (10 expostas), corrigidas por migration 251 (REVOKE de authenticated, service_role mantido). CI estatico scripts/check-security-definer.ps1 agora detecta: sem REVOKE (critico), GRANT a anon (erro) e GRANT a authenticated (erro), com allowlist de violations historicas por numero de migration. npm scripts db:security-check e db:security-check-live.
- [x] [P2][Duplicacao] Criar src/lib/utils/csv.ts e migrar as copias confirmadas: escapeCsvValue (8 copias), downloadCsvFile (12 copias) e downloadBlobFile (1 copia) centralizados; 3 utils.ts de modulos (estoque, estoque-equipes, posicao-trafo) passam a re-exportar via alias csvEscape; 219 linhas removidas de 12 arquivos; tsc --noEmit 0 erros.
- [x] [P2][Duplicacao] Criar src/lib/utils/formatters.ts e parsers.ts e migrar copias confirmadas (formatDateTime em 12 arquivos, formatDate em 8, formatAuditActor em 6, formatCurrency em 3, parseCsvLine em 3); excecoes mantidas onde o comportamento diferia; -327 linhas; tsc --noEmit 0 erros.
- [x] [P2][Duplicacao] Reduzir duplicacoes em API routes: criado src/lib/server/apiHelpers.ts com 10 funcoes compartilhadas; removidas copias locais identicas de activities, people, teams, stock-transfers, faturamento; buildTeamTypeMap/buildJobTitleMap/buildTypeServiceMap reduzidos a wrappers de buildNameMap; bloco de paginacao (4 linhas) substituido por parsePagination() em 3 rotas; tsc --noEmit 0 erros.
- [x] [P2][Programacao] Mover a regra server-side para `src/server/modules/programacao` e reduzir a rota de 4777 linhas. -- ENCERRADO: rota ja esta em 661 linhas e logica esta em src/server/modules/programacao/ (catalogs.ts, rpc.ts, selects.ts, types.ts).
- [x] [P2][Modularizacao][Phase 5] Criar estrutura modular inicial para programacao/ProgrammingPageView.tsx (2425 linhas): criados types.ts (21 tipos: ViewMode, ScheduleTone, PeriodMode, DocumentKey, ProgrammingStatus, ProjectItem, TeamItem, DocumentEntry, ActivityCatalogItem, ScheduleActivityItem, ScheduleItem, SupportOptionItem, TeamSummaryItem, DragPayload, ScheduleFormState, ModalState, StatusAction, CancelModalState, SaveRequestPayload, ReprogramModalState, CopyModalState, FeedbackState, ProgrammingResponse, ActivityCatalogResponse, SaveProgrammingResponse, CopyProgrammingResponse), utils.ts (4 constantes + 26 funcoes puras: parseIsoDate, toIsoDate, addDays, startOfWeekMonday, createVisibleDates, formatDateShort, formatBoardDate, formatPeriodLabel, calculateExpectedMinutes, formatDuration, formatDisplayDate, formatDisplayDateTime, createEmptyDocuments, createDocuments, activityOptionLabel, buildDefaultForm, getDocumentState, detectScheduleIssue, getScheduleTone, sortSchedules, workloadStatusLabel, workloadPrimaryLabel, normalizeSchedule, buildConflictFeedbackMessage, findActivityOption, buildIncludedAtLabel), index.ts (re-export); PageView vai de 2425 -> 1910 linhas mantendo apenas 3 funcoes CSS-dependentes + componente; tsc --noEmit 0 erros.
- [x] [P2][Programacao] Continuar modularizacao interna de programacao/ProgrammingPageView.tsx. -- ENCERRADO: tela programacao (antiga) esta desativada; ProgrammingSimplePageView.tsx (2619 linhas) e a tela ativa.
- [x] [P2][Modularizacao] Modularizar ProgrammingSimplePageView.tsx (2619 linhas): extraidos 4 hooks de modal (useHistoryModal, useCancelModal, usePostponeModal, useCopyToDatesModal) para hooks.ts; PageView reduzido de 2619 → 2160 linhas (-459); tsc --noEmit 0 erros; CRC verificacao/crc/programacao.md atualizado.
- [ ] [P2][Testes] Adicionar testes de bypass de tenant/permissao, concorrencia simultanea, retry idempotente, lote invalido e falha de historico.
- [x] Exibir no `Ciclo da medicao` o objetivo acumulado e o `Ritmo produtivo` diario, somando a meta diaria do tipo vigente para cada par unico de equipe + data com medicao valida, respeitando os filtros e o tenant.
- [x] Aplicar autorizacao server-side `dashboard-medicao/read` no endpoint do dashboard e integrar `useErrorLogger("dashboard_medicao")` na tela.
- [x] Refinar o `Ritmo produtivo` para deixar explicito que usa somente equipes/datas com Medicao `COM_PRODUCAO` ativa e nao cancelada, excluindo `SEM_PRODUCAO` e Garantia de faturamento minimo.
- [x] Mover `Ritmo atual` e `Ritmo produtivo` para cards, remover a barra `Objetivo acumulado` e exibir a diferenca diaria na tabela.
- [x] Recalcular `Dias reais` da `Meta ciclo trabalhado` diretamente no Dashboard pelas equipes/datas filtradas, sem depender do `worked_days` persistido ao salvar a tela Meta.
- [x] Atualizar cards, lista e detalhe da tela Meta com a media atual de dias trabalhados no carregamento, mantendo persistencia somente no salvamento explicito e aplicando autorizacao server-side/log de erros.
- [x] Adicionar `Ritmo meta` com base em `Valor diario x Equipes medida` do ciclo e exibir na tabela as diferencas do ritmo atual contra o ritmo produtivo e contra o ritmo meta.

- [x] [Dashboard Equipes][Etapa 1] Definir o contrato funcional da nova tela: mover `Equipes no ciclo`, `Encarregados no ciclo`, ranking, bullet, gap financeiro e todo o bloco `Supervisor no ciclo`, mantendo os tres blocos gerais no Dashboard Medicao.
- [x] [Dashboard Equipes][Etapa 1] Definir o MK/equipe por `team_id` como unidade oficial de meta e registrar que encarregado sera detalhamento de contribuicao dentro do MK, sem rateio da meta oficial.
- [x] [Dashboard Equipes][Etapa 1] Mapear a lacuna de atribuicao simultanea: a Medicao atual possui somente um `foreman_name_snapshot` por ordem e nao divide uma mesma producao entre varios encarregados.
- [x] [Dashboard Equipes][Decisao de dados] Confirmado: cada ordem pertence integralmente ao encarregado salvo em foreman_name_snapshot; nao sera criada estrutura de contribuicoes fracionadas; modelo atual do Dashboard Equipes esta correto e nao precisa de migracao.
- [x] [Dashboard Equipes][Etapa 2] Extrair contratos e calculos compartilhados do Dashboard Medicao para `src/server/modules/team-performance`, com fachada publica e sem duplicar a rota atual.
- [x] [Dashboard Equipes][Etapa 3] Criar rota, endpoint, modulo visual, permissao `dashboard-equipes/read`, menu, migration 234 e integracao com `useErrorLogger("dashboard_equipes")`.
- [x] [Dashboard Equipes][Etapa 4] Mover os blocos de equipes, encarregados e supervisores para a nova tela e simplificar o Dashboard Medicao.
- [x] [Dashboard Equipes][Etapa 5] Refazer ranking, bullet e gap por MK/equipe e implementar modal com contribuicao dos encarregados, projetos, ordens, dias e exportacao CSV.
- [x] [Dashboard Equipes][Supervisor historico] Criar `team_supervisor_history` e ajustar `Supervisor no ciclo` para resolver supervisor por data da ordem e dias efetivos de vinculo na meta.
- [x] [Dashboard Equipes][Etapa 6] Validar soma por MK, isolamento multi-tenant, permissao server-side, lint, build e atualizar documentacao final.

- [x] Criar migration 235_add_performance_indexes.sql com dois índices ausentes: project_measurement_orders(tenant_id, measurement_kind, is_active, status) para o dashboard-medicao e stock_transfer_item_reversals(tenant_id, created_at desc) para filtro de data na tela de Estornos.
- [x] Aplicar singleton e cache de auth (TTL 45s por token+tenant) em appUsersAdmin.ts, eliminando novo client Supabase a cada request e reduzindo 4 queries de auth para 0 em requests repetidos dentro do TTL nas 68 rotas de API.
- [x] Remover select("*") de composicao-equipe/route.ts nas 3 ocorrencias (fetchCompositionById, cobertura diaria e lista paginada), substituindo por colunas explicitas conforme os tipos declarados.
- [x] Reduzir limit(50000) para limites conservadores em 6 pontos de 4 endpoints: consumo-projeto e dash-operacional-faturamento para 5.000, estornos (item e integral) e dash-operacional-faturamento/programacao para 2.000, dash-estoque para 5.000., eliminando novo client Supabase a cada request e reduzindo 4 queries de auth para 0 em requests repetidos dentro do TTL nas 68 rotas de API.
- [x] Fortalecer AGENTS.md com protocolo obrigatorio de uso da pasta verificacao, mapa de quando ler cada arquivo, regras de performance e trafego (banco, auth, API, front-end) e checklist completo por tela com 4 dimensoes (integridade, seguranca, performance, documentacao).
- [x] Expandir verificacao/06_performance.md com criterios objetivos por camada (banco, API, front-end), exemplos antes/depois, como confirmar com EXPLAIN ANALYZE e checklist de PR.
- [x] Criar verificacao/11_front_ui.md com regras exclusivas de front-end: debounce, dependencias de useEffect, filtro padrao de periodo, autenticacao centralizada e limite de linhas no PageView.
- [x] Criar verificacao/12_trafego_egress.md com limites de resposta por tipo de endpoint, quando cachear e nao cachear, log de resposta e prevencao de sobreposicao de dados.
- [x] Criar pasta verificacao/crc/ com template reutilizavel e CRCs dos modulos criticos: auth (4-5 queries por request, singleton ausente, cache ausente), programacao (15-20 queries por GET, sobreposicao de dados, arquivo de 4519 linhas) e dashboard_medicao (limit 10000 sem filtro de data, query duplicada de teams).
- [x] Adicionar secao de performance e trafego ao estrutura_saas_multitenant.md com regras de banco, cliente singleton, auth, limites de resposta por tipo, cache e checklist de validacao expandido.
- [x] Adicionar filtro de data no dashboard-medicao: discovery query leve (execution_date apenas, limit 3000) em paralelo com query principal COM_PRODUCAO (limit 2000, janela cycleStart..cycleEnd/De/Para), e SEM_PRODUCAO (limit 1000, mesma janela); elimina limit(10000) sem data em ambas as queries e garante que o seletor de ciclos historicos continue funcionando via discovery separada.
- [x] Adicionar cache in-memory (TTL 5min por tenant_id) nos 4 catálogos estáticos da Programacao (programming_sgd_types, programming_eq_catalog, programming_reason_catalog, programming_work_completion_catalog), eliminando 4 queries Supabase por abertura de tela e 2 por modal de detalhe.
- [x] Corrigir bug de regressao em composicao-equipe/route.ts: a substituicao de select("*") na sessao anterior removeu acidentalmente a definicao do closure fetchCompositionPage, deixando o arquivo sem compilar; closure restaurado.
- [x] Eliminar fallbacks sequenciais de deteccao de schema em programacao/route.ts: fetchProgrammingRows (5 queries sequenciais) e fetchProgrammingById (4 queries sequenciais) reduzidos a 1 query direta cada; removidas 5 constantes de select e isMissingEtapaFinalColumnError; todas as migrations ja aplicadas, fallbacks eram codigo morto.
- [x] Adicionar log de tamanho de resposta (threshold 100KB) nos 3 endpoints de maior payload: GET /api/programacao board, dashboard-medicao e dash-operacional-faturamento; console.warn com KB e tenant_id quando ultrapassar limite; sem helper compartilhado.
- [x] Unificar duas queries sequenciais de teams no dashboard-medicao: substituir teamsResult (equipes das ordens) + activeTeamsResult (equipes ativas) por uma query com .or('ativo.eq.true,id.in.(...)'); teamMap e activeTeamMap reconstruídos por filtro local; allTeams substitui referencias espalhadas em personIds, supervisorOptions e potentialSupervisorTeams.
- [x] Reduzir limit(10000) sem filtro de data em meta/route.ts: adicionar .gte("execution_date", 24 meses atras) e limit(3000); window calculado com addMonths local; workedDays de ciclos mais antigos ficam zerados (comportamento aceitavel para historico remoto).
- [x] Corrigir limit(100000) critico em mapa-programacao/route.ts: adicionar windowStart (18 meses atras via setUTCMonth) e limit(5000); remover fallback de deteccao de etapa_final (migration ja aplicada); projetos sem programacao recente exibidos como sem atividade recente conforme regra de negocio confirmada.
- [x] Cache in-memory para fetchTeams e fetchProjects em programacao/route.ts: TTL 5 min por tenant_id; _boardTeamsCache cobre as 4 queries de enriquecimento (teams + team_types + people + service_centers); _boardProjectsCache cobre project_with_labels; cache invalidado por expiresAt; erros de query nao sao cacheados.
- [x] [Dashboard Equipes][Etapa 6] Validacao final: soma por MK verificada em calculateTeamPerformanceWindow (acumulacao direta + participationPercentage correto); isolamento multi-tenant confirmado (tenantId em todas as queries, calculateTeamPerformanceWindow opera sobre orders pre-filtradas por tenant); permissao server-side confirmada via requirePageAction pageKey=dashboard-equipes action=read; tsc --noEmit 0 erros; eslint 0 erros; next build exit code 0 todas as rotas compiladas.
- [x] S3-4 Auditoria de indices via EXPLAIN ANALYZE: 6 queries criticas analisadas em producao; todos os planos usam Index Scan (nenhum Seq Scan preocupante); migration 235 confirmada em uso (idx_stock_transfer_item_reversals_tenant_created_at e idx_project_measurement_orders_tenant_exec_status); Seq Scans em project_programming sao corretos para tabela de ~390 rows e o planner migrara automaticamente quando crescer; nenhum indice novo necessario no momento.
- [x] [P2][Modularizacao][Phase 1] Extrair types, selects e normalizers de programacao/route.ts (4720 linhas): criados src/server/modules/programacao/types.ts (44 tipos), selects.ts (3 constantes SELECT), normalizers.ts (33 funcoes puras); route.ts atualizado para importar desses modulos; duplicatas removidas; tsc --noEmit 0 erros.
- [x] [P2][Modularizacao][Phase 2] Extrair catalogs e queries de programacao/route.ts
- [x] [P2][Modularizacao][Phase 3] Extrair rpc.ts de programacao/route.ts (3013 linhas): criado src/server/modules/programacao/rpc.ts com 11 funcoes (saveProgrammingFullViaRpc, saveProgrammingBatchFullViaRpc, resolveProgrammingSgdType, resolveProgrammingWorkCompletionStatus, resolveInitialProjectWorkCompletionStatus, resolveProgrammingEqCatalog, setProgrammingEnelFieldsViaRpc, setProgrammingExecutionResultViaRpc, setProgrammingElectricalFieldViaRpc, cancelProgrammingViaRpc, postponeProgrammingViaRpc); route.ts vai de 3013 -> 2370 linhas; tsc --noEmit 0 erros. (3959 linhas): criados catalogs.ts (CATALOG_TTL_MS, 6 Maps de cache TTL, 9 funcoes: fetchProjects, fetchTeams, fetchTeamsByIds, fetchSupportOptions, fetchProjectSupportDefaults, fetchProgrammingSgdTypes, fetchProgrammingEqCatalog, fetchProgrammingReasonCatalog, fetchProgrammingWorkCompletionCatalog) e queries.ts (11 funcoes: fetchProgrammingRows, fetchProgrammingWeekSummary, fetchProgrammingActivities, fetchProgrammingActivitiesForSave, fetchRescheduledProgrammingIds, fetchProgrammingHistory, fetchNextProgrammingStage, fetchProgrammingStageValidation, fetchProgrammingById, fetchProgrammingConflictPayload, fetchProgrammingResponseItem); route.ts vai de 3959 -> 3013 linhas; tsc --noEmit 0 erros.
- [x] [P2][Modularizacao][Phase 4] Extrair handlers de negocio de programacao/route.ts (2370 linhas): criado src/server/modules/programacao/handlers.ts (1639 linhas) com PROGRAMMING_PAGE_KEY, authorizeProgrammingAction, resolveTeamTimeConflictDetailedMessage, resolveProjectCompletedProgrammingContext, copyProgramming, copyProgrammingToDates, saveProgrammingBatch, saveProgramming, saveProgrammingWorkCompletionStatus; route.ts vai de 2370 -> 755 linhas, mantendo apenas GET, POST, PUT, PATCH como thin HTTP router; tsc --noEmit 0 erros.
- [x] Criar a tela `Apuracao de Fator Minimo` em `Operacao`, com endpoint protegido por `apuracao-fator-minimo/read`, filtros por periodo/status/tipo e selecao multipla de projeto/equipe/codigo de servico, simulacao server-side consolidada por equipe + data somente pelo botao `Simular`, detalhe sob demanda, paginacao do resultado e exportacao CSV.
- [x] Corrigir `STATUS` da `Extracao ENEL NOVO` para usar somente status operacional da Programacao (`PROGRAMADO`, `REPROGRAMADA`, `ADIADO`, `CANCELADO`), sem preencher `PARCIAL`/`CONCLUIDO` de `Estado Trabalho`.
- [x] Mover o bloco `Prazos das Obras` da tela `Programacao Simples` para `Mapa de Programacao`, mantendo janelas, carrossel, modal e exportacao CSV a partir da carteira consolidada.
- [x] Marcar no `Mapa de Programacao` obras com etapa cancelada/adiada e etapa ativa posterior como `Revisao de etapas`, preservando a numeracao historica da etapa interrompida e destacando card, tabela e detalhe.
- [x] Criar tabela dedicada de `Revisao de etapas` no `Mapa de Programacao`, com exportacao CSV e coluna de revisao isolada das tabelas gerais.
- [x] Bloquear novas divergencias `ADIADA/CANCELADA + CONCLUIDO` em Programacao com trigger no banco, ajustar backfill de inativas para nao herdar `CONCLUIDO`, ampliar auditoria read-only e destacar o alerta no Mapa de Programacao.
- [ ] [Apuracao de Fator Minimo][Extracao oficial] Modelar confirmacao da apuracao com snapshot imutavel de filtros, usuario, data/hora, regra aplicada, itens considerados e resultado por equipe/data.

- [x] Corrigir botao `Copiar programacao` na Programacao Simples para ficar desabilitado em programacoes `etapaUnica`, `etapaFinal` ou sem `etapaNumber`, evitando click habilitado que retornava alerta sem acao.
- [x] Adicionar validacao backend em `copyProgrammingToDates` para rejeitar etapas de destino menores ou iguais a etapa atual da programacao de origem, com mensagem explicativa no retorno 400.
- [x] [Substituido pela migration 274] O rollback compensatorio antigo em `copyProgrammingToDates` foi removido; a copia agora roda em RPC atomica e falha sem criar linhas quando qualquer destino/equipe falhar.
- [x] Corrigir `addTeamToProgramming` para propagar `Estado Trabalho` via fallback: quando `source.work_completion_status` e null, chama `resolveInitialProjectWorkCompletionStatus` para buscar o ultimo status ativo do projeto antes de criar o novo registro.
- [x] Adicionar useMemo `fullGroupScheduleIds` na Programacao Simples para pre-computar quais programacoes ja tem todas as equipes do tenant; botao `Adicionar equipe` fica desabilitado quando nao ha equipe disponivel para adicionar.
- [x] Adicionar escopo individual/grupo no modal `Adiar` da Programacao Simples (mesmo padrao do `Cancelar`): radio "Todas as equipes da obra neste dia" (padrao) e "Apenas esta equipe" (exige nova data); roteamento no backend via `postponeProgrammingViaRpc` (individual) ou `postponeProgrammingGroupViaRpc` (grupo) em 5 camadas (route.ts, handlers.ts, api.ts, hooks.ts, components.tsx).
- [x] Corrigir ReferenceError `postponeScope is not defined` na Programacao Simples adicionando `postponeScope` e `setPostponeScope` a desestruturacao do `usePostponeModal` no `ProgrammingSimplePageView.tsx`.
- [x] Corrigir erro `Atividades da Programacao nao foram carregadas` ao chunkar a query `.in("programming_id", programmingIds)` em lotes de 100 em `fetchProgrammingActivities`, evitando falha por URL longa no PostgREST quando a grade tem muitas programacoes.
- [x] Corrigir sugestao/gravação de taxa na Medicao `Sem producao`: tela passa a buscar a ultima taxa do projeto tambem nesse tipo, salva `manual_rate` sugerido/informado, cadastro em massa respeita taxa opcional em `SEM_PRODUCAO` e migration 268 faz backfill das ordens antigas com taxa tecnica `1`.
- [x] Corrigir a Programacao para bloquear programar/reprogramar sem ETAPA valida, preservar `ETAPA UNICA`/`ETAPA FINAL` no adiamento, corrigir programacoes ativas antigas sem etapa e adicionar constraint `project_programming_active_stage_required_check`.
- [x] Corrigir regressao da copia da Programacao causada pelo CHECK imediato de ETAPA ativa, substituindo por constraint trigger diferida na migration 270.
- [x] Corrigir falso bloqueio restante da copia da Programacao na trigger diferida de ETAPA ativa, validando a linha final persistida pela migration 271.
- [x] Criar `docs/Mapa_Regras_Programacao.md` com mapa consolidado das regras de negocio da Programacao por status, ETAPA, Estado Trabalho, adiamento, cancelamento, copia, adicao de equipe, sincronizacao e seguranca multi-tenant.
- [x] Remover preenchimento automatico de `Estado Trabalho` na Programacao: cadastro novo salva sem status, copia/adicao replica somente valor da linha modelo quando existir, docs e mapa de regras atualizados.
- [x] [P0][Programacao] Blindar Estado Trabalho `ANTECIPADO`: removido de seletores manuais, bloqueado no backend para edicao livre, migration 272 adiciona `anticipated_by_programming_id`/`anticipated_at`/`previous_work_completion_status`, valida CONCLUIDO anterior por tenant/projeto/ETAPA, restaura somente antecipacoes causadas pelo CONCLUIDO reaberto e corrige docs que ainda citavam limpeza legada `ANTECIPADA`.
- [ ] Executar no banco o saneamento dos 2 registros `CANCELADA`/`ETAPA 1` com `Estado Trabalho = ANTECIPADO` pelo script `scripts/fix-programming-anticipated-migration-272-canceled-stage1.sql` antes de reaplicar a migration `272_harden_anticipated_work_completion_status.sql`.
- [x] Adicionar auditoria read-only para diagnosticar bloqueadores da migration 272 e detalhar a mensagem de erro da migration com IDs/contexto dos registros invalidos.
- [x] Compatibilizar a auditoria read-only da migration 272 com bases pre-migration, removendo dependencia da coluna `anticipated_by_programming_id` antes de ela existir.
- [x] Criar script transacional de saneamento para limpar `Estado Trabalho = ANTECIPADO` invalido em programacoes `CANCELADA`/`ETAPA 1` que bloqueiam a migration 272.
- [x] Criar botao/modal `Reprogramar` na Programacao Simples para escopo `Somente esta equipe`, alterando a mesma linha via `PUT /api/programacao`, exigindo nova data diferente, motivo por select, observacao em correcao retroativa, alerta confirmavel de sequencia de ETAPA e mantendo historico/concorrencia do save transacional existente.
- [ ] [P1][Programacao] Implementar reprogramacao transacional em grupo por `programming_group_id` antes de habilitar `Todas as equipes deste grupo` no modal `Reprogramar`: hoje o radio fica desabilitado em `src/modules/dashboard/programacao-simples/components.tsx` e `confirmReprogram` bloqueia `reprogramScope === "group"` em `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx`.
- [ ] [P1][Programacao] Criar migration versionada com RPC `reprogram_project_programming_group` (ou nome equivalente do projeto), security definer, `search_path` fixo, EXECUTE restrito a `service_role`, filtro por `tenant_id + programming_group_id`, `FOR UPDATE` em todas as linhas ativas do grupo e rollback total em qualquer falha.
- [ ] [P1][Programacao] Na RPC de reprogramacao em grupo, validar antes de gravar: concorrencia da linha clicada por `expectedUpdatedAt`, nova data diferente, motivo obrigatorio, conflito de agenda/equipe para todas as linhas, regras de ETAPA/ETAPA UNICA/ETAPA FINAL, projeto com Estado Trabalho `CONCLUIDO`, duplicidade no grupo destino e preservacao de atividades/documentos/campos operacionais.
- [ ] [P1][Programacao] Integrar backend da reprogramacao em grupo em `src/server/modules/programacao/rpc.ts`, `src/server/modules/programacao/handlers.ts` e `src/app/api/programacao/route.ts`, retornando payload estruturado com IDs afetados, mensagens de conflito por equipe e `programming_group_id`.
- [ ] [P1][Programacao] Habilitar o radio `Todas as equipes deste grupo` no modal `Reprogramar` somente depois da RPC e da rota estarem prontas, fazendo `confirmReprogram` chamar o fluxo de grupo e atualizar a grade com todos os IDs retornados.
- [ ] [P1][Programacao] Atualizar `docs/Tela_Programacao_Simples_SaaS.txt` e `supabase/migrations/README.txt` documentando comportamento antes/depois, arquivos tocados, funcao/RPC criada, validacoes, rollback e impacto multi-tenant/RLS.
- [x] Organizar o cabecalho do modal `Copiar programacao`, exibindo origem em blocos separados para `Projeto`, `Equipe`, `Data atual` e `ETAPA`, com layout responsivo e quebra segura para codigos longos.
- [x] Aplicar o mesmo padrao visual de origem no modal `Reprogramar`, exibindo `Projeto`, `Equipe`, `Data atual` e `ETAPA` em blocos organizados e responsivos.
- [x] Corrigir falso bloqueio da trigger `enforce_completed_work_status_group_integrity` e o sincronismo texto/UUID de Estado Trabalho: a guarda de grupo para `CONCLUIDO` agora compara o Estado Trabalho canonico anterior e novo por texto/UUID, a limpeza explicita remove tambem `work_completion_status_id`, e edicoes operacionais comuns (ex.: KM/quantidades) passam a ser permitidas quando a linha ja era tecnicamente `CONCLUIDO` no mesmo `programming_group_id`.
- [x] Criar auditoria read-only pre-migration 279 para as obras `RC0323603639` e `RC0323603633`, listando divergencia texto/UUID de Estado Trabalho, grupos operacionais, linhas tecnicamente `CONCLUIDO` e riscos de falso bloqueio antes de aplicar a migration.
- [x] [Performance] Limitar `fetchProgrammingHistory` a 50 registros via `.limit(50)` para evitar carregamento irrestrito do historico de programacao (src/server/modules/programacao/queries.ts)
- [ ] [Performance][Cancelado] Validacao de janela de datas em `GET /api/programacao` foi revertida: o filtro padrao da tela usa o ano inteiro (01/01 a 31/12), tornando o limite de 60 dias incompativel com o modelo de negocio atual.
- [x] [Performance] Implementar paginacao real no banco em `GET /api/medicao` via `isSimplePaginationMode`: quando nenhum filtro em memoria esta ativo (activityId, programmingMatch, workCompletionStatus, completionAlert), a rota usa `count:"exact"` + `.range()` em vez de `fetchPagedSupabaseRows` + slice em memoria (src/app/api/medicao/route.ts)
- [x] [Observabilidade][Supabase] Criar consultas read-only de monitoramento para investigar picos de Disk I/O, cache, top queries, crescimento de tabelas, indices pouco usados, seq scans, conexoes, locks, API/PostgREST e Edge Functions. Arquivos: `scripts/supabase-monitoring-readonly.sql` para Postgres, `scripts/supabase-log-explorer-monitoring.sql` como aviso seguro no SQL Editor e `scripts/supabase-log-explorer-monitoring.txt` para colar no Logs Explorer.
- [x] [Observabilidade][Supabase] Corrigir a armadilha do `ERROR: 42601` em `timestamp_sub(...)`: o arquivo `.sql` de Logs Explorer agora roda sem erro no Postgres e aponta para o `.txt` com as consultas reais do Supabase Logs Explorer.
- [x] [Observabilidade][Supabase] Corrigir erro `ERROR: 42P01 relation "pg_stat_statements" does not exist` no `scripts/supabase-monitoring-readonly.sql`: blocos de top queries agora detectam `public.pg_stat_statements`, `extensions.pg_stat_statements` ou retornam aviso sem interromper os demais blocos.
- [x] [Observabilidade][Supabase Reports] Criar roteiro do relatorio `Indica Controle — Saúde, I/O e Performance` com exatamente 6 blocos iniciais: Disk I/O, CPU, API Requests + erros, Top 20 queries por tempo total, Cache hit rate e Tabelas/indices maiores. Arquivo: `scripts/supabase-report-indica-controle-saude-io-performance.txt`.
- [x] [Observabilidade][Supabase Reports] Remover o bloco legado `09_edge_functions_note` do script Postgres para nao aparecer como card extra; API/Edge ficam concentrados no bloco `API Requests + erros` do roteiro do Reports.
- [x] [Performance] Inverter ordem de query em `loadStockHistory` (stock-balance): antes buscava TODOS os stock_transfers do centro e depois filtrava por materialId; agora busca os stock_transfer_items do material primeiro (limit 2000), depois cruza com transfers filtrados por centro via `in("id", chunk)` (src/app/api/stock-balance/route.ts)
- [x] [Performance] Adicionar paginacao real no banco em `GET /api/stock-balance` (Estoque Atual): `shouldHydrateHistoricalZeros` agora exige `includeHistoricalZeros=1` (opt-in); caminho padrao usa `count:"exact"` + `.range()` com filtros em BD e query separada de resumo por UMB em paralelo; frontend ganhou campo `Incluir historico zerado` nos filtros (src/app/api/stock-balance/route.ts, src/modules/dashboard/estoque/)
- [x] [Performance] Operacoes de Equipe (`GET /api/team-stock-operations` - listagem): push de filtros para o banco (operationKind para stock_transfer_team_operations; projectId e entryType para stock_transfers; materialCode pre-resolvido via materials); loadTeamOperationRows e stock_transfers migrados para loadRowsInChunks; pré-resolucao de materialCode em paralelo com loadTeamOperationRows; early return quando materialCode nao encontra material (src/app/api/team-stock-operations/route.ts)
- [x] [Performance] Operacoes de Equipe (`loadTeamOperationHistory`): adicionado `.limit(200)` nas 3 queries paralelas de `material_history` para evitar varredura irrestrita da tabela append-only (src/app/api/team-stock-operations/route.ts)
- [x] [Performance][Auditoria Front] Auditar telas para refetch desnecessario, refresh automatico, carga duplicada no mount, SSR + client reload, refetch ao trocar aba, consulta por linha/card e modais carregando antes de abrir. Achados principais: Dashboard Medicao e Dashboard Equipes podem refazer a carga inicial ao preencher filtros derivados da primeira resposta; Dash Operacional/Faturamento faz duas chamadas automaticas no mount com metadados sobrepostos; React Query nao aparece nas telas operacionais auditadas.
- [x] [P1][Performance][Dashboard Medicao/Equipes] Evitar segunda chamada automatica no mount quando a primeira resposta preencher `startDate`/`endDate`/`selectedCycleStart` ou `cycleStart`; preservado refresh manual por filtros.
- [x] [P1][Performance][Dash Operacional/Faturamento] Consolidar carga inicial de metadados e valores de projetos para reduzir chamadas simultaneas ao mesmo endpoint; `loadProjectValues` passa a hidratar filtros, datas de corte, projetos por valor, cards operacionais e tickets em uma unica chamada inicial.
- [x] [P1][Performance][Medicao] Eliminar auto-refresh de composicao/listagem: a tela nao refaz mais busca ao focar/voltar para a aba nem a cada 60s; atualizacao fica sob demanda pelo botao `Atualizar lista` em `/medicao`.
- [x] [UX][Medicao] Remover indicador textual `Carregando...` do topo da lista de ordens para nao aparecer ao lado dos botoes durante acoes/carregamentos; feedback permanece nos botoes e estados da tabela.
- [ ] [P2][Performance][Telas com modais/historicos] Avaliar cache por item/projeto para abas e modais abertos repetidamente, mantendo carregamento sob demanda e evitando prefetch antes da abertura.
- [x] [Bug][Dashboard Estoque] Corrigir subcontagem na `Evolucao de movimentacoes`: a API parou de ignorar `stock_transfers.operation_event_id` (persistido por trigger) e voltou a prioriza-lo, usando o recalculo em runtime (`buildFallbackOperationEventId`) apenas quando a coluna estiver nula; o fallback tambem passou a usar o mesmo status do banco (`operation_kind` da equipe ou `movement_type`) em vez do `operationKind` inferido por `stock_center_id`, eliminando a divergencia de formula que colapsava eventos distintos na mesma chave e subcontava tipos como Requisicao (src/app/api/dash-estoque/route.ts).
- [x] [Bug][Performance][Dashboard Estoque] Corrigir truncamento silencioso em `loadTransfers`: a query usava `.limit(5000)`, mas o Supabase/PostgREST deste projeto aplica um teto de 1000 linhas por resposta, descartando sem erro o restante do periodo (ex.: em 2026, cortava em 03/06, apagando o resto de junho e meses seguintes de todas as agregacoes do Dashboard Estoque). Corrigido com paginacao real via `.range()` em lotes de 1000 (`DASH_TRANSFERS_MAX_ROWS = 20000`), ordenando por `entry_date, id`. Validado contra dados reais: Requisicao em 06/2026 subiu de 5 para 50 (src/app/api/dash-estoque/route.ts).
