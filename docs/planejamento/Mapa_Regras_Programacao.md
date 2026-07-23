# Mapa de Regras de Negocio - Programacao Normalizada

Documento reescrito em 2026-07-21 para o modelo NORMALIZADO (tela `Programacao (Normalizada)`).
Supersede o mapa anterior, que descrevia o modelo legado (`programacao-simples`, tabela
`project_programming` com `programming_group_id`, ETAPA digitada e triggers de sincronizacao).

Escopo:
- Tela: `/programacao-normalizada`.
- API principal: `/api/programacao-normalizada` (+ `/meta`).
- Server module: `src/server/modules/programacao-normalizada/*`.
- Frontend module: `src/modules/dashboard/programacao-normalizada/*`.
- Banco: migrations `310`–`318` e `320`–`330` (`programming`, `programming_team`, `programming_activity`,
  `programming_document`, `programming_history` + RPCs).
- NUMERACAO DE MIGRATIONS (colisao historica, fechada em 2026-07-21): existem DOIS arquivos
  com o numero **318** — `318_allow_generic_pending_serial_identification.sql` (outro dominio,
  commit 047c8d7) e `318_pendencia_as_boolean_flag.sql` (este modelo). AMBOS JA FORAM APLICADOS,
  entao nenhum foi renomeado (migration aplicada nunca se renomeia: o arquivo deixaria de
  corresponder ao banco). O numero **319 NAO EXISTE** e fica permanentemente vago, reservado por
  causa dessa colisao. A sequencia real e: 310–318 (dois no 318) · 319 vago · 320–330.
- Fonte de desenho: `docs/planejamento/Spec_Nova_Programacao_Modelo_Normalizado.md`
  (secoes 2, 3.1, 3.2, 4, 4.2, 5, 6, 8, 9, 10).

A tela legada `programacao-simples` continua em producao com suas proprias regras (documentadas
em `docs/Tela_Programacao_Simples_SaaS.txt`); este mapa NAO se aplica a ela.

---

## Resumo Executivo

A Programacao Normalizada controla o PLANO de um projeto: a sequencia de ETAPAS, uma por data.
A etapa (`programming`) e o pai; as equipes (`programming_team`) sao filhas dela, junto de
atividades e documentos.

Diferencas estruturais em relacao ao modelo legado:
- NAO ha `programming_group_id`: a etapa (`programming.id`) e o grupo. Some a checagem
  `PROGRAMMING_GROUP_STAGE_MISMATCH` e a sincronizacao por trigger entre equipes irmas.
- Uma linha por `(tenant_id, project_id, execution_date)` — nao mais uma linha por equipe.
  Campos operacionais/documentos existem UMA vez na etapa; as equipes compartilham por serem
  filhas.
- Classificacao de etapa (`Unica`/`N`/`Final`) e DERIVADA da posicao por data, nunca digitada.

Regras centrais:
- Tres eixos independentes: `programming.status` (agenda), `programming.work_completion_status`
  (execucao) e `programming_team.status` (participacao da equipe).
- Uma etapa ativa tem status de agenda `PROGRAMADA` ou `REPROGRAMADA`.
- Uma etapa interrompida tem `ADIADA` (inclui "em espera", sem data) ou `CANCELADA`.
- Uma etapa encerrada por conclusao antecipada tem `ANTECIPADA` + `work_completion_status = ANTECIPADO`.
- Pendencia NAO e status nem Estado Trabalho: e a flag booleana `is_pendencia`, ortogonal a tudo
  (so reflete na exibicao do Status). Migration 318 (supersede 314/316/317).
- Classificacao de etapa (numeracao) e derivada por RPC sobre as etapas numeraveis do projeto
  (`PROGRAMADA`/`REPROGRAMADA` com `execution_date` nao nulo), dense rank por data.
- So `work_completion_status = CONCLUIDO` encerra o projeto. Maximo um CONCLUIDO NAO-pendencia
  ativo por projeto.
- Projeto com CONCLUIDO ativo bloqueia inserir/editar/adicionar equipe/adiar/cancelar, EXCETO
  operacoes sobre uma etapa `is_pendencia` (criar/gerir pendencia nao exige reabrir).
- Escritas sensiveis passam por RPC `SECURITY DEFINER` chamada pelo backend com `service_role`;
  `tenant_id` vem sempre da sessao, nunca do cliente.

---

## Entidades e Campos Principais

### `programming` (a etapa / o "pai") — uma linha por `(tenant_id, project_id, execution_date)`

