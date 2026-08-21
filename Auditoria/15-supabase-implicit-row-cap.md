# 15 - Supabase implicit row cap

Data: 2026-08-21
Estado: passos 2, 3 e 4 concluidos. Passo 5 (triagem P0) EM ANDAMENTO — 2 de 17 tabelas P0.
Escopo: truncamento implicito do PostgREST em QUALQUER consulta de `src/`, exportacao ou nao.
Nao confundir com `Auditoria/14-exportacoes-csv.md`, que tratou so de integridade de exportacao.

## Por que esta auditoria existe

A 14 fechou 18/18 violacoes conhecidas de `.limit()` acima do teto, 3 contratos de exportacao e
4 limites dinamicos, e o `row-limit-baseline.json` ficou vazio (commit `37feb75`). Mas o ratchet
daquela fase so enxerga UMA das formas do problema: `.limit(N)` com N literal acima de 1.000. A
quarta superficie — consulta que chega a execucao sem NENHUMA barreira e para em 1.000 em
silencio — nunca foi inventariada.

## O ajuste conceitual que define esta fase

**Nao se classifica chamada isolada. Classifica-se o caminho ate a execucao.**

O que precisa ser demonstrado e que o codigo consome toda a cardinalidade esperada, ou que a
consulta e comprovadamente unitaria. Presenca de metodo nao e prova.

```
SAFE
├─ .single() / .maybeSingle()
├─ count/head
├─ consulta comprovadamente unitaria (filtro por coluna UNIQUE/PK)
└─ helper cujo contrato garante paginacao da RESPOSTA ate exaustao

NAO E SAFE POR SI SO
├─ .limit()
├─ .range() isolado            <- `.range(0, 999)` sem iteracao E truncamento
├─ chunkValues(...) / loadRowsInChunks(...)
├─ filtro .in(...) quebrado em lotes
└─ helper que so limita PARAMETROS da consulta
```

Regra que resume tudo: **chunk de parametro != paginacao de resposta**. Isto

```ts
for (const chunk of chunkValues(ids)) { await query.in('id', chunk); }
```

limita a largura do FILTRO. Nao protege contra o teto de 1.000 linhas RETORNADAS.

### Definicao precisa de "paginacao ate exaustao"

Necessaria porque a base ja errou isto tres vezes de forma independente:

```
├─ parada em PAGINA VAZIA        (nunca "pagina menor que a pedida")
└─ avanco pelas linhas RECEBIDAS (nunca pelo tamanho do bloco pedido)
```

Historico: a exportacao de `/saida` parava comparando com o limite pedido; em `/estornos` o
aviso de "resultado parcial" era codigo morto porque comparava com valor inalcancavel (ambos
citados no cabecalho de `scripts/check-row-limit.mjs`); e o terceiro exemplar continua VIVO,
descrito abaixo.

## Inventario bruto (passo 3)

Varredura read-only de 360 fontes `.ts`/`.tsx` de `src/`, com a definicao restrita de SAFE.
Resultado em `Auditoria/15-inventario-bruto.csv` (489 linhas, schema de 8 campos).

| Categoria | Cadeias |
|---|---|
| TOTAL de cadeias `.from()` | **642** |
| SAFE por protocolo (`loadAllRows`) | 25 |
| SAFE por cardinalidade unitaria | 128 |
| **SEM barreira provada** | **489** |

### O numero e 489 candidatos brutos, nao 489 defeitos

Registro explicito, porque a diferenca importa: **489 sao pontos de execucao/cadeias suspeitas
pelo heuristico**. Alguns desaparecem quando o fluxo for seguido; outros podem SURGIR quando
helpers aparentemente seguros forem analisados corretamente. O numero de defeitos so existe
depois da analise de fluxo e de cardinalidade.

Esta superficie ja foi contada tres vezes, com tres numeros, e NENHUM deles e "defeitos". A
sequencia registra o custo de heuristico textual:

| Contagem | Numero | Por que mudou |
|---|---|---|
| 1a | 504 | tratava `.range()` isolado como barreira segura |
| 2a | 614 | `.range()` deixou de ser barreira (definicao mais rigorosa) |
| 3a | **489** | regex de `.maybeSingle<T>()` corrigido (ver retratacao adiante) |

Nao usar 504 nem 614 como linha de base de comparacao. So o 489 vale, e so ate a Compiler
API do passo 7 recontar com analise de fluxo.

### Distribuicao por pista presente (pista != barreira)

| Cadeias | Pista |
|---|---|
| 219 | `.in(...)` |
| 161 | nenhuma pista — consulta nua |
| 32 | `.limit(...)` (todos dentro do teto; acima dele foi zerado pela 14) |
| 19 | chunk + `.in(...)` |
| 18 | `.range(...)` isolado |
| 12 | `count: exact` |
| 10 | `.range(...)` + `.in(...)` |

### Distribuicao por ponto de execucao

| Cadeias | Ponto |
|---|---|
| 325 | `await` direto |
| 132 | indefinido pelo heuristico |
| 29 | callback |
| 3 | builder retornado |

