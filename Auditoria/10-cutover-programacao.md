# Corte para a Programação Normalizada — o que falta

Premissa do usuário: **`/programacao-normalizada` deve ser a principal, e tudo deve partir dela; as demais programações não devem mais ser usadas.**

Esta análise mede a distância entre essa premissa e o código de hoje.

**Conclusão: o corte está muito mais adiantado do que o menu sugere.** O backend legado já está isolado num único caminho, e o que resta é pequeno, mecânico e bem delimitado — com **uma exceção** que exige implementação de verdade.

---

## 1. Estado das 6 fases

Fases conforme as decisões travadas em 2026-07-29.

| # | Fase | Estado | Evidência |
|---|---|---|---|
| 1 | Tabela de mapeamento legado→novo | ✅ **feita** | `342_create_programming_legacy_map.sql` |
| 2 | Histórico legado migrado | ✅ **feita** | `343_migrate_legacy_programming_history.sql` |
| 3 | Consumidores só-leitura por projeto | ✅ **feita** | nenhum deles lê `project_programming` — ver §2 |
| 4 | Mapa de Programação | 🟡 **backend feito, UI não** | `/api/mapa-programacao` já importa de `@/server/modules/programacao-normalizada`; a `MapProgrammingPageView` ainda importa UI da Simples |
| 5 | Três donos de FK (Medição, APR, Cronograma) | ✅ **feitas** | `344_cronograma_...`, `350_apr_control_...`, `351_medicao_match_normalized_programming.sql` |
| 6 | Aposentar a Simples | ❌ **não feita** | é o que resta |

