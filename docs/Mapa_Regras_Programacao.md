# Mapa de Regras de Negocio - Programacao

Documento gerado em 2026-06-26.

Escopo:
- Tela `Programacao` atual: `/programacao-simples`.
- Tela de consulta: `/programacao-visualizacao`, usando a mesma view em modo visualizacao.
- API principal: `/api/programacao`.
- Banco esperado com migrations ate `271_fix_deferred_programming_stage_guard_current_row.sql`.

---

## Resumo Executivo

A Programacao controla agendas operacionais por `tenant_id`, `project_id`, `team_id` e `execution_date`.

Regras centrais:
- Uma programacao ativa tem status operacional `PROGRAMADA` ou `REPROGRAMADA`.
- Uma programacao interrompida tem status `ADIADA` ou `CANCELADA`.
- Toda programacao ativa deve ter:
  - `etapa_number` numerico maior que zero, ou
  - `etapa_unica = true`, ou
  - `etapa_final = true`.
- `ETAPA UNICA` e `ETAPA FINAL` sao exclusivas entre si.
- `Estado Trabalho = CONCLUIDO` bloqueia novas programacoes, copias, inclusao de equipe, adiamento e cancelamento ate reabrir o projeto por uma edicao/acao permitida.
- Ao salvar uma etapa como `CONCLUIDO`, etapas futuras ativas do mesmo projeto podem ser marcadas como `ANTECIPADO`.
- Ao retirar `CONCLUIDO`, etapas futuras marcadas como `ANTECIPADA` legada sao limpas.
- Adiamento com nova data transforma a origem em `ADIADA` e cria nova linha `REPROGRAMADA`.
- Cancelamento transforma a linha, ou grupo escolhido, em `CANCELADA`.
- Copia para outras datas exige origem com ETAPA numerica e destino com ETAPA maior.
- As escritas sensiveis devem passar por API/RPC com `tenant_id` derivado da sessao.

---

## Entidades e Campos Principais

Tabela principal:
- `project_programming`

Campos de identidade:
- `tenant_id`: escopo multi-tenant obrigatorio.
- `project_id`: obra/projeto.
- `team_id`: equipe.
- `execution_date`: data de execucao.

Status operacional:
- `status`: `PROGRAMADA`, `REPROGRAMADA`, `ADIADA`, `CANCELADA`.
- `is_active`: legado/apoio visual; a regra atual usa principalmente `status`.
- `cancellation_reason`: motivo de cancelamento/adiamento.
- `canceled_at`: data/hora da interrupcao.
- `canceled_by`: usuario que interrompeu.

Etapa:
- `etapa_number`: etapa numerica.
- `etapa_unica`: etapa especial unica.
- `etapa_final`: etapa especial final.

Estado Trabalho:
- `work_completion_status`: estado operacional da obra na programacao.
- Catalogo: `programming_work_completion_catalog`.

Rastreio:
- `project_programming_history`: historico operacional oficial da Programacao.
- `copied_from_programming_id`: origem usada em copia/adicao de equipe.
- `copy_batch_id`: lote de copia quando aplicavel.

Campos operacionais sincronizados por Projeto + Data:
- `feeder`
- `campo_eletrico`
- `electrical_eq_catalog_id`
- `sgd_type_id`
- `affected_customers`
- `outage_start_time`
- `outage_end_time`
- `support`
- `support_item_id`
- `poste_qty`
- `estrutura_qty`
- `trafo_qty`
- `rede_qty`

---

## Status Operacional

| Status | Significado | Acoes permitidas | Efeitos principais |
| --- | --- | --- | --- |
| `PROGRAMADA` | Agenda ativa original | Editar, copiar, adicionar equipe, adiar, cancelar | Aparece na lista/calendario como ativa. |
| `REPROGRAMADA` | Agenda ativa resultante de reprogramacao/adiamento/copia conforme fluxo | Editar, copiar, adicionar equipe, adiar, cancelar | Tambem conta como ativa. |
| `ADIADA` | Agenda interrompida por adiamento | Detalhes/historico; sem edicao operacional | Guarda motivo/data de interrupcao. Pode ter nova linha `REPROGRAMADA` vinculada. |
| `CANCELADA` | Agenda cancelada | Detalhes/historico; sem edicao operacional | Guarda motivo/data de cancelamento. |

