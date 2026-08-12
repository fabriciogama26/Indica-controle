# Evidência de infraestrutura — estado pré-otimização

Captura do painel **Infrastructure** do Supabase, janela **5 a 12 de agosto de 2026**. Guardada como marco `T0` de infraestrutura, para o before/after depois do P2.

---

## 1. O retrato

| Recurso | Uso | Leitura |
|---|---|---|
| **Compute** | **86%** | 🔴 muito alto |
| **CPU** | **82%** | 🔴 muito alto |
| **Disk I/O** | **86%** | 🔴 muito alto |
| Memória | 49% | 🟢 confortável |
| Disco (capacidade) | 4% | 🟢 espaço não é problema |
| Database | **90,5 MB** | minúsculo |
| WAL | 80 MB | pequeno |
| System | 175,3 MB | normal |

CPU e Disk I/O **pioraram fortemente perto de 12 de agosto**, que é a janela em que as capturas de `pg_stat_statements` foram feitas.

---

## 2. O que isto prova, e o que não prova

### Prova: o problema não é volume de dados

```
Database: 90,5 MB
        ↓
centenas de milhares de consultas
        ↓
CPU 82% · Disk I/O 86%
        ↓
Compute 86%
```

Um banco de 90 MB cabe inteiro na memória de qualquer instância. Se CPU e I/O estão em 82–86% com esse tamanho, **não existe tabela grande demais para o servidor** — existe **banco pequeno consultado vezes demais**.

Isso confirma, por evidência independente, o que o Nível B mostrou: o custo está em **fan-out**, não em varredura. E reforça a correção que a medição já tinha feito na tese do Nível D — nenhuma consulta passa de 152 blocos por chamada, mas há milhares de chamadas.

**Consequência prática:** reduzir número de chamadas passa à frente de qualquer caça a tabela grande, e à frente de índice novo.

### Não prova: que 86% é um teto físico

O painel mostra **utilização ao longo da janela selecionada**, não uso instantâneo. Antes de tratar 86% como limite, é preciso saber o que essa métrica representa no plano de compute atual — pode ser pico, média ou percentil. **Não usar esse número isolado para justificar upgrade.**

O que é inequívoco no print é o **estado relativo**: CPU e Disk I/O estão muito mais pressionados que memória e capacidade de disco.

---

## 3. Correção de rumo: a causa raiz #1 cai

A metodologia desta auditoria ([`00`](00-metodologia-4-niveis.md)) organiza tudo em torno das três causas que a Supabase aponta para High Disk I/O. A primeira delas é **"uso alto de memória fazendo swap para disco"**.

**Com Memory em 49%, essa hipótese sai do páreo neste projeto.**

| Causa raiz | Status após esta evidência |
|---|---|
| #1 — memória → swap | ❌ **descartada** — 49% de uso, sem pressão |
| #2 — cache hit baixo | ⚠️ improvável com 90 MB de banco; o dado cabe em cache. A medição corrobora: `blks_read_per_call` é 0,00 na quase totalidade das consultas |
| #3 — queries lentas | ⚠️ parcial — nenhuma consulta passa de ~44 ms de média; o custo vem da **quantidade**, não da duração |

Ou seja: **nenhuma das três causas canônicas explica este caso sozinha.** O padrão real é uma quarta, que a documentação não destaca:

> **Fan-out de consultas baratas.** Centenas de milhares de chamadas de 1–5 ms, cada uma tocando poucos blocos, que somadas saturam CPU e I/O sem que exista nenhuma query lenta, nenhuma tabela grande e nenhuma pressão de memória.

Isso vale para a metodologia reusável: um projeto pode estar com Disk I/O em 86% **sem disparar nenhum dos três alarmes clássicos**.

---

## 4. Ajuste no ranking de fan-out

Os números de fan-out citados até aqui vinham da leitura **cumulativa**. O delta entre as duas capturas ([`08`](08-nivel-b-resultado.md)) reordena:

| Módulo | Cumulativo (enganoso) | **Δ real na janela** |
|---|---|---|
| `dash-estoque` | ≈ 266.000 | **≈ 1.973** ← maior consumidor vivo |
| `auth/permissão` | ≈ 240.100 | **≈ 1.541** |
| `programacao (legado)` | ≈ 96.500 | **0** ← morto |

**`programacao (legado)` não deve entrar em nenhum plano de otimização.** Ela não executa; o custo dela era histórico acumulado. O C8 já a removeu do código, e isso foi limpeza de dívida — não vai mover CPU nem I/O.

Sobra, portanto, **um alvo de fan-out vivo e um de overhead fixo**:

1. `loadReversalSets` do `dash-estoque` — 1.496 chamadas contra 8 da carga principal
2. `resolveAuthenticatedAppUser` + `requirePageAction` — ~1.541 chamadas de custo fixo por request

---

## 5. O experimento before/after

O banco pequeno é o que torna este teste forte: se o volume de dados praticamente não muda e as chamadas caem muito, qualquer variação de CPU/I/O é atribuível à mudança.

| Métrica | `T0` (2026-08-12) | `T1` (pós-P2) |
|---|---|---|
| Compute | 86% | |
| CPU | 82% | |
| Disk I/O | 86% | |
| Memória | 49% | |
| Database | 90,5 MB | (esperado: ~igual) |
| Δ chamadas `stock_transfer_item_reversals` | 1.496 | |
| Δ chamadas auth (4 consultas) | 1.541 | |
| Δ `total_exec_time` da família dash-estoque | — | |

**Como ler o resultado:**

| Cenário | Conclusão |
|---|---|
| Chamadas caem muito **e** CPU/I/O caem junto | ✅ causalidade demonstrada; fan-out era o gargalo |
| Chamadas caem 80–90% **e** CPU/I/O seguem perto de 80% | ❌ há outro consumidor não mapeado — procurar antes de considerar compute maior |
| Chamadas não caem | a mudança não fez o que devia; revisar antes de medir infra |

**Nenhum upgrade de compute antes deste experimento.** Aumentar a instância agora esconderia a causa e tornaria o teste impossível — e, com 90 MB de banco, é quase certo que resolveria sintoma, não problema.

---

## 6. Como recapturar

O painel é `Infrastructure` no dashboard do Supabase. Anexar o print da mesma janela relativa (7 dias) e preencher a tabela do §5. Capturar **junto** com a captura de `pg_stat_statements` do mesmo dia, para as duas evidências cobrirem o mesmo intervalo.
