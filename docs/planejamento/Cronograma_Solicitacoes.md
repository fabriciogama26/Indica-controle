# Plano de Arquitetura — Cronograma de Solicitações Técnicas

Documento de planejamento gerado em 2026-07-09. Não é o TXT oficial de tela — quando a implementação avançar, criar `docs/Tela_Cronograma_Solicitacoes_SaaS.txt` no padrão obrigatório e atualizar `TASKS.md`. Este arquivo existe para travar as regras de negócio e a arquitetura antes de qualquer migration/código.

Módulo proposto: `cronograma-solicitacoes` (pageKey `cronograma-solicitacoes`).

Status: **planejado, não implementado.** Regras confirmadas pelo usuário em 2026-07-09.

---

## 1. Objetivo

CRUD de pedidos técnicos da operação (Inspeção, As Built, Locação), controlando prazo (SLA), prioridade, responsável e integração com a Programação. A tela mostra o que entrou, quem é o responsável, o prazo e o que está atrasado.

Não é um workflow com múltiplas transições — é um cadastro validado, com estado derivado de prazo.

---

## 2. Regras de negócio (travadas)

### 2.1 Tipos e trava por estado da Programação
- Tipos: **Inspeção**, **As Built**, **Locação**.
- Apenas **As Built** é travado pela Programação: só aceita projeto cujo **estado atual** seja `CONCLUIDO` **ou** `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO`. O autocomplete de projeto, quando o tipo é As Built, só lista projetos nesses estados.
- **Inspeção** e **Locação**: sem trava de estado — qualquer projeto cadastrado (ativo).
- Isto **substitui** a tabela de estados do spec original (as regras de CONCLUÍDO/CANCELADO/ADIADO/ADIADO deixam de existir).

### 2.2 Resolução do "estado atual" do projeto
- Estado = da **linha mais recente** de `project_programming` do projeto, ordenada por `execution_date` desc (desempate por etapa). A **Data Limite não é chave de consulta**.
- O `work_completion_status` deve ser normalizado tratando as duas grafias do catálogo: canônica `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO` e legada `PARCIAL_PLANEJADO_BENFICIO_ATINGIDO`. Reusar o normalizador já existente em `src/server/modules/dashboard-measurement/controller.ts` (não recriar).
- A validação de estado roda **no servidor no momento do salvar** (estado live), não só no client. O estado no instante do cadastro é congelado em `estado_programacao_snapshot` + `programacao_id` para auditoria.

### 2.3 Prioridade e prazo (dias corridos, TZ America/Sao_Paulo)
| Prioridade | Data Limite | Editável | Exige |
|---|---|---|---|
| Baixa | Data de Entrada + 10 dias corridos | Não | — |
| Média | Data de Entrada + 5 dias corridos | Não | — |
| Alta | Manual (≥ Data de Entrada) | Sim | Justificativa obrigatória |

- Baixa/Média recalculam a Data Limite se a Data de Entrada mudar.
- Alta: Data Limite nunca menor que Data de Entrada; justificativa obrigatória.

### 2.4 Campos do cadastro
- **Projeto** — autocomplete nas obras cadastradas; filtrado pelo Tipo (ver 2.1).
- **Tipo de Solicitação** — Inspeção / As Built / Locação.
- **Prioridade** — Baixa / Média / Alta (ver 2.3).
- **Data de Entrada** — digitada.
- **Data Limite** — automática (Baixa/Média) ou manual (Alta).
- **Responsável** — pessoas com cargo (`job_titles.code`) **LOCADOR** ou **INSPETOR** (confirmar códigos exatos no catálogo do tenant na implementação).
- **Solicitante** — usuário logado (automático).
- **Observações** — texto livre.
- **Justificativa da prioridade** — obrigatória quando Alta.

### 2.5 Puxado do projeto (read-only, via `project_with_labels`)
Município (`city_text`) · Endereço (`street`/`neighborhood`) · Prioridade do projeto (`priority_text`).

### 2.6 Status (somente 4)
- **Pendente** — ao cadastrar (default).
- **Concluído** — pelo criador do pedido; grava `data_conclusao` automaticamente.
- **Cancelado** — pelo criador; exige motivo.
- **Atrasado** — **derivado em runtime** (não persistido, sem job agendado): `hoje > data_limite` e status ∉ {Concluído, Cancelado}.

Removidos do spec original: "Em andamento", "Aguardando informação" e o campo **Data de início** (não há transição que os alimente). **Sem anexos.**

### 2.7 Duplicidade
Constraint parcial/única no banco: `(tenant_id, projeto_id, data_entrada, tipo_solicitacao)`. Não permite dois pedidos do mesmo tipo, mesmo projeto e mesma data de entrada.

### 2.8 Histórico
Toda alteração grava usuário, data/hora, campo, valor anterior e novo — padrão `*_history` (jsonb `changes`), igual a `project_history`.

---

## 3. Modelo de dados

