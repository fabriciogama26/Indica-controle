# Nível B — Ranking por custo acumulado (fecha o Nível B)

Captura completa de **2026-08-13** via `scripts/perf-baseline-onequery.sql`. É o bloco `04` que faltava desde o início da auditoria.

**Janela dos contadores: `stats_reset = 2026-02-12` → 6 meses e 11 dias.** Banco de 82 MB. Veredito: `OK`, 1.305.042 chamadas de aplicação num total de 3.857.351.

---

> ## ⚠️ Correção importante: as porcentagens deste documento são de 6 meses, e não explicam o pico de agosto
>
> Somando as quatro origens do bloco `03`: **25.221.925 ms = 7,0 horas de execução** — numa janela de **4.584 horas**.
>
> ```
> utilização média do banco em 6 meses:  0,153 %
> ```
>
> **O banco esteve praticamente ocioso no período.** Isso cria uma contradição direta com o painel `Infrastructure` ([`11`](11-infraestrutura.md)), que mostrou CPU 82% e Disk I/O 86% — e a explicação é que **as duas medidas têm janelas diferentes**:
>
> | Fonte | Janela | O que mostra |
> |---|---|---|
> | `pg_stat_statements` | **6 meses** (desde `stats_reset` de 12/02) | média diluída |
> | painel `Infrastructure` | **7 dias** | o pico recente |
>
> Um pico concentrado na semana de 12 de agosto some numa média semestral. **Portanto: nada neste documento prova o que causou o pico.** As porcentagens dizem onde o banco gastou tempo *ao longo de seis meses*, não onde gastou *na semana em que o I/O subiu*.
>
> Isso é a mesma armadilha de cumulativo-versus-delta que a auditoria já documentou duas vezes — e desta vez peguei a mim mesmo. A atribuição de ~32% ao Studio abaixo **é verdadeira para os 6 meses**, mas não é, por si só, a explicação do pico.
>
> **Para explicar o pico é preciso um delta sobre aquela janela**, que não existe: as capturas de delta feitas até aqui cobriram minutos de ociosidade. O caminho é capturar `T0` agora e `T1` depois de um dia útil, conforme [`07`](07-baseline-p1.md).

---

## 1. A descoberta que reordena tudo: um terço do banco é o próprio Supabase Studio

| Origem | Chamadas | Tempo | % |
|---|---|---|---|
| `indefinido` | 2.546.144 | 13.190.528 ms | **52,30%** |
| `app (postgrest)` | 1.305.042 | 11.827.488 ms | 46,89% |
| `ddl/migration` | 5.488 | 199.388 ms | 0,79% |
| `dump/copy` | 677 | 4.521 ms | 0,02% |

O bucket `indefinido` é o maior — e o bloco `04b` mostra o que há dentro dele. **Duas coisas muito diferentes:**

### 1.1 `set_config` do PostgREST — 8,96%

```
select set_config('search_path', $1, true), set_config($2, $3, true),
       set_config('role', $4, true), set_config('request.jwt.claims', $5, true), …
   1.305.413 chamadas · 2.260.160 ms · 1,73 ms cada
```

**1.305.413 chamadas — praticamente idêntico às 1.305.042 de aplicação.** É o preâmbulo que o PostgREST executa a cada requisição para montar o contexto da sessão. Não é query de negócio, é custo de existir uma requisição.

Consequência: **o custo real da aplicação é ≈ 55,8%** (46,89% + 8,96%), e parte dele só cai reduzindo o **número de requisições HTTP**, não o número de queries por requisição.

### 1.2 Introspecção do Supabase Studio — ≈ 32% do tempo total

As outras nove linhas do `04b` são o **dashboard do Supabase navegando o próprio schema**:

| % | Chamadas | Média | Consulta |
|---|---|---|---|
| 6,93% | 1.303 | **1.341 ms** | `pg_available_extensions` (tela Extensions) |
| 5,78% | 1.757 | 829 ms | `base_table_info` (Table Editor) |
| 4,96% | 519 | **2.408 ms** | introspecção de funções — **363.678 blocos de temp** |
| 4,03% | 1.280 | 795 ms | colunas por tabela (`json_agg`) |
| 3,95% | 790 | 1.262 ms | introspecção de funções — **900.172 blocos de temp** |
| 2,03% | 470 | **1.090 ms** | `SELECT name FROM pg_timezone_names` |
| 1,64% | 4.437 | 94 ms | `base_table_info` |
| 1,54% | 1.444 | 269 ms | `tables` com RLS |
| 1,30% | 828 | 397 ms | `table_privileges` |