Regra de atividade:
- Ativas: `PROGRAMADA`, `REPROGRAMADA`.
- Inativas/interrompidas: `ADIADA`, `CANCELADA`.

---

## Fluxo Principal de Cadastro

1. Usuario seleciona projeto, data, periodo, horario, equipe(s), ETAPA, tipo de SGD, numero/tipo do N EQ e demais campos.
2. Frontend sugere automaticamente a proxima ETAPA apenas no cadastro novo, quando:
   - ha projeto;
   - ha data;
   - ha equipe selecionada;
   - nao esta em modo edicao;
   - nao marcou `ETAPA UNICA` nem `ETAPA FINAL`.
3. O usuario pode manter a sugestao ou editar manualmente.
4. Antes de salvar, o frontend valida campos obrigatorios, horario, documentos, quantidades, ETAPA e conflitos locais.
5. API repete validacoes criticas.
6. Backend salva via RPC full transacional.
7. Cada equipe selecionada gera uma programacao independente.
8. Historico e registrado em `project_programming_history`.

Campos obrigatorios no cadastro/edicao ativa:
- Projeto.
- Equipe(s).
- Data execucao.
- Periodo.
- Hora inicio.
- Hora termino.
- Tipo de SGD.
- N EQ - Numero.
- N EQ - Tipo.
- ETAPA numerica, exceto quando `ETAPA UNICA` ou `ETAPA FINAL` estiver marcada.

---

## Regra de ETAPA

### ETAPA Numerica

Regras:
- Deve ser inteiro maior que zero.
- E obrigatoria para programacao ativa quando `ETAPA UNICA` e `ETAPA FINAL` estao desmarcadas.
- Nao pode conflitar com historico do mesmo projeto/equipe.
- Nao pode ser igual ou menor do que etapa ja existente na validacao de conflito.
- Copia para outras datas exige destino com ETAPA maior que a origem.

Efeitos:
- Usada para ordenacao logica da obra.
- Usada na regra `CONCLUIDO -> ANTECIPADO`.
- Usada na validacao de copia e adicao de equipe.

### ETAPA UNICA

Regras:
- Mutuamente exclusiva com `ETAPA FINAL`.
- Nao usa `etapa_number`.
- Bloqueia a acao `Copiar programacao`.
- Deve ser preservada no adiamento.

Efeitos:
- Exportacoes exibem `ETAPA UNICA` no campo de informacao de etapa.
- A programacao continua valida mesmo com `etapa_number = null`.

### ETAPA FINAL

Regras:
- Mutuamente exclusiva com `ETAPA UNICA`.
- Nao usa `etapa_number`.
- Bloqueia a acao `Copiar programacao`.
- Deve ser preservada no adiamento.

Efeitos:
- Exportacoes exibem `ETAPA FINAL` no campo de informacao de etapa.
- A programacao continua valida mesmo com `etapa_number = null`.

### Guarda de Banco

Constraint/trigger:
- Nome logico do erro: `project_programming_active_stage_required_check`
- Migration `269`: criou o CHECK imediato e fez backfill das programacoes ativas antigas sem etapa.
- Migration `270`: substitui o CHECK imediato por constraint trigger diferida.
- Migration `271`: ajusta a funcao diferida para validar a linha final persistida, nao o `NEW` antigo do evento enfileirado.
- Funcao: `enforce_project_programming_active_stage_required`
- Trigger: `zz_trg_project_programming_active_stage_required`

Regra:
```sql
status not in ('PROGRAMADA', 'REPROGRAMADA')
or etapa_number is not null
or coalesce(etapa_unica, false) = true
or coalesce(etapa_final, false) = true
```