Os 132 "indefinido" sao a medida da insuficiencia do heuristico textual, e a justificativa
concreta para o passo 7 usar a Compiler API: seguir o builder ate o sink e pergunta de fluxo de
dados, nao de sintaxe.

## Dois achados que ja mudam o desenho do classificador

### 1. `loadPaged` — o terceiro exemplar da condicao de parada errada, vivo

`src/server/modules/dashboard-portfolio/controller.ts:368` e uma reimplementacao privada do
`loadAllRows`, com a condicao de parada que o docstring do original proibe explicitamente:

```ts
if ((data ?? []).length < QUERY_PAGE_SIZE) break;   // "pagina menor que a pedida"
```

Hoje FUNCIONA, por coincidencia aritmetica: `QUERY_PAGE_SIZE = 1000` e igual ao
`SUPABASE_RESPONSE_ROW_CAP = 1000`, entao a primeira pagina cheia volta com exatamente 1.000 e o
laco continua. Nao e defeito ativo — e armadilha latente. Basta alguem elevar `QUERY_PAGE_SIZE`
para 2.000, num commit que parece otimizacao, e ele passa a truncar na primeira pagina
PARECENDO um laco de paginacao correto.

Um unico call site (`linha 488`, `loadMeasurementOrders` da Carteira Operacional).

Valor para o classificador: uma allowlist por NOME DE HELPER marca `loadPaged` como SAFE. So a
verificacao de PROTOCOLO o pega. E a prova mais limpa da tese desta auditoria, e esta no
repositorio, nao numa taxonomia teorica.

### 2. RETRATADO — a categoria SAFE "unitaria" NAO e vazia: sao 119 chamadas

Este documento afirmou, numa versao anterior, que `.single()`/`.maybeSingle()` apareciam
**1 vez** em todo o `src/`, e concluiu dai que a triagem nao poderia se apoiar em sintaxe
para provar unicidade, e que a Compiler API seria insuficiente sem uma lista de colunas
UNIQUE das migrations.

**A afirmacao estava errada e a conclusao caiu junto.** O grep usado era
`\.single()\|\.maybeSingle()`, que nao casa a forma com parametro generico
`.maybeSingle<PagePermissionRow>()` — e essa e a forma usada em 117 dos 119 casos:

| Forma | Ocorrencias |
|---|---|
| `.maybeSingle<T>()` | 117 |
| `.single<T>()` | 1 |
| `.maybeSingle()` | 1 |
| **Total** | **119**, em 43 arquivos |

O mesmo erro estava no probe do inventario, com o mesmo regex. Efeito nos numeros:

| | Errado | Corrigido |
|---|---|---|
| SAFE unitaria | 3 | **128** |
| Sem barreira | 614 | **489** |

Consequencias para o passo 7, revertendo o que estava escrito aqui:

1. Deteccao sintatica de consulta unitaria **funciona** e cobre a maior parte dos casos. A
   lista de colunas UNIQUE das migrations continua util para os residuais (`.eq` em coluna
   unica sem `.maybeSingle`), mas deixa de ser pre-requisito.
2. Fica a licao metodologica, que vale mais que o numero: **regex sobre chamada encadeada
   erra por forma sintatica nao prevista**, e erra em silencio, para menos. Foi exatamente
   assim que os 614 nasceram inflados. E o mesmo argumento que ja justificava a Compiler
   API no passo 7 — so que agora com um exemplo cometido dentro desta propria auditoria.

## Priorizacao da triagem (passo 4)

Por cardinalidade, nao por arquivo: revisar arquivo a arquivo mistura cadastro quase estatico com
consulta operacional de alta cardinalidade.

### A hipotese inicial, e o que a medicao fez com ela

Registro do erro porque ele e o argumento mais forte desta auditoria a favor de medir antes
de triar. Esta era a fila proposta, por "quantidade de cadeias no inventario" e intuicao de
importancia de negocio:

| Tabela | Linhas medidas | Veredito |
|---|---|---|
| `project` | 228 | **P3** — errado por 1 ordem de grandeza |
| `project_with_labels` | 228 (1:1) | **P3** — errado por 1 ordem de grandeza |
| `stock_centers` | 19 | **P3** — errado por 2 ordens |
| `materials` | 1.351 | P0 — acertou |
| `stock_transfer_team_operations` | 2.987 | P0 — acertou |
| `stock_transfer_reversals` | 2 | **P3** — errado por 3 ordens |
| `stock_transfer_item_reversals` | 128 | **P3** — errado |
| `stock_transfer_items` | 7.976 | P0 — acertou |

Placar: 3 acertos em 8. E as 6 tabelas de HISTORICO que aparecem entre as 17 P0 nao estavam
na hipotese — nenhuma delas. A fila real esta na secao da medicao, abaixo.

Calibracao do classificador (numerosas, cardinalidade hoje menor):
`teams` (46), `app_users` (37), `people` (27), `job_titles` (15), `team_types` (13).
Somar a estas os dois padroes de helper enganoso que a base produziu sozinha: `loadPaged` e
`loadRowsInChunks`.

## Medicao no banco vivo — 2026-08-21 (PARCIAL)

