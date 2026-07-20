# Plano de Arquitetura — Nova Estrutura da Programação

Documento de planejamento gerado em 2026-07-07. Não é o TXT oficial de tela (`docs/Tela_Programacao_Simples_SaaS.txt`) — este arquivo existe para alinhar a decisão de arquitetura antes de qualquer migration/código ser escrito. Quando (e se) a implementação avançar, o TXT oficial e `Mapa_Regras_Programacao.md` devem ser atualizados como sempre.

**Atualização 2026-07-18**: este rascunho foi superado por
`Spec_Nova_Programacao_Modelo_Normalizado.md`, que já foi implementado como tela nova
(`/programacao-normalizada`, ao lado de `programacao-simples`). Ver
`docs/Tela_Programacao_Normalizada_SaaS.txt` para o estado real do código.

Duas frentes, tratadas como fases independentes:

- **Fase 1**: separar cabeçalho (grupo operacional) da alocação por equipe, permitindo criar a programação sem equipe.
- **Fase 2**: cadastro em massa via upload de planilha.

A Fase 2 depende do modelo de dados da Fase 1 estar definido (mesmo que não implementado), porque o formato da planilha de import muda dependendo de onde a ETAPA/SGD/quantidades moram.

---

## 1. Problema atual (diagnóstico)

`project_programming` é uma tabela achatada: cada linha é `tenant_id + project_id + team_id + execution_date`. Não existe uma entidade real de "grupo operacional" — o que existe é `programming_group_id`, uma coluna calculada por trigger que serve para simular que N linhas (uma por equipe) são a mesma execução.

Consequências do modelo atual:

- Campos que logicamente pertencem à execução como um todo (ETAPA, Tipo de SGD, Nº EQ, Alimentador, quantidades de POSTE/ESTRUTURA/TRAFO/REDE, janela de desligamento, descrição do serviço) são **duplicados em cada linha de equipe** e mantidos "iguais" por trigger de sincronização (migrations `267`, `273`, com correções em `275`–`282`).
- Não é possível criar a programação sem pelo menos 1 equipe, porque `team_id` é campo de identidade da linha e a guarda de ETAPA ativa (`project_programming_active_stage_valid_check`) exige ETAPA válida em toda linha ativa — sem equipe não há linha, e sem linha não há onde a ETAPA morar.
- Dois mecanismos de agrupamento coexistem: `programming_group_id` (cancelamento/adiamento/sync operacional) e Projeto+Data(+janela de 7 dias para `LV-xx`) (sync de documentos e Estado Trabalho). Ações diferentes da mesma tela usam escopos de agrupamento diferentes.
- Cancelamento e adiamento não têm reversão (diferente de `CONCLUIDO`, que tem fluxo completo de reabertura).

Referência completa do estado atual: `docs/Mapa_Regras_Programacao.md`.

---

## 2. Objetivo da Fase 1

Permitir o fluxo: **criar o cabeçalho da programação sem equipe → usar "Adicionar equipe" para popular** — sem violar a guarda de ETAPA e sem duplicar campos operacionais em N linhas.

Isso exige mover a identidade "o que vamos fazer, onde e quando" para uma entidade própria, e deixar "quem vai fazer" (equipe) como um relacionamento filho.

### 2.1 Modelo proposto (conceitual, sem DDL)

**Tabela nova — cabeçalho (nome de trabalho: `project_programming_group`)**
Substitui o papel hoje ocupado pela coluna calculada `programming_group_id`. Passa a ser uma linha real, criada explicitamente no cadastro, contendo:

- Identidade: `tenant_id`, `project_id`, `execution_date`.
- Classificação de ETAPA: `etapa_number`, `etapa_unica`, `etapa_final` (mesma guarda de "exatamente um estado válido" migra pra cá).
- Campos operacionais hoje sincronizados por trigger entre linhas de equipe: `feeder`, `campo_eletrico`, `electrical_eq_catalog_id`, `sgd_type_id`, `affected_customers`, `outage_start_time`, `outage_end_time`, `support`, `support_item_id`, `service_description`.
- Quantidades: `poste_qty`, `estrutura_qty`, `trafo_qty`, `rede_qty` — **ver decisão pendente no item 2.3**, porque essas quantidades podem precisar variar por equipe na prática.
- Documentos (`SGD`/`PI`/`PEP`) — candidato a tabela própria (`project_programming_documents`) vinculada ao cabeçalho, eliminando o mecanismo paralelo de sync por "Projeto+Data+janela de 7 dias".
- `status_grupo` derivado (todas as equipes adiadas/canceladas → grupo inativo), só para leitura/relatório, não como fonte de verdade por linha.