Identidade e concorrencia:
- `id`, `tenant_id`, `project_id`.
- `execution_date` (date, ANULAVEL desde 318 — etapa "em espera" nao tem data).
- `updated_at` (para `expectedUpdatedAt`).

Classificacao derivada (escrita SO por `reclassify_project_programming_stages`):
- `etapa_number` (int), `etapa_unica` (bool), `etapa_final` (bool).

Eixo 1 — status de agenda:
- `status`: `PROGRAMADA`, `REPROGRAMADA`, `ADIADA`, `CANCELADA`, `ANTECIPADA`.
  (NAO existe `PENDENCIA` como status.)

Eixo 2 — Estado Trabalho (execucao):
- `work_completion_status`: catalogo por tenant (`programming_work_completion_catalog`).
  Valores: em branco, `PARCIAL_PLANEJADO`, `PARCIAL_NAO_PLANEJADO`, `BENEFICIO_ATINGIDO`,
  `CONCLUIDO`, `ANTECIPADO` (automatico). (NAO existe `PENDENCIA` no Estado Trabalho.)

Flag independente:
- `is_pendencia` (bool, default false): checkbox ortogonal. Quando true E a etapa esta ABERTA
  (ativa e nao concluida), a coluna Status exibe "Pendencia" (vermelho); em estado terminal
  (ADIADA/CANCELADA/ANTECIPADA) ou concluida, o status real prevalece e a pendencia vira so um
  marcador secundario "Pend." (achado 8). Nao afeta Etapa, Estado Trabalho nem
  numeracao.

Cadastro operacional (por etapa):
- `service_description`, `period`, `start_time`, `end_time`, `expected_minutes`,
  `outage_start_time`, `outage_end_time`, `feeder`, `campo_eletrico`, `affected_customers`,
  `sgd_type_id`, `electrical_eq_catalog_id` (No EQ), `support`, `support_item_id`,
  `poste_qty`, `estrutura_qty`, `trafo_qty`, `rede_qty`, `note`.

Rastreio:
- `resolve_pendencia_de_id` (FK -> `programming`, opcional), `copied_from_id`, `copy_batch_id`,
  `anticipated_by_id`, `anticipated_at`, `previous_work_completion_status`,
  `previous_operational_status`, `cancellation_reason`, `canceled_at`, `canceled_by`.

Constraints/indices relevantes:
- `programming_status_check`: `status in (PROGRAMADA, REPROGRAMADA, ADIADA, CANCELADA, ANTECIPADA)`.
- Nao-negatividade: `programming_quantities_non_negative_check` (poste/estrutura/trafo/rede, 310) e
  `affected_customers`/`expected_minutes >= 0` (migration 325, NOT VALID). Coerencia de desligamento
  (fim x inicio) fica no app — desligamento pode virar a meia-noite.
- Unicidade `(tenant_id, project_id, execution_date)` e indice PARCIAL
  `WHERE execution_date IS NOT NULL` (duas etapas "em espera" nao colidem).
- Invariante de classificacao validada em runtime no fim do `reclassify` (equivalente a guarda
  da migration 275 legada).

### `programming_team` (a filha) — enxuta

- `id`, `programming_id` (FK), `tenant_id`, `team_id`.
- `status`: `ATIVA`, `REMOVIDA`, `TRANSFERIDA`.
- `added_from_id` (origem em copia/adicao), `updated_at`.

### `programming_activity` / `programming_document`

- Filhas da etapa (nao replicadas por equipe). Documento por tipo: `SGD`, `PI`, `PEP`
  (unico por `(programming_id, document_type)`).

### `programming_history`

- Historico oficial por etapa (e por equipe quando faz sentido, via `programming_team_id`).

---

## Os Tres Eixos (nao confundir)

1. `programming.status` — agenda da etapa: o que aconteceu com a data.
2. `programming.work_completion_status` — execucao da etapa: situacao do servico.
3. `programming_team.status` — participacao da equipe: se esta alocada.

Escopo de acao:
- `Adiar`/`Cancelar` agem no `status` da ETAPA (grupo).
- Remover/transferir equipe age na PARTICIPACAO (`programming_team.status` ->
  `REMOVIDA`/`TRANSFERIDA`), sem tocar no status da etapa.

Combinacoes validas de status x Estado Trabalho:
- `PROGRAMADA`/`REPROGRAMADA` (ativas): em branco, `PARCIAL_PLANEJADO`, `PARCIAL_NAO_PLANEJADO`,
  `BENEFICIO_ATINGIDO`, `CONCLUIDO`.