Objetivo:
- Impedir novas programacoes ativas sem ETAPA valida, inclusive por escrita direta ou RPC.
- Validar a regra no fim da transacao para permitir que as RPCs full criem a linha base e preencham `etapa_number`, `etapa_unica` ou `etapa_final` antes do commit.

---

## Estado Trabalho

Campo:
- `project_programming.work_completion_status`

Catalogo:
- `programming_work_completion_catalog`

Valores relevantes no fluxo atual:
- `PARCIAL`
- `PARCIAL_PLANEJADO`
- `PARCIAL_NAO_PLANEJADO`
- `CONCLUIDO`
- `ANTECIPADO`
- `NAO_INFORMADO` apenas como filtro visual, nao como status salvo.

### Heranca no Cadastro/Copia/Adicao

Ao criar uma nova programacao:
1. Backend procura o ultimo `work_completion_status` nao nulo do mesmo projeto no tenant.
2. Ignora programacoes `CANCELADA`.
3. Valida se o codigo ainda esta ativo no catalogo do tenant.
4. Se houver status valido, herda esse status.
5. Se nao houver historico valido, usa `PARCIAL` como fallback, desde que ativo no catalogo.

### Bloqueio por CONCLUIDO

Quando existe programacao do projeto com `Estado Trabalho = CONCLUIDO`:
- Bloqueia novo cadastro.
- Bloqueia copia para outras datas.
- Bloqueia adicionar equipe.
- Bloqueia adiar.
- Bloqueia cancelar.
- Permite edicao apenas quando a propria programacao concluida esta sendo editada para trocar o Estado Trabalho para valor diferente de `CONCLUIDO`.

Mensagem esperada:
- "Este projeto possui Estado Trabalho CONCLUIDO..."

### Salvar CONCLUIDO

Quando uma edicao salva `work_completion_status = CONCLUIDO` e a programacao tem `etapa_number`:
1. Programacao editada fica `CONCLUIDO`.
2. Backend chama `mark_project_programming_future_stages_anticipated`.
3. Etapas futuras ativas do mesmo projeto, com `etapa_number` maior, podem receber `ANTECIPADO`.
4. Historico operacional e registrado.

### Reabrir CONCLUIDO

Quando o usuario troca uma programacao de `CONCLUIDO` para outro Estado Trabalho:
1. API valida que o novo status nao e concluido.
2. Salva via RPC transacional de Estado Trabalho.
3. Limpa etapas futuras legadas com `work_completion_status = ANTECIPADA`.
4. Atualiza visualizacao da linha.

Observacao:
- O codigo atual usa `ANTECIPADO` como padrao normalizado.
- Ha limpeza de valor legado `ANTECIPADA` em alguns fluxos.

### Interrompidas e CONCLUIDO

Regras:
- Programacao `ADIADA` ou `CANCELADA` nao deve receber `Estado Trabalho = CONCLUIDO`.
- Banco possui trigger/guarda para impedir divergencia `ADIADA/CANCELADA + CONCLUIDO`.
- Tambem bloqueia nova transicao para `ADIADA`/`CANCELADA` quando o projeto ja possui `CONCLUIDO`.

---

## Reprogramacao por Edicao

Uma edicao vira reprogramacao quando muda ao menos um destes campos:
- Projeto.
- Equipe.
- Data.
- Hora inicio.
- Hora termino.
- Periodo.

Regras:
- Exige motivo de reprogramacao.
- Motivo precisa vir do catalogo `programming_reason_catalog`.
- Se o motivo exigir observacao, observacao complementar e obrigatoria.
- Motivo final precisa ter no minimo 10 caracteres quando enviado ao backend.
- Usa controle de concorrencia por `expectedUpdatedAt`.
- Nao permite editar programacao `ADIADA` ou `CANCELADA`.
- Se a programacao atual possui atividades incompletas no snapshot, o frontend e o backend bloqueiam o save.

