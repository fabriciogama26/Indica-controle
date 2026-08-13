# P1 — Baseline de medição (runbook)

Objetivo duplo: **(a)** destravar o Nível B da auditoria; **(b)** deixar um marco `T0` que permita, depois, provar se a RPC do P2.1 realmente reduziu leituras, chamadas e tempo acumulado.

> **Status: não executado.** O Supabase CLI não está linkado neste ambiente (`supabase/.temp/` e `.supabase/` não existem) e não há `SUPABASE_ACCESS_TOKEN` nem `SUPABASE_DB_PASSWORD` no ambiente. `npm run db:link` é interativo — pede a senha do banco. A captura precisa ser rodada por quem tem a credencial.

---

## 0a. Como rodar — e a armadilha do SQL Editor

Há dois caminhos, e escolher o errado faz perder 90% do resultado **em silêncio**.

| Ferramenta | Script | Por quê |
|---|---|---|
| **SQL Editor do Supabase** | [`scripts/perf-baseline-onequery.sql`](../scripts/perf-baseline-onequery.sql) | o editor devolve **apenas o resultado do último `select`** do arquivo |
| `npx supabase db query --file` | [`scripts/perf-baseline-capture.sql`](../scripts/perf-baseline-capture.sql) | o CLI imprime **todos** os result sets, e este script tem os recortes extras das causas raiz |

> ### 🪤 A armadilha, medida na prática
>
> `perf-baseline-capture.sql` tem 10 blocos, cada um um `select` separado. Rodado no **SQL Editor**, ele devolve só o último — os outros nove somem sem erro nenhum.
>
> Isso aconteceu de verdade nas coletas de 2026-08-12, e o sintoma foi difícil de ver porque cada rodada trazia um bloco **plausível**:
>
> | Captura | Último bloco do script na época | O que chegou |
> |---|---|---|
> | 1ª | `04_rows_por_chamada` | bloco 04 |
> | 2ª | `07_custo_por_chamada` | bloco 07 |
> | 3ª e 4ª | `08_muitas_chamadas` | bloco 08 |
>
> Sempre o último. Os blocos `00`, `02` e `03` nunca chegaram — e foi por isso que a validade temporal da amostra ficou várias rodadas sem resposta, com o ranking por custo (`04`) ausente.
>
> **Sinal de que você caiu nisso:** o resultado tem uma única tabela quando o script deveria produzir várias.

O `perf-baseline-onequery.sql` empilha os blocos com `union all` num `select` só, então o editor devolve tudo. As colunas numéricas ficam nulas nas linhas de texto (blocos `00`, `02`, `03`) — é esperado.

---

## 0. Antes de tudo: a captura é utilizável?

`pg_stat_statements` acumula **tudo** que passou pelo banco — não só a aplicação. Numa janela de manutenção, restore ou logo após um `stats_reset`, o topo da lista é ruído, e ler esses números como se fossem da aplicação leva à conclusão oposta da correta.

**Isto já aconteceu neste projeto.** A primeira captura (2026-08-12) veio dominada por:

| Sinal observado | O que era de fato |
|---|---|
| `COPY public.stock_transfer_items … TO stdout` com `rows_per_call = 3.952` | **`pg_dump`**, não `loadTransferItems`. Um dump tem milhares de linhas por chamada por definição. |
| `-- 315_migrate_legacy_programming_data.sql`, `-- 2) Carga`, backfills | **migrations** rodando, não telas |
| `calls` entre **1 e 7** em toda a lista | tráfego real de aplicação teria centenas ou milhares |

Lido sem cuidado, aquele `3.952 rows/call` "confirmaria" o achado do Nível D — quando na verdade não dizia absolutamente nada sobre o `dash-estoque`.

O script agora classifica cada query por **`origem`** e traz um **bloco `02_veredito`** que recusa a captura quando ela não serve:

| Veredito | Significa |
|---|---|
| `OK` | amostra dominada por tráfego de aplicação; pode virar baseline |
| `SUSPEITA` | menos de 20% do tempo veio da aplicação; conferir o bloco `03` antes de concluir |
| `FRACA` | menos de 500 chamadas de aplicação; serve para testar a coleta, não como baseline |
| `NAO SERVE DE BASELINE` | nenhuma consulta de aplicação na amostra — janela de manutenção, `stats_reset` recente, ou banco que não é o de produção |
| `INVALIDA` | `pg_stat_statements` vazia ou indisponível |