- `ADIADA`/`CANCELADA`: Estado Trabalho em branco (limpo na acao).
- `ANTECIPADA`: apenas `ANTECIPADO` (par obrigatorio, gerado por conclusao anterior).

Par acoplado automatico unico: `ANTECIPADA` + `ANTECIPADO`.
A flag `is_pendencia` e um terceiro eixo ortogonal (so reflete no Status exibido).

---

## Classificacao Automatica de Etapa

Escopo: uma etapa por `(projeto, data)`.

Conjunto NUMERAVEL = etapas do projeto no calendario: `status in (PROGRAMADA, REPROGRAMADA)`
COM `execution_date IS NOT NULL`. Ordenadas por `execution_date`:

```
N = etapas numeraveis do projeto
N == 0 -> nada
N == 1 -> UNICA           (number=null, unica=true,  final=false)
N >= 2 -> maior data e FINAL (number=null, unica=false, final=true)
          as N-1 anteriores sao numericas 1..N-1 por ordem de data
```

- Numeracao e absoluta e por projeto (dense rank comeca em 1, sem buracos), calculada sobre todas
  as etapas numeraveis (nao so as visiveis num filtro). Uma lista filtrada por data pode mostrar
  "Etapa 8" legitimamente — nao ajustar a numeracao ao filtro.
- A flag `is_pendencia` NAO afeta a numeracao: a etapa conta pela data como qualquer
  PROGRAMADA/REPROGRAMADA.
- Etapa "em espera" (`ADIADA`, `execution_date IS NULL`) e etapas `CANCELADA`/`ANTECIPADA` ficam
  FORA da numeracao (classificacao zerada).
- Gatilhos do recalculo (mesma transacao da acao): criar, editar equipe, adiar, cancelar,
  concluir, reabrir, mudar Estado Trabalho, togglar pendencia. Todas as RPCs de escrita chamam
  `reclassify_project_programming_stages` no final.
- A `FINAL` migra automaticamente para a maior data numeravel apos qualquer mudanca do conjunto
  ativo. Nao ha ETAPA digitada/sugerida — tudo derivado.

---

## Estado Trabalho (catalogo por comportamento)

| Valor | Encerra? | Numera? | Observacao |
| --- | --- | --- | --- |
| em branco | nao | sim | etapa a fazer (default na criacao) |
| `PARCIAL_PLANEJADO` | nao | sim | fez tudo que planejou para a ida |
| `PARCIAL_NAO_PLANEJADO` | nao | sim | sobrou trabalho |
| `BENEFICIO_ATINGIDO` | nao | sim | energizavel; informativo; nao antecipa, nao bloqueia, nao conta em "um por projeto" |
| `CONCLUIDO` | SIM | sim | unico que encerra o projeto |
| `ANTECIPADO` | (consequencia) | — | automatico, gerado quando um CONCLUIDO anterior antecipa (por data) |

- Quem preenche: em branco e automatico na criacao; `PARCIAL_*`/`BENEFICIO_ATINGIDO` sao manuais
  (RPC `set_project_programming_work_completion_status`); `CONCLUIDO` via acao `Concluir`
  (`mark_...completed_and_anticipate`); `ANTECIPADO` e o unico 100% automatico.
- `PENDENCIA` saiu do catalogo de Estado Trabalho (virou a flag `is_pendencia`). O select da lista
  oferece: em branco, `PARCIAL_PLANEJADO`, `PARCIAL_NAO_PLANEJADO`, `BENEFICIO_ATINGIDO`,
  `CONCLUIDO`.
- Sair de `CONCLUIDO` para outro valor pelo select reabre primeiro (mesma RPC de `Reabrir`,
  restaura antecipadas) e so depois aplica o valor escolhido.

---

## Pendencia (flag `is_pendencia`) — modelo 318

Pendencia deixou de ser classificacao, status e Estado Trabalho (modelos 314/316/317 superados).
Virou uma checkbox booleana, ortogonal a tudo, para rastreio e para liberar a excecao da trava.

- Marcar `is_pendencia = true` -> a coluna Status exibe "Pendencia" (vermelho) SE a etapa estiver
  aberta (ativa e nao concluida); em terminal/concluida o status real prevalece (ver linha 77-78,
  achado 8). O status de agenda
  (`PROGRAMADA`/`REPROGRAMADA`) continua gravado por baixo; desmarcar volta a exibi-lo.