Efeitos:
- Salva via RPC full.
- Historico registra alteracoes como `UPDATE` ou `RESCHEDULE`, conforme a RPC.
- Se a alteracao resultar em `CONCLUIDO`, dispara regra de `ANTECIPADO`.

---

## Adiamento

Acao:
- Botao `Adiar`.

Disponibilidade:
- Apenas programacoes ativas (`PROGRAMADA`/`REPROGRAMADA`).
- Bloqueado quando o projeto possui `Estado Trabalho = CONCLUIDO`.
- Exige catalogo de motivos disponivel.

Escopos:
- `group`: todas as equipes ativas do mesmo Projeto + Data.
- `individual`: apenas a equipe selecionada.

### Adiamento sem nova data

Regra:
- Marca a programacao, ou grupo, como `ADIADA`.
- Nao cria nova linha.

Efeitos:
- `status = ADIADA`.
- `is_active = false` quando aplicavel.
- Grava `cancellation_reason`.
- Grava `canceled_at`.
- Grava `canceled_by`.
- Registra historico operacional.

### Adiamento com nova data

Regra:
- Nova data precisa ser posterior a data atual.
- No escopo individual, nova data e obrigatoria.
- No escopo grupo, nova data e opcional.

Efeitos:
1. Origem vira `ADIADA`.
2. Nova programacao e criada com status `REPROGRAMADA`.
3. Nova linha preserva os campos operacionais da origem.
4. Nova linha preserva `etapa_number`, `etapa_unica` e `etapa_final`.
5. `work_completion_status` da nova linha e zerado no adiamento individual pela RPC atual.
6. Historico vincula origem e nova programacao.

Fluxo:
```mermaid
flowchart TD
  A[Programacao ativa] --> B{Adiar com nova data?}
  B -->|Nao| C[Origem vira ADIADA]
  B -->|Sim| D[Origem vira ADIADA]
  D --> E[Nova linha criada]
  E --> F[Status REPROGRAMADA]
  F --> G[Preserva ETAPA numerica ou ETAPA UNICA/FINAL]
```

---

## Cancelamento

Acao:
- Botao `Cancelar`.

Disponibilidade:
- Apenas programacoes ativas.
- Bloqueado quando o projeto possui `Estado Trabalho = CONCLUIDO`.
- Exige motivo do catalogo.

Escopos:
- `individual`: cancela apenas a equipe selecionada.
- `group`: cancela todas as equipes ativas do mesmo Projeto + Data.

Efeitos:
- `status = CANCELADA`.
- `is_active = false` quando aplicavel.
- Grava motivo.
- Grava data/hora e usuario.
- Registra historico operacional.
- Se uma programacao estava em edicao, a edicao e encerrada.

Fluxo:
```mermaid
flowchart TD
  A[Programacao ativa] --> B{Escopo}
  B -->|Individual| C[Somente linha selecionada]
  B -->|Grupo| D[Ativas do mesmo Projeto + Data]
  C --> E[Status CANCELADA]
  D --> E
  E --> F[Historico + motivo]
```

---

## Copiar Programacao para Outras Datas

Acao:
- Botao `Copiar programacao`.

Disponibilidade:
- Apenas programacoes ativas.
- Origem precisa ter `etapa_number` numerico.
- Bloqueado para `ETAPA UNICA`.
- Bloqueado para `ETAPA FINAL`.
- Bloqueado para origem sem `etapa_number`.
- Bloqueado se projeto possui `Estado Trabalho = CONCLUIDO`.

Regras do modal:
- Cada linha exige Data destino, ETAPA e ao menos uma equipe.
- Data destino nao pode ser a data original.
- Datas destino nao podem repetir.
- ETAPAs destino nao podem repetir.
- ETAPA destino deve ser maior que ETAPA origem.
- Equipes selecionadas precisam estar ativas e pertencer ao tenant.

Validacoes do backend:
- Sessao e permissao `create`.
- Concorrencia por `expectedUpdatedAt`.
- Origem ativa.
- Origem com ETAPA numerica.
- Projeto sem `CONCLUIDO`.
- Equipes ativas por tenant.
- Conflito de etapa por projeto/equipe.
- Conflito de agenda por equipe/data/horario.
- Heranca de Estado Trabalho inicial.