Executada por `scripts/check-tenant-cardinality-live.sql`. Data carimbada de proposito:
contagem de linha envelhece, e sem data ninguem sabe daqui a seis meses qual era o
tamanho quando a prioridade foi definida.

### Bloco 3 (controle da view) — EXECUTADO

| project_rows | view_rows | ratio | veredito |
|---|---|---|---|
| 228 | 228 | 1.0000 | CONFIRMADO 1:1 — view nao multiplica |

Dois resultados, um deles nao previsto:

**1. A leitura estatica da view estava certa.** Os 10 `left join` casam sempre na PK do
lado direito, entao `project_with_labels` e 1:1 com `project`. A categoria
"Especial — view/join que pode multiplicar" NAO se aplica a ela. Continua valendo como
categoria para outras views, a serem identificadas por definicao SQL (join em coluna nao
unica), nunca por suspeita.

**2. A hipotese de prioridade estava ERRADA, e o proprio numero a derruba.** `project`
tem 228 linhas GLOBAIS. Como `max_rows_per_tenant <= total_rows`, nenhum tenant pode
passar de 228 — logo as duas tabelas sao **P3**, sem necessidade da query por tenant.

Isso remove do topo da fila as duas tabelas que a hipotese colocava em primeiro e segundo
lugar, e com elas 55 cadeias (29 + 26). Nao e ajuste fino: e a confirmacao de que
priorizar por "quantidade de cadeias no inventario" ou por intuicao de importancia de
negocio nao guarda relacao com exposicao ao truncamento.

### Recalibracao que isso sugere para o resto da medicao

Com a entidade central de negocio em 228 linhas, as tabelas capazes de passar de 1.000 por
tenant sao provavelmente as de LINHA DE ITEM e as transacionais, que crescem com atividade
e nao com cadastro:

`stock_transfer_items`, `project_measurement_order_items`, `stock_transfer_team_operations`,
`programming`, `stock_transfers`.

Coerente com `Auditoria/11-infraestrutura.md`, que mediu 90,5 MB de banco: um schema desse
tamanho nao comporta tabela de cadastro grande, mas comporta tabela de item com dezenas de
milhares de linhas.

Isso e recalibracao de hipotese, nao resultado. So os blocos 1 e 2 decidem.

### Preflight de cobertura — EXECUTADO, e reprovou a propria medicao

| Tabelas BASE de `public` com `tenant_id` | 114 |
|---|---|
| Cobertas pela lista fixa da 1a versao | 16 (14%) |
| **Fora da medicao** | **98** |

A lista escolhida a mao reprovou. E nao reprovou na margem: ficaram de fora justamente
as familias que a propria recalibracao acima apontava como as mais expostas.

**Linhas de item** — `project_activity_forecast` (base da Carteira Operacional),
`project_billing_order_items`, `project_asbuilt_measurement_order_items`,
`programming_activity`, `programming_team`, `project_programming_activities`,
`requisicao_itens`, `stock_requisition_request_items`, `team_composition_members`.

**Transacionais e saldos** — `stock_movements`, `project_programming`,
`inventory_balance`, `stock_center_balances`, `project_material_balance`,
`stock_serial_pending_balances`, `trafo_instances`, `warehouse_material_addresses`.

**Historico e auditoria** — a familia mais perigosa das tres, e a unica sem NENHUM
representante na lista original: `app_entity_history`, `project_history`,
`programming_history`, `material_history`, `project_programming_history`,
`login_audit`, `app_error_logs`, `idempotency_requests`,
`cronograma_solicitacoes_history`, `app_user_permission_history`, e mais uma duzia.
Estas crescem MONOTONICAMENTE e nunca sao podadas: sao as primeiras a passar de 1.000
por tenant, por construcao, independente do tamanho operacional do cliente.

### Licao registrada: lista fixa nao serve para inventario

O erro nao foi escolher mal as 16 — foi escolher. Lista curada envelhece por dois
caminhos: o vies de quem escolhe (priorizei entidade de negocio, e entidade de negocio
e justamente o que nao cresce) e a entropia do schema (tabela nova entra e fica fora em
silencio).

`scripts/check-tenant-cardinality-live.sql` foi reescrito para DESCOBRIR as tabelas em
`information_schema` e medir todas. Nao ha mais lista para manter nem para esquecer, e
o preflight deixa de ser necessario: a cobertura passou a ser 100% por construcao.

Vale como criterio geral para o resto desta auditoria, e para o passo 7: **enumerar
sempre, curar nunca**.

### Medicao dinamica das 114 tabelas — EXECUTADA em 2026-08-21

`tenant_count = 1` em praticamente todas as tabelas (hash `6159d562`). Consequencia que mais
importa: **`max_rows_per_tenant` = `total_rows`**, e portanto tudo que aparece como P0 e
exposicao ATUAL, nao projecao. Se existe consulta sem barreira sobre uma dessas tabelas, ela
esta truncando hoje, em producao, no unico tenant que tem dados.

**17 tabelas P0 (acima de 1.000 linhas no maior tenant):**

