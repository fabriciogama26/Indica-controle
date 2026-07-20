# Auditoria de migração — Programação (dados reais)

Base: dump `data.sql` (pg_dump data-only, 2026-07-11). Análise para a nova tela.
Complementa `Spec_Nova_Programacao_Modelo_Normalizado.md`.

## Estado dos dados

- `project_programming`: **582 linhas**, 54 colunas, **408 grupos** (`programming_group_id`).
- Status: PROGRAMADA 275, REPROGRAMADA 123, CANCELADA 115, ADIADA 69.
- Estado Trabalho: em branco 315, PARCIAL_NAO_PLANEJADO 135, CONCLUIDO 54,
  PARCIAL_PLANEJADO 36, PENDENCIA 24, PARCIAL_PLANEJADO_BENFICIO_ATINGIDO 17, RETIRADO 1.
- `project_programming_activities`: **0 linhas** (feature não usada).
- `project_programming_history`: 2266 linhas (UPDATE 1250, BATCH_CREATE 426, RESCHEDULE 233,
  COPY 129, CANCELADA 115, ADIADA 69, CREATE 44).
- Vínculos: `anticipated_by` **0**, `copied_from` 115, `copy_batch` 43.
- Documentos SGD/PI/PEP preenchidos em apenas **19 linhas** (colunas inline).
- Equipes ativas por grupo: 0→126 grupos, 1→199, 2→68, 3→6, 4→5, 5→3, 10→1.

## Migra limpo (sem risco)

- Grupo = uma data: **0 grupos** com mais de uma `execution_date`. Colapso grupo→etapa é seguro.
- **0** equipes repetidas no mesmo grupo.
- **0** conflitos de agenda já gravados — a regra nova não invalida dado existente.
- Classificação: todas as linhas ativas em estado válido único (única 55, final 63, num 280,
  inválidas 0).
- **0** projetos com mais de um CONCLUIDO ativo.
- Antecipação é greenfield (`anticipated_by` = 0): desenhar do zero, nada a migrar.
- Etapa sem equipe e N equipes já são realidade (126 grupos com 0 equipes; 1 grupo com 10).
- `copied_from`/`copy_batch` (115/43): preservar os vínculos repontando para os novos ids.

## Decisões bloqueantes

### D1 — Existe etapa no mesmo dia (quebra "uma data = uma etapa")

Projeto `53d3e7b9`, data 2026-07-24: **3 etapas ativas** (etapa 1, etapa 2, FINAL), mesma
descrição, mesmo horário. 5 casos no total (1 ativo). A classificação automática por data
colapsaria as três em uma (errado). Opções:
- **(a) Proibir**: corrigir o dado (re-datar ou mesclar) e travar uma etapa por data. Mantém o
  desenho atual do spec intacto.
- **(b) Permitir**: várias etapas por data → a ordem deixa de ser só por data; precisa de uma
  sequência explícita dentro do dia (um `stage_order`), e a classificação passa a ordenar por
  `(execution_date, stage_order)`.

Decisão trava a `reclassify_project_stages`. Recomendo (a) se os 5 casos forem quirk de
digitação; (b) se a operação realmente faz fases no mesmo dia.

### D2 — Catálogo de Estado Trabalho (mais rico que o spec assumia)

| Código atual | Linhas | Ação |
| --- | --- | --- |
| CONCLUIDO | 54 | mantém (único que encerra) |
| PARCIAL_NAO_PLANEJADO | 135 | mantém |
| PARCIAL_PLANEJADO | 36 | mantém |
| PARCIAL_PLANEJADO_BENFICIO_ATINGIDO | 17 | renomear → `BENEFICIO_ATINGIDO` (corrige typo); informativo |
| **PENDENCIA** | **24 (ativas)** | **decisão: manter como código OU migrar p/ vínculo** |
| ANTECIPADO | 0 | mantém (usado pela antecipação automática) |
| RETIRADO | 1 | decisão: manter, mapear ou aposentar |
| SUSPENSO | 0 | decisão: manter ou aposentar |
| PARCIAL (legado) | 0 | já inativo |

**PENDENCIA é o ponto central**: hoje é um Estado Trabalho ativo (24 linhas), não um vínculo.
Isso contradiz a decisão de modelar pendência como `resolve_pendencia_de_id`. Duas saídas:
- **Manter como código** (menos migração; bate com o dado atual; "pendente" fica sendo um
  Estado Trabalho de verdade).
- **Migrar para vínculo** (mais limpo conceitualmente; exige converter as 24 linhas — mas só 1
  tem `copied_from`, então o vínculo de origem teria que ser inferido ou preenchido à mão).