Efeitos:
- Cria uma nova programacao para cada par `Data destino + Equipe`.
- Se a equipe ja existia no grupo de origem, usa a propria linha dessa equipe como modelo.
- Se a equipe nao existia no grupo de origem, usa a linha clicada como modelo.
- Destinos sempre usam ETAPA numerica informada.
- `etapa_unica = false`.
- `etapa_final = false`.
- Grava `copied_from_programming_id`.
- Historico registra `COPY_TO_DATES`.

Rollback:
- Se alguma iteracao falhar depois de criar registros, a API cancela os registros ja criados no lote para evitar estado parcialmente salvo.

Fluxo:
```mermaid
flowchart TD
  A[Origem ativa com ETAPA numerica] --> B[Usuario informa datas, etapas e equipes]
  B --> C{Validacoes}
  C -->|Falha| D[Bloqueia e mostra erro]
  C -->|Ok| E[Cria registros destino]
  E --> F{Alguma criacao falhou?}
  F -->|Sim| G[Cancela registros criados no lote]
  F -->|Nao| H[Historico COPY_TO_DATES]
```

---

## Adicionar Equipe

Acao:
- Botao `Adicionar equipe`.

Disponibilidade:
- Apenas programacoes ativas.
- Desabilitado quando todas as equipes ativas do tenant ja existem no grupo.
- Bloqueado se projeto possui `Estado Trabalho = CONCLUIDO`.

Regra de grupo:
- Grupo base: mesmo `Projeto + Data de execucao + ETAPA`.
- Para ETAPA numerica: compara `etapa_number`.
- Para ETAPA especial: compara `etapa_unica`/`etapa_final`.

Validacoes:
- Programacao modelo existe e esta ativa.
- Controle de concorrencia por `expectedUpdatedAt`.
- Equipe alvo ativa e do mesmo tenant.
- Equipe alvo ainda nao existe no grupo.
- Sem conflito de horario.
- Sem conflito de etapa no historico da equipe.
- Estado Trabalho da linha modelo precisa estar ativo no catalogo; se estiver vazio, herda fallback do projeto.

Efeitos:
- Cria nova programacao para a equipe escolhida.
- Mantem a programacao original intacta.
- Copia os dados da programacao modelo.
- Grava `copied_from_programming_id`.
- Historico registra metadata `ADD_TEAM`.

---

## Sincronizacao Automatica por Projeto + Data

Origem:
- Migration `267_sync_programming_operational_fields_by_project_date.sql`.

Quando dispara:
- Em edicao de uma programacao ativa via wrapper full.

Escopo:
- Mesmo `tenant_id`.
- Mesmo `project_id`.
- Mesma `execution_date`.
- Status ativo: `PROGRAMADA` ou `REPROGRAMADA`.
- Exclui a propria linha origem.

Campos sincronizados:
- Alimentador.
- N EQ - Numero.
- N EQ - Tipo.
- Tipo de SGD.
- Numero de Clientes Afetados.
- Inicio de desligamento.
- Termino de desligamento.
- Apoio.
- Item de apoio.
- POSTE.
- ESTRUTURA.
- TRAFO.
- REDE.

Campos que nao sincronizam:
- ETAPA.
- Equipe.
- Data.
- Horario.
- Status operacional.
- Estado Trabalho.
- Atividades.

Efeitos:
- Atualiza linhas irmas ativas.
- Registra historico por linha afetada.
- `related_programming_id` aponta para a origem da sincronizacao.

---

## Documentos e Extracoes

Documentos:
- `SGD`
- `PI`
- `PEP`

Regras:
- Data de pedido nao pode ser maior que data aprovada.
- Documentos sao persistidos junto com a programacao.
- Em alguns fluxos documentados, alteracoes de documentos podem replicar para equipes ativas do mesmo Projeto + Data; para equipes LV, tambem pode alcancar programacoes ativas do mesmo projeto em ate 7 dias, conforme migrations/documentacao anterior.