| Linhas | Tabela | Familia |
|---|---|---|
| 10.803 | `material_history` | historico |
| 7.976 | `stock_transfer_items` | linha de item |
| 5.647 | `login_audit` | historico |
| 4.339 | `project_material_forecast` | linha de item |
| 3.777 | `stock_transfers` | transacional |
| 3.493 | `programming_history` | historico |
| 2.987 | `stock_transfer_team_operations` | transacional |
| 2.913 | `team_composition_members` | linha de item |
| 2.835 | `project_measurement_order_items` | linha de item |
| 2.594 | `project_programming_history` | historico |
| 2.386 | `stock_requisition_request_items` | linha de item |
| 2.296 | `project_measurement_order_history` | historico |
| 1.744 | `project_activity_forecast` | linha de item |
| 1.699 | `stock_center_balances` | saldo |
| 1.351 | `materials` | cadastro |
| 1.150 | `app_entity_history` | historico |
| 1.065 | `app_user_page_permissions` | permissao |

P1: `programming_team` (975), `project_asbuilt_measurement_order_items` (918).
P2: 8 tabelas entre 578 e 897.

**A hipotese de prioridade errou quase tudo.** Das 8 tabelas que a hipotese punha no topo,
so `materials` e `stock_transfer_items` e `stock_transfer_team_operations` sao P0. `project`
(228), `stock_centers` (19) e `stock_transfer_reversals` (2) estavam erradas por ate tres
ordens de grandeza. Em compensacao, 6 das 17 P0 sao tabelas de HISTORICO, que a lista
curada nao continha nenhuma — confirmando a licao registrada acima.

### Triagem resultante (passo 4)

Cruzando a medicao com o inventario corrigido de 489 cadeias:

| Prioridade | Cadeias sem barreira |
|---|---|
| **P0** | **99** |
| P1 | 4 |
| P2 | 29 |
| P3 | 357 |

**99 cadeias sobre tabelas que ja passaram do teto.** Esse e o alvo real do passo 4 — nao os
489, e muito menos os 614 originais. As 357 P3 continuam registradas, mas so voltam a
importar quando a cardinalidade delas mudar, o que a re-execucao periodica desta medicao
detecta.

Distribuicao das 99 por tabela esta em `Auditoria/15-inventario-bruto.csv`, ordenado por
prioridade e cardinalidade decrescente.

### Verificacao pontual ja feita: `app_user_page_permissions`

Foi a P0 que mais preocupou na leitura (tabela de PERMISSAO, 1.065 linhas, 14 cadeias em 14
arquivos): truncamento ali significaria usuario perdendo ou ganhando acesso em silencio.

**Verificada e SEM defeito.** As duas leituras centrais —
`src/lib/server/pageAuthorization.ts:99` e o guard local de
`src/app/api/dash-operacional-faturamento/route.ts:451` — filtram por
`tenant_id` + `user_id` + `page_key` e terminam em `.maybeSingle<T>()`. Tupla unica,
consulta genuinamente unitaria. Foram justamente os falsos positivos do regex quebrado.

Serve de aviso para a triagem das outras 98: **cardinalidade alta nao implica defeito**. O
que decide e o caminho ate a execucao, nao o tamanho da tabela.

## Regra rigida da triagem (passo 5 em diante)

```
P0 = prioridade de INSPECAO
P0 != defeito
```

A classificacao P0/P1/P2/P3 mede EXPOSICAO, ou seja, quanto a tabela pode truncar se a
consulta nao tiver barreira. Ela nao afirma nada sobre a consulta em si. Confundir os dois
transformaria a triagem numa lista de 99 correcoes a fazer, quando o trabalho real e 99
leituras a fazer — das quais uma parte vai terminar em SAFE.

### Primeiro caso de calibracao SAFE: `app_user_page_permissions`

Registrado como CASO DE CALIBRACAO, nao como "falso positivo descartado". A distincao
importa: ele define o padrao que o classificador do passo 7 precisa reconhecer.

```
tabela P0 (1.065 linhas)
  + filtro por tupla unica (tenant_id + user_id + page_key)
  + terminacao em .maybeSingle<T>()
  = SAFE, independente da cardinalidade
```

Padrao nomeado: **unitaria por tupla**. Vale para qualquer tabela, em qualquer prioridade.
E o primeiro item da taxonomia do passo 5.

### Ordem da triagem P0

Escolhida por velocidade de descoberta de padrao, nao so por cardinalidade:

1. **`material_history`** — 10.803 linhas, apenas 3 cadeias. Poucas leituras e cardinalidade
   altissima: e o caminho mais rapido para o primeiro veredito e para o primeiro padrao.
2. **`stock_transfer_items`** — 7.976 linhas, 15 cadeias em 11 arquivos. Muitas leituras da
   mesma tabela tendem a repetir padrao: e o melhor material para FORMAR a taxonomia do
   passo 5, nao so para aplicar.
3. Demais P0 por cardinalidade e impacto.

### Pendencia de medicao antes do passo 4

