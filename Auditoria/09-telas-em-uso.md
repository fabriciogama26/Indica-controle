# Telas em uso, telas mortas e telas vazias

Análise estática motivada pela medição: `programacao (legado)` apareceu como o maior consumidor do banco, e a pergunta era se ela ainda deveria estar sendo usada.

**Resposta curta: sim, está sendo usada — e é o destino padrão de quem clica em "Programacao" no menu.**

---

## 1. A Programação legada não é legado inativo

### 1.1 Três das quatro rotas de programação caem na tela congelada

| Rota | O que renderiza | Módulo de destino |
|---|---|---|
| `/programacao` | `redirect("/programacao-simples")` | **`programacao-simples`** |
| `/programacao-simples` | `ProgrammingSimplePageView` | **`programacao-simples`** |
| `/programacao-visualizacao` | `ProgrammingSimplePageView mode="visualizacao"` | **`programacao-simples`** |
| `/programacao-normalizada` | `ProgrammingNormalizedPageView` | `programacao-normalizada` |

E o menu ([`AppShell.tsx`](../src/components/layout/AppShell.tsx)) expõe as duas em paralelo, com a **congelada ocupando o nome principal**:

```
"Programacao"               → /programacao-simples        ← congelada
"Programacao (Normalizada)" → /programacao-normalizada    ← nova
"Visualizacao Programacao"  → /programacao-visualizacao   ← congelada (leitura)
```

O `CLAUDE.md` §5 diz que `src/modules/dashboard/programacao-simples/*` está **congelada até a remoção**. Só que congelada, aqui, significa "não recebe refatoração nem crescimento" — **não** significa "não é executada". Ela é o caminho padrão.

### 1.2 A cadeia até a tabela legada

```
menu "Programacao"
  → /programacao-simples
    → modules/dashboard/programacao-simples
      → /api/programacao  e  /api/programacao/meta
        → src/server/modules/programacao/{handlers,queries,catalogs}.ts
          → project_programming, project_programming_history,
            project_programming_activities
```

Confirmado por busca: `programacao-simples` chama **exatamente** `/api/programacao` e `/api/programacao/meta`, e nada mais. E `src/server/modules/programacao` é importado **somente** por essas duas rotas.