- NAO toca a coluna Etapa (mantem Etapa N/Final/Unica), o Estado Trabalho nem a numeracao.
- Dois pontos de escrita:
  - Formulario "Nova etapa": checkbox cria a etapa ja com `is_pendencia = true` (INSERT do
    `save_project_programming_stage`, parametro `p_is_pendencia`). E isso que ACIONA a excecao da
    trava de projeto concluido.
  - Card da etapa: toggle liga/desliga via `set_project_programming_pendencia_flag`
    (etapa existente; so status ativo).
- MOTIVO OBRIGATORIO em marcar/desmarcar e DESCRICAO do servico restante obrigatoria ao LIGAR
  (migration 329, achado 3), ambos no historico. Ao LIGAR, aceita o vinculo opcional de origem
  (`resolve_pendencia_de_id`) — a etapa do mesmo projeto que gerou a sobra; ao desligar, o
  vinculo e limpo. Exige `programacao-pendencia`.
- NAO se obriga `work_completion_status` na PROPRIA pendencia (decisao 2026-07-21): `is_pendencia`
  responde POR QUE a etapa existe; `work_completion_status` responde O QUE aconteceu na execucao.
  Pendencia recem-programada ainda nao foi executada — o estado correto dela e EM BRANCO (a fazer);
  obrigar preenchimento so produziria um valor falso.
- O que SE obriga na ORIGEM: quando ha `resolve_pendencia_de_id`, a etapa de origem precisa ter o
  Estado do Trabalho JA LANCADO (nao da para registrar sobra de uma etapa cujo resultado ainda nao
  foi informado) e em um destes: `PARCIAL_NAO_PLANEJADO`, `PARCIAL_PLANEJADO`, `BENEFICIO_ATINGIDO`
  ou `CONCLUIDO`. Pendencia SEM origem continua permitida (sobra descoberta depois), exigindo
  motivo e descricao.
- Excecao da trava de CONCLUIDO: `programming_project_has_active_completion` IGNORA etapas
  `is_pendencia` (uma pendencia concluida nao tranca o projeto). save/add_team/postpone/cancel/
  set_wcs liberam a operacao quando a etapa e `is_pendencia`, sem reabrir o projeto.
- Guarda no DESLIGAR (migration 321): desmarcar `is_pendencia` (`true->false`) e BLOQUEADO
  (409 `PROJECT_COMPLETED_REQUIRES_REOPEN`) enquanto o projeto tiver um CONCLUIDO ativo
  nao-pendencia — senao a etapa voltaria como comum num projeto concluido, ou criaria um
  segundo CONCLUIDO comum. Defesa em profundidade: indice unico parcial
  `programming_one_active_completion_per_project` (um CONCLUIDO ativo nao-pendencia por projeto).
- Concluir uma pendencia e PERMITIDO mesmo com o projeto ja concluido; nao antecipa nada; a flag
  fica (rastreio) e `CONCLUIDO` prevalece na exibicao.
- Vinculo opcional `resolve_pendencia_de_id` (liga a pendencia a etapa parcial que a originou)
  permanece disponivel para rastreio, sem RPC dedicada que o escreva nesta entrega.

---

## Antecipacao (por data, nao por numero)

Ao salvar `CONCLUIDO` na etapa X (`mark_project_programming_completed_and_anticipate`), na mesma
transacao:
1. Etapas ativas NAO-pendencia do projeto com `execution_date > X.execution_date` ->
   `status = ANTECIPADA`, `work_completion_status = ANTECIPADO`, `anticipated_by_id = X`,
   guardando `previous_work_completion_status` e `previous_operational_status`.
2. `reclassify` (X passa a ser a ultima ativa -> FINAL).
3. Maximo um `CONCLUIDO` NAO-pendencia ativo por projeto. Concluir uma pendencia nao dispara
   antecipacao nem entra nessa regra.

`reopen_project_programming_completed` reverte: restaura as antecipadas por X ao estado anterior e
recalcula.

---

## Adiamento (in-place, duas rotas) — modelo 318

`postpone_project_programming_stage` atua IN-PLACE na propria etapa (nao cria mais linha nova).
O editor comum mantem a data TRAVADA (`DATE_CHANGE_NOT_ALLOWED`); remarcar e sempre pelo Adiar.

- Rota "Nova data" (`p_new_execution_date` preenchido): `execution_date = nova`,
  `status = REPROGRAMADA`. Exige data posterior a atual (se a etapa tinha data). Checa conflito de
  agenda por equipe na nova data.