O campo `cardinalidade` do schema e hoje o unico que seria PRESUNCAO — e e justamente o que
governa a ordem da triagem, entao errar nele desperdica a fase. Ele e mensuravel: com
`npm run db:check-link` confirmado, um `count` por tabela transforma
`baixa / crescente / operacional` em fato. **Medir e carimbar a data no documento**, como foi
feito em `11-infraestrutura.md`: contagem de linha envelhece, e daqui a seis meses ninguem sabe
se `project` tinha 400 ou 4.000 quando a prioridade foi definida.

Essa medicao pode reordenar a lista acima. A ordem atual e hipotese, nao resultado.

## Sequencia

```
1.  Commitar estado atual                           FEITO (37feb75)
2.  Criar Auditoria/15-supabase-implicit-row-cap.md FEITO
3.  Inventario completo read-only                   FEITO (489 candidatos, CSV)
4.  Triagem por tabela                              FEITO (99 cadeias P0)
5.  Catalogar padroes reais                         EM ANDAMENTO (material_history, stock_transfer_items)
6.  Definir SAFE / REVIEW / DEFECT
7.  Implementar novo lint:rowlimit (Compiler API + colunas UNIQUE das migrations)
8.  Corrigir defeitos confirmados
9.  Criar novo baseline
10. So entao voltar ao modulo central de exportacao
```

O lint nasce a partir do codigo real do repositorio, nao de uma taxonomia teorica. Por isso o
passo 7 vem depois do 5, e nao antes.

---

# Passo 5 — Triagem P0 (em andamento)

Data de inicio: 2026-08-21. Checkpoint anterior: commit `7ec8e9c`.

## Achado estrutural: existem QUATRO helpers de paginacao, tres deles privados

A auditoria comecou supondo um helper (`loadAllRows`). A triagem encontrou mais tres,
cada um reimplementado dentro de um arquivo de rota, e dois deles com a condicao de
parada que o `loadAllRows` proibe explicitamente:

| Helper | Onde | Parada | Situacao |
|---|---|---|---|
| `loadAllRows` | `src/lib/server/apiHelpers.ts` | pagina VAZIA | correto |
| `loadPaged` | `dashboard-portfolio/controller.ts:368` | `length < 1000` | armadilha latente |
| `loadAllPages` | `team-stock-operations/route.ts:212` | `length < 1000` | armadilha latente |
| `loadRowsInChunks` | `stock-balance/route.ts:132` | — | NAO pagina resposta |

`loadPaged` e `loadAllPages` funcionam hoje pela mesma coincidencia aritmetica: o bloco
pedido (`1000`) e igual ao teto do servidor (`1000`), entao a primeira pagina cheia volta
com exatamente 1.000 e o laco continua. Elevar qualquer uma das duas constantes, num
commit que parece otimizacao, faz as duas truncarem na primeira pagina PARECENDO laco
correto.

Consequencia para o passo 7: **allowlist por nome de helper esta descartada em definitivo**.
Tres dos quatro nomes seriam marcados SAFE por engano.

## Conceito que faltava no schema: cardinalidade POS-FILTRO

A cardinalidade por tabela (P0-P3) diz quanto a TABELA tem. Nao diz quanto a CONSULTA
devolve, porque a consulta tem filtro. Os dois erros possiveis aparecem juntos aqui:

- `material_history` e P0 (10.803), mas filtrada por um `stockTransferId` devolve um
  punhado de linhas. **P0 sem defeito.**
- `stock_transfer_items` filtrada por `.in(stock_transfer_id, <lote de 500>)` pode
  devolver mais de 1.000 numa unica resposta mesmo com media de ~2 itens por
  transferencia. **Filtro presente, sem protecao nenhuma.**

Medicao criada para decidir: `scripts/check-postfilter-cardinality-live.sql`
(`npm run db:postfilter-live`). Executada em 2026-08-21.

## Triagem: `material_history` (P0, 10.803 linhas, 3 cadeias)

| Arquivo:linha | Classificacao | Motivo |
|---|---|---|
| `materials/route.ts:773` | **SAFE** | paginacao de UI com total exato |
| `stock-transfers/route.ts:1097` | **REVIEW** | 4 consultas sem `.limit()` nem `.range()` |
| `team-stock-operations/route.ts:1187` | **REVIEW** | mesma leitura, com `.limit(200)` |

### Novo padrao SAFE: paginacao de UI com total exato

`materials/route.ts:773` nao le tudo e nao e unitaria — le UMA pagina
(`historyPageSize <= 30`) com `count: "exact"`. Nao ha truncamento silencioso porque o
contrato nao e "todas as linhas": e "uma pagina + total honesto", e o total vem do banco.

Terceiro item da taxonomia, ao lado de `unitaria por tupla`. Importa porque a definicao
de SAFE que abre este documento fala em "paginacao ate exaustao" — e aqui a exaustao
nunca acontece, e mesmo assim esta correto. **A exaustao nao e o criterio; o criterio e
o codigo nao afirmar mais do que leu.**

### A assimetria entre as duas REVIEW

`stock-transfers:1097` e `team-stock-operations:1187` fazem a MESMA leitura — historico
de material de uma transferencia — com tetos diferentes: nenhum e 200. Nenhum dos dois
autores sabia qual era o limite certo, e os dois escolheram sozinhos. O `.limit(200)` nao
sofre corte do PostgREST (esta abaixo de 1.000), mas e corte silencioso da aplicacao, da
mesma classe. A medicao pos-filtro decide os dois de uma vez.

