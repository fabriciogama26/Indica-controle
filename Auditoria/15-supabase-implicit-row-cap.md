# 15 - Supabase implicit row cap

Data: 2026-08-21
Estado: passos 2, 3 e 4 (triagem) concluidos. Passo 5 (catalogar padroes) nao iniciado.
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
5.  Catalogar padroes reais                         <- proximo
6.  Definir SAFE / REVIEW / DEFECT
7.  Implementar novo lint:rowlimit (Compiler API + colunas UNIQUE das migrations)
8.  Corrigir defeitos confirmados
9.  Criar novo baseline
10. So entao voltar ao modulo central de exportacao
```

O lint nasce a partir do codigo real do repositorio, nao de uma taxonomia teorica. Por isso o
passo 7 vem depois do 5, e nao antes.
