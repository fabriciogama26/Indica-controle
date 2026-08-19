# Web Vitals — a dimensão de tempo de tela

Dados do Vercel Speed Insights, janela **12 a 18 de agosto de 2026**. É a medição que faltava para decidir as telas: o Nível B mediu **custo de banco**, isto mede **o que o usuário espera**.

> Ver a distinção em [`06`](06-plano-de-acao.md), seção "Latência ≠ custo de banco". Uma tela pode custar 1% do banco e ainda assim demorar 6 segundos.

---

## 1. ⚠️ Antes dos números: a amostra é pequena

| Rota | Amostras |
|---|---|
| `/login` | 14 |
| `/home` | 12 |
| `/composicao-equipe` | 4–8 |
| `/medicao` | 3–5 |
| `/mapa-programacao` | **2** |
| `/dashboard-medicao` | **2** |
| `/entrada` (LCP) | **1** |

**P75 sobre 2 amostras não é P75.** Os números das rotas ruins são indicativos, não conclusivos — `/mapa-programacao` com 6,72 s pode ser duas sessões em rede ruim.

O que **é** confiável: `/login` (14) e `/home` (12) estão bons, e as telas pesadas estão consistentemente piores. O padrão vale; a magnitude por rota, não.

---

## 2. LCP — 2,55 s no P75 global

| Rota | LCP | Estado |
|---|---|---|
| `/mapa-programacao` | **6,72 s** | 🔴 |
| `/composicao-equipe` | **5,47 s** | 🔴 |
| `/dashboard-medicao` | **5,13 s** | 🔴 |
| `/medicao` | **4,61 s** | 🔴 |
| `/programacao-normalizada` | 2,67 s | 🟡 |
| `/entrada` | 2,55 s | 🟡 |
| `/home` | 1,94 s | 🟢 |
| `/login` | 1,02 s | 🟢 |

### 2.1 O elemento de LCP é o achado

| Elemento medido | LCP |
|---|---|
| `article.MapProgrammingPageView-module…` | 6,72 s |
| `h2.TeamCompositionPageView-module…` | 5,47 s |
| **`div.AppShell-module…__pageH…`** | **5,13 s** |
| **`div.AppShell-module…__logoBlo…`** | **4,61 s** |
| `html>body>div.AppShell-module…` | 2,67 s |

Em `/medicao` e `/dashboard-medicao`, o maior elemento pintado é **o logo e o cabeçalho do AppShell** — a moldura da aplicação, não o conteúdo. E ele pinta aos 4,6–5,1 s.

**Isso significa que a tela fica em branco até lá.** Não é "o dado demorou a chegar": é que **nada** renderiza — nem a barra lateral, nem o logo — até quatro segundos e meio.

### 2.2 Causa confirmada no código (2026-08-19)

O padrão é assinatura de **renderização 100% no cliente**: nada aparece antes do JS baixar, parsear e hidratar. Reforça isso o fato de `/login` (1,02 s) e `/home` (1,94 s) usarem o mesmo shell e irem bem — o custo extra está no JS por rota.

Os `PageView` das telas ruins são grandes: `StockTransfersPageView` 3.697 linhas, `MeasurementPageView` 3.641, `TeamCompositionPageView` 1.308.

**Mas a correlação não fecha, e não vou forçá-la:**

| Rota | LCP | Consultas na API |
|---|---|---|
| `/mapa-programacao` | 6,72 s | **12** |
| `/composicao-equipe` | 5,47 s | 31 |
| `/medicao` | 4,61 s | 39 |
| `/programacao-normalizada` | 2,67 s | **46** |

A rota com **mais** consultas é a **mais rápida** das quatro; a com menos consultas é a mais lenta. **Número de consultas não explica o LCP** — e, portanto, a otimização de round-trips (P2 da auditoria de banco) também não é a resposta para o LCP.

Também não consegui medir o bundle por rota: o `build-manifest` deste projeto devolve o mesmo conjunto compartilhado (401 kB) para todas, sem separar o chunk da página.

#### O gate de sessão