**Ler o bloco `02` antes de qualquer outro número.** Se não for `OK`, deixar a aplicação rodar e recapturar — os blocos `04` a `07` já filtram para `origem = 'app (postgrest)'`, mas com amostra vazia eles simplesmente não trazem linha.

> O fingerprint de aplicação é a CTE `pgrst_source`, que o PostgREST envolve em toda requisição da API. Se por alguma razão o bloco `04` vier vazio mesmo com a aplicação em uso, conferir o bloco `04b` (ruído) e o `03` (tempo por origem) para ver como as consultas estão chegando, e ajustar a regra de `origem` — não desistir do filtro e voltar a ler tudo junto.

---

## 1. A armadilha que invalida quase toda comparação antes/depois

Antes do passo a passo, o ponto que decide se este baseline vai valer alguma coisa.

`total_exec_time`, `calls` e `shared_blks_read` são **acumulados e proporcionais ao tráfego**. Se `T0` cair numa semana de fechamento e `T1` numa semana calma, o dash-estoque vai parecer 60% mais barato mesmo que a RPC não tenha mudado nada. E o inverso também: uma RPC ótima pode parecer neutra se `T1` tiver o dobro de uso.

**Portanto: nunca provar a melhoria com números brutos.** As métricas que sobrevivem à variação de tráfego são as **por chamada**:

| Métrica bruta (enganosa) | Métrica normalizada (honesta) |
|---|---|
| `total_exec_time` | `mean_exec_time_ms` |
| `shared_blks_read` | `blks_read_per_call` |
| `rows` | `rows_per_call` |
| `temp_blks_written` | `temp_written_per_call` |

O script `scripts/perf-baseline-capture.sql` já calcula as quatro colunas normalizadas.

### O problema específico de comparar antes/depois de uma RPC

Depois do P2.1, o `queryid` das consultas antigas **não vai só mudar de valor — vai desaparecer**, e um `queryid` novo (o da RPC) aparece no lugar. Não existe diff linha a linha.

A comparação correta é **por unidade de carregamento do dashboard**:

```
                        ANTES (T0)                  DEPOIS (T1)
consultas               ~29 queries                 1 RPC
                        (família dash-estoque)      (queryid novo)

denominador             nº de vezes que o dashboard foi aberto na janela
```

O denominador é a peça que falta capturar — e **ele não sai do `pg_stat_statements`.**

Foi verificado: nenhuma consulta do `dash-estoque` tem assinatura única o bastante para ser isolada por texto. `stock_centers` é lida por **8 rotas** (`consumo-projeto`, `stock-balance` ×2, `stock-requisitions/meta`, `team-stock-operations/meta`, `trafo-positions/meta`, `warehouse-addressing`, `dash-estoque`), várias com o mesmo `center_type = 'OWN'` e a mesma lista de colunas — depois da normalização do `pg_stat_statements` elas colapsam ou ficam indistinguíveis. `controls_balance` aparece em 6. Contar `loadTransfers` também não serve: ela roda `⌈N/1000⌉` vezes por carregamento, número que varia com o período escolhido.

Portanto, as formas de obter o denominador, em ordem de preferência:

1. **Correta e trivial: contagem de requisições `GET /api/dash-estoque` no log da hospedagem** (Vercel), na mesma janela do `T0`. É o número exato de carregamentos, e é uma consulta só. `/api/dash-estoque` é rota Next.js, não PostgREST — não aparece nos logs do Supabase.
2. **Aproximada, se o log não estiver disponível:** ler os textos de query do bloco `02` e desambiguar à mão qual `stock_centers` é a do dashboard, aceitando que é estimativa. Registrar explicitamente que é aproximação.

> Anotar o denominador **junto com a captura**, no mesmo arquivo. Ele não é recuperável depois — o log da hospedagem tem retenção limitada e a janela do `T0` passa.

Com o denominador, a métrica que prova o ganho é:

