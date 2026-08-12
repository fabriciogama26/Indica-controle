# Auditoria de Performance — Disk I/O / Supabase

Auditoria de performance PostgreSQL/Supabase focada em **Disk I/O**, uso de memória, consultas redundantes, índices, RLS e escalabilidade.

Data-base da coleta estática: **2026-08-12** — commit `0a5981a`.

---

## Escopo desta pasta

Todo artefato `.md` de auditoria de performance vive aqui. Nada nesta pasta altera código: são relatórios, scripts de coleta e plano de ação.

| Arquivo | Nível | Conteúdo |
|---|---|---|
| [`00-metodologia-4-niveis.md`](00-metodologia-4-niveis.md) | — | Procedimento reutilizável (A→D). Ler primeiro em toda reexecução. |
| [`01-nivel-a-mapa-consultas.md`](01-nivel-a-mapa-consultas.md) | A | Mapa `Página → API/RPC → tabela → filtros → índice atual → índice recomendado → risco` |
| [`02-nivel-a-indices.md`](02-nivel-a-indices.md) | A | Inventário dos 258 índices vivos, duplicatas, prefixos redundantes, write amplification |
| [`03-nivel-b-pg-stat-statements.md`](03-nivel-b-pg-stat-statements.md) | B | Scripts SQL de custo acumulado, cache hit ratio, temp blocks, índices não usados |
| [`04-nivel-c-explain.md`](04-nivel-c-explain.md) | C | Playbook `EXPLAIN (ANALYZE, BUFFERS)` + queries candidatas já identificadas |
| [`05-nivel-d-arquitetura.md`](05-nivel-d-arquitetura.md) | D | Dashboards que fazem N consultas para N cards; candidatos a RPC única / materialized view |
| [`06-plano-de-acao.md`](06-plano-de-acao.md) | — | Achados priorizados em P0→P4, com validação de cada item |
| [`07-baseline-p1.md`](07-baseline-p1.md) | B | Runbook do P1: habilitar `pg_stat_statements`, capturar `T0` e comparar com `T1` sem se enganar com variação de tráfego |
| [`08-nivel-b-resultado.md`](08-nivel-b-resultado.md) | B | **Resultado medido (parcial)** — o que a primeira medição real confirmou, derrubou e reordenou |
| [`09-telas-em-uso.md`](09-telas-em-uso.md) | A | Telas vivas, telas mortas e telas vazias — por que a Programação legada ainda é o destino padrão do menu |
| [`10-cutover-programacao.md`](10-cutover-programacao.md) | A/D | O corte da Programação Normalizada — estado das fases e os passos C0 a C8 |
| [`11-infraestrutura.md`](11-infraestrutura.md) | B | **Evidência de infraestrutura** — CPU/Disk I/O em 82–86% com banco de 90 MB; marco T0 do before/after |
| [`baseline/`](baseline/) | B | Capturas brutas de `scripts/perf-baseline-capture.sql`, uma por arquivo |

### Auditorias anteriores nesta pasta

Os `.txt` abaixo **não** fazem parte desta auditoria de performance. Estavam em `docs/` e foram movidos para cá durante esta sessão (não por esta auditoria — ver nota no fim). Ficam listados para o índice não mentir:

| Arquivo | Tema |
|---|---|
| `Auditoria_Completa_SaaS.txt` | auditoria geral do SaaS |
| `Auditoria_Concorrencia_Idempotencia_Realtime_2026-07.txt` | concorrência, idempotência, Realtime |
| `Auditoria_Lixo_NextSupabase_2026-07.txt` | código morto / desperdício (`/auditoria-lixo`) |
| `Auditoria_Login_Acessos_SaaS.txt` | login, logout, `login_audit` |
| `Auditoria_Programacao_Integridade_Supabase_2026-06.txt` | integridade da Programação |
| `Auditoria_Projetos_Programacao_Integridade_2026-06.txt` | integridade Projetos × Programação |

> ⚠️ **Referências pendentes:** `docs/00_Indice_SaaS.txt`, `docs/Tela_Programacao_Simples_SaaS.txt` e `TASKS.md` ainda apontam para `docs/Auditoria_*.txt`. Cerca de 18 links estão quebrados desde a mudança de pasta e precisam ser atualizados para `Auditoria/`.

---

## Como reexecutar

```
/auditoria-performance
```

O comando está em `.claude/commands/auditoria-performance.md` e aponta para o procedimento completo em [`prompts/auditoria-performance.md`](../prompts/auditoria-performance.md).

Argumento opcional para focar um módulo:

```
/auditoria-performance medicao
```

---

## Estado dos níveis

| Nível | Status | Observação |
|---|---|---|
| A — análise estática do repositório | 🟢 Concluído | Feito sem tocar em produção. Base de todos os outros níveis. |
| B — `pg_stat_statements` | 🟡 Parcial | Duas capturas do bloco `08` em 2026-08-12 permitiram o **delta**, que respondeu P1.1 e P1.3 ([`08`](08-nivel-b-resultado.md)), mais a evidência de infraestrutura ([`11`](11-infraestrutura.md)). **Faltam os blocos `02`, `03` e `04`** — sem o `04` não há ranking por custo acumulado, e ~90% do tempo do banco segue não atribuído. |
| C — `EXPLAIN (ANALYZE, BUFFERS)` | 🟡 Parcial | Candidatas selecionadas por evidência estática; falta rodar contra dados reais. |
| D — arquitetura | 🟢 Concluído | Achados de arquitetura não dependem de acesso a produção. |

**Nível B é o único que fecha a conta.** A análise estática diz *onde é provável* que o I/O esteja indo; `pg_stat_statements` diz *para onde ele foi de fato*. Não aplicar índices em lote antes de rodar o Nível B — ver `06-plano-de-acao.md`.

---

## Limites desta auditoria

- **Atualizado em 2026-08-12:** houve medição contra produção — duas capturas de `pg_stat_statements` (frequência + delta) e o painel `Infrastructure`. Os "riscos" do Nível A que **não** foram cobertos por essas capturas continuam sendo priorização estática, não medição.
- A medição já **derrubou duas conclusões** da análise estática: a tese "milhares de linhas por chamada" (nenhuma consulta passa de 152 blocos/chamada) e o ranking que elegeu `programacao (legado)` como maior consumidor (delta zero — era histórico acumulado). Ler [`08`](08-nivel-b-resultado.md) e [`11`](11-infraestrutura.md) antes de qualquer conclusão tirada só do Nível A.
- Contagem de linhas/tabelas vem de `supabase/migrations/` (371 arquivos) e de `src/`. Se o schema de produção divergir das migrations, o Nível B corrige.
- Não há suíte automatizada de teste no projeto — validação de qualquer correção derivada daqui é manual, conforme `guias/guia_validacao.md`.
