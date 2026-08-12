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
| [`06-plano-de-acao.md`](06-plano-de-acao.md) | — | Achados priorizados por (impacto × esforço), com validação de cada item |

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
| B — `pg_stat_statements` | 🔴 Bloqueado | A extensão **não está habilitada** neste projeto (nenhuma migration a cria). Scripts prontos em `03-...`; exigem execução no banco. |
| C — `EXPLAIN (ANALYZE, BUFFERS)` | 🟡 Parcial | Candidatas selecionadas por evidência estática; falta rodar contra dados reais. |
| D — arquitetura | 🟢 Concluído | Achados de arquitetura não dependem de acesso a produção. |

**Nível B é o único que fecha a conta.** A análise estática diz *onde é provável* que o I/O esteja indo; `pg_stat_statements` diz *para onde ele foi de fato*. Não aplicar índices em lote antes de rodar o Nível B — ver `06-plano-de-acao.md`.

---

## Limites desta auditoria

- Nenhuma medição foi feita contra o banco de produção. Todo número de "risco" é uma priorização por evidência estática (volume de código, padrão de filtro, ausência de índice compatível), não uma medição.
- Contagem de linhas/tabelas vem de `supabase/migrations/` (371 arquivos) e de `src/`. Se o schema de produção divergir das migrations, o Nível B corrige.
- Não há suíte automatizada de teste no projeto — validação de qualquer correção derivada daqui é manual, conforme `guias/guia_validacao.md`.