```
custo por carregamento = Σ(total_exec_time da família) / nº de carregamentos
blocos por carregamento = Σ(shared_blks_read da família) / nº de carregamentos
```

**Essa é a única comparação que sustenta a afirmação "a RPC reduziu I/O".** Registrar o denominador em `T0` — sem ele, o `T1` não tem com o que ser comparado.

---

## 2. Passo a passo

### 2.1 Habilitar / confirmar `pg_stat_statements`

Nenhuma migration do projeto cria a extensão. Verificar:

```sql
select e.extname, e.extversion, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_stat_statements';
```

Se não retornar linha: **Dashboard do Supabase → Database → Extensions → `pg_stat_statements`**.

Não habilitar por migration versionada sem alinhar com `guias/guia_supabase.md` — extensão é objeto de plataforma, e o Supabase gerencia `shared_preload_libraries`.

Em projeto Supabase ela costuma viver no schema `extensions`. Se a sessão não enxergar:

```sql
select * from extensions.pg_stat_statements limit 1;
```

O script de captura já tenta `public`, `extensions` e o nome nu, nessa ordem.

### 2.2 Linkar o CLI

```bash
npm run db:link          # interativo: pede a senha do banco
npm run db:check-link    # deve imprimir OK e o ref lcusxnhhrjosxqgiphgp
```

### 2.3 Capturar `T0`

```bash
mkdir -p Auditoria/baseline
npx supabase db query --file scripts/perf-baseline-capture.sql --linked \
  > Auditoria/baseline/2026-08-__-T0-pre-p2.txt
```

**Capturar duas vezes**, porque uma janela só não representa o sistema:

| Captura | Quando | Por quê |
|---|---|---|
| `T0-pico` | dia útil de uso normal/alto | é o regime que dói |
| `T0-fechamento` | dia de fechamento de mês | períodos maiores, mais linhas, é onde o teto do dash-estoque estoura |

O `T0-fechamento` é o que importa para o P2.1: é a janela em que o dash-estoque chega perto (ou passa) das 20.000 movimentações.

### 2.4 Registrar o denominador

**Não sai do banco.** Pegar no log da hospedagem (Vercel) a contagem de requisições `GET /api/dash-estoque` na mesma janela do `T0`, e anotar no rodapé do arquivo da captura:

```
# denominador: 412 carregamentos de GET /api/dash-estoque
# fonte: Vercel logs, 2026-08-14 00:00 a 2026-08-14 23:59 UTC
```

Ver §1 para o porquê de não dar para derivar isso do `pg_stat_statements`.

### 2.5 Validar a captura antes de confiar nela

Do bloco `02` (**veredito**): tem que dizer `OK`. Qualquer outro valor → recapturar; ver §0.

Do bloco `03` (**tempo por origem**): `app (postgrest)` precisa dominar. Se `dump/copy` ou `ddl/migration` estiverem no topo, a janela é de manutenção.

Do bloco `00`:

- `contadores_desde` (`stats_reset`) — **anotar**. Se mudar entre `T0` e `T1`, o diff é inválido.
- `janela_acumulada` — se for de poucas horas, os números não representam nada. Esperar acumular.

Regra prática para escolher a janela: **não capturar logo após deploy, restore, `pg_dump` agendado ou rodada de migrations.** Qualquer um dos quatro contamina a amostra por horas.

---

## 3. Preencher com o resultado

### 3.1 Tabela de cruzamento do Nível A

