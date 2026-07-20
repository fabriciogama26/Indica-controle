# Plano de teste manual — Nova tela de Programação

Rodar pela própria tela, num ambiente de dev com as tabelas novas vazias.
Base: `Spec_Nova_Programacao_Modelo_Normalizado.md`.

Legenda: **P** = passos · **E** = esperado.

## A. Classificação automática

A1 — Plano de 5 datas
- P: criar plano com 5 datas (ex.: 08, 11, 14, 17, 20/07).
- E: etapas 1, 2, 3, 4 e a de 20/07 = **Final**.

A2 — Uma etapa só
- P: criar plano com 1 data.
- E: etapa = **Única** (sem número, sem final).

A3 — Cancelar etapa do meio
- P: no plano A1, cancelar a 2ª (11/07).
- E: a 3ª (14/07) vira **etapa 2**; numeração fecha o buraco; Final continua em 20/07.

A4 — Cancelar a Final
- P: no plano A1, cancelar a Final (20/07).
- E: a de 17/07 vira **Final**.

A5 — Colapso para Única
- P: cancelar até sobrar uma etapa ativa.
- E: a que sobrou vira **Única**.

## B. Inserção e pendência (regra do "hoje vs final")

B1 — Inserir antes da Final (final não passou)
- P: com a Final em 20/07 (data futura), adicionar 16/07.
- E: 16/07 entra como numérica; renumera; Final continua 20/07.

B2 — Data posterior com a Final ainda no futuro
- P: com a Final em 20/07 (futuro), adicionar 24/07.
- E: 24/07 vira a **nova Final**; a antiga (20/07) vira numérica.

B3 — Data posterior com a Final **já passada** → pendência
- P: com a Final em 18/07 e **hoje > 18/07**, programar 22/07.
- E: 22/07 entra como **PENDÊNCIA** (Estado Trabalho); **sem número**; a Final **não muda**.

B4 — Uma etapa por (projeto, data)
- P: tentar criar 2 etapas no mesmo projeto e mesma data.
- E: **bloqueia**. Repetir em projetos diferentes → **aceita**.

## C. Equipes

C1 — Muitas equipes numa etapa
- P: adicionar 3+ equipes a uma etapa.
- E: a etapa mostra "N equipes"; expande e lista todas; classificação não muda.

C2 — Etapa sem equipe
- P: criar etapa sem equipe.
- E: permitido (planejada, sem alocar).

C3 — Remover equipe
- P: remover uma equipe de uma etapa com 2+.
- E: equipe vira **REMOVIDA**; agenda liberada; etapa intacta.

C4 — Remover a última equipe
- P: remover a única equipe da etapa.
- E: etapa fica **sem equipe** (não cancela sozinha).

## D. Conflito de agenda (por equipe, horário, tenant-wide)

D1 — Sobreposição bloqueia
- P: equipe MK1 em 09/07 08:00–12:00 na obra A; tentar MK1 em 09/07 08:00–12:00 na obra B.
- E: **bloqueia** (TEAM_TIME_CONFLICT).

D2 — Horário encostado aceita
- P: MK1 em 09/07 08:00–12:00 (obra A) e MK1 em 09/07 12:00–17:00 (obra B).
- E: **aceita** (sem sobreposição).

D3 — Data retroativa também checa
- P: repetir D1 com data já passada.
- E: mesmo bloqueio (retroativo não é exceção).

## E. Estado Trabalho e encerramento

E1 — Default em branco
- P: criar etapa nova.
- E: Estado Trabalho **em branco** (não escolhido pelo usuário na criação).

E2 — Concluir no meio antecipa e promove
- P: plano de 7 etapas; marcar CONCLUÍDO na 5ª.
- E: 6ª e 7ª viram **ANTECIPADA/ANTECIPADO**; a 5ª vira **Final**; novas ações **travadas**.

E3 — Reabrir reverte
- P: reabrir a 5ª (tirar o concluído).
- E: 6ª e 7ª voltam a ativas; a 5ª volta a numérica; Final volta pra 7ª.

E4 — Antecipação pega a Final (correção)
- P: plano com Final; concluir uma etapa numérica anterior à Final.
- E: a **Final também é antecipada** (por data), não só as numeradas.

E5 — Benefício atingido é informativo
- P: marcar BENEFÍCIO ATINGIDO numa etapa.
- E: **não** antecipa, **não** trava, **não** conta como encerramento.

E6 — Um concluído por projeto
- P: tentar marcar CONCLUÍDO em duas etapas ativas do mesmo projeto.
- E: **bloqueia** a segunda.

## F. Concorrência e histórico

F1 — Edição concorrente
- P: abrir a etapa em duas abas; salvar numa; salvar na outra.
- E: a 2ª falha por `expectedUpdatedAt` desatualizado (não sobrescreve).

F2 — Histórico
- P: após cada ação (criar, cancelar, concluir, remover equipe, reclassificar).
- E: registro correspondente em `project_programming_history` (ou equivalente novo).