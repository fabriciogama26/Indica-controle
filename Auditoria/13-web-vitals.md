# Web Vitals — a dimensão de tempo de tela

Dados do Vercel Speed Insights. É a medição que faltava para decidir as telas: o Nível B mediu **custo de banco**, isto mede **o que o usuário espera**.

> Ver a distinção em [`06`](06-plano-de-acao.md), seção "Latência ≠ custo de banco". Uma tela pode custar 1% do banco e ainda assim demorar 6 segundos.

## Janelas medidas

| Janela | Device | Onde está neste documento |
|---|---|---|
| **12 a 18 de agosto de 2026** | não registrado na coleta | seções 1 a 5 — diagnóstico original, LCP e CLS por rota |
| **1 a 7 de setembro de 2026** | Desktop, Production | seção 7 — reavaliação da Fase W3 |

Duas frentes que estavam abertas em agosto foram fechadas e estão nas seções novas:

- **Seção 6 — W2.1 medido.** O JS por rota. O tronco comum é **84% do payload da rota mais pesada** e a amplitude entre a maior e a menor rota é de **43,8 kB gzip** — o que derruba o bundle por rota como explicação do LCP e responde o W2.3.
- **Seção 7 — Fase W3.** A amostra saiu de 2–14 para 15–115 por rota, o CLS caiu de 0,14 para **0,06** (a Fase W1 funcionou) e o LCP **piorou**, de 2,55 s para **3,78 s**.

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