## Triagem: `stock_transfer_items` (P0, 7.976 linhas, 13 cadeias)

Distribuicao por padrao:

| Cadeias | Padrao |
|---|---|
| 11 | filtro `.in("stock_transfer_id", <lote>)` |
| 1 | filtro por serial (`trafo-positions:318`) |
| 1 | `.limit()` dentro do teto |

**Uma unica medicao decide 11 das 13.** O retorno e `(tamanho do lote) x (itens por
transferencia)`, e os tamanhos de lote em uso divergem:

| Arquivo | `RELATION_QUERY_CHUNK_SIZE` |
|---|---|
| `stock-balance/route.ts` | 100 |
| `stock-transfers/route.ts` | 100 |
| `team-stock-operations/route.ts` | **500** |

### Candidato a DEFECT: `team-stock-operations/route.ts:780`

A cadeia completa, do inicio ao fim:

```
loadAllPages  -> le TODAS as operacoes de equipe do tenant, sem recorte de pagina
                 (stock_transfer_team_operations = 2.987 linhas)
   |
currentTransferIds -> ~milhares de ids, NAO limitado a montante
   |
loadRowsInChunks(ids, chunk = 500)
   |
.in("stock_transfer_id", chunk) sobre stock_transfer_items
   SEM .range(), SEM .limit()
   |
resposta esperada por chunk = 500 x ~2,11 itens/transferencia = ~1.055 linhas
```

Media global: 7.976 itens / 3.777 transferencias = **2,11**. Isso poe a resposta de cada
chunk em torno de 1.055 linhas — **acima do teto de 1.000**, na media, nao no pior caso.

Nao esta classificado como DEFECT ainda de proposito: a media global nao e a media das
transferencias ligadas a operacoes de equipe, e o que decide e a soma dos 500 maiores, nao
a media. `pior_lote_500` na medicao pos-filtro responde isso com numero. Mas a estrutura
ja esta confirmada por leitura: nao ha nenhuma barreira entre um lote de 500 e a resposta.

Nota: os mesmos 100 de lote em `stock-balance` e `stock-transfers` dao ~211 linhas na
media. **CORRIGIDO PELA MEDICAO — ver secao seguinte: o teto real de um lote de 100 e 2.593.**

## Status

- `material_history`: 1 SAFE, 2 REVIEW (dependem da medicao pos-filtro)
- `stock_transfer_items`: 11 dependem da medicao pos-filtro, 1 candidato a DEFECT
- Taxonomia SAFE ate agora: `unitaria por tupla`, `paginacao de UI com total exato`,
  `paginacao ate exaustao (parada em pagina vazia)`
- Proximo: rodar `npm run db:postfilter-live` e fechar as 13 cadeias das duas tabelas

## Medicao pos-filtro — 2026-08-21

`scripts/check-postfilter-cardinality-live.sql`.

| Medida | max | media | pior lote 100 | pior lote 500 |
|---|---|---|---|---|
| `stock_transfer_items` por transferencia | 63 | 2,11 | **2.593** | **4.699** |
| `stock_transfer_items` por serial | 4 | 1,37 | — | — |
| `material_history` por `stockTransferId` | 63 | 2,14 | — | — |
| transferencias ligadas a operacoes de equipe | 2.987 | — | — | — |

### CORRECAO — usei a media onde tinha acabado de escrever que media nao serve

A secao anterior afirmava que um lote de 100 daria "~211 linhas, com folga confortavel".
Isso e a MEDIA (100 x 2,11). O teto real de um lote de 100 e **2.593** — 2,6 vezes o teto
do PostgREST.

O erro e exatamente o que esta auditoria existe para combater, cometido dentro dela: o
comentario do proprio SQL dizia "cada uma responde qual e o MAIOR retorno possivel, nao
qual e a media", e a prosa logo abaixo usou a media assim mesmo. Media descreve o caso
tipico; truncamento silencioso e definido pelo caso extremo. Fica registrado como segunda
autocorrecao desta auditoria, ao lado da contagem de `.maybeSingle<T>()`.

Consequencia: o defeito **nao e exclusivo do lote de 500**. Todo lote sem `.range()` esta
exposto; o 500 apenas garante o estouro, enquanto o 100 depende de concentracao.

## Vereditos — `material_history` (3 de 3 fechadas)

| Arquivo:linha | Veredito | Evidencia |
|---|---|---|
| `materials/route.ts:773` | **SAFE** | paginacao de UI com `count: exact`, pagina <= 30 |
| `stock-transfers/route.ts:1097` | **SAFE** | max 63 linhas por `stockTransferId`, sem barreira mas sem exposicao |
| `team-stock-operations/route.ts:1187` | **SAFE** | max 63, muito abaixo do `.limit(200)` |

Tabela P0 de 10.803 linhas, **zero defeitos**. E a demonstracao mais forte da regra
`P0 = prioridade de inspecao, P0 != defeito`: o filtro por `stockTransferId` reduz 10.803
para no maximo 63.

