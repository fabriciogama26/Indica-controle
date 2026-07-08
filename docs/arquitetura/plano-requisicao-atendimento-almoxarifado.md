# Plano - Fluxo de Requisicao com Atendimento no Almoxarifado

Status: proposta aprovada para implementacao (plano detalhado, sem codigo escrito ainda).
Escopo: introduzir fluxo de duas etapas (solicitacao -> atendimento) para requisicao de material,
com o almoxarife podendo aceitar, reduzir ou recusar item a item.
Ultima revisao: incorpora auditoria de brechas (15 pontos) e decisoes do usuario.

---

## 1. Problema e contexto

Hoje a requisicao de material para equipe (`REQUISITION`) vive na tela **Operacoes de Equipe**
(`/saida`) e e **imediata em uma etapa**: ao criar, a RPC `save_team_stock_operation_record` ja
baixa o saldo do centro do almoxarifado e ja credita o centro da equipe no mesmo commit.

Nao existe conceito de pedido pendente, aprovacao ou atendimento parcial.

Este plano introduz a camada de aprovacao/atendimento **sem reescrever** o motor de saldo,
serial, TRAFO, estorno e auditoria que ja existe: a movimentacao de saldo passa a ser o
**efeito** do atendimento, nao o inicio do fluxo.

---

## 2. Arquitetura de telas

**Separar** o fluxo em telas proprias (nao sobrecarregar a `/saida`, que move saldo na hora).

| Tela | Rota | Responsabilidade |
|---|---|---|
| Solicitacao de Requisicao | `/requisicao-solicitacao` | Solicitante (usuario logado) abre o pedido. Grava PENDENTE, **nao toca saldo**. |
| Atendimento de Requisicoes | `/requisicao-atendimento` | Almoxarife assume e atende item a item. So aqui o saldo se move. |
| Operacoes de Equipe (existente) | `/saida` | Mantida intacta para requisicao/devolucao direta imediata. |

A tela de Solicitacao reaproveita os componentes de material/serial da `/saida`, sem herdar o
comportamento imediato.

---

## 3. Regras de negocio consolidadas