Exportacoes:
- CSV da lista filtrada.
- `ENEL-EXCEL`.
- `Extracao ENEL NOVO`.

Regras de ETAPA nas exportacoes:
- `ETAPA FINAL` tem prioridade visual sobre `ETAPA UNICA`.
- Depois vem `ETAPA UNICA`.
- Depois vem `x ETAPA` numerica.

Regra de STATUS na `Extracao ENEL NOVO`:
- Usa status operacional:
  - `PROGRAMADO`
  - `REPROGRAMADA`
  - `ADIADO`
  - `CANCELADO`
- Nao usa `Estado Trabalho` para preencher a coluna `STATUS`.

---

## Filtros e Listagem

Filtros principais:
- Data inicial.
- Data final.
- Projeto.
- Municipio.
- Equipe.
- Status.
- Estado Trabalho.
- Tipo SGD.

Lista:
- Data execucao.
- Projeto.
- Equipe.
- Base.
- Horario.
- Registrado por.
- Status.
- Estado Trabalho.
- Atualizado em.
- Acoes.

Ordenacao:
- `execution_date` decrescente.
- Em empate, cadastro mais recente primeiro.

Modo visualizacao:
- Usa a mesma view da Programacao Simples.
- Acoes de escrita ficam ocultas/bloqueadas.

---

## Permissoes

Page key:
- `programacao-simples`
- `programacao-visualizacao`

Acoes server-side:
- `read`: consultar.
- `create`: cadastrar/copiar/adicionar equipe.
- `update`: editar/adiar/salvar Estado Trabalho.
- `cancel`: cancelar.

Regras:
- A API sempre resolve usuario autenticado.
- Usuario inativo e bloqueado.
- Permissao e validada server-side antes de operar.
- Tenant vem da sessao (`appUser.tenant_id`), nao do payload do cliente.

---

## Auditoria e Historico

Tabela oficial:
- `project_programming_history`

Acoes comuns:
- `CREATE`
- `BATCH_CREATE`
- `UPDATE`
- `RESCHEDULE`
- `ADIADA`
- `CANCELADA`
- `COPY`
- `ADD_TEAM` via metadata.

Conteudos gravados:
- Status antes/depois.
- Data antes/depois.
- Equipe antes/depois.
- Horarios antes/depois.
- ETAPA antes/depois.
- Motivo.
- Metadata de origem.
- Usuario.

Logs de erro:
- Frontend usa `useErrorLogger("programacao_simples")`.
- Falhas relevantes registram contexto seguro, sem depender de dados livres sensiveis.

---

## Regras Multi-tenant e Seguranca

Obrigatorio em toda leitura/escrita:
- Filtrar por `tenant_id`.
- Validar equipe dentro do tenant.
- Validar projeto dentro do tenant.
- Validar catalogos dentro do tenant.
- Validar programacao por `tenant_id + id`.

RPCs:
- Fluxos sensiveis usam RPC security-definer.
- Chamada ocorre server-side com service role quando necessario.
- Cliente autenticado nao deve executar RPC sensivel diretamente.

Concorrencia:
- Edicao, cancelamento, adiamento, copia e adicao de equipe usam `expectedUpdatedAt`.
- Se registro mudou, API retorna conflito e pede recarga.

RLS:
- Assumir RLS ligado.
- Operacoes server-side preservam escopo por `tenant_id`.

---

## Matriz de Eventos

