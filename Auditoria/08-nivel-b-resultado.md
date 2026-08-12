# Nível B — Resultado medido

> ## 🎯 P1.1 respondida por delta entre duas capturas — 2026-08-12
>
> Duas capturas do bloco `08` no mesmo dia permitiram calcular o **delta por `queryid`**, que era o caminho recomendado em [`07` §…](07-baseline-p1.md) para não depender dos cumulativos. O resultado **inverte a conclusão da leitura cumulativa**.
>
> ### O legado da Programação está congelado — delta ZERO
>
> | Consulta | Δ chamadas |
> |---|---|
> | `project_programming` (3 variantes) | **0, 0, 0** |
> | `project_programming_history` | **0** |
> | `project_programming_activities` | +56 |
>
> As quatro primeiras não moveram **uma única chamada**, e o `total_exec_time_ms` veio idêntico até a casa decimal (`911706.90` nas duas capturas). Zero execuções no intervalo.
>
> **Portanto: os 912 s de `project_programming_history` são histórico acumulado, não custo atual.** A suspeita registrada em §1.3 está confirmada — era tráfego fantasma de antes do corte, e a leitura cumulativa que o elegeu "maior consumidor medido" era artefato.
>
> **Consequência para o plano:** o C8 (remoção do legado) continua tendo sido a coisa certa a fazer — era código morto e dívida de manutenção —, mas **a justificativa de performance dele evapora**. Foi limpeza, não otimização. Nenhum ganho de I/O deve ser esperado do corte.
>
> Ponta solta: `project_programming_activities` +56 é a única do grupo que se moveu. Não deveria, se a tela antiga não foi usada. Precisa de explicação antes de dar o assunto por encerrado.
>
> ### O gargalo vivo é outro, e agora está quantificado
>
> | Consulta | Δ chamadas |
> |---|---|
> | `stock_transfer_item_reversals` (**duas** consultas) | **+748 cada = 1.496** |
> | `stock_transfer_items` | +364 |
> | `app_users`/`app_roles`/`app_user_tenants` (auth) | +393 cada |
> | `app_user_page_permissions` | +362 |
> | `stock_transfers` (carga do dash-estoque) | **+8** |
>
> **A razão é o achado:** `stock_transfers` moveu **8** e `stock_transfer_item_reversals` moveu **1.496** — cerca de **187 chamadas de estorno para cada chamada da carga de movimentações**. É o `loadReversalSets` disparando duas consultas por chunk, agora medido em tráfego real e não inferido do código.
>
> ⚠️ Ressalva: `stock_transfers` é o laço paginado, então as 8 chamadas podem ser páginas de poucos carregamentos, não 8 carregamentos. A razão 187:1 é sólida; a leitura "por carregamento" depende do denominador do log da hospedagem.
>
> **Nova ordem de prioridade do P2, agora por medição e não por análise estática:**
>
> 1. `loadReversalSets` do `dash-estoque` — maior fan-out vivo, isolado e corrigível
> 2. `resolveAuthenticatedAppUser` + `requirePageAction` — ~1.541 chamadas de overhead fixo no mesmo intervalo
> 3. o resto do `dash-estoque` (`stock_transfer_items`, +364)
>
> `programacao (legado)` **sai da fila** — não tem custo vivo.

---

## Leitura cumulativa (captura única) — preservada como histórico

Primeira medição real com tráfego de aplicação válido. Captura de **2026-08-12**, bloco `08_muitas_chamadas` (top 25 por `calls`).

> **Parcial e com viés conhecido.** Faltam os blocos `02_veredito`, `03_tempo_por_origem` e `04` (top por custo acumulado). O bloco `08` ordena por `calls`, então **não é o ranking de custo** — é o ranking de frequência. As conclusões abaixo estão marcadas conforme o que cada uma suporta.

---

## 1. O que a medição mudou na auditoria

### 1.1 A tese do Nível D, como estava escrita, **não se confirmou**