Isso fecha o laço com a medição de [`08` §1.2](08-nivel-b-resultado.md#12-o-maior-consumidor-medido-é-um-módulo-que-a-auditoria-tratou-como-legado): as ≈96.500 chamadas e ≈1.297 s de `programacao (legado)` **são de código vivo**, alcançado pelo menu.

### 1.3 Ressalva que continua de pé

Isso **não** promove automaticamente `project_programming_history` a gargalo atual. As duas coisas são independentes:

| Consulta | Situação |
|---|---|
| `project_programming` (3 variantes, ≈60 mil chamadas, ≈360 s) | **código vivo** — bate com o que `server/modules/programacao` faz hoje |
| `project_programming_history` (20.815 chamadas, 912 s) | **não bate com nenhum call site atual** — seleciona `project_id`/`from_execution_date`/`to_execution_date`, colunas que só o caminho pré-cutover usava ([`08` §1.3](08-nivel-b-resultado.md#13-a-consulta-que-domina-project_programming_history)) |

Ou seja: a tela legada está viva, **e ainda assim** a consulta mais cara atribuída a ela pode ser fantasma. Continua dependendo do bloco `00` (`contadores_desde`) e da comparação por delta entre duas capturas.

### 1.4 Acoplamento que a remoção vai encontrar

`programacao-simples` não é folha. Três módulos apontam para ela:

| Quem | O que importa | Tipo |
|---|---|---|
| [`mapa-programacao/MapProgrammingPageView.tsx`](../src/modules/dashboard/mapa-programacao/MapProgrammingPageView.tsx#L12) | `components`, `constants`, `exports`, `utils` | **dependência real de runtime** |
| `permissoes/PermissionsPageView.tsx` | só a string `pageKey: "programacao-simples"` | catálogo de permissão |
| `programacao-normalizada/{constants,utils}.ts` | apenas **comentários** citando a origem do código portado | nenhuma |

Só o `mapa-programacao` é bloqueante. Remover `programacao-simples` exige antes extrair `ProgrammingDeadlinePanel`, as constantes de deadline, `buildDeadlineCsvContent` e os helpers de status para um lugar compartilhado — ou duplicá-los no `mapa-programacao`.

> **Não é uma decisão de performance.** É pré-requisito da remoção, e a remoção é o que de fato zera o custo do módulo legado. Registrado aqui para não ser descoberto no meio do corte.

---

## 2. Telas que existem e não fazem nada

**11 páginas são apenas `ModulePlaceholder`** — casca com título, descrição e lista de "próximos passos". Nenhuma consulta, nenhum CRUD.

**10 delas estão no menu.** O usuário clica e não encontra funcionalidade:

| Rota | Rótulo no menu |
|---|---|
| `/centro-servico` | Centro de Servico |
| `/contrato` | Contrato |
| `/imei` | Imei |
| `/municipio` | Municipio |
| `/nivel-tensao` | Nivel de Tensao |
| `/porte` | Porte |
| `/prioridade` | Prioridade |
| `/responsavel-distribuidora` | Responsavel Distribuidora |
| `/tipo-equipe` | Tipo de Equipe |
| `/tipo-servico` | Tipo de Servico |

E `/cadastro-base` é placeholder **fora** do menu — inalcançável pela navegação.

**Impacto em performance: zero.** Placeholder não consulta banco. O impacto é de produto e de manutenção: 11 rotas no build, 11 `page_key` no controle de permissão, e menu que promete o que não entrega.

> Fora do escopo desta auditoria de I/O, mas é exatamente o tipo de achado que `prompts/auditoria-lixo.md` classifica. Registrado para não se perder.

---

## 3. Rotas de API sem consumidor

Das **90** rotas, **1** não tem consumidor real:

| Rota | Situação |
|---|---|
| `/api/projects/forecast/template` | **órfã**. O frontend baixa o template chamando a Edge Function direto: [`ProjectsPageView.tsx:1891`](../src/modules/dashboard/projetos/ProjectsPageView.tsx#L1891) usa `functions/v1/get_project_forecast_template`. A rota de API faz o mesmo trabalho e ninguém chama. |

Falso positivo verificado e descartado: `/api/dashboard-carteira-operacional/forecast-gaps` é montada por template string em [`dashboard-carteira-operacional/api.ts:43`](../src/modules/dashboard/dashboard-carteira-operacional/api.ts#L43) — está viva.

Todos os **37 módulos** de `src/modules/dashboard` têm página que os importa. Nenhum módulo órfão.

---

## 4. Quadro geral

| Categoria | Qtd | Observação |
|---|---|---|
| Rotas de página | 51 | 49 alcançáveis pelo menu ou por link de configuração |
| Páginas funcionais | 40 | |
| **Páginas placeholder** | **11** | 10 no menu, 1 fora |
| Módulos de dashboard | 37 | todos com página |
| Rotas de API | 90 | |
| **Rotas de API órfãs** | **1** | `/api/projects/forecast/template` |
| Páginas sem link no menu | 3 | `/programacao` (redirect), `/permissoes` (link em configurações), `/cadastro-base` (placeholder órfão) |

---

## 5. O que isto muda no plano

| Item | Efeito |
|---|---|
| `programacao (legado)` | **Não é tráfego residual.** É a tela padrão de Programação. O custo medido só cai quando o cutover terminar e `programacao-simples` sair. |
| Prioridade do cutover da Programação Normalizada | Sobe: passa a ser o caminho com maior ganho de I/O medido, acima de qualquer RPC de dashboard. |
| Pré-requisito de remoção | Extrair de `programacao-simples` o que o `mapa-programacao` importa. |
| `project_programming_history` | Continua pendente de validação temporal — tela viva não implica consulta viva. |
| 11 placeholders + 1 API órfã | Sem efeito em I/O. Encaminhar para `/auditoria-lixo`. |