**Tabela `project_programming` (mantida, mas reduzida a "alocação de equipe")**
Passa a conter só o que realmente varia por equipe:

- `group_id` (FK para o novo cabeçalho, obrigatório).
- `team_id`, `start_time`, `end_time`, `period`.
- `status` operacional (`PROGRAMADA`, `REPROGRAMADA`, `ADIADA`, `CANCELADA`, `ANTECIPADA`, `TRANSFERIDA`).
- `work_completion_status` (Estado Trabalho) — fica por equipe, como já é hoje.
- Motivo/data/usuário de cancelamento e adiamento.
- `copied_from_programming_id`, vínculos de histórico.

### 2.2 Novo ciclo de vida

```
1. Usuário cria o cabeçalho: projeto, data, ETAPA, SGD, Nº EQ, quantidades, documentos.
   -> Grava 1 linha em project_programming_group. Nenhuma linha de equipe ainda existe.
2. Usuário clica "Adicionar equipe" (n vezes) para cada equipe que vai executar.
   -> Cada clique cria 1 linha em project_programming vinculada ao group_id.
   -> Não precisa mais "clonar" um molde: os campos operacionais já vivem no cabeçalho.
3. Ações por equipe (adiar individual, cancelar individual, transferir, Estado Trabalho)
   seguem operando na linha de project_programming, como hoje.
4. Ações de grupo (adiar/cancelar todas as equipes) operam sobre group_id diretamente,
   sem precisar recalcular grupo por trigger.
```

Efeito colateral positivo: a guarda de ETAPA ativa passa a validar o **cabeçalho** (1 checagem por grupo), não cada linha de equipe — elimina a classe de bug que motivou as migrations `269`–`275`, `279`–`282` (trigger de sincronização + guarda por linha brigando entre si).

### 2.3 Decisão pendente — quantidades por equipe

Hoje `POSTE`/`ESTRUTURA`/`TRAFO`/`REDE` são replicados idênticos por equipe e sincronizados quando um editor muda em uma linha. Duas opções:

- **A. Quantidade fica só no cabeçalho** (uma execução, um total). Mais simples, mas perde a granularidade de "quanto cada equipe de fato instalou", se isso importa operacionalmente.
- **B. Quantidade fica por equipe** (linha de alocação), e o cabeçalho não tem essas colunas. Mais fiel à realidade de campo, mas exige decidir o que preencher quando a equipe é adicionada antes do serviço começar (zero? em branco?).

Esta decisão precisa ser tomada com quem opera a tela antes de fechar o schema — não é uma decisão técnica pura.

### 2.4 Migração de dados existentes

- Cada `programming_group_id` distinto vira 1 linha em `project_programming_group`, com os campos operacionais copiados da linha mais recente do grupo (mesma lógica de "canônico" já usada na migration `276` para saneamento de `CONCLUIDO` duplicado).
- `project_programming` existente perde as colunas migradas e ganha `group_id` apontando pro cabeçalho recém-criado.
- Precisa rodar em ambiente de homologação primeiro e comparar contagem de linhas antes/depois, dado o volume de migrations já aplicadas em cima dessa tabela (mais de 30 migrations só em Programação).

### 2.5 Impacto em RPCs e regras existentes

Reescrita ou aposentadoria esperada:

- `save_project_programming_full` / `save_project_programming_batch_full` — passam a separar "criar/atualizar cabeçalho" de "criar/atualizar linha de equipe".
- Trigger de sincronização por `programming_group_id` (migration `273` e correções seguintes) — deixa de existir; sincronização vira "ler direto do cabeçalho", sem duplicar e sem trigger.
- `postpone_project_programming_group`, `cancel_project_programming_group` — passam a operar em `group_id` real em vez de recalcular por trigger.
- Guarda `enforce_project_programming_active_stage_required` — migra para validar o cabeçalho.
- `Adicionar equipe` deixa de precisar de uma "linha modelo" para clonar — só insere referenciando o cabeçalho.
- Exportações ENEL/ENEL NOVO — hoje leem campos direto da linha de equipe; passam a fazer join com o cabeçalho. Mapeamentos de coluna não mudam, só a origem do dado.

Regras que **não mudam**: catálogos (`programming_reason_catalog`, `programming_work_completion_catalog`, `programming_eq_catalog`, `programming_sgd_types`), histórico (`project_programming_history`), permissões, multi-tenant.

### 2.6 Riscos

- Reescrita toca praticamente todas as RPCs de Programação (~30 migrations construídas em cima do modelo atual). Não é uma migration incremental pequena — é uma reestruturação.
- Período de transição com dado antigo (achatado) e novo (cabeçalho/detalhe) coexistindo, se o rollout for gradual.
- Exportações ENEL são usadas operacionalmente pela distribuidora (ENEL) — qualquer erro de mapeamento no join novo quebra entrega externa, não só uso interno.
- Ganho é estrutural (menos bug de sincronização, permite criar sem equipe), mas o custo de implementação é alto. Vale considerar um piloto isolado (ex.: nova tabela rodando em paralelo, sem desligar a antiga) antes de migrar tudo.

