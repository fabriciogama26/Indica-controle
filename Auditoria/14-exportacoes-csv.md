# 14 - Exportacoes CSV: truncamento silencioso

Data: 2026-08-21
Escopo: os 37 arquivos de `src/modules` que constroem CSV, mais toda chamada `.limit()`
de `src/` acima do teto do PostgREST.

## A classe de bug

O PostgREST deste projeto entrega no maximo 1.000 linhas por resposta e **nao sinaliza o
corte**: devolve 200 com menos linhas do que o SQL produziu. O sintoma nunca e erro nem
tela vazia — e numero errado apresentado como certo, e planilha incompleta com cara de
planilha fechada.

Esta auditoria encontrou a mesma classe de bug em **tres formas diferentes**, e so uma
delas era detectavel pelo ratchet que ja existia.

### Forma 1 - `.limit(n)` acima de 1.000 (detectavel)

18 ocorrencias em 12 arquivos, todas ja rastreadas em `row-limit-baseline.json`.
`.limit(5000)` nunca entregou 5.000; entregava 1.000 e o codigo somava como se fosse tudo.

Agravante encontrado em quase todos: **ordem decrescente**. Como o corte pega o fim da
lista ordenada, o que sumia era sistematicamente o dado mais ANTIGO — o menos provavel de
ser notado por quem confere pela tela.

Pior caso medido: `dashboard-measurement/controller.ts`, recorte ANUAL com `.limit(5000)`.
O ano inteiro de um tenant ativo passa de 1.000 ordens com folga, entao o dashboard vinha
somando so a ponta recente e apresentando o resultado como total do ano.

### Forma 2 - `pageSize` grande recusado em silencio pelo servidor (NAO detectavel)

Faturamento e Medicao As Built pediam `pageSize=10000` numa unica requisicao. O servidor
aplica `parsePagination(..., { maxPageSize: 500 })`, que **capa sem avisar**. O cliente
recebia 500 linhas, nao olhava `pagination.total`, e dava a exportacao por completa.

Nenhum `.limit()` literal acima de 1.000 aparece nesse caminho: o teto efetivo era 500.
O ratchet estatico nao tem como pegar isso, porque o valor so existe em runtime.

### Forma 3 - exportar o estado da tela, que e so a pagina visivel (NAO detectavel)

Cronograma de Solicitacoes serializava `items`, o array da pagina corrente, num
`exportCsv` sincrono. Com `PAGE_SIZE = 20`, **o CSV saia com no maximo 20 linhas**.

Foi o pior achado da auditoria em dano por simplicidade: nao depende de volume, nao
depende de teto de servidor, e acontece em 100% das exportacoes desde sempre.

## O que ja estava certo

Quatro padroes corretos convivendo na mesma base — o que confirma que o problema e
ausencia de um contrato unico, nao falta de conhecimento:

| Padrao | Onde |
|---|---|
| Laco de paginas ate `total`, `EXPORT_PAGE_SIZE = 100` | Projetos, Pessoas, Materiais, Equipes, Atividades, Cargo, Composicao de Equipe, Medicao (200), Controle APR (500) |
| Flag `forExport` no servidor + `loadAllRows` + **aviso de exportacao parcial na tela** | Programacao Normalizada |
| Modo export no servidor + `loadAllRows` | Estornos |
| Cursor com `hasOlder` | Entrada |

A Programacao Normalizada e a referencia: e a unica que **avisa** quando a exportacao sai
parcial, comparando com o count exato do banco. As outras tres estao corretas, mas falham
em silencio se a premissa mudar.

## Correcoes aplicadas

- 18/18 chamadas `.limit()` acima do teto trocadas por `loadAllRows`. `row-limit-baseline.json`
  ficou **vazio**.
- Toda consulta paginada ganhou **ordem total** (desempate por `id`). Sem isso o Postgres nao
  garante a mesma sequencia entre paginas, e a paginacao por offset pode repetir ou perder
  linha. Varias das consultas antigas nao tinham `.order()` nenhum: alem de truncar, elas
  truncavam de forma NAO DETERMINISTICA — o mesmo projeto podia gerar dois resultados
  diferentes em dois cliques.
- Cronograma, Faturamento e Medicao As Built passaram a percorrer todas as paginas ate
  `pagination.total`, com `EXPORT_PAGE_SIZE` casado com o `maxPageSize` real de cada rota.

### Os 4 `.limit()` dinamicos, conferidos a mao

O ratchet avisa que nao consegue analisa-los. Conferidos nesta auditoria, os quatro sao seguros:

- `stock-requisitions/serial-options`, `stock-transfers/serial-options`,
  `team-stock-operations/serial-options`: `parsePageSize` capa em **100**.
- `stock-transfers/route.ts:724`: `blockSize` e `TRANSFER_FETCH_BLOCK_SIZE = 200` ou
  `pageSize + 1 <= 101`. Maximo **200**.

## Pendencias registradas

1. **O ratchet cobre uma das tres formas.** As formas 2 e 3 continuam indetectaveis
   automaticamente. Enquanto cada tela implementar sua propria exportacao, elas voltam.
2. **Nenhuma exportacao alem da Programacao Normalizada avisa quando sai parcial.** As
   correcoes desta entrega tornam o truncamento improvavel, nao impossivel.
3. **Consultas sem `.limit()` E sem `.range()` tambem param em 1.000**, e nao entram em
   nenhum baseline. Nao foram varridas aqui. Exemplo no proprio arquivo corrigido de
   `composicao-equipe/meta`: `teams` e `job_titles` seguem sem paginacao, ao lado de duas
   consultas que acabaram de ser corrigidas. Hoje sao pequenas; a protecao e nenhuma.
4. **Modulo unico de exportacao**: discutido e adiado por decisao explicita. Ver secao abaixo.

## Modulo unico de exportacao - decisao de 2026-08-21

Avaliada a proposta de centralizar exportacao em `src/server/modules/export/`, com
`COPY`/cursor -> stream -> Supabase Storage e `export_jobs` para arquivos grandes.

**Decisao: o modulo sim, a metade pesada nao — ainda.** Quatro razoes, todas locais:

1. Nao existe driver Postgres no projeto (so `@supabase/supabase-js`). `COPY` e
   `DECLARE CURSOR` exigem conexao direta, ou seja, um segundo caminho de acesso ao banco.
2. Vercel + Supavisor: em *transaction mode*, o unico viavel em serverless, **cursor nao
   funciona** (precisa de sessao). E nao existe worker de longa duracao na Vercel.
3. Conexao direta roda com RLS desligada. Trocar a ultima barreira por um `WHERE tenant_id`
   de aplicacao, justamente no endpoint que serializa tabela inteira, e o risco mais caro da
   proposta. Este repo ja pagou esse preco: as migrations 375+ existem porque duas views
   ficaram sem `security_invoker = true`, corrigidas a mao fora do versionamento.
4. `Auditoria/11-infraestrutura.md` mediu **banco de 90,5 MB** e concluiu que o gargalo e
   fan-out de consultas baratas, nao volume. Nenhuma exportacao isolada chega perto de
   precisar de streaming por cursor.

Forma recomendada quando o modulo for feito: registry declarativo por exportacao
(`key`, permissao, colunas, loader paginado), `loadAllRows` + streaming da Response, e
**contagem exata como porteiro** (`count: 'exact', head: true`) comparada com o que saiu —
a peca que transforma truncamento silencioso em erro visivel. A ramificacao de job/Storage
entra como costura, construida quando existir uma exportacao que realmente estoure, com
numero medido.