- Rota "Deixar em espera" (`p_new_execution_date` NULL): `execution_date = NULL`,
  `status = ADIADA`. Etapa sai da numeracao; nao ocupa agenda (sem data). Fica visivel na lista
  cross-projeto pelo chip "Em espera" (migration 327), alem do plano do projeto.
- Dar data a uma etapa em espera (`ADIADA` sem data) -> `REPROGRAMADA` (mesma RPC, rota Nova data).
- Motivo obrigatorio nas duas rotas. A mudanca de data De/Para vai para o historico
  (`POSTPONE_STAGE`).
- Estado Trabalho volta a branco ao adiar/remarcar (migration 326; obrigatorio para `ADIADA` — ver
  linha 135).
- Aceita entrada `PROGRAMADA`/`REPROGRAMADA` (remarcar/por em espera) e `ADIADA` (dar data).
- Excecao da trava de concluido para etapa `is_pendencia`.

Observacao de exibicao: etapa em espera (data NULL) NAO aparece na lista cross-projeto (filtrada
por intervalo de data); e gerenciada pelo plano do projeto (`ProjectPlanView`).

---

## Cancelamento

`cancel_project_programming_stage`:
- `status = CANCELADA`, limpa `work_completion_status`, grava `cancellation_reason`/`canceled_at`/
  `canceled_by`, e chama `reclassify`.
- Aceita etapa ativa (`PROGRAMADA`/`REPROGRAMADA`) e em espera (`ADIADA`).
- Motivo obrigatorio. Libera a agenda das equipes (o filtro de conflito so considera etapas
  `PROGRAMADA`/`REPROGRAMADA`).
- Excecao da trava de concluido para etapa `is_pendencia`.

---

## Conflito de Agenda por Equipe

`programming_team_schedule_conflict`:
- Uma equipe nao pode ter duas alocacoes ativas com horario sobreposto na mesma data, em qualquer
  projeto do tenant.
- So contam: `programming_team.status = ATIVA` em etapa `status in (PROGRAMADA, REPROGRAMADA)`.
  `REMOVIDA`/`TRANSFERIDA`/`ADIADA`/`CANCELADA`/`ANTECIPADA` liberam a agenda.
- Sobreposicao: `inicio_A < termino_B` e `inicio_B < termino_A`. Encostar nao conta (08–12 seguido
  de 12–17 passa).
- Rodada em todo ponto que aloca equipe numa data: criar plano com equipes, adicionar equipe,
  adiar com nova data. Data retroativa nao e excecao. Falhou em qualquer equipe -> operacao inteira
  falha (transacional, sem gravacao parcial).

---

## Fluxo de Cadastro (ciente do plano)

- Um ponto de entrada: ao selecionar o projeto, o formulario mostra o plano existente ou o
  formulario de primeiras etapas.
- Uma etapa por submissao (uma data = uma etapa). Datas adicionais entram pelo botao
  "Nova etapa a partir desta", que reabre o editor herdando o cadastro da etapa clicada (so a data
  fica em branco). O botao legado "+ Adicionar data" (varias datas numa submissao) foi removido.
- Guarda: projeto com etapa `CONCLUIDO` ativa bloqueia inserir/editar o plano ate reabrir, EXCETO
  criar uma etapa com `is_pendencia = true` (checkbox marcada no formulario Nova etapa).
- Checagem em duas camadas: previa no cliente (nao autoritativa) + validacao no save via RPC
  transacional com lock por projeto (`pg_advisory_xact_lock`).
- Heranca template+override completa (spec §9, "aplicar as etapas nao alteradas") ainda NAO foi
  implementada; o formulario herda o cadastro da ultima etapa ao abrir uma nova.

---

## RPCs (todas `SECURITY DEFINER`, `service_role` apenas)