## Vereditos — `stock_transfer_items`

### DEFECT confirmado: `team-stock-operations/route.ts:780`

```
loadAllPages       -> 2.987 transferencias ligadas a operacoes de equipe (medido)
loadRowsInChunks(ids, chunk = 500)
.in("stock_transfer_id", chunk)   SEM .range(), SEM .limit()
```

Um lote CHEIO de 500 devolve, no caso tipico, 500 x 2,11 = **1.055 linhas**. Ja passa do
teto de 1.000 na MEDIA — nao no extremo. Com 2.987 ids sao 6 lotes, e os 5 primeiros sao
cheios. No extremo medido, um lote de 500 chega a **4.699** linhas, das quais o PostgREST
entrega 1.000.

Efeito na tela Operacoes de Equipe: itens de movimentacao somem da listagem e da
exportacao sem nenhum aviso, com status 200.

### Exposicao latente: os lotes de 100

`stock-balance/route.ts:847`, `stock-transfers/route.ts:793` e `stock-transfers/route.ts:242`
usam `RELATION_QUERY_CHUNK_SIZE = 100`. Caso tipico 211 linhas, teto medido **2.593**.
Nao estoura sempre, mas pode estourar — e o codigo nao tem como perceber.

Classificacao: **DEFECT latente**. A correcao e a mesma dos tres (paginar a resposta), e
nao ha razao para tratar diferente do lote de 500, so ordem de prioridade.

### SAFE

| Arquivo:linha | Evidencia |
|---|---|
| `trafo-positions/route.ts:318` | max 4 linhas por (material + serial + lote) |

### Pendentes de checagem por sitio

As 7 cadeias com `.in(...)` sem chunk dependem de quantos ids a lista carrega em cada
caso, e isso e limite de codigo, nao de dado — precisa de leitura individual. Sao:
`consumo-projeto:307`, `dash-estoque:435`, `estornos:293`, `materials:1030`,
`stock-transfers/reversal:181`, `team-stock-balance:306`,
`team-stock-operations/reversal:130`. Mais `materials:465`, com `.limit()` dentro do teto.

## Placar do passo 5 ate aqui

| | |
|---|---|
| Cadeias fechadas | 6 |
| SAFE | 4 |
| DEFECT confirmado | 1 |
| DEFECT latente | 3 |
| Pendentes de leitura individual | 8 |

Duas tabelas P0 (18.779 linhas somadas) produziram **1 defeito confirmado e 3 latentes**,
todos do mesmo padrao: `chunk de parametro sem paginacao de resposta`. Nenhum deles seria
detectado por `.limit()` acima do teto, que era o unico criterio da Auditoria 14.

---

# Correcao dos 4 casos — infraestrutura + migracao

Data: 2026-08-21. Diagnostico congelado no commit `3a69884`.

## Parte 1 — helper compartilhado

`loadRowsInChunks` passou a existir UMA vez, em `src/lib/server/apiHelpers.ts`, com
contrato explicito sobre DUAS dimensoes independentes:

```
lista de IDs --(chunkSize)--> lote --(pageSize, ate pagina vazia)--> linhas
```

Invariantes deliberadamente NAO parametrizaveis, porque a auditoria mostrou que permitir
variacao aqui produz bug:

1. parada em PAGINA VAZIA, nunca "pagina menor que a pedida";
2. avanco pelas linhas RECEBIDAS, nunca pelo bloco pedido;
3. paralelismo ENTRE LOTES — paginas do mesmo lote sao sequenciais por definicao, ja que
   a proxima depende de quantas linhas a anterior devolveu.

Parametros expostos: so `chunkSize`, `maxParallel` e `pageSize`. Nada de estrategia de
parada, avanco ou ordenacao.

**Erro generico, sem acoplamento.** A assinatura e `<T, TError = PostgrestError>` e o
helper NUNCA inspeciona o erro — so o propaga. Assim a infraestrutura compartilhada nao
conhece nem o `PostgrestError` nem o `QueryError` local de nenhum modulo, e cada call site
mantem o proprio tipo. Nao foi preciso `mapError`: a genericidade resolve sem conversao.

**Desvio do desenho proposto, registrado:** a assinatura devolve `{ data, error }` em vez
de `Promise<T[]>` com throw. Motivo: os 19 call sites ja fazem
`const { data, error } = await ...` seguido de `if (error) return NextResponse.json(...)`,
e dois deles passam o erro a um logger tipado. Trocar para throw obrigaria a reescrever o
tratamento de erro dos 19 junto com a paginacao, misturando duas mudancas de risco
diferente na mesma entrega.

**Ordem total e contrato do chamador.** O helper nao adivinha coluna: quem constroi a
query declara `.order()`. Foi aplicado `id` na maioria, e `transfer_id` em
`stock_transfer_team_operations`, cuja PK e `transfer_id` e nao `id` — detalhe que so
aparece lendo a migration 140.

## Parte 2 — migracao

As TRES copias privadas foram removidas (`stock-balance`, `stock-transfers`,
`team-stock-operations`), junto de `chunkValues`, que so existia para alimenta-las.