### Tabela `cronograma_solicitacoes`
- `id`, `tenant_id` (NOT NULL, RLS ON)
- `projeto_id` (FK projects), `projeto_codigo` (snapshot do SOB)
- `tipo_solicitacao` (`INSPECAO` | `AS_BUILT` | `LOCACAO`)
- `prioridade` (`BAIXA` | `MEDIA` | `ALTA`)
- `data_entrada`, `data_limite`, `data_conclusao`
- `status` (`PENDENTE` | `CONCLUIDO` | `CANCELADO`) — Atrasado é derivado, não persiste
- `responsavel_id` (FK people/app_users), `solicitante_id` (FK app_users)
- `observacao`, `justificativa_prioridade`, `motivo_cancelamento`
- `estado_programacao_snapshot`, `programacao_id` (só preenchidos p/ As Built; null nos demais)
- `created_by`, `updated_by`, `created_at`, `updated_at`

**Constraints/índices**
- Única: `(tenant_id, projeto_id, data_entrada, tipo_solicitacao)`
- Índices: `(tenant_id, status)`, `(tenant_id, data_limite)`, `(tenant_id, projeto_id, tipo_solicitacao)`, `(tenant_id, responsavel_id)`
- RLS por `tenant_id`, políticas espelhando `project_programming`

### Tabela `cronograma_solicitacoes_history`
`change_type`, `changes jsonb`, `created_by`, `created_at` — padrão `project_history`.

### RPCs (security-definer, padrão `save_project_record`)
- `save_cronograma_solicitacao` — insert/update + histórico + optimistic lock (`p_expected_updated_at`).
- `set_cronograma_solicitacao_status` — concluir/cancelar com motivo + histórico.

---

## 4. Backend / API / Front

### Backend `src/server/modules/cronograma-solicitacoes/`
`types.ts`, `normalizers.ts`, `selects.ts`, `queries.ts`, `handlers.ts`, `authorization.ts` (espelhar `projects/authorization.ts`).
- Resolver de estado da Programação (item 2.2), reusando normalizador de medição.
- Tabela de decisão Tipo × estado (só As Built trava).
- Cálculo de prazos (2.3) com TZ fixa.
- Derivação em runtime de Atrasado / Dias Restantes / Dias em Atraso na listagem.

### API `src/app/api/cronograma-solicitacoes/`
- `route.ts`: `GET` lista paginada (`count + range`; filtros nativos indexados: tipo, prioridade, status, período de entrada, período de prazo, município, responsável; pesquisa por projeto/código/responsável/solicitante) + `POST/PUT`/status via RPC.
- `meta/route.ts`: catálogos estáticos (tipos, prioridades, status, responsáveis, projetos p/ autocomplete) com cache TTL 5 min — separado da lista (padrão obrigatório).
- `estado-programacao/route.ts` (ou querystring em `meta`): consulta live do estado do projeto para o formulário; **revalidada no `POST/PUT`**.
- Front carrega `meta` + `lista` em `Promise.all`.

### Front `src/modules/dashboard/cronograma-solicitacoes/`
`CronogramaSolicitacoesPageView.tsx` + `components.tsx` + `constants.ts` + `exports.ts` (padrão `programacao-simples`). Página em `src/app/(dashboard)/cronograma-solicitacoes/page.tsx`.
- Cards (Total, Pendentes, Concluídas, Atrasadas, Vencendo Hoje, Vencendo em 3 dias) — agregados no backend, não somados no Node.
- Grid ordenável (Prazo, Prioridade, Projeto, Responsável, Status), filtros combináveis, cores por prioridade/status.
- Autocomplete de projeto reusando endpoint de projetos, filtrado pelo Tipo.

### Permissões
Registrar pageKey em `src/lib/auth/authorization.ts` (`ROUTE_PAGE_KEYS`, `resolveDefaultPageAccess`) e semear `app_pages` via migration (path único).

---

## 5. Fases de entrega

1. **Migration** — tabela + `_history` + RLS + constraint de duplicidade + índices + RPCs.
2. **Backend module** — resolver de estado, decisão Tipo×estado, prazos, derivação de Atrasado.
3. **API** — `route` + `meta` + estado-do-projeto.
4. **Front** — PageView + componentes + página.
5. **Permissões** — `authorization.ts` + seed `app_pages`.
6. **Docs** — `docs/Tela_Cronograma_Solicitacoes_SaaS.txt` + `TASKS.md`.

Ordem recomendada: começar pela Fase 1 (o schema trava o resto).

---

## 6. A confirmar na implementação (dados, não regra)
- Códigos exatos em `job_titles` para `LOCADOR` e `INSPETOR` no tenant.
- Existência do código `PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO` (ou grafia legada) no `programming_work_completion_catalog` do tenant.
- Origem canônica do Responsável: `people` vs `app_users` (o cadastro de pessoas é `people`; o vínculo de solicitante é `app_users`).