### 3.1 Solicitacao (etapa 1)
- Solicitante = **usuario logado** (`requested_by` + snapshot do nome).
- Cabecalho: `stock_center_id`, `team_id`, `project_id`, `request_date`.
- Itens: `material_id` + `quantity_requested` (`> 0`). **Sem serial na criacao** (ver 3.6).
- Nao valida saldo (o estoque pode chegar depois); saldo so e validado no atendimento.
- Material nao pode repetir na mesma solicitacao.
- Pedido sem itens e bloqueado.
- **Bloqueio de duplicidade (#11) - nivel item:** e permitido ter varios pedidos em aberto no
  mesmo dia, mas o **mesmo material** nao pode aparecer em 2 pedidos em aberto
  (`PENDENTE` ou `EM_ATENDIMENTO`) para a mesma combinacao
  **tenant + equipe + projeto + data + material**.
- Sem edicao apos criado: para corrigir, **Cancelar + novo pedido**.

### 3.2 Atendimento (etapa 2)
Lista de pedidos abertos (projeto, equipe, centro, data, nº de itens, quem assumiu).

**Claim / concorrencia (#10):** ao abrir para atender, o almoxarife **assume** o pedido:
- status vai de `PENDENTE` para `EM_ATENDIMENTO`, gravando `claimed_by`, `claimed_at`,
  `claim_expires_at` (default 15 min, configuravel por tenant).
- Enquanto assumido por outro e nao expirado, o pedido fica somente-leitura para os demais.
- A claim expira automaticamente apos o tempo sem confirmacao (volta a `PENDENTE`).
- Supervisor pode liberar a claim manualmente.

Ao abrir os itens, a tela mostra `quantity_requested` **e o saldo atual real** de cada material
(apenas informativo - ver 3.3).

Decisao por linha (exclusao mutua, nenhuma marcada por padrao):

| Acao | quantity_fulfilled | Exige |
|---|---|---|
| Aceitar | = solicitada | - |
| Reduzir | `> 0 e < solicitada` (input) | **motivo do catalogo** |
| Recusar | 0 | **motivo do catalogo** |

- **Nao existe "Aumentar":** o almoxarife nunca entrega mais que o solicitado. Se precisar de
  mais, o solicitante ajusta via novo pedido.
- `Reduzir` com `0` NAO e permitido; para zerar, usar `Recusar`.
- **Toda decisao diferente de Aceitar exige motivo de catalogo (#7).**
- Botao **ACEITAR TUDO** no topo: aceita automaticamente **apenas** itens **comuns com saldo
  suficiente**; itens serializados/TRAFO e itens sem saldo permanecem pendentes de decisao manual (#5).
- **Confirmar bloqueado** enquanto houver item sem decisao **ou** com decisao incompleta
  (ver 3.4).

### 3.3 Saldo: tela x backend (#2)
- Saldo exibido na tela = **informativo** (pode desatualizar entre abrir e confirmar).
- Saldo validado na RPC de atendimento = **oficial**. A decisao final e sempre do backend.
- Erro de saldo retorna tabela por material: `Material | Escolhido | Disponivel no momento | Faltante`.

### 3.4 Validacao de linha completa (#6)
Uma linha so e considerada valida quando todas as condicoes da decisao estao preenchidas:

| Decisao | Regras obrigatorias |
|---|---|
| Aceitar (comum) | `atendida = solicitada` |
| Aceitar (serializado) | unidade selecionada e disponivel |
| Aceitar (TRAFO) | unidade selecionada + serial + LP validos e disponiveis |
| Reduzir | `0 < atendida < solicitada` + motivo |
| Recusar | `atendida = 0` + motivo |

### 3.5 Efeito ao confirmar (transacional, #1)
Sequencia canonica da RPC (tudo-ou-nada):
1. Recebe pedido e decisoes.
2. Inicia transacao.
3. Trava a linha do pedido; confere se continua `EM_ATENDIMENTO` do proprio ator (senao aborta).
4. Revalida permissoes e dados do pedido (ver #12 em 3.7).
5. Valida todas as decisoes e campos obrigatorios (3.4).
6. Trava os saldos dos materiais envolvidos em **ordem fixa** (evita deadlock).
7. Trava os seriais/LPs escolhidos, quando houver.
8. Confere saldo disponivel e disponibilidade dos seriais.
9. Baixa condicional: baixar somente se `saldo_disponivel >= quantity_fulfilled`.
10. Gera a REQUISITION real via `save_team_stock_operation_record` (almoxarifado -> centro da equipe).
11. Atualiza saldo do almoxarifado e custodia da equipe.
12. Atualiza itens atendidos (`quantity_fulfilled`, `item_status`, motivo/obs, serial/LP,
    `resulting_transfer_item_id`).
13. Define `status = ENCERRADO` e `resultado_atendimento`.
14. Grava auditoria completa (#15).
15. Commit.

Se qualquer etapa falhar: **ROLLBACK total**, nenhuma movimentacao permanece, o pedido volta a
`PENDENTE` e retorna mensagem detalhada por material/serial. Falha de saldo por concorrencia
**nao** vira "parcial" automatico (#9).

### 3.6 Materiais serializados / TRAFO (Cenario B, #4)
- O **solicitante nao informa serial**; pede apenas "N unidades do material X".
- O **almoxarife escolhe a unidade** no atendimento (autocomplete Serial/LP da `/saida`,
  restrito ao centro de origem). Material nao-serializado-por-padrao aceita digitar o serial.
- Unicidade e disponibilidade do serial sao validadas **no atendimento**, dentro da transacao:
  - serial precisa estar disponivel no centro de origem;
  - nao pode estar transferido, reservado, em manutencao, baixado ou bloqueado;
  - nao pode ser usado em dois atendimentos;
  - troca do serial ocorre na mesma transacao;
  - registra origem, destino, data, usuario e requisicao vinculada.
- Item serializado tem `qty = 1`; para ele so cabem `Aceitar` (com unidade) ou `Recusar`.

### 3.7 Revalidacao no backend (#12)
A tela limita opcoes, mas a RPC (criar e atender) revalida sempre:
usuario pertence ao tenant; usuario pode solicitar/atender para aquela equipe; equipe ativa;
centro ativo; projeto ativo; material ativo e movimentavel para a equipe; data valida
(nao futura / nao indevidamente retroativa).

### 3.8 Cancelamento
- De `PENDENTE`/`EM_ATENDIMENTO` para `CANCELADO`.
- Permitido ao **solicitante e ao almoxarife**.
- Cancelar durante o atendimento: o lock rejeita o confirm concorrente com mensagem clara.

### 3.9 Estados (separacao processo x resultado, #8, #9)
- `status`: `PENDENTE` | `EM_ATENDIMENTO` | `ENCERRADO` | `CANCELADO`.
- `resultado_atendimento` (preenchido ao encerrar): `TOTAL` | `PARCIAL` | `RECUSADO`.
- Colunas de auditoria: `atendido_em`, `atendido_por`, `cancelado_em`, `cancelado_por`,
  `claimed_by`, `claimed_at`, `claim_expires_at`.

Definicoes fechadas do resultado (com Aumentar removido):
- `TOTAL`: todos os itens atendidos com `quantity_fulfilled = quantity_requested`.
- `PARCIAL`: ao menos um item com `quantity_fulfilled > 0` e pelo menos um item reduzido ou recusado.
- `RECUSADO`: todos os itens com `quantity_fulfilled = 0`.
- `CANCELADO`: pedido cancelado antes de gerar movimentacao.

Rotulo exibido na tela pode compor `status` + `resultado_atendimento`
(ex.: "Atendida parcial", "Recusada", "Cancelada").

### 3.10 Correcao pos-atendimento (#14 - ja existe)
Pedido atendido e **imutavel**. Correcoes usam os fluxos existentes da `/saida`:
devolucao (`RETURN`), retorno de campo (`FIELD_RETURN`), estorno por item e estorno em lote,
sempre gerando nova movimentacao vinculada. Nao ha edicao do pedido original.

### 3.11 Estorno pos-atendimento (reuso total do ledger existente)
O atendimento nao cria mecanismo novo de estorno; a baixa gera a REQUISITION real no ledger
(`stock_transfers` / `stock_transfer_items` / `stock_transfer_team_operations`), que ja possui
estorno por item e em lote com todas as regras.

Decisoes fechadas:
- **Onde estornar:** somente na tela `/saida` (Operacoes de Equipe), reusando a tela e as RPCs
  atuais. A tela de Atendimento **nao** dispara estorno; apenas **exibe** o status de estorno.
- **Reflexo no pedido:** o estorno **nao reabre** o pedido (permanece `ENCERRADO`/imutavel). O item
  do pedido apenas mostra a marca "estornado", derivada do vinculo `resulting_transfer_item_id`
  contra `stock_transfer_item_reversals`. `resultado_atendimento` **nao** e recalculado.
- **Agrupamento (batch = pedido):** ao atender, as movimentacoes geradas recebem um
  `operation_batch_id` ligado ao pedido. Assim o estorno pode ser por item **ou** do atendimento
  inteiro do pedido em um clique, reusando `reverse_team_stock_operation_batch_v2`.

Regras herdadas (ja existentes, sem alteracao):
- Estorno de `REQUISITION` devolve saldo da equipe para o almoxarifado (EQUIPE -> BASE); se a
  equipe ja consumiu/moveu o saldo, e preciso devolver antes.
- Serial/TRAFO volta ao centro de origem via `trafo_instances`.
- Sem duplo estorno, sem estorno de estorno; motivo do catalogo + data obrigatorios.
- Estorno permitido a `admin/master/user` com `requirePageAction` `saida/reverse`.

---

## 4. Banco (migrations 294-296; a 293 ja estava ocupada por measurement_project_activity_indicators)

### 294_create_stock_requisition_module.sql
- `stock_requisition_requests`: `id`, `tenant_id`, `stock_center_id`, `team_id`, `project_id`,
  `requested_by`, `requested_by_name_snapshot`, `request_date`, `status`,
  `resultado_atendimento`, `claimed_by`, `claimed_at`, `claim_expires_at`,
  `atendido_em`, `atendido_por`, `cancelado_em`, `cancelado_por`, `notes`, auditoria.
  FKs compostas com `tenant_id` (padrao da migration 288). Unique `(id, tenant_id)`.
  Bloqueio de duplicidade em **nivel item**: o mesmo `material_id` nao pode existir em 2 pedidos
  em aberto para `(tenant_id, team_id, project_id, request_date)`. Como equipe/projeto/data ficam
  no cabecalho e o material no item, aplicar via trigger que valida contra itens de pedidos com
  `status in (PENDENTE, EM_ATENDIMENTO)`, ou denormalizar `team_id/project_id/request_date` no item
  para permitir indice unico parcial `(tenant_id, team_id, project_id, request_date, material_id)`
  filtrado pelo status aberto.
- `stock_requisition_request_items`: `id`, `request_id`, `tenant_id`, `material_id`,
  `quantity_requested`, `quantity_fulfilled` (null enquanto aberto), `item_status`
  (`PENDING|ACCEPTED|REDUCED|REJECTED`), `unfulfilled_reason_code` (em REDUCED e REJECTED),
  `notes`, `serial_number` (definido no atendimento), `lot_code`, `resulting_transfer_item_id`.
- `stock_requisition_adjustment_reason_catalog`: motivos por tenant (`Saldo insuficiente`,
  `Material avariado`, `Separacao parcial`, `Limite de transporte`, `Divergencia de pedido`,
  `Material bloqueado`, etc.), espelhando `stock_transfer_reversal_reason_catalog`.
- RLS ON; escrita direta bloqueada para `authenticated` (gravacao so pelas RPCs), conforme
  auditoria das migrations 210/288.

### 295_create_stock_requisition_rpcs.sql
- `create_stock_requisition_request(...)`: grava cabecalho + itens PENDING sem tocar saldo;
  valida tenant, centro, equipe, projeto, materiais ativos, duplicidade, `quantity_requested > 0`.
- `claim_stock_requisition_request(...)`: PENDENTE -> EM_ATENDIMENTO com `claim_expires_at`.
- `release_stock_requisition_claim(...)`: libera claim (expira automatica ou supervisor manual).
- `fulfill_stock_requisition_request(...)`: sequencia canonica da secao 3.5. Carimba
  `stock_transfer_team_operations.operation_batch_id` vinculado ao pedido, habilitando estorno
  do atendimento inteiro via `reverse_team_stock_operation_batch_v2`, e grava
  `resulting_transfer_item_id` em cada item atendido.
- `cancel_stock_requisition_request(...)`: PENDENTE/EM_ATENDIMENTO -> CANCELADO
  (solicitante e almoxarife).

### 296_register_stock_requisition_pages.sql
- Cadastra `/requisicao-solicitacao` e `/requisicao-atendimento` em `app_pages`
  (nascem bloqueadas para nao-admin), com actions `read`, `create`, `cancel`, `claim`,
  `fulfill`, `release`.

---

## 5. Backend / API (padrao de performance do CLAUDE.md)

- `GET /api/stock-requisitions/meta`: catalogo (centros, equipes, projetos, materiais ativos
  paginados, motivos) com cache/TTL, separado da lista.
- `GET /api/stock-requisitions`: lista paginada server-side (`count + range`), filtros nativos
  (status, equipe, projeto, data). `POST`: cria pedido. O detalhe do pedido atendido resolve o
  status de estorno por item via `resulting_transfer_item_id` -> `stock_transfer_item_reversals`
  (somente exibicao; o estorno em si ocorre na `/saida`).
- `GET /api/stock-requisitions/serial-options`: reusa a consulta de `trafo_instances` no centro de origem.
- `POST /api/stock-requisitions/claim` e `/release`: gestao da claim.
- `POST /api/stock-requisitions/fulfill`: atendimento (aciona RPC). `requirePageAction` `fulfill`.
- `POST /api/stock-requisitions/cancel`: cancelamento. `requirePageAction` `cancel`.
- Todas com `requirePageAction`, escopo `tenant_id`, meta + lista carregados em `Promise.all`.

---

## 6. Frontend

- `/requisicao-solicitacao`: form (centro, equipe, projeto, data) + lista local de itens
  (material + qtd), lista paginada dos proprios pedidos, acao Cancelar. Reusa autocomplete de
  material da `/saida`.
- `/requisicao-atendimento`: lista de pedidos abertos; ao abrir, **assume** o pedido
  (EM_ATENDIMENTO); tabela de itens com `quantity_requested` + saldo atual; decisao exclusiva por
  linha (Aceitar/Reduzir/Recusar); selecao de unidade para serializado/TRAFO; ACEITAR TUDO
  (so comuns com saldo); Cancelar pedido; Confirmar bloqueado ate todas as linhas validas.

---

## 7. Registro obrigatorio de tela (checklist do AppShell)

- `menuSections` + `titleMap` em `src/components/layout/AppShell.tsx` (secao Almoxarifado).
- `permissionCatalog` em `src/modules/dashboard/permissoes/PermissionsPageView.tsx`.
- Migration 296 cadastrando as paginas em `app_pages`.

---

## 8. Docs e TASKS

- `docs/Tela_Requisicao_Solicitacao_SaaS.txt` e `docs/Tela_Requisicao_Atendimento_SaaS.txt` (padrao TXT mapeado).
- Atualizar `docs/00_Indice_SaaS.txt`, `README.md` (se impactar uso) e `TASKS.md`.

---

## 9. Auditoria de brechas - resolucao final

| # | Brecha | Resolucao |
|---|---|---|
| 1 | Travar so o pedido nao protege o saldo | Lock de saldo em ordem fixa + baixa condicional dentro da transacao |
| 2 | Saldo da tela pode estar desatualizado | Tela = informativo, backend = oficial, erro tabular por material |
| 3 | Aumentar era perigoso | Removido: almoxarife nunca aumenta |
| 4 | Contradicao no serializado | Cenario B: sem serial na criacao, unidade escolhida e validada no atendimento |
| 5 | Aceitar Tudo ignorava serializado | So aceita comuns com saldo; serializado/TRAFO/sem-saldo ficam manuais |
| 6 | "Decidido" nao garantia linha valida | Validacao completa de campos por decisao |
| 7 | Reduzir sem motivo | Toda decisao != Aceitar exige motivo de catalogo |
| 8 | Status misturava processo e resultado | `status` + `resultado_atendimento` + colunas de auditoria |
| 9 | PARCIAL mal definido | Definicoes fechadas; falha de concorrencia volta a PENDENTE, nao vira parcial |
| 10 | Dois almoxarifes no mesmo pedido | EM_ATENDIMENTO com claim + expiracao + liberacao por supervisor |
| 11 | Pedidos pendentes duplicados | Bloqueio nivel item: mesmo material em aberto por tenant + equipe + projeto + data |
| 12 | Faltava revalidar no backend | RPC revalida tenant/permissao/equipe/centro/projeto/material/data |
| 13 | Origem/destino fisico (ja existe) | REQUISITION almoxarifado -> centro proprio da equipe, vinculado ao projeto |
| 14 | Devolucao/estorno (ja existe) | RETURN/FIELD_RETURN/estorno por item e lote; pedido atendido e imutavel |
| 15 | Trilha de auditoria | Registro completo por pedido e item (solicitado x atendido, decisao, motivo, obs, serial, saldo, doc gerado) |

---

## 10. Fluxograma (texto de referencia)

Raias: Solicitante | Almoxarife | Sistema/Banco.

1. Solicitante cria pedido (centro, equipe, projeto, data, itens). Sistema valida duplicidade
   (mesmo material em aberto p/ equipe+projeto+data = bloqueia), itens e quantidades.
   Grava PENDENTE (sem saldo).
2. Decisao Solicitante: precisa corrigir? Sim -> Cancelar -> novo pedido. Nao -> segue.
3. Almoxarife abre o pedido -> Sistema faz claim (EM_ATENDIMENTO, expira em X min).
4. Para cada item: losango "e serializado/TRAFO?"
   - Nao -> Aceitar / Reduzir (motivo) / Recusar (motivo).
   - Sim -> selecionar unidade disponivel + validar serial/LP -> Aceitar / Recusar.
5. ACEITAR TUDO: marca so comuns com saldo suficiente.
6. Decisao Sistema: todas as linhas validas? Nao -> Confirmar bloqueado. Sim -> Confirmar.
7. Transacao atomica: trava pedido -> confere EM_ATENDIMENTO -> revalida permissoes/dados ->
   trava saldos (ordem fixa) -> trava seriais -> confere disponibilidade -> baixa condicional ->
   gera REQUISITION origem->destino -> atualiza itens/saldos -> define status/resultado ->
   auditoria -> commit.
8. Decisao Sistema: saldo/serial suficiente para todos? Nao -> ROLLBACK, volta a PENDENTE,
   mensagem por material. Sim -> ENCERRADO com resultado TOTAL/PARCIAL/RECUSADO.

Terminadores: ATENDIDA_TOTAL | ATENDIDA_PARCIAL | RECUSADA | CANCELADA.

---

## 11. Ordem de implementacao

1. Migrations 294-296 (tabelas + RPCs + registro de paginas).
2. APIs (`meta`, lista/criar, serial-options, claim/release, fulfill, cancel).
3. Telas (solicitacao e atendimento).
4. Docs TXT + permissionCatalog + AppShell + TASKS.

Ao final: resumo + texto de commit para confirmacao. Nao rodar `git add`/commit automaticamente.