[`AppShell.tsx:474`](../src/components/layout/AppShell.tsx#L474):

```tsx
if (isLoading || !session) {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingCard}>Carregando sessao...</div>
    </div>
  );
}
```

**O shell inteiro está atrás do carregamento da sessão** — barra lateral, logo, cabeçalho e conteúdo.
As duas variáveis vêm de `useAuth` ([`AppShell.tsx:419`](../src/components/layout/AppShell.tsx#L419)),
que resolve via `fetch("/api/auth/session-access")` com `cache: "no-store"`
([`auth.service.ts:52`](../src/services/auth/auth.service.ts#L52)).

Isso explica exatamente as três medições que não fechavam:

| Observação | Explicação |
|---|---|
| O elemento de LCP é o **logo/cabeçalho do AppShell**, não o conteúdo | o logo só pinta depois que a sessão resolve |
| `/programacao-normalizada` tem **46 consultas** e é a mais rápida das quatro | o LCP acontece **antes** de a página buscar dados |
| `/login` vai a 1,02 s com o mesmo bundle | `/login` não passa pelo gate de sessão |

**O LCP não é custo de banco nem número de consultas.** É JS baixado, parseado e hidratado, mais uma ida à rede
para autenticar, tudo em série, antes do primeiro pixel útil.

Continua faltando medir o **JS por rota** — o `build-manifest` devolve o mesmo conjunto compartilhado (401 kB)
para todas, sem separar o chunk da página. Isso mantém aberto *quanto* do tempo é bundle e *quanto* é o gate;
a existência do gate, essa está confirmada.

---

## 3. CLS — 0,14 no P75, e aqui a causa está confirmada no código

| Rota | CLS | Estado |
|---|---|---|
| `/requisicao-atendimento` | **0,89** | 🔴 catastrófico |
| `/cronograma-solicitacoes` | **0,39** | 🔴 |
| `/composicao-equipe` | **0,25** | 🔴 |
| `/programacao-normalizada` | 0,24 | 🟡 |
| `/mapa-programacao` | 0,16 | 🟡 |
| `/requisicao-solicitacao` | 0,14 | 🟡 |
| `/entrada` | 0,11 | 🟡 |
| `/medicao`, `/dashboard-medicao`, `/saida` | ≤ 0,07 | 🟢 |
| `/login`, `/home` | 0 | 🟢 |

`/requisicao-atendimento` com **0,89** é quase 9× o limite do "bom".

### 3.1 Duas causas, ambas encontradas no código

**Causa A — placeholder de uma linha virando tabela inteira**

[`FulfillmentPageView.tsx:308`](../src/modules/dashboard/requisicao-atendimento/FulfillmentPageView.tsx#L308):

```tsx
{isLoading ? (
  <p className={styles.empty}>Carregando...</p>
) : list.length === 0 ? (
  <p className={styles.empty}>Nenhum pedido na fila.</p>
) : (
  <table className={styles.table}>   {/* ← empurra tudo abaixo */}
```

Um `<p>` de uma linha vira uma tabela de N linhas. Todo o conteúdo abaixo desloca. É o candidato direto ao 0,44 do seletor `div.FulfillmentPageView-module__9hXXh…`.

**Causa B — alerta injetado no fluxo, sem espaço reservado**

[`CronogramaSolicitacoesPageView.tsx:475`](../src/modules/dashboard/cronograma-solicitacoes/CronogramaSolicitacoesPageView.tsx#L475):

```tsx
{(error || feedback) && (
  <div className={error ? styles.alertError : styles.alertOk} …>
```

Aparece **depois** da `</section>` e empurra o rodapé — o que explica exatamente os dois seletores medidos nessa tela: `section…` com 0,47 **e** `footer…` com 0,14.

Mesmo padrão em [`FulfillmentPageView.tsx:306`](../src/modules/dashboard/requisicao-atendimento/FulfillmentPageView.tsx#L306).

### 3.2 É sistêmico, e a correção é única

Os padrões `{feedback ? <bloco/> : null}` e `{isLoading ? <p/> : <tabela/>}` se repetem em todas as telas ruins. **Não são cinco bugs — é um padrão de UI repetido.**

Correção em dois componentes compartilhados, aplicados por ordem de CLS:

```tsx
// 1. Slot de feedback com altura reservada: o bloco aparece SEM empurrar nada.
<div className={styles.feedbackSlot}>   {/* min-height fixo, sempre no DOM */}
  {feedback ? <p …>{feedback.message}</p> : null}
</div>

// 2. Skeleton com a altura aproximada do conteudo, no lugar do <p> de uma linha.
{isLoading ? <TableSkeleton rows={10} /> : …}
```

Nenhuma das duas muda regra de negócio, dado exibido ou chamada de API.

---

## 4. Plano

### Fase W1 — CLS — 🟢 aplicada em 2026-08-19

| # | Item | Onde | Estado |
|---|---|---|---|
| W1.1 | `FeedbackSlot` | [`src/components/ui/FeedbackSlot.tsx`](../src/components/ui/FeedbackSlot.tsx) | 🟢 |
| W1.2 | `TableSkeleton` + `TableSkeletonRows` | [`src/components/ui/TableSkeleton.tsx`](../src/components/ui/TableSkeleton.tsx) | 🟢 |
| W1.3 | `/requisicao-atendimento` (CLS 0,89) | `FulfillmentPageView` | 🟢 |
| W1.4 | `/cronograma-solicitacoes` (CLS 0,39) | `CronogramaSolicitacoesPageView` | 🟢 |
| W1.5 | `/composicao-equipe` (CLS 0,25) | `TeamCompositionPageView` | 🟢 |
| W1.6 | `/programacao-normalizada` e `/mapa-programacao` | | ⚪ não iniciado |

#### Por que a altura reservada não é um `min-height`

As três telas têm geometrias de feedback **diferentes**:

| Tela | Caixa do feedback |
|---|---|
| `/requisicao-atendimento` | `margin: 0` — parágrafo puro, sem padding nem borda |
| `/cronograma-solicitacoes` | `padding: 10px 14px`, `font-size: 13px`, borda |
| `/composicao-equipe` | `padding: 12px 16px`, `font-weight: 700`, borda, `border-radius: 16px` |

Um número fixo estaria errado nas três. O `FeedbackSlot` vazio renderiza **o mesmo elemento com a mesma classe**
do feedback real, apenas `visibility: hidden`: a altura é igual **por construção** e continua correta se o CSS
da tela mudar. Mesma ideia no `TableSkeleton`, que recebe a classe da tabela real — padding, `line-height` e
bordas vêm do CSS já existente, não de números escolhidos a esmo.

Resíduo conhecido: mensagem que quebra em duas linhas ainda desloca uma linha, porque o slot reserva uma por padrão.
O `FeedbackSlot` aceita `reserveLines` para as telas em que isso for frequente. Nenhuma das três precisa hoje.

#### Aceite objetivo — verificado

Critério: *nenhuma ocorrência de placeholder→tabela ou feedback inserido sem espaço reservado nas três rotas-alvo.*
Isso separa **o componente foi criado** de **o padrão sumiu**.

```
grep -nE "\{feedback \?|\{\(error \|\| feedback\)|\{error &&|\{feedback &&"  <as 3 telas>
  -> nenhuma ocorrencia

grep -nE "Carregando\.\.\.|Carregando composicoes|Carregando equipes"  <as 3 telas>
  -> 2 ocorrencias, ambas classificadas abaixo
```

| Ocorrência restante | Veredito |
|---|---|
| [`CronogramaSolicitacoesPageView.tsx:822`](../src/modules/dashboard/cronograma-solicitacoes/CronogramaSolicitacoesPageView.tsx#L822) | **Fora de escopo, legítimo.** Está dentro de `modalBackdrop`, aberto por clique. Shift após input do usuário não conta para CLS. |
| [`TeamCompositionPageView.tsx:951`](../src/modules/dashboard/composicao-equipe/TeamCompositionPageView.tsx#L951) | **Já coberto por entrega anterior.** O `<p>` usa `.coverageMessageLoading`, que tem `min-height: 236px` reservando o painel de cobertura. Não é shift não reservado. Ver a ressalva sobre `min-height` logo abaixo. |

**Correção de um veredito intermediário desta mesma fase:** cheguei a classificar a linha 951 como resíduo não reservado.
Está errado — `.coverageMessageLoading` já tem `min-height: 236px` e `.compositionsTableWrapper` já tem
`min-height: 360px`, ambos de uma entrega anterior de CLS registrada no `TASKS.md`. A rota fica 🟢.

#### Ressalva: `min-height` reserva um piso, não a altura real

Os `min-height` herdados e o número de linhas do skeleton têm o mesmo limite: garantem uma altura **mínima**, não a altura
**final**. Se o conteúdo carregado for mais alto que o reservado, ainda há deslocamento — em menor escala, mas há.

Por isso o número de linhas do skeleton foi alinhado ao tamanho de página real de cada tela, e não deixado num valor genérico:

| Tela | Tamanho de página | Linhas do skeleton |
|---|---|---|
| `/cronograma-solicitacoes` | 20 | 20 |
| `/composicao-equipe` | 20 (`DEFAULT_PAGE_SIZE`) | 20 |
| `/requisicao-atendimento` | 50 | **10** |

Nas duas primeiras, uma página cheia sai deslocamento zero. Em `/requisicao-atendimento` a página é de 50, mas a fila
de atendimento raramente tem 50 pedidos em aberto: reservar 50 linhas trocaria o deslocamento por meia tela vazia — que
também conta como CLS quando o conteúdo real encolhe o bloco. 10 é uma aposta na cardinalidade típica da fila, **não uma
medição**, e é o número a ajustar primeiro se o CLS dessa rota não cair como esperado.

Eliminar o resíduo por completo exigiria altura fixa com rolagem interna ou virtualização — decisão de UX, fora do W1.

#### O que não foi tocado

Nenhuma mudança em fetch, API, estado, regra de negócio ou estrutura de dados. O `{detail ? …}` de
[`FulfillmentPageView.tsx:370`](../src/modules/dashboard/requisicao-atendimento/FulfillmentPageView.tsx#L370) abre por
clique — mesmo motivo do modal, fora do CLS.

**Aceite de campo (pendente):** CLS de cada rota abaixo de 0,1 no Speed Insights quando houver amostra suficiente.
Hoje as três têm 4–8 amostras; ver seção 1.

### Fase W2 — LCP (caminho crítico de render, não banco)

W2.2 já está respondido — ver 2.2. O gate está em [`AppShell.tsx:474`](../src/components/layout/AppShell.tsx#L474).

| # | Item |
|---|---|
| W2.1 | Medir o **JS por rota** — `@next/bundle-analyzer`, ou o painel `Network` numa carga fria de `/medicao`. Ainda não medido. |
| W2.2 | ~~Confirmar quando o shell pinta~~ — 🟢 confirmado: só depois de JS + hidratação + `/api/auth/session-access` |
| W2.3 | Decidir a correção, com os dois números na mão: quanto do LCP é bundle e quanto é o gate |

**Não iniciar W2.3 antes de W2.1.** Foi exatamente o erro que a auditoria de banco cometeu ao priorizar o `dash-estoque`
por `calls` sem ter o ranking por custo. Saber *onde* está o gate não diz *qual fração* do tempo ele custa.

Ordem acordada: atacar o caminho crítico de layout/auth/providers **antes** de qualquer consulta. Mexer em API ou RPC
não move o LCP, porque o LCP acontece antes de a página buscar dados.

### Fase W3 — reavaliar com amostra maior

Voltar aos números quando as rotas ruins tiverem **≥ 20 amostras**. Hoje `/mapa-programacao` e `/dashboard-medicao` têm 2.

---

## 5. Como isto se encaixa na auditoria

| Frente | Métrica | Estado |
|---|---|---|
| Custo de banco | `pg_stat_statements` | 🟢 Nível B fechado — fila: `login_audit` → `get_programming_week_summary` |
| **Tempo de tela** | **Web Vitals** | 🟡 **este documento** — CLS com causa confirmada, LCP em investigação |

As duas frentes são **independentes**. Corrigir o CLS não muda o banco; corrigir o `login_audit` não muda o LCP. Podem correr em paralelo.

E vale registrar: o `dash-estoque`, que a auditoria de banco tirou da fila, **não aparece entre as piores nem em LCP nem em CLS**. A decisão de tirá-lo da fila continua correta pelas duas medições independentes.