Escrita da Simples já congelada: `PROGRAMMING_SIMPLES_READ_ONLY = true` em [`handlers.ts:98`](../src/server/modules/programacao/handlers.ts#L98). A tela é **somente leitura** desde o commit `7ecd00a`.

---

## 2. O legado já está isolado num único caminho

Busca por quem lê a tabela legada em todo o `src/`:

| Tabela legada | Lida por |
|---|---|
| `project_programming` | **só** `server/modules/programacao/{handlers,queries}.ts` |
| `project_programming_history` | **só** `server/modules/programacao/queries.ts` |
| `project_programming_activities` | **só** `server/modules/programacao/queries.ts` |
| `project_programming_copy_batches` | **ninguém** |

E `server/modules/programacao` é importado **apenas** por `/api/programacao` e `/api/programacao/meta`, que são chamados **apenas** por `programacao-simples`.

```
programacao-simples  →  /api/programacao(/meta)  →  server/modules/programacao  →  project_programming*
        ↑
   único ponto de entrada de todo o modelo legado
```

Do outro lado, o normalizado já é lido por `server/modules/programacao-normalizada/queries.ts` e por `/api/medicao` diretamente.

**Isso é a melhor notícia da análise:** não há consumidor espalhado a caçar. Cortar a Simples corta o legado inteiro de uma vez.

---

## 3. O que exatamente bloqueia

### 3.1 Mapa de Programação — 5 símbolos no módulo errado (mecânico)

[`MapProgrammingPageView.tsx`](../src/modules/dashboard/mapa-programacao/MapProgrammingPageView.tsx#L12) importa da Simples:

| Símbolo | Origem hoje | Quem usa de verdade |
|---|---|---|
| `ProgrammingDeadlinePanel` | `programacao-simples/components.tsx:735` | **só o Mapa** |
| `DEADLINE_CAROUSEL_PAGE_SIZE`, `DEADLINE_WINDOW_*` (4 constantes) | `programacao-simples/constants.ts:27-31` | **só o Mapa** |
| `buildDeadlineCsvContent` | `programacao-simples/exports.ts` | **só o Mapa** |
| `resolveDeadlineStatus` | `programacao-simples/utils.ts` | **só o Mapa** |
| `formatDeadlineStatusLabel` | `programacao-simples/utils.ts` | **só o Mapa** |

Verificado símbolo a símbolo: **fora do próprio arquivo que os define, o único consumidor é o `mapa-programacao`.** A Simples não usa nenhum deles na sua própria tela.

São ativos do Mapa morando no módulo errado. Movê-los para `mapa-programacao` é **mecânico e sem mudança de comportamento** — e resolve a fase 4 por inteiro.

Sinal que confirma o diagnóstico: a Normalizada já tem `buildProgrammingCsvContent`, `buildEnelCsvContent` e `buildEnelNovoWorkbookData` (as três extrações portadas), e **não tem** `buildDeadlineCsvContent`. Não é lacuna de paridade — é que esse export nunca pertenceu à tela de Programação.

### 3.2 `/programacao-visualizacao` — o único item que exige implementação

Decisão travada #5: *"`programacao-visualizacao` vira modo de consulta da Normalizada"*.

Hoje:

```tsx
// (dashboard)/programacao-visualizacao/page.tsx
<ProgrammingSimplePageView mode="visualizacao" />
```

A Simples tem esse modo implementado ([`ProgrammingSimplePageView.tsx:111,117`](../src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx#L111)):

```tsx
export function ProgrammingSimplePageView({ mode = "cadastro" }: { mode?: ProgrammingSimplePageViewMode })
const isVisualizationMode = mode === "visualizacao";
```

A **Normalizada não tem modo de visualização.** `ProgrammingNormalizedPageView` não recebe `mode`; a única ocorrência de `mode` no arquivo é `mode={postponeMode}`, que é do fluxo de adiamento e não tem relação.

**Este é o único bloqueio que não é mover código.** Precisa implementar o modo consulta na Normalizada, com a mesma regra de esconder ações de escrita que a Simples aplica.

### 3.3 Redirect e menu — configuração

| Item | Hoje | Alvo |
|---|---|---|
| `/programacao` | `redirect("/programacao-simples")` | `redirect("/programacao-normalizada")` |
| Menu "Programacao" | → `/programacao-simples` | → `/programacao-normalizada` |
| Menu "Programacao (Normalizada)" | entrada separada | some (vira a principal) |
| Menu "Visualizacao Programacao" | → Simples | → Normalizada em modo consulta |

### 3.4 Permissões

`page_key` registradas: `programacao`, `programacao-simples`, `programacao-normalizada`, `programacao-visualizacao`, mais as granulares `programacao-api`, `programacao-concluir`, `programacao-corrigir-data`, `programacao-pendencia`, `programacao-postpone`.

[`PermissionsPageView.tsx:76`](../src/modules/dashboard/permissoes/PermissionsPageView.tsx#L76) lista `programacao-simples` com o rótulo "Programacao". Precisa acompanhar a troca — e as granulares precisam ser conferidas uma a uma contra a Normalizada antes de qualquer remoção, sob pena de operação liberada por engano.

---

## 4. Ordem sugerida

Cada passo é entregável e reversível sozinho.

| # | Passo | Natureza | Risco |
|---|---|---|---|
| C1 | Mover os 5 símbolos de deadline para `mapa-programacao` | mecânico | baixo — nenhum outro consumidor |
| C2 | Implementar modo consulta na Normalizada | **implementação** | médio — é o único item de código novo |
| C3 | Repontar `/programacao-visualizacao` para a Normalizada | configuração | baixo |
| C4 | Repontar `/programacao` e ajustar o menu | configuração | baixo |
| C5 | Ajustar `page_key` de permissão | configuração | **atenção** — conferir as granulares |
| C6 | Remover `programacao-simples`, `/api/programacao(/meta)`, `server/modules/programacao` | remoção | baixo depois de C1–C5 |

**C1 pode ir sozinho, já.** Não depende de nada e tira o único acoplamento de runtime entre os módulos.

C6 só depois de C1–C5 e de confirmar que nenhuma tela quebrou.

---

## 5. Efeito na auditoria de performance

| Item | Efeito |
|---|---|
| `programacao (legado)` — ≈96.500 chamadas, ≈1.297 s ([`08` §1.2](08-nivel-b-resultado.md#12-o-maior-consumidor-medido-é-um-módulo-que-a-auditoria-tratou-como-legado)) | **zera em C6.** Não é otimização, é remoção — e não exige RPC nova nem índice novo. |
| Custo/benefício vs. P2.1 e P2.2 | C6 elimina o maior consumidor medido **deletando código**, sem risco de mudar número de card. As RPCs de dashboard entregam menos e custam mais. |
| `project_programming_history` (912 s, pendente de validação temporal) | Se for tráfego vivo, C6 zera junto. Se for pré-cutover, decai sozinho. **Nos dois casos C6 resolve** — o que remove a urgência de responder P1.1 antes de agir. |
| Índices `project_programming` (19) e write amplification ([`02` §4](02-nivel-a-indices.md#4-write-amplification)) | Depois de C6 as tabelas legadas ficam sem leitor. Aí sim decidir entre manter por histórico ou arquivar — decisão de dados, não de performance. |

> **Recomendação:** o corte da Programação passa à frente de P2.2 (`dash-operacional-faturamento`) na fila. Não porque a medição já ranqueou custo — ela ainda não ranqueou —, mas porque é o único caminho que remove custo **apagando código já marcado para morrer**, com risco menor que escrever uma RPC de agregação nova.
>
> Isso **não** dispensa P1.1/P1.2. Dispensa apenas esperar por eles *para este item*.
