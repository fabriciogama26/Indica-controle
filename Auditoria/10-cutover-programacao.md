# Corte para a Programação Normalizada — o que falta

Premissa do usuário: **`/programacao-normalizada` deve ser a principal, e tudo deve partir dela; as demais programações não devem mais ser usadas.**

Esta análise mede a distância entre essa premissa e o código de hoje.

**Conclusão: o corte está adiantado no banco e nas migrations, mas a virada na aplicação não está completa** — e há um consumidor vivo do modelo legado que contradiz o que a migration 351 declara ter fechado.

> ### ⚠️ Correção da primeira versão deste documento
>
> A versão anterior afirmava que *"o legado já está isolado num único caminho"*. **Isso estava errado**, por dois erros de método meus:
>
> 1. Busquei `/api/` apenas dentro dos três módulos de programação, em vez de varrer o `src/` inteiro — e por isso não vi que a **Medição** chama `/api/programacao`.
> 2. Meu script de módulos órfãos comparava `dashboard/<nome>` por substring, e `dashboard/programacao` casa com `dashboard/programacao-simples`. O falso negativo escondeu um módulo inteiro.
>
> As duas falhas foram apontadas pelo usuário. A §2 abaixo está reescrita.

---

## 1. Estado das 6 fases

Fases conforme as decisões travadas em 2026-07-29.

| # | Fase | Estado | Evidência |
|---|---|---|---|
| 1 | Tabela de mapeamento legado→novo | ✅ **feita** | `342_create_programming_legacy_map.sql` |
| 2 | Histórico legado migrado | ✅ **feita** | `343_migrate_legacy_programming_history.sql` |
| 3 | Consumidores só-leitura por projeto | ✅ **feita** | nenhum deles lê `project_programming` |
| 4 | Mapa de Programação | ✅ **feita** | backend já usava `@/server/modules/programacao-normalizada`; a UI foi desacoplada no **C2** (2026-08-12) — o Mapa não importa mais nada de `programacao-simples` |
| 5 | Três donos de FK (Medição, APR, Cronograma) | ✅ **feita** | `344_cronograma_...`, `350_apr_control_...`, `351_medicao_...` aplicadas; o front da Medição foi corrigido no **C0** (commit `eadefad`). Ver §3.0 |
| 6 | Aposentar a Simples | ❌ **não feita** | é o que resta |

A fase 5 é a que estava mal classificada na primeira versão. **A migration foi feita; a tela não acompanhou.** É a origem do risco alto da §3.0.