Somadas com o `set_config`: **≈ 10.373.203 ms, ou 41% de todo o tempo do banco.** Sem o `set_config`, a introspecção sozinha fica em ~32%.

> **Isto não é a aplicação.** São 1.303 aberturas da tela de Extensions, 4.437 do Table Editor, 470 leituras de fuso horário. Cada uma custando entre 0,8 e 2,4 segundos.

---

## 2. As três causas raiz, agora com resposta definitiva

| Causa | Veredito |
|---|---|
| #1 memória → swap | ❌ **não é a aplicação.** `temp_total = 1709 GB` desde fevereiro, mas o bloco `06_spill` mostra que **toda** a escrita em disco vem da introspecção do Studio (363 mil, 900 mil, 163 mil blocos) e dos próprios scripts de auditoria. **Nenhuma consulta de aplicação tem `temp_blks_written > 0`.** |
| #2 cache hit baixo | ❌ **morta.** `cache_hit_global = 100,00%`, e `blks_read_per_call = 0,00` em todas as linhas de aplicação. Com 82 MB, o banco inteiro está em RAM. |
| #3 queries lentas | ⚠️ **existe, mas não na aplicação.** As consultas acima de 1 s são todas do Studio (1.090 a 2.408 ms). A mais lenta da aplicação é uma RPC de 919 ms. |

A **quarta causa** documentada em [`11`](11-infraestrutura.md) — fan-out de consultas baratas — continua válida, mas agora se sabe que divide o palco com a introspecção do dashboard.

---

## 3. Ranking real da aplicação — e ele não é o que o fan-out sugeria

| % | Consulta | Chamadas | Média | Blocos/chamada |
|---|---|---|---|---|
| **5,49%** | **RPC de resumo semanal da Programação** (`p_tenant_id, p_week_start`) | 9.045 | 153 ms | 765 |
| 3,61% | `project_programming_history` | 20.815 | 43,8 ms | 152 |
| 1,60% | `project_programming_history` (2ª variante) | 9.337 | 43,1 ms | 126 |
| 1,53% | RPC de medição (`p_measurement_order_id, p_programming_id`) | 1.097 | **353 ms** | **2.711** |
| 1,44% | **INSERT em `login_audit`** | 2.661 | **137 ms** | 489 |
| 1,21% | **INSERT em `login_audit`** (2ª variante) | 2.577 | **118 ms** | 519 |
| 1,15% | `project_programming` | 4.109 | 70 ms | 40 |
| 1,12% | `project_programming` | 2.903 | 97 ms | 92 |
| 1,08% | `programming_history` + `row_to_json` | 2.442 | 111 ms | **1.681** |
| 0,88% | RPC de rate limit | 2.726 | 81 ms | 368 |
| 0,72% | RPC de operação de estoque de equipe | 443 | **409 ms** | **4.298** |
| 0,52% | RPC de requisição (`p_request_id, p_decisions`) | 144 | **919 ms** | **13.870** |

### 3.1 O `dash-estoque` custa ~1%

Somando todas as linhas dele: `itens` 0,65% + `stock_transfers` 0,17% + estorno item 0,10% + 0,09% + estorno transf 0,06% + 0,06% ≈ **1,13%**.

> **Correção de rumo, e é sobre uma decisão minha.** Eu priorizei o `loadReversalSets` como "maior consumidor vivo" com base no ranking por **número de chamadas** (bloco `08`). O ranking por **custo** mostra que aquelas 167 mil chamadas somam ~0,3% do tempo do banco: são baratíssimas (0,42–0,52 ms, 1–3 blocos).
>
> A correção que fiz está certa e não deve ser revertida — menos round-trips é melhor —, mas **o ganho esperado é marginal**, não estrutural. Foi otimização do lugar errado, escolhida porque eu tinha só metade da medição.
>
> Lição para a metodologia: `calls` sozinho engana tanto quanto `mean_exec_time` sozinho. **Só o `total_exec_time` ordena.**

### 3.2 O auth confirma a previsão

As quatro consultas somam ~1,08% do tempo, com 240 mil chamadas. Continua sendo **latência e round-trip, não I/O** — exatamente como o Nível A previu. O que muda é que agora sabemos que cada requisição também paga um `set_config` de 1,73 ms, então **reduzir requisições vale mais que reduzir queries por requisição**.

### 3.3 Os `INSERT` em `login_audit` — investigado

2,65% do tempo total em dois `INSERT`, com **137 ms e 118 ms de média** e ~500 blocos por chamada.

**O que a investigação estabeleceu:**