| Arquivo | Call sites | chunkSize | maxParallel |
|---|---|---|---|
| `stock-balance/route.ts` | 8 | 100 | — |
| `stock-transfers/route.ts` | 5 | 100 | — |
| `team-stock-operations/route.ts` | 6 | 500 | 4 |

Chunk sizes e paralelismo preservados exatamente como estavam: a correcao e sobre
paginacao da RESPOSTA, e mudar o chunk junto tornaria impossivel atribuir qualquer
diferenca de comportamento a uma causa.

### O call site que ficou FORA do helper, de proposito

`stock-transfers/route.ts`, preload de busca por material. Ele e limitado de proposito —
corta em 200 ids logo depois, e o proprio codigo ja documentava isso. Passar esse callback
ao helper teria duas saidas, ambas erradas: paginar ate exaurir mudaria a semantica de um
filtro best-effort, e ignorar `from`/`to` para manter o teto criaria um LACO INFINITO,
porque a parada por pagina vazia nunca aconteceria.

Virou um laco de chunk explicito, com comentario dizendo por que nao usa o helper. Teto
intencional declarado no codigo e diferente de teto acidental — e o helper existe para
impedir o segundo, nao o primeiro.

## Criterio de aceite

Nao e "nao deu erro". E **contagem retornada = contagem esperada medida no banco**.
`scripts/check-chunk-fix-acceptance-live.sql` (`npm run db:chunk-acceptance-live`) devolve:

- `itens_reais` — total verdadeiro de itens das transferencias de operacoes de equipe;
- `itens_entregues_antes` — o que o codigo antigo entregava, com o teto de 1.000 por lote;
- `itens_perdidos_antes` — a diferenca, ou seja, o que sumia da tela;
- `lotes_que_truncavam`.

Executada em 2026-08-21 — resultado na secao seguinte. A tela Operacoes de Equipe e a
exportacao dela devem passar a mostrar 5.791 itens, contra 5.748 antes da correcao.

## Padrao para o resto do passo 5

A correcao rende a regra que fecha a taxonomia:

```
helper que pagina PARAMETROS mas nao a RESPOSTA
  = DEFECT ou REVIEW obrigatorio
  independente do tamanho do chunk
```

Independente do tamanho porque o lote de 100 tambem estourava no teto medido (2.593). O
chunk pequeno so torna o defeito dependente dos dados, e a auditoria ja rejeitou qualquer
solucao baseada em "hoje cabe em 1.000".

## Medicao de aceite — 2026-08-21

`scripts/check-chunk-fix-acceptance-live.sql`.

| Medida | Valor |
|---|---|
| transferencias de operacoes de equipe | 2.987 |
| **itens reais** | **5.791** |
| itens entregues antes da correcao | 5.748 |
| **itens perdidos antes** | **43** |
| lotes | 6 |
| lotes que truncavam | **1** |

**Defeito confirmado: 43 itens sumiam da tela Operacoes de Equipe, com status 200.**

### TERCEIRA autocorrecao: o prognostico exagerou a extensao

A secao do defeito afirmava que um lote cheio de 500 devolveria "500 x 2,11 = 1.055
linhas — acima do teto de 1.000 na MEDIA, nao no extremo", e que dos 6 lotes "os 5
primeiros sao cheios". Os numeros reais:

| | Prognostico | Medido |
|---|---|---|
| itens por transferencia | 2,11 | **1,94** |
| linhas por lote | ~1.055 | **~965** |
| lotes acima do teto | 5 de 6 | **1 de 6** |
| perda | nao estimada | **43 de 5.791 (0,74%)** |

A causa do desvio: usei a media GLOBAL de itens por transferencia (7.976 / 3.777 = 2,11),
mas as transferencias ligadas a operacoes de equipe tem media menor (5.791 / 2.987 = 1,94).
Filtro diferente, populacao diferente, media diferente — o mesmo erro de aplicar uma
estatistica agregada a um subconjunto, so que agora na direcao pessimista.

**O que NAO muda:** o defeito era real e estava ativo. 43 linhas sumiam de uma listagem de
movimentacao de estoque sem nenhum sinal, e itens faltando numa movimentacao sao erro de
conferencia, nao ruido estatistico.

**O que muda:** a extensao. Nao eram 5 lotes truncando, era 1. O sistema estava
EXATAMENTE NA BORDA — 965 linhas por lote contra um teto de 1.000, folga de 3,5%. Qualquer
crescimento (mais itens por transferencia, ou mais transferencias) empurraria os outros 5
lotes por cima do teto. A correcao chegou no momento em que o defeito comecava a se
manifestar, nao depois de anos escondido.

### Licao para a triagem das 8 pendentes

Media de populacao agregada NAO se aplica a subconjunto filtrado. Ja errei nas duas
direcoes nesta auditoria: para menos, ao chamar o lote de 100 de "folga confortavel"
usando media em vez de teto; e para mais, aqui, ao projetar 5 lotes truncando com uma
media que nao era da populacao certa. Nas 8 cadeias restantes, medir a distribuicao DO
FILTRO, nunca a da tabela.