| Evento | Condicao | Resultado | Bloqueios principais |
| --- | --- | --- | --- |
| Cadastrar | Campos obrigatorios validos | Cria uma linha por equipe | Projeto `CONCLUIDO`, ETAPA invalida, equipe invalida, conflito horario |
| Editar sem mudar data/equipe/hora/periodo | Linha ativa | Atualiza linha; sincroniza campos operacionais por Projeto + Data | Linha `ADIADA/CANCELADA`, snapshot de atividades incompleto, concorrencia |
| Reprogramar por edicao | Mudou projeto/equipe/data/hora/periodo | Salva alteracao com motivo | Motivo ausente, projeto `CONCLUIDO`, conflito horario/etapa |
| Salvar `CONCLUIDO` | Edicao com etapa numerica | Marca etapa e antecipa etapas futuras | Falha RPC antecipado, catalogo invalido |
| Reabrir `CONCLUIDO` | Trocar para status diferente | Salva status e limpa legado `ANTECIPADA` | Tentar salvar outro `CONCLUIDO`, linha cancelada/adiada |
| Adiar sem data | Linha ativa | Origem vira `ADIADA` | Projeto `CONCLUIDO`, motivo ausente, concorrencia |
| Adiar com data | Linha ativa e data futura | Origem `ADIADA`, nova linha `REPROGRAMADA` | Data igual/anterior, projeto `CONCLUIDO`, conflito |
| Cancelar | Linha ativa | Linha/grupo vira `CANCELADA` | Projeto `CONCLUIDO`, motivo ausente, concorrencia |
| Copiar para datas | Origem ativa com ETAPA numerica | Cria destinos por data/equipe | ETAPA UNICA/FINAL, destino <= origem, conflito agenda/etapa |
| Adicionar equipe | Linha ativa | Cria linha irma para nova equipe | Equipe ja no grupo, conflito horario/etapa, projeto `CONCLUIDO` |

---

## Mapa de Codigo

Frontend:
- `src/app/(dashboard)/programacao-simples/page.tsx`
  - Rota de cadastro.
- `src/app/(dashboard)/programacao-visualizacao/page.tsx`
  - Rota de visualizacao.
- `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx`
  - View principal, formulario, filtros, lista, submit, edicao.
- `src/modules/dashboard/programacao-simples/hooks.ts`
  - Hooks de ETAPA, cancelamento, adiamento, copia para datas.
- `src/modules/dashboard/programacao-simples/components.tsx`
  - Modais e componentes de formulario/lista.
- `src/modules/dashboard/programacao-simples/validators.ts`
  - Filtros e validacoes locais.
- `src/modules/dashboard/programacao-simples/api.ts`
  - Chamadas HTTP da tela.
- `src/modules/dashboard/programacao-simples/exports.ts`
  - Exportacoes CSV/ENEL.
- `src/modules/dashboard/programacao-simples/utils.ts`
  - Formatacao, normalizacao e helpers visuais.

API:
- `src/app/api/programacao/route.ts`
  - Router HTTP fino: GET, POST, PUT, PATCH.
- `src/server/modules/programacao/handlers.ts`
  - Regras de negocio server-side: save, batch, copy, add team, Estado Trabalho.
- `src/server/modules/programacao/rpc.ts`
  - Chamadas e wrappers de RPC.
- `src/server/modules/programacao/queries.ts`
  - Leituras de programacao, historico, atividades, conflito e etapa.
- `src/server/modules/programacao/catalogs.ts`
  - Catalogos com cache por tenant.
- `src/server/modules/programacao/normalizers.ts`
  - Normalizacao de status, datas, textos, payloads.
- `src/server/modules/programacao/types.ts`
  - Contratos TypeScript da API e RPC.
- `src/server/modules/programacao/selects.ts`
  - Select principal de `project_programming`.

Banco e migrations relevantes:
- `082_create_programming_batch_create_rpc.sql`
  - Cadastro em lote.
- `094_add_programming_stage_and_completion_fields.sql`
  - ETAPA e Estado Trabalho.
- `101_create_project_programming_history.sql`
  - Historico proprio.
- `102_use_programming_history_only_and_physical_rescheduled_status.sql`
  - `REPROGRAMADA` fisico.
- `106_move_programming_save_history_into_full_rpcs.sql`
  - Historico dentro do save transacional.
- `135_create_programming_reason_catalog.sql`
  - Motivos padronizados.