Escrita da Simples já congelada: `PROGRAMMING_SIMPLES_READ_ONLY = true` em [`handlers.ts:98`](../src/server/modules/programacao/handlers.ts#L98). A tela é **somente leitura** desde o commit `7ecd00a`.

---

## 2. Quem ainda consome o modelo legado

No **servidor**, o isolamento é real: `project_programming`, `project_programming_history` e `project_programming_activities` são lidas **só** por `server/modules/programacao/{handlers,queries}.ts`, importado **só** por `/api/programacao` e `/api/programacao/meta`. `project_programming_copy_batches` não é lida por ninguém.

No **frontend**, havia três consumidores. **Dois foram eliminados no commit `eadefad` (2026-08-12)**:

| Consumidor | Chamadas | Estado |
|---|---|---|
| `programacao-simples/api.ts` | 11 (leitura + escrita) | ✅ esperado — é a tela congelada, sai no C8 |
| ~~`medicao/MeasurementPageView.tsx`~~ | ~~2 leituras~~ | ✅ **corrigido no C0** — passou a usar `/api/medicao/programming-sources` |
| ~~`programacao/ProgrammingPageView.tsx`~~ | ~~4 (1 leitura + 3 escritas)~~ | ✅ **removido no C1** — módulo órfão apagado (~3.700 linhas) |

```
programacao-simples ──→ /api/programacao → server/modules/programacao → project_programming*
                        ↑ único consumidor restante
```

Depois do C0/C1, **cortar a Simples passa a cortar o legado inteiro** — que era o que a primeira versão deste documento afirmava, erradamente, já ser verdade.

---

## 3. O que exatamente bloqueia

### 3.0 Medição lendo do legado — risco **ALTO**, e é bug latente, não só dívida

A migration [`351_medicao_match_normalized_programming.sql`](../supabase/migrations/351_medicao_match_normalized_programming.sql) declara no cabeçalho:

> *"Fecha o corte: depois desta migration **nenhuma tela em producao le/escreve `project_programming` como fonte viva** (ela permanece so como arquivo historico)."*

**O código contradiz a migration.** A Medição carrega suas fontes de programação de `/api/programacao`, que lê `project_programming`:

| Ponto | Caminho |
|---|---|
| [`:1208`](../src/modules/dashboard/medicao/MeasurementPageView.tsx#L1208) | `loadSources` — formulário manual |
| [`:2010`](../src/modules/dashboard/medicao/MeasurementPageView.tsx#L2010) | cadastro em massa |
| [`:2152`](../src/modules/dashboard/medicao/MeasurementPageView.tsx#L2152) | `programmingId: selectedSchedule?.id ?? null` |

Logo, `selectedSchedule.id` é um **`project_programming.id` legado**, e é ele que vai como `p_programming_id` para `save_project_measurement_order` — que, **depois da 351, resolve `p_programming_id` contra `programming` (normalizado)**.

As migrations 315/335 geraram UUIDs novos sem guardar a origem. **O ID legado nunca vai casar com nenhum `programming.id`.**

**Por que não quebrou visivelmente:** a RPC tem fallback por projeto + equipe + data (bloco 3 da 351). Então o match explícito falha em silêncio e cai sempre no fallback. Consequências:

1. **A escolha explícita do usuário é descartada.** O fallback re-resolve por projeto+equipe+data com desempate por status (`PROGRAMADA` > `REPROGRAMADA` > `ADIADA` > `CANCELADA`) — não pela etapa que a pessoa selecionou na tela.
2. **Vínculo perdido quando a etapa mudou de data.** A própria 351 mediu isso em produção: 14 das 181 ordens vinculadas são casos em que a etapa foi reprogramada, adiada ou cancelada para outra data depois da criação da ordem. Nesses, o fallback busca pela data da ordem, não acha, e `programming_id` fica nulo.
3. O caminho `p_programming_id` explícito — o que a 351 escreveu com mais cuidado, incluindo a validação de equipe ATIVA em `programming_team` — **nunca é exercitado pela tela**.

> **Severidade: ALTO / Confiança: Alta.** É divergência entre guia e implementação no sentido da seção 12 do `CLAUDE.md`: a migration afirma um estado que o código não cumpre. Não resolver em silêncio — e não é aceitável deixar para a fase 6, porque afeta dados gravados **agora**.

#### Correção — desenho travado do C0

**Não** apontar a Medição para `/api/programacao-normalizada`: isso misturaria permissões de tela (a Medição passaria a depender do `page_key` da Programação) e criaria dependência do C3.

**Endpoint próprio de fontes da Medição**, autorizado por `medicao`:

```
GET /api/medicao/programming-sources?startDate=&endDate=
  requirePageAction({ pageKey: "medicao", action: "access" })
  → server/modules/programacao-normalizada (fachada pública)
    → programming + programming_team + programming_activity
  → devolve o MESMO shape que a tela já consome
```

**A peça que faz isso funcionar — o fan-out por equipe:**

O legado é **uma linha por (projeto, equipe, data)**, então `ScheduleItem.teamId` é escalar. O normalizado é **uma etapa por (projeto, data)**, com N equipes em `programming_team`. A conversão não é 1:1 — o endpoint precisa emitir **um `ScheduleItem` por equipe ATIVA da etapa**, todos com o mesmo `id = programming.id`:

```
programming (1 etapa)                    ScheduleItem[]
  id = P1, date = D, project = X    →    { id: P1, teamId: T1, projectId: X, date: D }
  programming_team: T1, T2 (ATIVA)       { id: P1, teamId: T2, projectId: X, date: D }
```

Isso é **exatamente o contrato que a migration 351 espera**: ela recebe `p_programming_id` (a etapa) e `p_team_id` separados, e valida por `exists` que a equipe está ATIVA em `programming_team`. Mandar o mesmo `programming.id` com `teamId` diferente é o uso correto, não um contorno.

**Mapeamento de campos:**

| `ScheduleItem` | Origem normalizada |
|---|---|
| `id` | `programming.id` ← **o que corrige o bug** |
| `projectId` | `programming.project_id` |
| `teamId` | `programming_team.team_id` (status `ATIVA`) — fan-out |
| `status` | `programming.status` |
| `date` | `programming.execution_date` |
| `electricalField` | `programming.campo_eletrico` |
| `workCompletionStatus` | `programming.work_completion_status` |
| `activities` | `programming_activity` (ativas) |

Mais `projects`, `teams` e `workCompletionCatalog`, que a tela também lê da mesma resposta.

**Impacto na tela: 2 linhas.** Só a URL em [`:1208`](../src/modules/dashboard/medicao/MeasurementPageView.tsx#L1208) e [`:2010`](../src/modules/dashboard/medicao/MeasurementPageView.tsx#L2010). O shape é idêntico, então o `MeasurementPageView.tsx` (3.641 linhas, acima do teto) **não precisa ser refatorado** — o que mantém o C0 pequeno e revisável.

> **Consequência não óbvia, agora ATIVA em produção:** até o C0, o caminho explícito de `p_programming_id` nunca era exercitado, então a validação da 351 — "a equipe pedida precisa estar ATIVA na etapa" — estava **dormente**. **Depois do C0 (`eadefad`) ela vale de verdade.** A própria 351 mediu que rejeitaria 1 das 181 ordens já vinculadas se fosse reeditada. Ou seja: pode aparecer erro de salvamento em casos de borda que antes passavam calados pelo fallback. **Isso é a correção funcionando**, não regressão — está registrado em `docs/Tela_Medicao_SaaS.txt` para quem for atender o chamado.

**Verificação pré-implantação (read-only, sem tocar em nada):** para um período representativo, comparar o conjunto de tuplas `(projectId, teamId, date)` devolvido pelo endpoint novo com o do `/api/programacao`. Devem coincidir; a única diferença esperada é o `id`. Divergência aqui indica etapa sem equipe ATIVA ou lacuna de migração — e tem que ser explicada **antes** de trocar a tela.

**Dívida relacionada que aparece de brinde:** `/api/medicao/route.ts` já lê `from("programming")` direto em 3 pontos, contornando a fachada pública do módulo — que existe justamente para impedir isso (ver o cabeçalho de [`server/modules/programacao-normalizada/index.ts`](../src/server/modules/programacao-normalizada/index.ts)). O C0 é a hora natural de mover essas 3 leituras para a fachada também.

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

### 3.5 Módulo `programacao/` órfão — 110 KB de código morto com escrita

`src/modules/dashboard/programacao/` existe, tem **72 KB** só de `ProgrammingPageView.tsx` (mais CSS, `types.ts`, `utils.ts`), e **ninguém o importa**. `/programacao/page.tsx` só faz `redirect`; a busca por `@/modules/dashboard/programacao"` e por `ProgrammingPageView` fora da própria pasta não retorna nenhum consumidor.

Agravante: ele contém **três chamadas de escrita** para `/api/programacao` ([:733](../src/modules/dashboard/programacao/ProgrammingPageView.tsx#L733), [:862](../src/modules/dashboard/programacao/ProgrammingPageView.tsx#L862), [:912](../src/modules/dashboard/programacao/ProgrammingPageView.tsx#L912)) — hoje inertes porque nada renderiza o componente, e barradas por `PROGRAMMING_SIMPLES_READ_ONLY` se fossem executadas. Mas é código de escrita no modelo legado esperando alguém religar uma rota.

**Remoção segura e imediata** — não depende de nenhuma outra fase. É o item de menor risco e maior redução de superfície do corte inteiro.

### 3.4 Permissões

`page_key` registradas: `programacao`, `programacao-simples`, `programacao-normalizada`, `programacao-visualizacao`, mais as granulares `programacao-api`, `programacao-concluir`, `programacao-corrigir-data`, `programacao-pendencia`, `programacao-postpone`.

**O fallback de acesso padrão está invertido em relação ao alvo.** [`DEFAULT_USER_PAGE_ACCESS`](../src/lib/auth/authorization.ts#L80) libera `programacao-simples` e `programacao-visualizacao` para usuário sem permissão customizada — e **não** libera `programacao-normalizada`. Ou seja, hoje o usuário comum só alcança a Normalizada por concessão explícita na tela de Permissões.

Isso é o oposto do que "a Normalizada é a principal" exige, e **não é uma linha a trocar**. O comentário na própria constante fixa a regra:

> *"Adicionar chave exige que o banco já tenha `default_user_access = true` para ela, concedido por migration explícita (padrão da migration 348)."*

Ou seja, liberar `programacao-normalizada` no fallback exige **migration** antes — a 356 força `default_user_access = false` em todo `INSERT` de `app_pages`. Adicionar a chave na lista sem a migration concederia a tela a todo usuário não administrativo sem registro em `app_user_permission_history`.

> ✅ **Resolvido no C3** pela migration `362`, que seguiu o padrão de 4 passos da 348 e fechou uma **inversão pai/filho** que a análise não tinha visto: a 348 liberou as três granulares filhas para o papel "Usuário", mas a tela **pai** continuou bloqueada desde a 312 — o papel tinha as sub-permissões de uma tela a que não chegava sozinho. A migration tem validação que aborta se essa inversão persistir.
>
> **Divergência pré-existente, deixada de fora do C3 de propósito:** as três granulares estão `default_user_access = true` no banco (348) e **não** aparecem em `DEFAULT_USER_PAGE_ACCESS`. Pela regra documentada na própria constante, adicioná-las seria permitido — o banco já está `true`. Não foi feito aqui por ser fora do escopo do C3 e por ser mudança de permissão, que não deve pegar carona em outra entrega. Vale decidir em separado.

[`PermissionsPageView.tsx:76`](../src/modules/dashboard/permissoes/PermissionsPageView.tsx#L76) lista `programacao-simples` com o rótulo "Programacao" e precisa acompanhar a troca. As granulares precisam ser conferidas uma a uma contra a Normalizada antes de qualquer remoção, sob pena de operação liberada por engano.

---

## 4. Ordem sugerida

Cada passo é entregável e reversível sozinho.

Ordem revista depois das correções, com a recomendação de corte do usuário incorporada.

| # | Passo | Natureza | Risco | Depende de |
|---|---|---|---|---|
| ~~**C0**~~ | **Medição: endpoint próprio de fontes** com fan-out por equipe ATIVA e `schedule.id = programming.id` | correção de bug | — | ✅ **feito** — `eadefad` |
| ~~C1~~ | Remover o módulo órfão `src/modules/dashboard/programacao/` | remoção | — | ✅ **feito** — `eadefad` |
| ~~**C2**~~ | Mover o **cluster de prazo (11 símbolos + CSS)** para `mapa-programacao` | mecânico | — | ✅ **feito** — 2026-08-12 |
| ~~C3~~ | Migration liberando `default_user_access = true` para `programacao-normalizada` | **migration** | — | ✅ **feito** — `362`, aguarda aplicação |
| ~~C4~~ | Implementar modo consulta na Normalizada **+ portar o Calendário Semanal** | implementação | — | ✅ **feito** — 2026-08-12 |
| ~~C5~~ | Repontar `/programacao-visualizacao` para a Normalizada | configuração | — | ✅ **feito** — 2026-08-12 |
| ~~C6~~ | Repontar `/programacao` → `/programacao-normalizada` e deixar só "Programacao" no menu | configuração | — | ✅ **feito** — 2026-08-12 ⚠️ **exige a 362 aplicada antes do deploy** |
| **C7** | Ajustar `DEFAULT_USER_PAGE_ACCESS` e `page_key` de permissão | configuração | **atenção** — granulares | ← **fase atual** |
| C8 | Remover `programacao-simples`, `/api/programacao(/meta)`, `server/modules/programacao` | remoção | baixo | C0–C7 |

**C0 e C1 concluídos em 2026-08-12.** C2 continua independente e pode ir já.

> ### 🚨 Ordem de deploy do C6 — a única armadilha operacional do corte
>
> O C6 **já está no código**, mas depende da migration `362` estar **aplicada no banco**. As duas coisas são independentes: o código sobe por deploy, a migration por `supabase db push`.
>
> ```
> ERRADO                              CERTO
> deploy do C6                        aplicar a 362
>   menu → só Normalizada               ↓
>   ↓                                 deploy do C6
> 362 ainda não aplicada                menu → só Normalizada
>   ↓
> usuário comum: default_user_access
> da Normalizada = false, e a Simples
> sumiu do menu
>   ↓
> SEM NENHUMA PROGRAMAÇÃO
> ```
>
> A janela de risco existe porque a Normalizada nasceu com `default_user_access = false` (312) e só a `362` inverte isso. Enquanto a Simples estava no menu, ela cobria o buraco; o C6 tirou essa cobertura.
>
> **Mitigação se o deploy for antes:** a Simples continua alcançável por URL direta (`/programacao-simples`) até o C8 — dá para orientar o usuário por lá até a migration entrar.

**C3 antes de C6/C7:** trocar o menu sem liberar a permissão deixa o usuário comum sem acesso a nenhuma Programação.

**C8 por último.** Depois do C0, `/api/programacao` deixa de ser fonte viva da Medição; ainda não pode ser removida porque `programacao-simples` segue ativa até C6/C7 e só sai no C8.

Alternativa intermediária sugerida pelo usuário, se C8 demorar: manter `/api/programacao` apenas como **compatibilidade temporária de leitura administrativa**, ou bloquear também a leitura quando não houver necessidade real — o equivalente de leitura ao `PROGRAMMING_SIMPLES_READ_ONLY` que já existe para escrita. Isso impede que o legado volte a virar fonte viva sem querer, que é exatamente o que aconteceu com a Medição.

### Atualização 2026-08-12 — C0/C1 implementados

- **C0:** criado `GET /api/medicao/programming-sources`, autorizado por `medicao/read`, lendo o modelo normalizado pela fachada pública de `server/modules/programacao-normalizada`. A resposta preserva o shape consumido pela Medição e faz fan-out por equipe ATIVA; `ScheduleItem.id` agora é `programming.id`.
- A Medição trocou as duas leituras de fontes (`MeasurementPageView.tsx`, carregamento normal e cadastro em massa) para o endpoint novo. O caminho explícito `p_programming_id` da 351 passa a ser exercitado com ID normalizado.
- As leituras internas de reconciliação em `src/app/api/medicao/route.ts` também passaram a chamar a fachada da Programação Normalizada, em vez de ler `programming`/`programming_history` direto dentro da rota.
- **C1:** removido o módulo órfão `src/modules/dashboard/programacao/`, incluindo as chamadas inertes de escrita para `/api/programacao`.
- **Ainda pendente:** C2 (deadline no Mapa), C3 (migration de permissão), C4-C7 (consulta/visualização/menu/permissões) e C8 (remoção final da Simples e do backend legado).

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
