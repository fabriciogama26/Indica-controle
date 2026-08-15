# Auditoria de Concorrência, Consistência Transacional e Conflitos de Estado — 2026-08-15

Executada conforme `prompts/auditoria-concorrencia.md`. Somente leitura — nenhuma correção foi aplicada além das já feitas nesta mesma sessão em Medição e Cronograma de Solicitações (ver `TASKS.md`, itens de 2026-08-15).

## Resumo executivo

- **Entidades cobertas:** Medição, Medição As Built, Cronograma de Solicitações (auditadas diretamente), Faturamento, Projetos, Controle de APR, Programação Normalizada, Requisições de Estoque, Transferências de Estoque, Operações de Equipe, Endereçamento de Almoxarifado, Posições de Trafo, Materiais, Pessoas, Cargos, Equipes, Composição de Equipe, Atividades de Serviço — 18 entidades, ~25 domínios de ação de escrita mapeados na íntegra.
- **4 achados 🔴 ativos** (fora do que já foi corrigido nesta sessão):
  1. **Cargos (Job Titles)** — único módulo do sistema sem RPC nenhuma: `PUT`/`PATCH` fazem `SELECT` em memória + `UPDATE` sem `WHERE updated_at` — lost update real.
  2. **Cargos** — `job_levels` é catálogo do tenant inteiro reescrito por completo a cada save de qualquer cargo, sem controle de versão — duas edições concorrentes de cargos diferentes podem apagar níveis uma da outra.
  3. **Faturamento** — criação (POST) não usa `withIdempotency` nem tem `UNIQUE` semântico; duplo clique/retry cria dois pedidos de faturamento distintos, ambos com sucesso — duplicação financeira silenciosa.
  4. **Projetos × Programação Normalizada** — cancelar um projeto e criar/reabrir uma etapa de Programação para o mesmo projeto usam *lock namespaces diferentes* (um `FOR UPDATE` de linha, outro `advisory lock`) e não se enxergam; pode terminar em projeto `CANCELADO` com etapa `PROGRAMADA` ativa — exatamente o estado que a regra de negócio proíbe.
- **~10 achados 🟡**, a maioria do mesmo padrão transversal: 409 devolve só `{message, reason}` (às vezes nem `currentUpdatedAt`) e o frontend, em várias telas (Projetos, Materiais, Pessoas, Cargos, Equipes, Atividades), chama `resetForm()` no conflito — apaga o que o usuário digitou sem alternativa. Mais dois achados pontuais: Requisição de Estoque sem idempotência na criação (janela estreita, efeito só se propaga se ninguém notar 2 linhas idênticas antes de atender); Equipes sem `UNIQUE`/`EXCLUSION` cobrindo "1 encarregado = 1 equipe ativa" (só `if exists` dentro da RPC).
- **O que já é sólido:** o padrão dominante do repositório — RPC `SECURITY DEFINER` com `SELECT...FOR UPDATE` + `expectedUpdatedAt` obrigatório — está corretamente implementado em Medição, Medição As Built, Materiais, Pessoas (caminho principal), Equipes (caminho principal), Atividades, Composição de Equipe, Controle de APR, Faturamento (status), Projetos, Programação Normalizada, e em todo o domínio de Estoque (Requisições, Transferências, Operações de Equipe, Endereçamento, Trafo). Nenhuma sobrescrita silenciosa foi encontrada nesses caminhos — quem perde a corrida recebe 409 explícito. Idempotência real (`withIdempotency` + header enviado pelo frontend) está corretamente plugada em 10 rotas críticas de estoque.
- **Nenhuma prioridade universal foi proposta** ("edição sempre vence") — cada achado de precedência é registrado por entidade, na seção correspondente.

## Achados 🔴 — detalhe e correção proposta

### 1. Cargos (Job Titles) — lost update real no UPDATE principal
`src/app/api/job-titles/route.ts` `PUT` (linhas 685-717) e `PATCH` (linhas 819-829): lê o cargo, compara `expectedUpdatedAt` em memória, grava com `.update(...).eq("tenant_id", ...).eq("id", jobTitleId)` — sem `.eq("updated_at", ...)`, sem `FOR UPDATE`, sem RPC. Duas edições quase simultâneas do mesmo cargo passam ambas no pré-check (nenhuma ainda escreveu) e a segunda sobrescreve a primeira sem erro para ninguém.
**Correção:** criar `save_job_title_record`/`set_job_title_record_status` seguindo o padrão já usado em materiais/pessoas/equipes/atividades (RPC + `FOR UPDATE` + `expectedUpdatedAt` obrigatório no `WHERE`).

### 2. Cargos — `job_levels` como catálogo compartilhado sem versão
`syncJobLevels` (`src/app/api/job-titles/route.ts:308-346`) faz `upsert` da lista de níveis do payload e desativa todo nível do tenant fora dessa lista — mas `job_levels` tem PK `(tenant_id, level)`, é do tenant inteiro, não do cargo. Duas edições concorrentes de cargos diferentes com listas distintas podem se pisar.
**Correção:** mover `job_levels` para dentro da mesma RPC do item 1, com diff explícito (não desativar o que está fora do payload do cargo específico).

