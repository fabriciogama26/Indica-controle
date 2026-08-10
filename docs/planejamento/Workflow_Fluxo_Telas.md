# Workflow das Telas — encadeamento operacional

Levantamento feito em **2026-08-10** por leitura direta do código (47 telas na sidebar,
90 `route.ts`, 369 migrations) e dos documentos do repositório.

Escopo: o que falta para as telas formarem um fluxo de trabalho encadeado — handoffs, estado
compartilhado, pendências e travas de sequência. Não avalia a qualidade isolada de cada tela.

Fora de escopo: o pipeline de código até a publicação, tratado em
`docs/planejamento/Workflow_Git_Deploy.md`.

---

## 1. Referência interna — o único fluxo com handoff formal

A **Requisição de material** (`src/app/api/stock-requisitions/route.ts`) é hoje o único fluxo do
sistema com máquina de estados real:

- estados `PENDING → EM_ATENDIMENTO → ENCERRADO / CANCELADO`;
- `claimed_by` + `claim_expires_at` — impede dois almoxarifes no mesmo pedido;
- `quantity_fulfilled` + `unfulfilled_reason_code` — atendimento parcial com motivo;
- `resulting_transfer_item_id` — liga o pedido à saída física;
- edição direta recusada com `409` e mensagem de negócio.

É o padrão a replicar nas demais cadeias. Somam-se a ele, como base já saudável: escrita
administrativa centralizada em RPC com `expectedUpdatedAt` (lock otimista) e histórico, permissão
por página e ratchet de tamanho de arquivo.

---

## 2. Lacunas que impedem um fluxo encadeado

### 2.1 Não existe estado de ciclo de vida do projeto
`project` carrega apenas flags booleanas independentes: `is_active` (036), `is_test` (150),
`is_withdrawn` (174), `is_third_party` (307), `has_locacao` (060). O estado que o negócio usa —
*previsto → locado → programado → executado → medido → faturado* — **não existe como dado** e é
re-derivado por tela, com regras divergentes:

- Cronograma de Solicitações deriva da linha mais recente de `project_programming`;
- Dashboard Carteira Operacional deriva de RPC própria (`dashboard_portfolio_*`);
- Medição precisa de normalizador para duas grafias do mesmo estado
  (`PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO` × `PARCIAL_PLANEJADO_BENFICIO_ATINGIDO`).

Consequência: dois dashboards podem discordar sobre o mesmo projeto sem fonte para desempatar.
**É a causa-raiz das demais lacunas.**

**Precisa:** view/RPC única `project_stage_state` devolvendo `estagio_atual`, `proxima_acao`,
`bloqueio` e `desde_quando`, consumida por todas as telas.

### 2.2 As telas não se conversam
Em 47 telas existem **quatro** navegações para outra tela, e apenas duas carregam contexto:

- `src/modules/dashboard/composicao-equipe/TeamCompositionPageView.tsx:998` — Composição → Medição
  com projeto, equipe e data;
- `src/modules/dashboard/posicao-trafo/TrafoPositionPageView.tsx:373` — Rastreio → Movimentação;
- `src/modules/dashboard/mapa-programacao/MapProgrammingPageView.tsx:1137-1139` — três links sem
  querystring.

Sete transições reais do negócio não têm ligação nenhuma: Projeto→Locação, Locação→Programação,
Programação→APR, Programação→Composição, Medição→Faturamento, Solicitação→Atendimento,
Atendimento→Saída. Na prática o operador anota o SOB, volta na sidebar e redigita o filtro.

**Precisa:** ação "próximo passo" na linha de cada lista, por querystring hidratada no destino —
o padrão já existe, funciona e só precisa ser replicado.

### 2.3 Home é placeholder
`src/modules/dashboard/home/HomePageView.tsx` tem 49 linhas e três cards de texto fixo. Não existe
fila de trabalho: ninguém abre o sistema e vê o que está pendente para si.

**Precisa:** cockpit por papel, alimentado por dados que já existem — requisições `PENDING` e
claims vencendo, APRs Divergente/não conferidas, programações do dia sem composição, ciclo de
medição em aberto e projetos sem atividade prevista (RPC pronta em
`358_dashboard_portfolio_forecast_gaps_rpc.sql`).

### 2.4 Programação tem três implementações vivas
A sidebar mostra **"Programacao"** (`/programacao-simples`, congelada para escrita) e
**"Programacao (Normalizada)"** lado a lado (`src/components/layout/AppShell.tsx:34-35`), e ainda
existe a rota `/programacao` com 1.910 linhas de PageView fora do menu. Três tabelas de FK
(`project_measurement_orders.programming_id`, `project_apr_controls.programming_id`,
`cronograma_solicitacoes.programacao_id`) ainda apontam para linhas legadas.