[`AppShell.tsx:511`](../src/components/layout/AppShell.tsx#L511):

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
As duas variáveis vêm de `useAuth` ([`AppShell.tsx:449`](../src/components/layout/AppShell.tsx#L449)),
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

W2.2 e W2.1 estão respondidos — ver 2.2 e a **seção 6**. O gate está em [`AppShell.tsx:511`](../src/components/layout/AppShell.tsx#L511).

| # | Item | Estado |
|---|---|---|
| W2.1 | Medir o **JS por rota** | 🟢 medido em 2026-09-08 — seção 6. Tronco comum 233,6 kB gzip; amplitude entre rotas 43,8 kB gzip |
| W2.2 | ~~Confirmar quando o shell pinta~~ | 🟢 só depois de JS + hidratação + `/api/auth/session-access` |
| W2.3 | Decidir a correção, com os dois números na mão | 🟢 decidido — seção 6.3: o alvo é o gate de sessão, não o code splitting por rota |
| W2.4 | Executar a correção do gate | ⚪ não iniciado — proposta em 6.4, ainda **não** validada em campo |

**Não iniciar W2.3 antes de W2.1.** Foi exatamente o erro que a auditoria de banco cometeu ao priorizar o `dash-estoque`
por `calls` sem ter o ranking por custo. Saber *onde* está o gate não diz *qual fração* do tempo ele custa.
Regra cumprida: W2.3 só foi decidido depois de a medição da seção 6 existir.

Ordem acordada: atacar o caminho crítico de layout/auth/providers **antes** de qualquer consulta. Mexer em API ou RPC
não move o LCP, porque o LCP acontece antes de a página buscar dados.

### Fase W3 — reavaliar com amostra maior

🟢 **Executada em 2026-09-08 — resultado na seção 7.** O critério de entrada (≥ 20 amostras) foi atingido em 10 das 11 rotas
do ranking novo; em agosto `/mapa-programacao` e `/dashboard-medicao` tinham 2.

---

## 5. Como isto se encaixa na auditoria

| Frente | Métrica | Estado |
|---|---|---|
| Custo de banco | `pg_stat_statements` | 🟢 Nível B fechado — fila: `login_audit` → `get_programming_week_summary` |
| **Tempo de tela** | **Web Vitals** | 🟡 **este documento** — CLS corrigido e confirmado em campo (0,06); LCP com causa e alvo decididos, correção não iniciada |

As duas frentes são **independentes**. Corrigir o CLS não muda o banco; corrigir o `login_audit` não muda o LCP. Podem correr em paralelo.

E vale registrar: o `dash-estoque`, que a auditoria de banco tirou da fila, **não aparece entre as piores nem em LCP nem em CLS**. A decisão de tirá-lo da fila continua correta pelas duas medições independentes.

---

## 6. W2.1 — o JS por rota, medido

Coleta de **2026-09-08**, sobre `npm run build` do commit `6afcc1b`.
Reexecutável: [`scripts/performance/measure-route-bundles-readonly.mjs`](../scripts/performance/measure-route-bundles-readonly.mjs).

> **Ponteiros de linha atualizados nesta revisão.** O gate de sessão descrito em 2.2 continua existindo e inalterado
> na forma, mas o arquivo cresceu desde agosto: `AppShell.tsx` foi de 474 para **511** (o `if (isLoading || !session)`)
> e de 419 para **449** (o `useAuth()`). Todas as citações deste documento foram corrigidas para as linhas atuais.
> Nenhum achado muda — apenas o endereço.

### 6.1 Por que a medição tinha falhado antes

Agosto registrou "o `build-manifest` devolve o mesmo conjunto compartilhado (401 kB) para todas". Duas causas:

1. **`.next/build-manifest.json` é o manifesto do Pages Router.** Num app App Router ele não descreve as rotas de `app/` — devolve o tronco comum e nada mais. A fonte certa seria `app-build-manifest.json`, que **este build não emite**: o projeto usa Next 16 com Turbopack (`next build` imprime `▲ Next.js 16.3.3 (Turbopack)`).
2. **O `next build` com Turbopack não imprime mais a tabela de "First Load JS" por rota.** A saída lista as rotas sem as colunas de tamanho. Era daí que o número costumava sair.

A fonte que funciona é o **HTML pré-renderizado de cada rota** em `.next/server/app/<rota>.html`: as 170 páginas são estáticas (`○`), e os `/_next/static/*.js` que cada HTML referencia são exatamente os chunks que o navegador busca antes de hidratar. É o que o script mede, somando bytes em disco e em gzip.

> Ressalva de método: a Vercel serve com **brotli**, tipicamente 15–20% menor que gzip. Os números abaixo são, portanto, um **teto** do que trafega — o que só reforça a conclusão, nunca a enfraquece.

### 6.2 O resultado

**59 rotas reais** (fora `_not-found` e `_global-error`, que não carregam os mesmos providers).

| | gzip | cru |
|---|---|---|
| **Tronco comum** — 9 chunks presentes em **todas** as rotas | **233,6 kB** | 790,0 kB |
| Rota mais pesada (`/programacao-normalizada`) | 277,8 kB | 971,6 kB |
| Rota mais leve (`/`) | 234,1 kB | 790,8 kB |
| **Amplitude entre a maior e a menor rota** | **43,8 kB** | 180,8 kB |

**O tronco comum é 84,1% do payload da rota mais pesada.** O code splitting por rota já existe e já funciona; o que ele separa é pequeno.

Composição do tronco (`--baseline`):

| Chunk | gzip | cru | Biblioteca |
|---|---|---|---|
| `1mkbuudhndal5.js` | 69,7 kB | 223,6 kB | `react-dom` |
| `1qg-zjzdujtg1.js` | **46,5 kB** | 179,6 kB | **`@supabase/supabase-js`** |
| `2e_32g43rjawq.js` | 41,6 kB | 151,8 kB | — |
| `0cz1d0mv5g_q7.js` | 38,6 kB | 110,0 kB | — |
| outros 5 | 37,2 kB | 125,0 kB | — |

`react-dom` + `@supabase/supabase-js` somam **116,2 kB gzip, ~50% do tronco**. O `supabase-js` entra pela cadeia
[`AuthContext.tsx`](../src/context/AuthContext.tsx) → [`src/lib/supabase/client.ts`](../src/lib/supabase/client.ts),
que está no layout raiz — ou seja, **toda rota embarca o cliente do Supabase**, inclusive `/` e `/login`.

### 6.3 W2.3 — a decisão, agora com o número

A pergunta era: quanto do LCP é bundle e quanto é o gate de sessão. Resposta:

| | `/login` | `/medicao` | diferença |
|---|---|---|---|
| Bundle (gzip) | 241,3 kB | 268,7 kB | **27,4 kB** |
| LCP (agosto) | 1,02 s | 4,61 s | **3,59 s** |

**27,4 kB gzip não produzem 3,59 s.** Mesmo a 1 Mbps efetivo — pessimista para o parque real — são ~0,22 s de
transferência, menos de 6% da diferença; parse e execução do delta acrescentam dezenas de milissegundos, não segundos.

O caso que fecha o argumento é um experimento natural que o próprio código oferece:

| Rota | Bundle gzip | RES (1–7 set) |
|---|---|---|
| `/medicao` | 268,7 kB | 81 |
| `/medicao-comercial` | 268,8 kB | 87 |

[`CommercialMeasurementPageView`](../src/modules/dashboard/medicao-comercial/CommercialMeasurementPageView.tsx) **é o
mesmo `MeasurementPageView` com uma prop de variante** — os bundles diferem em 0,1 kB. Ainda assim o RES difere em
6 pontos. Bundle idêntico não pode explicar RES diferente.

E no conjunto das 11 rotas do ranking de setembro, a relação entre tamanho de bundle e RES **não aparece**:

```
Pearson  RES x bundle_gzip : 0,091
Spearman RES x bundle_gzip : 0,145
faixa de bundle: 25,5 kB gzip   |   faixa de RES: 20 pontos
```

Correlação nula e de sinal invertido (bundle maior → RES marginalmente melhor), o que é ruído.
**Ressalva honesta:** com n = 11 e apenas 25,5 kB de dispersão, este teste não teria poder para detectar um efeito
pequeno mesmo se ele existisse. Ele não *prova* que o bundle é irrelevante — quem sustenta isso é o par
`/medicao` × `/medicao-comercial` e a aritmética dos 27,4 kB. A correlação apenas não contradiz.

**Veredito do W2.3: o alvo é o gate de sessão, não o code splitting por rota.** Dividir bundle por rota disputa
43,8 kB gzip no melhor caso absoluto — e o LCP a bater está em segundos.

### 6.4 W2.4 — o que atacar, em ordem de retorno

⚠️ **Nada disto foi aplicado.** É proposta, não entrega, e cada item precisa da sua própria tarefa e validação.

| # | Alvo | Por quê | Risco |
|---|---|---|---|
| 1 | **Não esconder o shell atrás da sessão** — [`AppShell.tsx:511`](../src/components/layout/AppShell.tsx#L511) devolver a moldura (logo, barra lateral, cabeçalho) imediatamente e gatear só o conteúdo | O elemento de LCP medido **é a moldura**. Pintá-la sem esperar a rede tira o round-trip inteiro do caminho crítico | Médio — mexe em fluxo de auth; a moldura não pode exibir dado de tenant antes de a sessão resolver |
| 2 | **Resolver a sessão no servidor**, em vez de `fetch("/api/auth/session-access")` com `cache: "no-store"` no cliente ([`auth.service.ts:52`](../src/services/auth/auth.service.ts#L52)) | Elimina a ida à rede em série depois da hidratação | Alto — redesenho do caminho de sessão, multi-tenant |
| 3 | **Tirar `@supabase/supabase-js` do tronco** (46,5 kB gzip em toda rota) | Único item que rende em **todas** as 59 rotas de uma vez | Médio — exige confirmar que o cliente de browser só é necessário sob demanda |

O item 1 é o de melhor relação retorno/risco e ataca a causa medida. O item 3 é o maior ganho de bytes disponível —
e ainda assim vale lembrar que 46,5 kB gzip valem centenas de milissegundos, não os 3 s do gap.

---

## 7. Fase W3 — reavaliação com a janela de 1 a 7 de setembro de 2026

Captura do Speed Insights em **Desktop / Production**, "Last 7 Days", lida em 2026-09-08.

### 7.1 Agregado

| Métrica | Agosto | Setembro | Estado |
|---|---|---|---|
| **RES** | não registrado | **87** | 🟡 abaixo de 90 |
| FCP | não registrado | **0,77 s** | 🟢 |
| **LCP** | 2,55 s | **3,78 s** | 🟡 **piorou** |
| INP | não registrado | **128 ms** | 🟢 |
| **CLS** | 0,14 | **0,06** | 🟢 **caiu 57%** |

**O CLS valida a Fase W1.** O aceite de campo que estava pendente desde 19/08 passou no agregado: 0,06 está abaixo
de 0,1. Ressalva: esta captura traz RES por rota, **não** CLS por rota — o aceite *por rota* segue não verificado.

**O INP nunca havia sido medido** e está verde (128 ms). Não gera ação.

### 7.2 O FCP é a nova evidência do gate

FCP **0,77 s** com LCP **3,78 s**: três segundos entre a primeira pintura e a maior pintura.

Isso é a assinatura exata do gate descrito em 2.2. Algo pinta rápido — o card `Carregando sessao...` de
[`AppShell.tsx:511`](../src/components/layout/AppShell.tsx#L511) — e a moldura real só aparece três segundos depois,
quando a sessão resolve. Em agosto a hipótese vinha do seletor do elemento de LCP; agora o intervalo FCP→LCP a
confirma pelo agregado, por um caminho independente.

Também explica por que o LCP piorou enquanto o CLS melhorou: são causas distintas, e a W1 nunca tocou no gate.

### 7.3 RES por rota

Todas as 11 rotas abaixo de 90.

| Rota | Amostras | RES | Bundle gzip (§6) | Já auditada em agosto? |
|---|---|---|---|---|
| `/dashboard-equipes` | 24 | **69** | 256,9 kB | não |
| `/programacao-normalizada` | 80 | **70** | **277,8 kB** (maior) | sim — LCP 2,67 s, CLS 0,24 |
| `/projetos` | 46 | 71 | 268,5 kB | não |
| `/atividades` | 44 | 71 | 259,6 kB | não |
| `/permissoes` | 21 | 73 | 252,3 kB | não |
| `/composicao-equipe` | 38 | 75 | 260,3 kB | sim — LCP 5,47 s, CLS 0,25 → W1 aplicada |
| `/entrada` | 15 | 76 | 266,7 kB | sim — LCP 2,55 s, CLS 0,11 |
| `/meta` | 25 | 77 | 256,1 kB | não |
| `/medicao` | 115 | 81 | 268,7 kB | sim — LCP 4,61 s |
| `/medicao-comercial` | 103 | 87 | 268,8 kB | não |
| `/equipes` | 65 | **89** | 261,7 kB | não |

**Sete das onze rotas nunca foram auditadas** — o ranking de agosto olhava outro conjunto.

### 7.4 O que NÃO é comparável entre as duas janelas

Registrado para o documento não sugerir uma comparação que os dados não sustentam:

1. **Métricas diferentes por rota.** Agosto tem LCP e CLS por rota; setembro tem **RES** por rota, que é um índice
   composto (FCP + LCP + CLS + INP) ponderado por amostra. A coluna "RES" e a coluna "LCP" não se comparam.
2. **Device diferente.** Esta captura é explicitamente **Desktop**; a coleta de agosto não registrou o filtro de device.
   Parte da variação de 2,55 s → 3,78 s pode ser mix de dispositivo, não regressão de código. **Não tratar a piora do
   LCP como regressão confirmada** sem repetir a leitura com o mesmo filtro.
3. **Rotas ausentes.** `/mapa-programacao`, `/dashboard-medicao`, `/requisicao-atendimento`, `/cronograma-solicitacoes`,
   `/login` e `/home` não aparecem no ranking de setembro. Ausência aqui é falta de tráfego na janela, não melhora.

### 7.5 O que a amostra maior corrigiu

O critério de entrada da W3 era ≥ 20 amostras. Foi atingido em **10 das 11** rotas — `/entrada` tem 15.
Em agosto, `/mapa-programacao` e `/dashboard-medicao` tinham 2 e `/entrada` tinha 1.

A ressalva da seção 1 ("P75 sobre 2 amostras não é P75") **deixa de valer para as rotas desta tabela**, e passa a
valer o oposto: os números de agosto para `/mapa-programacao` (6,72 s) e `/dashboard-medicao` (5,13 s), que
orientaram a priorização, continuam apoiados em 2 amostras cada e **nunca foram confirmados**. Não usá-los para
ordenar trabalho novo.

### 7.6 Fila sugerida a partir desta janela

| # | Item | Justificativa |
|---|---|---|
| 1 | **W2.4 item 1** — soltar a moldura do gate de sessão | Ataca o intervalo FCP→LCP de 3 s, que é global; nenhuma rota escapa dele |
| 2 | **W1.6** — CLS de `/programacao-normalizada` | Ficou de fora da W1 e a rota é a 2ª pior de RES, com o maior bundle |
| 3 | **Diagnosticar `/dashboard-equipes`** (RES 69, o pior) | Nunca auditada, bundle mediano — a causa não está nos bytes |
| 4 | Repetir a captura com filtro **Mobile** e por rota em LCP/CLS | Fecha as lacunas 1 e 2 da seção 7.4 |