Recomendação pragmática: **manter `PENDENCIA` como Estado Trabalho** (é o que o dado diz e o que
você descreveu primeiro) e usar o vínculo `resolve_pendencia_de_id` como complemento opcional
para ligar a etapa de resolução à origem, quando existir. Assim não se perde nada e ganha-se o
rastreio.

## Reconciliações (backfill)

- **Divergência entre irmãs**: 12 grupos com campos divergentes entre equipes —
  service_description (5), end_time (4), rede_qty (3), start_time (2), poste_qty (1), period (1).
  No colapso grupo→etapa, valor canônico = mais recente por `updated_at`, **com lista de revisão**
  para esses 12 (não sobrescrever cegamente descrição/quantidade).
- **Horário pode ser por equipe**: start/end/period divergem em ~6 grupos. Como o conflito de
  agenda é por equipe×horário, o mais correto é `period`/`start_time`/`end_time`/`expected_minutes`
  irem para **`programming_team`**, não para a etapa. Revisão do spec (que os punha na etapa).
- **Documentos inline**: SGD/PI/PEP são 9 colunas na linha, preenchidas em só 19 linhas e 1 por
  etapa. **Manter inline na `programming`** (não criar tabela filha de documento — simplifica vs
  o spec).
- **Coluna dupla**: existem `work_completion_status` (texto) e `work_completion_status_id` (FK).
  Consolidar numa só (a FK ao catálogo); a de texto é redundante.
- **`is_active`**: redundante com `status`. Aposentar; fonte única = `status`.
- **`programming_group_id`**: eliminado (a etapa passa a ser o id). Repontar `copied_from`,
  `anticipated_by` e o histórico para os novos ids de etapa/equipe.
- **Atividades**: 0 linhas; manter a tabela filha, nada a migrar.

## Telas dependentes (mapa, visualização de programação)

Elas leem de `project_programming` (uma linha por equipe). Para não quebrar no dia da virada:
- Criar uma **view de compatibilidade** que reproduz o formato antigo (etapa × equipe achatado),
  ex.: `project_programming_flat` = `programming ⋈ programming_team`, com as colunas com os nomes
  antigos. Mapa e Visualização passam a ler a view; funcionam sem alteração imediata.
- Migrar essas telas depois, uma a uma, para ler direto das tabelas novas, e então aposentar a
  view. A escrita nova nunca passa pela view.

## Importação em massa com ATUALIZAÇÃO (upsert)

Como a planilha reconhece o que já existe e o que mudou:
- **Round-trip com id**: a atualização começa exportando o plano atual para Excel já com colunas
  ocultas `programming_id` e `programming_team_id`. O usuário edita e reenvia.
- **Casamento (sempre por chave, nunca inserção cega)**: o ID é só um atalho. Com ou sem ID, o
  import **sempre** verifica a chave natural `projeto SOB + data` — que é a própria etapa (uma
  data = uma etapa por projeto). Fluxo por linha:
  - tem ID → casa por ID; ainda assim confere se bate com a chave natural.
  - sem ID → casa por `projeto + data`.
  - existe → é a etapa existente: **atualiza** o cadastro e reconcilia as equipes (não cria
    duplicata).
  - não existe → etapa nova.
  Ou seja, ausência de ID **não** significa "cadastrar como novo". Isso também vale no cadastro
  manual (a tela ciente do plano já detecta a etapa existente).
- **Colisão de chave**: quando `projeto + data` já existe, o comportamento depende do modo —
  `upsert` atualiza, `insert-only` marca erro no preview, `skip` ignora. Nunca duplica em
  silêncio.
- **Diff no dry-run**: o staging compara cada linha com o registro guardado e mostra o que muda,
  campo a campo (`descrição: X → Y`, `rede: 120 → 150`, `+MK5`, `−MK3`) antes de gravar.
- **Modos**: `upsert` (insere novos + atualiza alterados, padrão), `update-only`, e `full-sync`
  (também remove equipes/etapas ausentes na planilha — opt-in, perigoso).
- **Concorrência**: a linha carrega `updated_at`; se o registro mudou desde a exportação, o
  preview marca conflito em vez de sobrescrever (mesmo `expectedUpdatedAt` da tela).
- **Regras no commit**: conflito de agenda, um CONCLUIDO por projeto, projeto concluído bloqueia
  mudança estrutural, e `reclassify` roda por projeto ao final. Tudo transacional, com
  `import_batch_id`.

## Passos ajustados

1. Fechar D1 e D2 (bloqueiam a `reclassify` e o catálogo).
2. Auditoria read-only na base viva (repetir estas queries no ambiente real).
3. Resolver o impedimento do CLI/project ref (migration 233 pendente da auditoria de junho).
4. Criar tabelas novas ao lado (`programming` + `programming_team` com horário; atividades).
5. Backfill com valor canônico + lista de revisão dos 12 grupos divergentes.
6. `reclassify_project_stages` + dry-run comparando com a classificação atual.
7. View de compatibilidade para mapa/visualização.
8. Virar a chave; aposentar `project_programming` depois.