O Nível A previu: *"carrega milhares de linhas por chamada para agregar em JavaScript"*. A métrica para confirmar isso é `blks_total_per_call`, com o critério documentado em [`07` §3.1](07-baseline-p1.md#31-tabela-de-cruzamento-do-nível-a):

| Faixa | Significado | Quantas consultas caíram aqui |
|---|---|---|
| > 1.000 blocos (> ~8 MB/chamada) | varredura ampla — confirmaria a tese | **nenhuma** |
| 100 – 1.000 | recorte médio | **1** (`project_programming_history`, 152) |
| < 100 | leitura pontual | **todas as outras 24** |

A maioria fica **abaixo de 5 blocos por chamada**. Nenhuma consulta está varrendo massa de dados por chamada.

**O problema real é outro: volume de chamadas.**

| Consulta | Chamadas |
|---|---|
| `app_users` por `auth_user_id` | **71.182** |
| `app_roles` por `id` | **71.166** |
| `app_user_tenants` por `user_id` | **70.973** |
| `stock_transfer_item_reversals` (2 consultas iguais em contagem) | **53.232** × 2 |
| `stock_transfer_reversals` (2 consultas) | **30.585** × 2 |
| `stock_transfer_items` | **28.285** |
| `app_user_page_permissions` | **26.818** |
| `project_programming` (3 variantes) | 24.111 / 17.983 / 17.983 |
| `project_programming_history` | 20.815 |

Isso reposiciona o P2 sem invalidá-lo: a RPC de agregação continua sendo a correção certa, **mas pelo motivo oposto ao que o relatório dizia**. Ela não vale por reduzir linhas trafegadas por chamada — vale por **colapsar dezenas de milhares de chamadas pequenas em uma**.

Consequência prática para o critério de aceite do P2.1: a métrica que prova o ganho passa a ser **número de chamadas por carregamento**, não blocos por chamada.

### 1.2 O maior consumidor medido é um módulo que a auditoria tratou como legado

Somando por módulo, dentro do que o bloco `08` mostra:

| Módulo | Tempo acumulado | % do tempo total | Chamadas |
|---|---|---|---|
| **`programacao (legado)`** | **≈ 1.297 s** (21,6 min) | **≈ 5,2%** | ≈ 96.500 |
| `dash-estoque` (+ materiais/centros compartilhados) | ≈ 438 s (7,3 min) | ≈ 1,8% | ≈ 266.000 |
| `auth/permissão` (custo fixo por request) | ≈ 272 s (4,5 min) | ≈ 1,1% | ≈ 240.100 |

O Nível A colocou `dash-operacional-faturamento` e `dash-estoque` como CRÍTICO/ALTO e classificou `project_programming` apenas como tabela com write amplification. A medição diz que **`programacao (legado)` é o maior consumidor** dos três.

### 1.3 A consulta que domina: `project_programming_history`

```
queryid              -2326642709752935078
calls                20.815
mean_exec_time       43,80 ms
total_exec_time      911.707 ms  ≈ 15,2 min
pct_do_tempo_total   3,66%          ← maior valor individual da amostra
blks_total_per_call  152,05         ← maior valor individual da amostra
```

É, isoladamente, o maior custo medido. Mas há uma ressalva que muda a conclusão:

**A consulta não corresponde a nenhum call site do `src/` atual.** Ela seleciona `id, programming_id, project_id, from_execution_date, to_execution_date, changes, created_at`. As duas leituras existentes em [`programacao/queries.ts:168`](../src/server/modules/programacao/queries.ts#L168) e [`:246`](../src/server/modules/programacao/queries.ts#L246) selecionam `created_by, reason, metadata, action_type` — conjunto diferente.

O comentário em [`medicao/route.ts:110-113`](../src/app/api/medicao/route.ts#L110) explica por quê:

> `programming_history` (310) não tem `project_id`/`from_execution_date`/`to_execution_date` como colunas próprias (**diferente do legado `project_programming_history`**)

Ou seja: a consulta capturada é o caminho **anterior ao corte da Programação Normalizada**. Como os contadores são cumulativos desde `stats_reset`, ela pode ser inteiramente tráfego histórico de um deploy antigo.

**Como resolver a dúvida** — nesta ordem:

1. Ver `contadores_desde` no bloco `00`. Se for anterior ao deploy do corte, é tráfego fantasma e vai decair sozinho.
2. Confirmar qual versão está em produção hoje.
3. Se o corte já subiu e a contagem **continua** crescendo entre duas capturas → há consumidor vivo não mapeado, e aí vira achado ALTO.

Até (1) e (2) responderem, **não tratar como N+1 vivo** e não priorizar correção.

### 1.4 O custo fixo de auth/permissão é maior em volume do que o Nível A estimou

```
app_users            71.182 chamadas   66,3 s
app_roles            71.166 chamadas   78,8 s
app_user_tenants     70.973 chamadas   49,7 s
app_user_page_perms  26.818 chamadas   77,5 s
                    ─────────────────────────
                    ≈ 240.100 chamadas  ≈ 272 s (1,1% do tempo)
```

O Nível A classificou isso como **BAIXO**, com a justificativa de que "são leituras de 1 linha em tabelas pequenas: custo de latência, não de Disk I/O". A medição **confirma a parte técnica** — `blks_total_per_call` entre 1,17 e 3,29, praticamente nada de I/O — mas mostra que a magnitude é bem maior do que o texto sugeria: é a maior contagem de chamadas do sistema inteiro.

Dois pontos que merecem investigação:

- As três primeiras vêm de `resolveAuthenticatedAppUser`, que **tem cache de 45 s**. Contagens de 71 mil praticamente idênticas nas três sugerem que o cache está sendo pouco aproveitado — cache em memória de processo não sobrevive a cold start de serverless, e cada instância mantém o seu.
- `app_user_page_permissions` com 26.818 chamadas é o `requirePageAction`, que **não tem cache nenhum** ([`01` §3](01-nivel-a-mapa-consultas.md#3-custo-fixo-por-requisição)).

Continua não sendo problema de Disk I/O. Vira, sim, candidato real de redução de latência — o item P4.4 sobe de prioridade.

### 1.5 `dash-estoque`: o P2.1 tem custo medido, mas menor que o previsto

| Consulta | Chamadas | Tempo | blocos/chamada |
|---|---|---|---|
| `stock_transfer_items` | 28.285 | 159,9 s | 65,07 |
| `stock_transfer_team_operations` | 15.875 | 60,8 s | 21,31 |
| `stock_transfers` | 15.838 | 41,9 s | 23,95 |
| `stock_transfer_item_reversals` (×2) | 53.232 cada | 46,7 s | 3,3 |
| `stock_transfer_reversals` (×2) | 30.585 cada | 30,2 s | 1,0 |

**Achado novo e concreto:** `stock_transfer_item_reversals` e `stock_transfer_reversals` aparecem **em pares com contagem idêntica** — 53.232/53.232 e 30.585/30.585. É o `loadReversalSets` disparando **duas consultas por chunk** (uma por `original_*`, outra por `reversal_*`). São ~167 mil chamadas só para montar conjuntos de estorno. Alvo direto do P2.1.

O total do `dash-estoque` (~1,8% do tempo) é bem menor do que o rótulo ALTO do Nível A sugeria — mas o número de chamadas (~266 mil) é o maior de qualquer módulo de negócio.

---

## 2. O que ainda falta para fechar o Nível B

| Bloco | Para quê | Status |
|---|---|---|
| `02_veredito` | confirmar que a amostra é válida como baseline | ❌ falta |
| `03_tempo_por_origem` | saber quanto do tempo é aplicação vs. manutenção | ❌ falta |
| `04` | **o ranking real por custo acumulado** | ❌ falta |
| `00` (`contadores_desde`) | resolver a dúvida do §1.3 | ❌ falta |
| `08` | frequência | ✅ obtido |

**Lacuna importante:** as 25 consultas visíveis somam ≈ 2.319 s, e seus `pct_do_tempo_total` somam ≈ 9,3%. Extrapolando, o tempo total do banco na janela é da ordem de **24.900 s (≈ 6,9 h)**. Ou seja, **~90% do tempo está fora desta amostra** — em consultas de aplicação menos frequentes porém mais caras (que o bloco `04` mostraria), ou fora da aplicação (que o bloco `03` mostraria).

Nenhuma decisão de priorização definitiva antes desses dois blocos.

---

## 3. Efeito no plano

| Item | Antes | Depois desta medição |
|---|---|---|
| Tese "milhares de linhas por chamada" | base do P2 | **não confirmada** — trocar por "dezenas de milhares de chamadas" |
| Critério de aceite do P2.1 | blocos lidos por carregamento | **chamadas por carregamento** |
| `programacao (legado)` | write amplification, MÉDIO | **maior consumidor medido** — investigar (§1.3) |
| `loadReversalSets` (2 consultas por chunk) | não mapeado | achado novo, alvo do P2.1 |
| P4.4 (cache do `requirePageAction`) | BAIXA | sobe — 240 mil chamadas de overhead fixo |
| Ordem P2.1 → P2.2 | por análise estática | **aguardar bloco `04`** antes de confirmar |