### 3. Faturamento — criação sem idempotência
`POST /api/faturamento` não usa `withIdempotency` (10 rotas de estoque usam, faturamento não). A RPC `save_project_billing_order` sempre insere quando `p_billing_order_id` é nulo; o único `UNIQUE` é sobre `billing_number`, autogerado, nunca colide. Duplo clique ou retry de rede cria dois pedidos de faturamento distintos, ambos 200.
**Correção:** adicionar `withIdempotency` na rota POST (mesmo padrão de `stock-transfers`/`stock-requisitions`), chave por tenant+usuário+hash do payload.

### 4. Projetos × Programação Normalizada — cancelamento sem lock compartilhado
`set_project_record_status` trava `project` via `FOR UPDATE`, mas sua checagem interna de "programação pendente" ainda consulta a tabela **legada** `project_programming`, não a normalizada `programming`. Em paralelo, `save_project_programming_stage` só usa `pg_advisory_xact_lock(tenant:project)` — um lock namespace diferente do `FOR UPDATE` de linha. As duas operações não se bloqueiam. Cancelar o projeto e criar/reabrir uma etapa de Programação quase ao mesmo tempo pode deixar o projeto `CANCELADO` com etapa `PROGRAMADA`/`REPROGRAMADA` ativa.
**Correção:** fazer `set_project_record_status` reler a contagem de etapas ativas (via `programming`, normalizada) **dentro** da mesma transação/lock, e corrigir a checagem interna da RPC para não usar mais `project_programming`.

## Achados 🟡 — lista consolidada

| # | Entidade | Achado | Evidência |
|---|---|---|---|
| 1 | Requisição de Estoque | Criação (`POST /api/stock-requisitions`) sem `withIdempotency`; checagem de duplicidade é `EXISTS` sem lock | `stock-requisitions/route.ts:297-349`, RPC `295...sql:154-168` |
| 2 | Pessoas | Fallback `savePersonDirectFallback` grava sem `FOR UPDATE`/versão quando a RPC "parece ausente" | `people/route.ts:574-606` |
| 3 | Equipes | Mesmo fallback inseguro (`saveTeamDirectFallback`/`setTeamStatusDirectFallback`) | `teams/route.ts:691-718, 828-832` |
| 4 | Equipes | "1 encarregado = 1 equipe ativa" garantida só por `if exists`, sem `UNIQUE`/`EXCLUSION` | `093/175...sql`, `134...sql:82-96` |
| 5 | Projetos × Controle de APR | `save_project_apr_control` lê `project.is_active` sem `FOR UPDATE`; cancelamento concorrente pode criar APR presa a projeto já inativo | `350...sql:185-195` |
| 6 | Projetos | Frontend chama `resetFormState()` no 409, apagando o formulário do usuário que perde a corrida | `ProjectsPageView.tsx:2199-2202, 2270-2273` |
| 7 | Faturamento | Backend devolve `currentUpdatedAt` no 409, mas frontend descarta (`createApiError` só lê `message`) | `BillingPageView.tsx:113-118` |
| 8 | Controle de APR | 409 não devolve nem `currentUpdatedAt` (mais fraco que Faturamento/Programação nesse quesito) | `controle-apr/route.ts:355,412` |
| 9 | Medição As Built | 409 devolve `currentUpdatedAt` mas não `currentRecord`/`updatedBy`/`changedFields` (Medição já foi corrigida nesta sessão; Asbuilt ficou de fora) | `medicao-asbuilt/route.ts:847-853, 1079-1085` |
| 10 | Materiais/Pessoas/Cargos/Equipes/Atividades | 409 genérico (`{message, code}`, via `buildConcurrencyConflictResponse`) + `resetForm()` no frontend em todas as 5 telas | `src/lib/server/concurrency.ts:37-42` + páginas correspondentes |
| 11 | Composição de Equipe | 409 tratado como erro genérico (não perde formulário, mas não orienta a recarregar) | `TeamCompositionPageView.tsx:918-923` |

## Matriz de precedência — entidades com achado

**Cargos:** nenhuma regra de precedência é respeitada hoje — segundo save sempre sobrescreve, independente de qual ação. É o único caso em que nem o piso mínimo ("perdedor recebe conflito explícito") é cumprido.

**Projetos × Programação Normalizada:** hoje não há prioridade nenhuma entre "cancelar projeto" e "criar/reabrir etapa" — depende de timing sem lock compartilhado. Regra de negócio já existe (mensagem "Resolva essas etapas antes de inativar o projeto") mas não é aplicada atomicamente.

**Equipes (encarregado):** "criar/ativar equipe para encarregado X" concorrente — quem committar primeiro deveria vencer com erro explícito para o outro, mas a checagem `if exists` sem `UNIQUE` permite que ambos passem na janela entre checagem e commit.