---

## 3. Objetivo da Fase 2 — Cadastro em massa via upload

### 3.1 Padrão de referência já existente no projeto

`Pessoas` e `Materiais` já têm cadastro em massa via CSV: botão de template, upload, processamento **linha a linha com sucesso parcial** (`N salvos, M com erro`), sem transação única cobrindo o arquivo inteiro. Ver `PeoplePageView.tsx` (`downloadMassTemplate`, `handleMassImportFile`).

### 3.2 Por que o import da Programação é diferente do lote atual

O `BATCH_CREATE` de hoje é **atômico** (tudo ou nada) porque as N equipes selecionadas representam a mesma execução/grupo — falha de uma equipe invalida o conjunto inteiro por design.

Um CSV de import em massa é outra coisa: cada linha do arquivo tende a representar uma **execução diferente** (projeto/data diferentes), não N equipes da mesma execução. Portanto o modelo certo é o de Pessoas/Materiais (parcial, linha a linha), não o modelo atual de Programação (atômico).

### 3.3 Formato da planilha (depende da Fase 1)

- **Se a Fase 1 não foi implementada**: cada linha do CSV = 1 programação completa (projeto, data, equipe, horário, ETAPA, SGD, Nº EQ, quantidades...). Mesmo problema de duplicação da Fase 1 se repete no CSV — se o usuário quer 3 equipes na mesma execução, precisa repetir a linha 3 vezes com dados idênticos.
- **Se a Fase 1 foi implementada**: o CSV pode ter duas abas/seções — uma linha de cabeçalho por execução, e linhas de equipe vinculadas por uma chave local do arquivo (ex.: `linha_cabecalho_ref`). Mais fiel ao modelo de dados, mas exige um template CSV mais sofisticado que os já existentes no projeto (que são tabelas simples de 1 nível).

Recomendação: **não implementar a Fase 2 antes de decidir a Fase 1**, mesmo que a Fase 1 não seja implementada de imediato — o formato do template CSV muda dependendo dessa decisão.

### 3.4 Validações que o import precisa repetir (mesmas da tela)

- ETAPA válida (numérica > 0 xor `ETAPA_UNICA`/`ETAPA_FINAL`) e sem conflito com histórico do projeto/equipe.
- Conflito de horário por equipe/data.
- Projeto não pode estar com Estado Trabalho `CONCLUIDO`.
- Equipe ativa e do tenant correto.
- Motivo/catálogos quando aplicável (não deveria aplicar no cadastro novo, só em ações de status).

Cada linha do CSV deve rodar pela mesma RPC transacional usada pela tela (`save_project_programming_full` ou a versão pós-Fase-1), nunca uma via de escrita direta — senão o import vira um jeito de furar as guardas de banco.

### 3.5 Riscos específicos do import em massa

- Arquivo grande com muitas linhas inválidas gera relatório de erro longo — precisa de UX pra isso (a de Pessoas já resolve, reaproveitar).
- Diferente de Pessoas, erro em Programação pode ser mais caro de entender (ex.: "ETAPA_CONFLICT" exige saber o histórico do projeto) — o relatório de erro por linha precisa ser específico, não genérico.
- Sem trava de duplicidade adicional, reimportar o mesmo arquivo duas vezes cria programações duplicadas (a validação de conflito de horário pega duplicata exata equipe+data+horário, mas não pega duplicata com pequena variação).

---

## 4. Próximos passos sugeridos

1. Decidir o item 2.3 (quantidades por equipe vs. por cabeçalho) com quem opera a tela.
2. Decidir se a Fase 1 será um piloto isolado (tabela nova em paralelo) ou substituição direta do modelo atual.
3. Só depois disso, desenhar o template CSV da Fase 2.
4. Qualquer decisão tomada aqui deve ser refletida em `docs/Mapa_Regras_Programacao.md` antes de virar migration.

## 5. Perguntas em aberto (para o usuário decidir, não técnicas)

- Quantidades de material (POSTE/ESTRUTURA/TRAFO/REDE) são por execução ou por equipe na realidade de campo?
- Cancelamento/adiamento sem reversão é aceitável, ou vale incluir "desfazer" no mesmo esforço de reestruturação?
- Import em massa deve aceitar múltiplas equipes por execução no mesmo arquivo (formato 2 níveis) já na primeira versão, ou começar simples (1 equipe por linha) e evoluir depois?