- `155_create_programming_work_completion_catalog.sql`
  - Catalogo de Estado Trabalho.
- `217_copy_programming_to_multiple_dates.sql`
  - Copia por datas.
- `229_save_programming_work_completion_status_transactional.sql`
  - Salvamento transacional de Estado Trabalho.
- `246_postpone_programming_by_project_date.sql`
  - Adiamento por Projeto + Data.
- `248_cancel_programming_by_project_date.sql`
  - Cancelamento por Projeto + Data.
- `255_add_anticipated_work_completion_status.sql`
  - `ANTECIPADO`.
- `258_guard_interrupted_programming_completed_work_status.sql`
  - Guarda contra interrompida concluida.
- `267_sync_programming_operational_fields_by_project_date.sql`
  - Sincronizacao de campos operacionais.
- `269_guard_programming_stage_on_active_records.sql`
  - Guarda de ETAPA obrigatoria e preservacao de flags especiais no adiamento.
- `270_defer_active_programming_stage_guard.sql`
  - Troca o CHECK imediato de ETAPA ativa por constraint trigger diferida, mantendo a regra final sem quebrar RPCs full transacionais.
- `271_fix_deferred_programming_stage_guard_current_row.sql`
  - Faz a trigger diferida consultar a linha final em `project_programming`, evitando falso bloqueio quando a RPC full insere sem ETAPA e atualiza ETAPA/flags antes do commit.

---

## Checklist de Validacao Manual

Cadastro:
- Criar programacao com ETAPA numerica.
- Criar programacao com `ETAPA UNICA`.
- Criar programacao com `ETAPA FINAL`.
- Tentar criar sem ETAPA e sem flags: deve bloquear.
- Copiar programacao valida com ETAPA destino numerica: deve concluir sem erro `project_programming_active_stage_required_check`.

Edicao/reprogramacao:
- Editar campos operacionais e verificar sincronizacao em outras equipes do mesmo Projeto + Data.
- Reprogramar mudando data e confirmar exigencia de motivo.
- Tentar editar `ADIADA` ou `CANCELADA`: deve bloquear.
- Tentar salvar sem ETAPA e sem flags: deve bloquear.

Estado Trabalho:
- Salvar `CONCLUIDO` em etapa numerica e verificar etapas futuras `ANTECIPADO`.
- Trocar `CONCLUIDO` para outro status e verificar limpeza de `ANTECIPADA` legada.
- Tentar adiar/cancelar/copiar/adicionar equipe em projeto `CONCLUIDO`: deve bloquear.

Adiamento:
- Adiar sem nova data: origem vira `ADIADA`.
- Adiar com nova data: origem vira `ADIADA`, nova linha vira `REPROGRAMADA`.
- Adiar origem `ETAPA FINAL`: nova linha preserva `etapa_final = true`.

Cancelamento:
- Cancelar individual.
- Cancelar grupo.
- Verificar motivo, historico e concorrencia.

Copia:
- Copiar origem numerica para datas futuras com ETAPAs maiores.
- Tentar copiar `ETAPA UNICA`/`ETAPA FINAL`: deve bloquear.
- Tentar destino com ETAPA menor/igual: deve bloquear.
- Tentar equipe com conflito de agenda: deve bloquear.

Adicionar equipe:
- Adicionar equipe ainda ausente do grupo.
- Tentar adicionar equipe ja presente: deve bloquear/desabilitar.
- Verificar `copied_from_programming_id`.

---

## Observacoes Operacionais

- Este mapa descreve a regra esperada do codigo e das migrations versionadas no repositorio.
- Ambientes que nao aplicaram as migrations mais recentes podem ter comportamento diferente.
- Antes de diagnosticar dado inconsistente, confirmar a migration listada em `supabase/migrations`.
- Para dados em branco/legados, preferir auditoria read-only antes de backfill.
- Mudancas futuras em Programacao devem atualizar este mapa, `docs/Tela_Programacao_Simples_SaaS.txt` e `TASKS.md`.