| RPC | Papel |
| --- | --- |
| `reclassify_project_programming_stages` | Coracao: renumera (dense rank por data) e valida a invariante. Ultimo passo de toda escrita. |
| `save_project_programming_stage` | Cria/edita a etapa (cadastro + equipes + atividades + documentos). `p_is_pendencia` grava a flag so no INSERT. Excecao da trava para pendencia. |
| `add_project_programming_team` | Adiciona equipe (checa conflito). Excecao da trava para pendencia. |
| `remove_project_programming_team` | Marca equipe `REMOVIDA`; libera agenda; historico `REMOVE_TEAM`. |
| `postpone_project_programming_stage` | Adiar in-place, duas rotas (nova data/em espera). |
| `cancel_project_programming_stage` | Cancela a etapa; limpa Estado Trabalho. |
| `mark_project_programming_completed_and_anticipate` | Conclui e antecipa por `execution_date` posterior; concluir pendencia permitido (sem antecipar). Exige >= 1 equipe ativa (migration 322, achado 5). |
| `reopen_project_programming_completed` | Restaura antecipadas e recalcula (reabre para em branco). |
| `change_completed_stage_work_status` | Sai de CONCLUIDO atomicamente: reabre + restaura antecipadas + aplica novo estado (`PARCIAL_*`/`BENEFICIO_ATINGIDO`/em branco) num so commit (migration 322, achado 4). |
| `set_project_programming_work_completion_status` | Estado Trabalho manual (em branco/`PARCIAL_*`/`BENEFICIO_ATINGIDO`) para etapa NAO concluida. |
| `remove_project_programming_team` (guard) | Nao remove a ultima equipe ativa de uma etapa concluida (migration 322, achado 5). |
| `set_project_programming_pendencia_flag` | Toggle da flag `is_pendencia` (card). Bloqueia `true->false` se houver CONCLUIDO ativo nao-pendencia (321). Exige MOTIVO e aceita origem `resolve_pendencia_de_id` (329). |
| `correct_project_programming_stage_date` | Corrige a data da etapa mantendo o registro e PRESERVANDO o status (nao vira REPROGRAMADA). Aceita data anterior/posterior; motivo obrigatorio; checa duplicidade e conflito de agenda; bloqueia CANCELADA/ANTECIPADA/CONCLUIDO e etapa em espera (329, achado 10). |
| `programming_team_schedule_conflict` | Conflito de agenda por equipe (tenant-wide). |
| `programming_project_has_active_completion` | Guarda de projeto CONCLUIDO (ignora `is_pendencia`). |
| `programming_list_project_page` | Pagina os `project_id` distintos da lista (filtros + chip) + total (migration 323, achado 14). |
| `append_programming_history_record` | Helper de historico. |

Concorrencia: `expectedUpdatedAt` obrigatorio em editar/adiar/cancelar/concluir/reabrir/toggle/
set-estado. Conflito retorna HTTP 409.

Concorrencia (migration 320): um trigger `BEFORE UPDATE` (`tg_programming_set_updated_at`) carimba
`updated_at = now()` em `programming`/`programming_team`/`programming_activity`/`programming_document`
a cada UPDATE, inclusive nas alteracoes indiretas do reclassify. Antes da 320 o `updated_at` ficava
congelado no valor do INSERT e o `expectedUpdatedAt` nunca detectava conflito (bug corrigido).

---

## Filtros e Listagem

- Lista cross-projeto paginada POR PROJETO (migration 323, achado 14): a RPC
  `programming_list_project_page` retorna os `project_id` distintos (filtrados/ordenados/paginados)
  + total de projetos; o servidor busca todas as etapas dos projetos da pagina. Nunca parte um
  projeto entre paginas nem gera contador parcial. `pageSize` conta PROJETOS. Agrupada por projeto
  no frontend; ordenada por `project_id` + `execution_date`.
- Chips de status: `TODAS`, `PROGRAMADAS` (`status in PROGRAMADA/REPROGRAMADA`),
  `PENDENCIAS` ("pendencias abertas": `is_pendencia = true` E `status in (PROGRAMADA, REPROGRAMADA)`
  E `work_completion_status IS DISTINCT FROM 'CONCLUIDO'`), `SEM_RETORNO` ("Pendencias sem retorno":
  condicao DERIVADA — `is_pendencia` E `status in (PROGRAMADA, REPROGRAMADA)` E `execution_date <`
  `p_today` E `work_completion_status IS NULL`; IGNORA o periodo, e `p_today` vem do SERVIDOR;
  migration 330), `EM_ESPERA` ("Em espera": `status = ADIADA`
  E `execution_date IS NULL` — IGNORA o filtro de periodo, pois essas etapas nao tem data; migration
  327, achado 9), `ATRASADAS` (ativas + `execution_date < hoje`),
  `ADIADAS` (`status = ADIADA`).
- A lista filtra por intervalo de data (`gte/lte execution_date`); etapas em espera (data NULL)
  nao aparecem nela — so no plano do projeto.
- Marcador derivado "Sem retorno ha N dias" (migration 330): na LINHA da lista, ao lado do Status,
  em laranja, com tooltip "A data de execucao passou e o Estado do Trabalho ainda nao foi
  informado". NAO substitui o status — e so um alerta. Some sozinho quando o Estado do Trabalho
  for lancado, a pendencia for desmarcada, a etapa for adiada/cancelada/antecipada ou a data for
  corrigida para hoje/futuro (nenhuma escrita nova; a condicao e derivada). Nao ha status nem
  coluna persistida "sem retorno".