---

## Schema real (confirmado no `schema.sql`) — impactos

### Tabela `project_programming` (54 colunas, constraints)
- `CHECK status`: `PROGRAMADA, REPROGRAMADA, ADIADA, CANCELADA, ANTECIPADA, TRANSFERIDA`
  (TRANSFERIDA já existe por linha — vira `programming_team.status` no modelo novo).
- `status_fields_check`: coerência de is_active/cancellation_reason/canceled_at/by por status.
- `programming_group_id uuid NOT NULL`; documentos SGD/PI/PEP são **colunas inline** com checks
  próprios; `work_completion_status` é **texto sem CHECK** (controlado por catálogo + normalize).
- Sem coluna de horário por equipe hoje: `period/start_time/end_time/expected_minutes` estão na
  linha (por equipe já, na prática) — reforça movê-los para `programming_team`.

### Chave única atual vs alvo
- Hoje: `uq_project_programming_active_project_team_date` = UNIQUE
  `(tenant_id, project_id, team_id, execution_date) WHERE is_active`. Ou seja, hoje o único
  impedimento é **mesma equipe repetida** no mesmo projeto+data — **não** "uma etapa por data".
  Por isso o caso de 3 etapas no mesmo dia existe (usam equipes diferentes).
- Alvo: UNIQUE `(tenant_id, project_id, execution_date)` na etapa (mais restritivo) + UNIQUE
  `(programming_id, team_id)` na equipe. Migrar exige resolver o D1 primeiro.

### Triggers — o que some com a normalização
| Trigger / função | Papel hoje | No modelo novo |
| --- | --- | --- |
| `enforce_project_programming_schedule_concurrency` | conflito de agenda (tenant-wide, horário) | **sobrevive** (equipe × data/horário da etapa) |
| `assign_project_programming_group_id` | calcula group_id de projeto+data+etapa | **some** (a etapa é o grupo) |
| `sync_programming_documents_by_project_date_and_lv_window` | replica documentos entre irmãs | **some** (doc uma vez na etapa) |
| `sync_programming_work_completion_status_by_project_date` | replica Estado Trabalho entre irmãs | **some** (estado uma vez na etapa) |
| `sync_project_programming_group_operational_fields` | replica campos operacionais entre irmãs | **some** |
| `enforce_completed_work_status_group_integrity` | integridade de CONCLUIDO no grupo | **some/simplifica** |
| `enforce_interrupted_programming_completed_work_status` | interrompida = estado em branco | **sobrevive** (na etapa) |
| `enforce_project_programming_anticipated_work_status` | coerência ANTECIPADA/ANTECIPADO | **sobrevive** (na etapa) |
| `restore_project_programming_anticipated_by_reopened_completion` | reabrir restaura antecipadas | **sobrevive/adapta** |

Ou seja, **4–5 triggers/funções de sincronização existem só por causa da denormalização** e
somem — confirmando o argumento do spec.

### Antecipação — brecha confirmada
`mark_project_programming_future_stages_anticipated` mira apenas
`etapa_number IS NOT NULL AND etapa_number > origem`. Como `FINAL`/`ÚNICA` têm `etapa_number NULL`,
**a FINAL nunca é antecipada hoje**, e a origem precisa ser numérica. A correção do spec
(antecipar por `execution_date` posterior) conserta isso de fato. Feature quase sem uso
(0 linhas `ANTECIPADO`), então é seguro redesenhar.

### Código de Estado Trabalho
`normalize_programming_work_completion_code` mapeia PARCIAL→PARCIAL_NAO_PLANEJADO,
PARCIAL_PLANEJADO→PARCIAL_PLANEJADO, ANTECIPADA→ANTECIPADO; demais (CONCLUIDO, PENDENCIA,
`PARCIAL_PLANEJADO_BENFICIO_ATINGIDO`, RETIRADO, SUSPENSO) passam direto. A antecipação só
dispara com CONCLUIDO — logo `BENEFICIO_ATINGIDO` **já não encerra** hoje (bate com a decisão D2).

### Débito técnico e segurança
- **16 overloads** de `save_project_programming_*` (`_full`, `_batch_full`, `_decimal`,
  `_with_electrical_and_eq`, `_with_electrical_field`…) — consolidar em poucas RPCs limpas no
  modelo novo.
- **Zero policies de DELETE** no schema inteiro → tudo soft-delete; "remover equipe" tem que ser
  status `REMOVIDA` (confirmado).
- RLS em `project_programming` e filhas: `tenant_select/insert/update` (sem delete).