Demais entidades (Medição, Medição As Built, Cronograma de Solicitações, Faturamento, Controle de APR, Programação Normalizada, todo o domínio de Estoque, Materiais, Pessoas/Atividades no caminho principal, Composição de Equipe): o piso "quem perde recebe conflito explícito" já é cumprido — não há achado de precedência.

## O que já está correto (não mexer sem motivo)

- **Medição / Medição As Built**: `FOR UPDATE` + `expectedUpdatedAt` obrigatório em save e troca de status; máquina de estados explícita (`ABERTA→FECHADA→ABERTA`, `CANCELAR` bloqueado só se já `CANCELADA`); criação sem vínculo de Programação protegida por `pg_advisory_xact_lock` + checagem de duplicidade por Projeto+Equipe+Data **dentro da mesma transação** (migration 202) — mais forte que um simples header de idempotência.
- **Cronograma de Solicitações**: corrigido nesta sessão (`UPDATE` condicionado a `status`+`updated_at`), 409 enriquecido.
- **Faturamento (status), Controle de APR, Projetos, Programação Normalizada**: todas as transições de status são atômicas via `FOR UPDATE`, com máquina de estados explícita e `expectedUpdatedAt` obrigatório.
- **Programação Normalizada** é o módulo mais bem protegido do repositório: soma `FOR UPDATE` de linha com `pg_advisory_xact_lock(tenant:project)` sempre que a operação precisa enxergar outras etapas do mesmo projeto — cobre a unidade real de consistência, não só a linha.
- **Domínio de Estoque inteiro** (Requisições, Transferências, Operações de Equipe, Endereçamento, Trafo): `FOR UPDATE` cobrindo saldo+movimento na mesma transação, `UNIQUE`/advisory lock como rede de segurança em toda reversão, e idempotência real (`withIdempotency` + header efetivamente enviado) em 10 das 12 rotas críticas.
- **Materiais, Pessoas (caminho principal), Equipes (caminho principal), Atividades, Composição de Equipe**: RPC + `FOR UPDATE` + `expectedUpdatedAt` obrigatório; Composição de Equipe trata equipe+membros+projetos como uma única unidade transacional, reforçada por `pg_advisory_xact_lock` + constraint trigger deferida para a regra "pessoa presente em uma só composição por dia".
- Duplo clique em **criação** está fechado por `UNIQUE`/índice parcial no banco (não só checagem em app) em: Materiais, Pessoas, Cargos, Equipes, Composição de Equipe, Atividades, Projetos, Controle de APR, Programação Normalizada, Cronograma de Solicitações.

## Plano de correção priorizado (aguardando autorização — nada foi alterado)

1. **Cargos** — migrar `PUT`/`PATCH` para RPC com `FOR UPDATE` + `expectedUpdatedAt` obrigatório, incluindo `job_levels` na mesma transação. (resolve achados 🔴 #1 e #2)
2. **Faturamento** — adicionar `withIdempotency` na rota de criação. (resolve achado 🔴 #3)
3. **Projetos × Programação Normalizada** — unificar a checagem de "etapas ativas" dentro do lock de cancelamento do projeto, e trocar a fonte de `project_programming` (legada) para `programming` (normalizada). (resolve achado 🔴 #4)
4. **Requisição de Estoque** — adicionar `withIdempotency` na criação. (🟡 #1)
5. **Equipes** — índice único parcial `(tenant_id, foreman_person_id) where ativo = true`. (🟡 #4)
6. **Projetos × Controle de APR** — adicionar `FOR UPDATE` na leitura de `project` dentro de `save_project_apr_control`. (🟡 #5)
7. **Transversal (ponto 7)** — enriquecer os 409 restantes (Medição As Built, Materiais, Pessoas, Cargos, Equipes, Atividades, Controle de APR) com `currentRecord`/`updatedBy`/`changedFields`, e parar de chamar `resetForm()` automaticamente nos frontends que ainda fazem isso (Projetos, Materiais, Pessoas, Cargos, Equipes, Atividades).
8. **Pessoas/Equipes** — remover ou proteger os fallbacks de escrita direta (🟡 #2, #3).

## Limitações declaradas

- Toda a análise é estática (código + migrations), rastreada até o `UPDATE`/`FOR UPDATE`/constraint final — nenhum cenário foi reproduzido com duas abas reais ou dois processos concorrentes de fato.
- Os dois achados cross-entidade (Projetos×Programação, Projetos×APR) foram deduzidos por rastreamento de lock namespaces no código-fonte; merecem validação manual antes de correção em produção.
- Não foi auditado o comportamento sob 3+ operações verdadeiramente simultâneas (só pares).
- A hipótese do fallback de Pessoas/Equipes disparar em produção hoje é avaliada como baixa probabilidade (schema atual não deveria mais acionar o gatilho), mas não foi possível confirmar rodando contra o banco real.
- Não foi auditado exaustivamente o corpo de `save_team_stock_operation_batch_full` linha a linha (inferência por padrão observado, não leitura completa).