- Exports (CSV/ENEL/ENEL NOVO) NAO usam a paginacao por projeto (o CSV e plano): consultam por
  ETAPA com teto de 5000 ETAPAS e `count` exato; `total` volta como total de ETAPAS do filtro.
  A classificacao exibida e a gravada, nunca recalculada no front. Se houver mais etapas que o
  teto, a resposta traz `truncated=true` e o front avisa com numeros concretos: "Exportados X de
  Y registros. Restrinja o periodo ou os filtros" (achados 13 e 6).

---

## Permissoes

- `page_key` da tela: `programacao-normalizada` (nasce `default_user_access = false`).
- Acoes autorizadas por `requirePageAction`: `read` (GET), `create` (POST novo), `update`
  (PUT/adicionar/remover equipe/adiar/set-estado), `cancel` (cancelamento).
- Permissoes GRANULARES por operacao (migration 328, achados 6 e 10) — padrao do CLAUDE.md:
  page_key propria checada DENTRO da operacao, sobre a permissao da tela:
  - `programacao-concluir` — Concluir, Reabrir e sair de CONCLUIDO (encerram/reabrem o projeto e
    disparam a antecipacao em cascata).
  - `programacao-pendencia` — marcar/desmarcar `is_pendencia` E criar etapa com pendencia pelo
    formulario (a flag libera a excecao da trava de projeto concluido).
  - `programacao-corrigir-data` — corrigir a data da etapa (aceita data para tras).
  Todas nascem bloqueadas; admin liberado no backfill.

---

## Auditoria e Historico

- Toda RPC de escrita grava em `programming_history` via `append_programming_history_record`.
- Acoes: `CREATE_STAGE`, `UPDATE_STAGE`, `ADD_TEAM`, `REMOVE_TEAM`, `POSTPONE_STAGE`,
  `CANCEL_STAGE`, `ANTICIPATE_STAGE`, `COMPLETE_STAGE`, `RESTORE_ANTICIPATED_STAGE`, `REOPEN_STAGE`,
  `RECLASSIFY_STAGE`, `SET_WORK_COMPLETION_STATUS`, `CHANGE_COMPLETED_WORK_STATUS`,
  `SET_PENDENCIA_FLAG` (com motivo e origem), `CORRECT_STAGE_DATE` (com motivo e De/Para da data).
- Mudancas registram De/Para por campo (ex.: `executionDate` no adiamento, `isPendencia` no toggle,
  `workCompletionStatus` na troca de estado). A edicao de cadastro (`UPDATE_STAGE`) tambem grava o
  diff De/Para de todos os campos escalares alterados (migration 324, achado 12) — antes gravava
  `changes = {}` (so "houve edicao").

---

## Regras Multi-tenant e Seguranca

- Toda entidade carrega `tenant_id`; toda query filtra por tenant no servidor.
- RLS ativa como ultima barreira; policies de INSERT/UPDATE/DELETE NAO existem para `authenticated`
  nas tabelas novas — escrita so por `service_role` via RPC.
- `tenant_id` vem sempre da sessao (`resolveAuthenticatedAppUser`), nunca do payload.
- Hardening de grants reaplicado em cada migration (revoke public/anon/authenticated, grant
  service_role) para as RPCs recriadas.

---

## Matriz de Eventos

| Evento | status | work_completion_status | is_pendencia | Classificacao |
| --- | --- | --- | --- | --- |
| Criar etapa | `PROGRAMADA` | em branco | conforme checkbox | recalculada |
| Criar etapa como pendencia | `PROGRAMADA` | em branco | true | recalculada |
| Marcar Estado Trabalho parcial | inalterado | `PARCIAL_*`/`BENEFICIO_ATINGIDO` | inalterado | inalterada |
| Concluir etapa | inalterado (segue ativa) | `CONCLUIDO` | inalterado | vira FINAL; antecipa posteriores |
| Concluir uma pendencia | inalterado | `CONCLUIDO` | permanece true | sem antecipacao |
| Antecipada (cascata) | `ANTECIPADA` | `ANTECIPADO` | false | fora da numeracao |
| Reabrir CONCLUIDO | restaura | restaura antecipadas | — | recalculada |
| Adiar > nova data | `REPROGRAMADA` | em branco | inalterado | recalculada |
| Adiar > em espera | `ADIADA` (data NULL) | em branco | inalterado | fora da numeracao |
| Dar data a etapa em espera | `REPROGRAMADA` | inalterado | inalterado | recalculada |
| Cancelar | `CANCELADA` | em branco | inalterado | fora da numeracao |
| Togglar pendencia | inalterado | inalterado | alterna | inalterada |
| Remover equipe | inalterado | inalterado | inalterado | inalterada |