Preencher [`03` §3](03-nivel-b-pg-stat-statements.md#3-cruzamento-obrigatório-com-o-nível-a). A coluna decisiva é **`blks_total_per_call`** (bloco `07` do script):

> ### ⚠️ `rows_per_call` NÃO serve para tráfego PostgREST
>
> Descoberto na segunda captura real (2026-08-12): **`rows_per_call` veio `1,00` em todas as linhas de aplicação.** Não é erro de coleta — é como o PostgREST funciona. Ele embrulha o resultado em `json_agg(...)`, então o `SELECT` externo devolve **sempre exatamente uma linha**, com o conjunto inteiro dentro de um JSON. Uma consulta que varreu 20.000 linhas aparece com `rows_per_call = 1,00`, igual a uma que leu uma linha só.
>
> A métrica que substitui é **`blks_total_per_call`** — blocos de 8 kB tocados por chamada, `(shared_blks_hit + shared_blks_read) / calls`. Ela mede o trabalho real e sobrevive ao empacotamento.

| `blks_total_per_call` | Equivale a | Leitura |
|---|---|---|
| > 1.000 | > ~8 MB por chamada | **confirma** o achado do Nível D — varredura ampla para agregar em JS |
| 100 – 1.000 | ~800 kB a 8 MB | recorte médio; achado real, prioridade menor |
| < 100 | < ~800 kB | leitura pontual — **derruba** o achado para aquela consulta |

Cruzar **sempre** com `calls`: custo acumulado = blocos/chamada × chamadas. Uma consulta de 50 blocos chamada 20.000 vezes custa mais que uma de 5.000 blocos chamada 10 vezes — e o problema dela é N+1, não varredura. O bloco `08` existe para isso.

⚠️ Tudo isso só vale para `origem = 'app (postgrest)'` — por isso os blocos `04` a `08` já filtram. Um `COPY` de `pg_dump` tem `rows_per_call` na casa dos milhares **por definição** e não diz nada sobre as telas; foi esse o erro de leitura que a primeira captura provocaria (§0).

O terceiro resultado é possível e legítimo. Registrá-lo é tão valioso quanto confirmar os outros dois.

### 3.2 Decidir os candidatos de índice

Os 4 índices de [`02` §8](02-nivel-a-indices.md#8-índices--candidatos-não-faltantes) estão `CANDIDATE`. Promover para `APPLY` só com:

1. custo acumulado relevante no bloco `01` (`pct_do_tempo_total`), **e**
2. `EXPLAIN` antes/depois confirmando mudança de plano ([`04`](04-nivel-c-explain.md)).

Lembrete de ordem: **P2 pode invalidar P3.1 e P3.2.** Se as consultas repetidas virarem CTE dentro de uma RPC, o candidato precisa ser reavaliado contra a query nova. Medir agora serve para priorizar P2 — não para criar índice que a RPC vai tornar obsoleto.

---

## 4. Depois do P2.1 — capturar `T1` e comparar

```bash
npx supabase db query --file scripts/perf-baseline-capture.sql --linked \
  > Auditoria/baseline/AAAA-MM-DD-T1-pos-p2-1.txt
```

Preencher:

| Métrica | `T0` | `T1` | Δ |
|---|---|---|---|
| Carregamentos do dashboard na janela (denominador) | | | — |
| Σ `total_exec_time` da família `dash-estoque` | | | |
| **ms por carregamento** | | | ← **prova o ganho** |
| Σ `shared_blks_read` da família | | | |
| **blocos lidos por carregamento** | | | ← **prova a redução de I/O** |
| Nº de `queryid` distintos da família | ~29 | 1 (RPC) | |
| `rows_per_call` máximo | | | |
| `temp_blks_written` da família | | | |
| `stats_reset` (tem que ser igual nas duas) | | | |

**Critério de aceite do P2.1** — as três precisam ser verdadeiras:

1. **blocos lidos por carregamento** cai de forma significativa;
2. **ms por carregamento** cai;
3. os **números dos cards continuam idênticos** aos de antes — RPC de agregação que muda um total é regressão de negócio, não otimização.

Se (1) e (2) melhorarem mas (3) falhar, **reverter**. Performance não compra correção.

---

## 5. Sobre agir antes da medição

P2 é o único bloco de arquitetura que não espera este baseline, e a justificativa não é pressa:

```
hoje:      DB → milhares de linhas → rede → Node → agregação JS
deveria:   DB → agregação → poucas linhas/um objeto → Node
```

O diagnóstico está no **formato do código**, não no tempo de execução — e a correção converge para padrão já aprovado no próprio projeto (`dashboard-portfolio`), em vez de introduzir camada nova.

O que este baseline acrescenta não é a decisão de fazer P2; é a **capacidade de provar depois** que fazer valeu a pena — e o número para mostrar a quem perguntar. Sem `T0`, o `T1` é só um número solto.

Por isso a ordem: capturar `T0` **antes** de começar o P2.1. Depois de a RPC entrar, o `T0` não existe mais para ser capturado.