Duas telas com o mesmo nome e regras distintas é o pior cenário possível para o fluxo.

**Precisa:** fechar as fases 4–6 do corte antes de qualquer investimento novo em Programação e
remover a rota órfã.

### 2.5 Zero sinal de atualização
Nenhuma assinatura Realtime no código (`channel` / `postgres_changes`: nenhuma ocorrência). Os dois
fluxos com duas pessoas — solicitante × almoxarife e encarregado × supervisor — dependem de F5. O
`claim_expires_at` expira sem avisar ninguém. Existe desenho parado em
`docs/planejamento/design_realtime_programacao_2026-07.md`.

**Precisa (mínimo viável):** invalidação/poll curto no Atendimento de Requisições e badge de
contagem na sidebar.

### 2.6 Permissão por tela é cosmética na maioria das rotas
15 dos 90 `route.ts` chamam `requirePage*`; 78 apenas resolvem sessão/tenant via
`resolveAuthenticatedAppUser`, que **não tem noção de página**. Como o menu é filtrado no cliente,
rotas como `faturamento`, `locacao`, `controle-apr`, `composicao-equipe` e `medicao/export`
respondem a qualquer usuário autenticado do tenant. RLS protege o tenant, não a permissão de tela —
e o CLAUDE.md seção 10 exige granularidade por operação.

### 2.7 Não há trava de sequência nem pré-requisito declarado
É possível medir sem composição de equipe (a tela apenas *informa* se existe composição ativa) e
programar projeto sem locação. As regras de ordem existem na cabeça do usuário, não no sistema.

**Precisa:** cada tela declarar seu pré-requisito e, quando não atendido, exibir o bloqueio **com
link para resolver** — barato apenas depois de 2.1.

---

## 3. O que falta por estágio

| Estágio (tela) | Falta para o fluxo |
|---|---|
| Projetos | Expor estágio do ciclo de vida, não flags; ação "criar locação" |
| Cronograma de Solicitações | Fechar a FK legada de `programacao_id` (fase 5 do corte) |
| Locação | Sinalizar o que falta para liberar programação; link de saída |
| Programação | Unificar as três telas em uma; encerrar a Simples |
| Composição de Equipe | Já tem o melhor handoff do app — manter e replicar |
| Controle de APR | Devolver pendência (Divergente / não conferido) para a Home |
| Medição | Pré-requisito de composição como bloqueio, não como aviso; link → Faturamento |
| Faturamento | `requirePageAction` na rota; entrada a partir da Medição fechada |
| Solicitação → Atendimento → Saída | Falta só visibilidade: contador e sinal de atualização |
| Estoque / Estoque Equipes / Mapa / Estornos / Consumo | Sem lacuna de fluxo relevante (consulta) |
| Dashboards (Medição, Equipes, Carteira, Operacional-Faturamento) | Ler o estágio da fonte única em vez de derivar cada um |

---

## 4. Ordem de execução

| Fase | O que fazer | Depende de |
|---|---|---|
| 1 | Terminar o corte da Programação (fases 4–6) | — |
| 2 | Criar `project_stage_state` como fonte única de estágio | Fase 1 |
| 3 | Home cockpit consumindo a fonte única + contadores por papel | Fase 2 |
| 4 | Deep links de "próximo passo" nas sete transições | Fase 2 |
| 5 | `requirePageAction` nas rotas de escrita | — |
| 6 | Sinal de atualização nos dois fluxos de duas pessoas | — |

A fase 1 vem primeiro porque qualquer trabalho de fluxo feito antes dela é feito duas vezes.
As fases 5 e 6 são independentes e podem correr em paralelo.

---

## 5. Divergências encontradas (CLAUDE.md seção 12)

- **`REGRA_DE_NEGOCIO.md` não contém regra de negócio.** O conteúdo é um prompt de "Auditoria de
  Contexto e Desperdício de Tokens". O CLAUDE.md lista esse arquivo como item 4 da hierarquia de
  prioridade — hoje aponta para o conteúdo errado.
- **`docs/Handoff_SaaS.txt` e `docs/00_Indice_SaaS.txt` estão desatualizados.** Afirmam que os CRUDs
  "ainda não são reais" e listam um conjunto de rotas ativas muito menor do que as ~47 existentes.
  Quem abrir uma task por esses arquivos parte de um mapa errado.