---

## Mapa de Codigo

- Banco:
  - `310_create_programming_normalized_module.sql` — schema + RLS select-only + indices + seed
    `BENEFICIO_ATINGIDO`.
  - `311_create_programming_normalized_rpcs.sql` — RPCs base.
  - `312_register_programming_normalized_page.sql` — pagina/permissao.
  - `313_add_documents_and_activities_to_save_stage.sql` — documentos/atividades no save.
  - `314_add_programming_set_work_completion_status_rpc.sql` — Estado Trabalho manual.
  - `315_migrate_legacy_programming_data.sql` — migracao do dado legado.
  - `316_fix_work_completion_status_reclassify_gap.sql` — SUPERSEDIDA pela 318.
  - `317_apply_revised_pendencia_model.sql` — pendencia como status espelhado; SUPERSEDIDA pela 318.
  - `318_pendencia_as_boolean_flag.sql` — pendencia como flag + Adiar in-place + excecao da trava.
- Server: `src/server/modules/programacao-normalizada/{selects,queries,catalogs,normalizers,rpc,handlers,types}.ts`.
- API: `src/app/api/programacao-normalizada/route.ts` (+ `/meta`).
- Front: `src/modules/dashboard/programacao-normalizada/{types,constants,utils,validators,api,hooks,components,listComponents,ProjectPlanView,ProgrammingNormalizedPageView,exports}.*`.

---

## Checklist de Validacao Manual

Classificacao:
- 1 etapa -> Unica; 7 etapas -> 1..6 + Final.
- Cancelar/adiar do meio renumera fechando o buraco; Final segue a maior data numeravel.
- Etapa em espera (data NULL) fica fora da numeracao.
- `is_pendencia` nao muda Etapa N/Final/Unica.

Pendencia (318):
- Checkbox no formulario cria etapa com Pendencia; Status mostra "Pendencia" (vermelho), Etapa
  segue Etapa N/Final.
- Toggle no card liga/desliga; desligar volta a exibir o status de agenda.
- Criar etapa Pendencia num projeto CONCLUIDO e permitido sem reabrir; etapa comum continua
  bloqueada.
- Concluir uma pendencia e permitido, nao antecipa, flag fica.

Adiar (318):
- "Nova data" -> `REPROGRAMADA` (mesma linha, data nova); historico com De/Para.
- "Deixar em espera" -> `ADIADA` sem data; some da lista cross-projeto, aparece no plano.
- Dar data a uma etapa em espera -> `REPROGRAMADA`.

Eixos e Estado Trabalho:
- `ADIADA`/`CANCELADA` limpam Estado Trabalho.
- `BENEFICIO_ATINGIDO` nao antecipa, nao bloqueia, nao encerra.
- So um `CONCLUIDO` NAO-pendencia ativo por projeto; antecipacao pega a FINAL (por data).

Equipe e agenda:
- Mesma equipe, mesma data, horario sobreposto, projetos diferentes -> bloqueia.
- Horarios encostados (08–12 / 12–17) -> aceita.
- Remover equipe libera a agenda. Remover a ULTIMA equipe ativa:
  - etapa NAO concluida -> permitido (a etapa fica sem equipe; nao cancela);
  - etapa CONCLUIDA -> BLOQUEADO (`STAGE_COMPLETED_LAST_TEAM`); reabra antes (migration 322).

Seguranca:
- `npm run db:security-check` para grants de RPC `SECURITY DEFINER`.
- Nenhuma escrita direta por `authenticated`; tudo por `service_role` via RPC.

---

## Observacoes Operacionais

- Este mapa cobre so o modelo normalizado. Regras do legado `programacao-simples` seguem em
  `docs/Tela_Programacao_Simples_SaaS.txt`.
- Pendencias de desenho ainda abertas (spec §9/§16): heranca template+override completa,
  importacao em massa por Excel, copiar/transferir equipe e escrita de `resolve_pendencia_de_id`.
- Divergencia guia x codigo deve ser reportada, nunca resolvida em silencio (CLAUDE.md secao 12).