| Fato | Fonte |
|---|---|
| **É síncrono no login.** O `insert` é `await`ado antes da resposta | [`auth-login-web/index.ts:119`](../supabase/functions/auth-login-web/index.ts#L119) |
| Vem de `service_role` — RLS está ativa mas só há policy de **SELECT**, sem policy de INSERT; qualquer outro papel seria recusado | migrations `000`, `006`, `020`, `021` |
| Há um trigger `BEFORE INSERT` que, se `created_by` vier nulo, executa `current_app_user_id()` — uma consulta em `app_users` por linha | `015_add_audit_columns.sql:141` e a função em `:15` |
| A tabela tem **5 índices** e **3 FKs para `app_users`** (`user_id`, `created_by`, `updated_by`) | `02-nivel-a-indices.md` §1 |
| Volume: 5.238 eventos em 6 meses ≈ **27 por dia** | bloco `04` |

**Em termos absolutos, é irrelevante como carga:** os dois `INSERT` somam **11,1 minutos em 6 meses**. Os 2,65% são grandes só porque o denominador (7 horas) é pequeno.

**Como latência, é real:** todo usuário espera ~137 ms a mais para entrar, porque a gravação está no caminho síncrono.

> **O que NÃO foi possível determinar por análise estática:** por que 489 blocos e 137 ms. Cinco índices, três FKs e um lookup de trigger somam algo na casa de 25–30 blocos, não 489. Esse número sugere varredura em algum ponto, mas **qual** só o `EXPLAIN` responde. Não vou inventar a causa.

**Próximo passo — `EXPLAIN` dentro de transação com rollback** (o `ANALYZE` executa de verdade):

```sql
begin;
explain (analyze, buffers, verbose)
insert into public.login_audit
  (user_id, tenant_id, event_type, event_at, status, reason, source,
   login_name, logged_in_at, created_at)
values
  (null, null, 'LOGIN', now(), 'FAILED', 'EXPLAIN_TESTE', 'WEB',
   'teste-explain', now(), now());
rollback;
```

Procurar no plano: `Trigger` com tempo próprio alto, `Seq Scan` em validação de FK, e a linha `Buffers` do nó de inserção.

**Correção provável, independente da causa:** tirar a gravação do caminho síncrono. A auditoria de login já registra que `login_audit` é gravada e consumida internamente, sem tela de leitura — então nada depende de ela estar pronta antes da resposta.

---

## 4. O que fazer com isto

| Prioridade | Item | Por quê |
|---|---|---|
| **1** | Investigar a introspecção do Studio (~32%) | maior consumidor isolado. Ver §5. |
| **2** | RPC de resumo semanal da Programação (5,49%) | maior consumidor da aplicação; 765 blocos/chamada em 9 mil chamadas |
| **3** | `INSERT` em `login_audit` (2,65%) | 137 ms para inserir uma linha é anômalo |
| **4** | RPCs pesadas por chamada (2.711 / 4.298 / 13.870 blocos) | poucas chamadas, mas cada uma varre muito |
| 5 | `project_programming_history` (5,21% somado) | **pendente de validação temporal** — delta zero em duas janelas; pode ser fantasma |
| 6 | Auth / `set_config` (~10% somado) | atacar por número de requisições, não por query |
| — | `dash-estoque` (~1,13%) | ❌ **sai da fila de prioridade** |

## 5. Sobre os 32% do Studio

Não é código do projeto e não se corrige por migration. As saídas possíveis:

1. **Reduzir o uso do dashboard** para navegação de schema — cada abertura de Table Editor ou Extensions custa segundos. É a explicação mais provável para os picos de CPU/Disk I/O de 12 de agosto, que coincidem com esta auditoria: **as próprias capturas e a navegação no Studio contribuíram para o pico que estávamos investigando**.
2. **Confirmar antes de agir:** capturar `T1` depois de um período **sem** uso do dashboard e comparar o delta dessas dez consultas.

> ⚠️ Isto tem consequência direta sobre o experimento before/after de [`11`](11-infraestrutura.md): se o `T1` for medido enquanto alguém usa o Studio, o ruído de introspecção pode mascarar completamente o efeito de qualquer otimização na aplicação. **O `T1` precisa ser capturado numa janela de uso normal do sistema e uso mínimo do dashboard.**

---

## 6. Limitação da classificação atual

O bucket `indefinido` (52%) mistura duas coisas que deveriam estar separadas: o `set_config` do PostgREST (custo de aplicação) e a introspecção do Studio (custo de ferramenta). O script de captura deve ganhar duas origens novas — `app (postgrest setup)` e `studio/introspeccao` — para que o bloco `03` seja legível sem análise manual.
