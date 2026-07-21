# Spec — Nova Programação (modelo normalizado, etapa como pai)

Documento de estrutura. Data: 2026-07-12. Supersede o rascunho anterior.
Complementa `Fluxo_Programacao.md`, `Mapa_Regras_Programacao.md` e `design_realtime_programacao_2026-07.md`.
Status: PARCIALMENTE APLICADA. Migrations 310–318 e o módulo `programacao-normalizada`
(front + server) já implementam o modelo. Pendente: importação em massa por Excel (§16),
herança template+override no cadastro (§9), copiar/transferir equipe e vínculo
`resolve_pendencia_de_id` (colunas existem, sem RPC que escreva).
A migration 318 (pendência como flag booleana `is_pendencia` + Adiar in-place com
"deixar em espera") supersede a 317 (que modelava pendência como status espelhado) — ver
§2, §3.1, §3.2, §4, §4.2, §6, §9, §10.

---

1. Ideia central

A "programação" de um projeto é o seu plano: a sequência de etapas, uma por data. Cada etapa é o pai; as equipes são filhas dela. A tela mostra o plano/etapas, não linha por equipe.

Mudança de modelo em relação a hoje: normalizar. Hoje tudo mora em project_programming, uma linha por equipe, com os campos operacionais/documentos/Estado Trabalho duplicados e mantidos em sincronia por trigger. Essa duplicação é a raiz das migrations 267 e 276–282 (dedup de CONCLUIDO, integridade de grupo, armadilha de boolean nulo). Tirando a duplicação, esses problemas deixam de poder existir.

Decisões confirmadas ao longo do desenho:

Classificação de etapa (única/numérica/final) é derivada da posição, não digitada.
FINAL é sempre a etapa de data mais recente.
A sequência é por projeto (tenant_id + project_id, todas as datas).
Uma data = uma etapa por projeto.
Físico normalizado (não mais linha-por-equipe).
Cada etapa tem cadastro próprio; a base é preenchida uma vez e herdada, com override por campo por etapa (template + override, nada travado).
benefício atingido é parcial informativo (não encerra o projeto).
Pendência é vínculo manual de uma etapa de resolução, não derivação automática.
2. Modelo de dados
project
  └─ programming            (a etapa / o plano-item; o "pai")
       ├─ programming_team       (equipe alocada; a "filha")
       ├─ programming_activity   (atividade: código + qtd)
       └─ programming_document   (SGD / PI / PEP)

programming (a etapa) — uma linha por (projeto, data):

Identidade: id, tenant_id, project_id, execution_date.
Classificação (derivada, escrita só por RPC): etapa_number, etapa_unica, etapa_final.
Eixo 1 — status operacional (agenda): status ∈ PROGRAMADA, REPROGRAMADA, ADIADA, CANCELADA, ANTECIPADA. PENDENCIA não é valor de status — ver is_pendencia abaixo.
Eixo 2 — Estado Trabalho: work_completion_status (catálogo por tenant). Sem PENDENCIA.
Flag independente: is_pendencia boolean default false — checkbox na etapa. Quando true, a coluna Status exibe "Pendência" (o status de agenda continua gravado por baixo, para voltar ao desmarcar). Não afeta numeração nem Estado Trabalho — é ortogonal a tudo.
Cadastro operacional (por etapa): service_description, periodo, hora_inicio, hora_termino, sgd_type_id, electrical_eq_catalog_id (Nº EQ), feeder, campo_eletrico, affected_customers, outage_start_time, outage_end_time, support, support_item_id, poste_qty, estrutura_qty, trafo_qty, rede_qty, anotacao.
Rastreio: resolve_pendencia_de_id (FK → programming, pendência), copied_from_id, copy_batch_id, anticipated_by_id, anticipated_at, previous_work_completion_status, previous_operational_status, cancellation_reason, canceled_at, canceled_by.
Concorrência: updated_at (para expectedUpdatedAt da etapa).

programming_team (a filha) — enxuta:

id, programming_id (FK), tenant_id, team_id.
status ∈ ATIVA, REMOVIDA, TRANSFERIDA.
added_from_id (origem em cópia/adicionar equipe), updated_at (concorrência da equipe).

programming_activity / programming_document — filhas da etapa, substituem a replicação por equipe (a regra de "replicar documento para equipes do mesmo projeto+data / +7 dias LV" deixa de existir).

O que sai do modelo:

programming_group_id — eliminado. A etapa (programming.id) é o grupo. Toda a derivação da migration 273 e a checagem PROGRAMMING_GROUP_STAGE_MISMATCH somem.
is_active — redundante; a fonte única passa a ser status.
Triggers de sincronização operacional/Estado Trabalho entre irmãs — desnecessários (os campos existem uma vez na etapa; as equipes compartilham por serem filhas).

Constante de projeto vs etapa: município e alimentador são padrões que vêm do projeto e são herdados; todos os demais campos são por etapa. Nada é travado — herança com override.

3. Os três eixos (não confundir)
programming.status — agenda da etapa: o que aconteceu com a data.
programming.work_completion_status — execução da etapa: situação do serviço.
programming_team.status — participação da equipe: se está alocada.

Regra de mapeamento de escopo:

Adiar/Cancelar em grupo = agem no status da etapa.
Adiar/Cancelar individual de equipe = viram operação de participação (programming_team.status → REMOVIDA/TRANSFERIDA), sem tocar no status da etapa.

Combinações válidas de status × Estado Trabalho:

PROGRAMADA/REPROGRAMADA (ativas): em branco, PARCIAL_PLANEJADO, PARCIAL_NAO_PLANEJADO, BENEFICIO_ATINGIDO, CONCLUIDO.
ADIADA/CANCELADA: Estado Trabalho em branco (trigger limpa).
ANTECIPADA: apenas ANTECIPADO (par obrigatório, gerado por conclusão anterior).
Pendência é a flag is_pendencia (ver 4.2), não um valor de status nem de Estado Trabalho.
3.1. Transições de status da etapa (status é sempre automático)

O usuário nunca escolhe status; ele sai de ação ou da flag de pendência.

Criar etapa (com sua data) → PROGRAMADA.
Mudança de data passa pelo Adiar (o editor mantém a data travada). Adiar tem dois caminhos:
Nova data → a etapa vira REPROGRAMADA (remarcada). Dispara reclassify (a posição pode mudar).
Deixar em espera (sem data) → ADIADA.
Dar uma data depois a uma etapa em espera (ADIADA) → vira REPROGRAMADA.
Cancelar → CANCELADA.
Conclusão de etapa anterior → ANTECIPADA nas de data posterior (automático).
Pendência (flag): marcar is_pendencia = true faz a coluna Status exibir "Pendência"; o status de agenda (Programada/Reprogramada) continua gravado por baixo. Desmarcar volta a mostrar o status de agenda. É só um selo por cima, não substitui a agenda.

O status é da etapa, não do projeto. O projeto não tem campo de status — é só o guarda-chuva das etapas. A coluna Estado da lista mostra o status por etapa; não há selo de status no nível da obra.

3.2. Exibição na lista (não colapsar os eixos)

Três colunas distintas, cada valor no seu lugar:

Etapa (posição): só Etapa N, Final ou Única. Nunca Pendência aqui. A etapa preserva a posição independentemente de status/estado/pendência.
Status (agenda, só leitura): Programada, Reprogramada, Adiada, Cancelada, Antecipada. Exibe "Pendência" quando is_pendencia = true (selo sobre a agenda).
Estado do trabalho (execução, editável): em branco, Parcial planejado, Parcial não planejado, Benefício atingido, Concluído. Sem Pendência aqui (virou flag). Antecipado não é selecionável — é automático.

Além disso, a etapa tem a checkbox de Pendência (marca/desmarca is_pendencia).

Eixos independentes. Único par acoplado automático: Antecipada+Antecipado. Pendência é a flag is_pendencia, que só reflete no Status. Erros a evitar: pôr Pendência na coluna Etapa ou no Estado do Trabalho; juntar Status e Estado do Trabalho numa coluna só.

4. Estado Trabalho (catálogo por comportamento)

Catálogo real (confirmado no dump). Codigos entre `` são os do banco:

Valor	Encerra?	Numera?	Observação
em branco	não	sim	etapa a fazer
PARCIAL_PLANEJADO	não	sim	fez tudo que planejou para a ida
PARCIAL_NAO_PLANEJADO	não	sim	sobrou trabalho (pode ganhar etapa de resolução)
BENEFICIO_ATINGIDO	não	sim	energizável; informativo; sem programação extra. Rename de PARCIAL_PLANEJADO_BENFICIO_ATINGIDO (corrige typo)
CONCLUIDO	sim	sim	único que encerra o projeto
ANTECIPADO	(consequência)	—	gerado quando um CONCLUIDO anterior antecipa (por data)
RETIRADO	não	?	1 linha no dump; decidir manter/mapear
SUSPENSO	não	?	sem uso no dump; decidir manter/aposentar

PENDENCIA saiu do catálogo de Estado Trabalho — virou a flag is_pendencia (ver 4.2). Só CONCLUIDO encerra. BENEFICIO_ATINGIDO é um parcial informativo — não antecipa, não bloqueia, não conta na regra de "um por projeto".

4.2. Pendência — checkbox is_pendencia (fora de tudo)

Revisão final (supersede todos os modelos anteriores de pendência). Pendência deixou de ser classificação, status e Estado Trabalho. Virou uma checkbox na etapa: is_pendencia (true/false). Assim não se perde o rastreio e ela fica ortogonal a tudo.

Marcar is_pendencia = true → a coluna Status exibe "Pendência". O status de agenda (Programada/Reprogramada) continua gravado por baixo; desmarcar volta a exibi-lo.
Não toca na coluna Etapa (a etapa mantém Etapa N/Final/Única por data).
Não toca no Estado do Trabalho (que segue seu próprio eixo).
Não afeta a numeração: a etapa conta pela data como qualquer PROGRAMADA/REPROGRAMADA.
Exceção da trava de concluído: marcar/programar pendência num projeto que está CONCLUIDO é permitido sem precisar reabrir o projeto (ver seção 9). É o caminho de "voltar pra matar uma sobra" sem desfazer a conclusão.

Onde fica a checkbox (dois lugares, papéis distintos):

No formulário "Nova etapa": cria a etapa já nascendo com is_pendencia = true. É isto que aciona a exceção da trava — o backend só libera gravar numa obra CONCLUIDO se a etapa vier com pendência marcada. Sem marcar, projeto concluído bloqueia e pede reabrir.
No card da etapa: liga/desliga is_pendencia de uma etapa que já existe (rastreio).

Ponto a confirmar: ao concluir uma etapa que está com is_pendencia = true, a flag fica (rastreio histórico de que foi pendência) ou é limpa? Default proposto: fica, e o Estado Trabalho CONCLUIDO prevalece na exibição.

O vínculo resolve_pendencia_de_id (seção 7) permanece opcional, para rastreio.

4.1. Quem preenche o Estado Trabalho
Em branco: automático na criação da etapa (nada executado ainda).
PARCIAL_PLANEJADO, PARCIAL_NAO_PLANEJADO, BENEFICIO_ATINGIDO, CONCLUIDO: atualizados manualmente pelo próprio programador, com base no retorno da execução/ fiscalização. Não há papel separado — o mesmo usuário que monta a agenda é quem aponta o resultado. O sistema não infere esses valores (não sabe o que foi feito em campo). (Pendência não está aqui — virou a flag is_pendencia, ver 4.2.)
ANTECIPADO: único automático. Gerado quando um CONCLUIDO de etapa anterior antecipa a etapa (por data). Nunca é escolhido à mão.

Ou seja, o Estado Trabalho é um campo de atualização manual do programador, exceto ANTECIPADO, que é consequência automática. A permissão de atualizar o Estado Trabalho acompanha a de programar (mesmo perfil).

5. Classificação automática de etapa

Escopo (D1 confirmado): uma etapa por (projeto, data). Duas etapas no mesmo dia só em projetos diferentes. Casos de mesmo projeto + mesma data no dado legado são erro e entram na lista de correção da migração (re-datar / mesclar / cancelar).

Invariante, aplicada sobre as etapas numeráveis do projeto — as que estão no calendário (status in PROGRAMADA, REPROGRAMADA; fora ADIADA/CANCELADA/ANTECIPADA) —, ordenadas por execution_date:

text
N = etapas numeráveis do projeto (PROGRAMADA/REPROGRAMADA)
N == 0 → nada
N == 1 → ÚNICA         (number=null, unica=true,  final=false)
N >= 2 → a de maior data é FINAL (number=null, unica=false, final=true)
         as N-1 anteriores são numéricas 1..N-1 por ordem de data

A flag is_pendencia não afeta a numeração — a etapa segue PROGRAMADA/REPROGRAMADA por baixo e conta normalmente pela data. Pendência aparece só na coluna Status (selo).

Numeração é absoluta e por projeto, calculada sobre todas as etapas numeráveis do projeto (não só as visíveis num filtro):

Sempre começa em 1 por projeto (dense rank por data, sem buracos). Nunca há deslocamento (nada de "começar em 8/11" por acúmulo de contador).
A FINAL é a de maior data entre as ativas (não considerar Adiada/Cancelada/Antecipada/ Pendência ao achar "a última"; senão nenhuma ativa vira Final).
Como a numeração é do projeto inteiro, uma lista filtrada por data pode legitimamente mostrar "Etapa 8" quando as 7 anteriores estão fora da janela — isso não é bug, é a posição real no projeto. Não ajustar a numeração ao filtro. Quem quiser ver a sequência completa desde 1 abre o plano do projeto (regra de exibição, não de cálculo).

Gatilhos do recálculo (todos na mesma transação da ação):

Criar etapa (inclusive a 1ª → única; a partir da 2ª a anterior deixa de ser única).
Cancelar/adiar etapa (fecha o buraco: numéricas renumeram, FINAL migra para a nova última data numerável; N→1 vira única).
Inserir/adicionar data enquanto a final ainda não passou (hoje ≤ data da final): comportamento normal — data posterior vira a nova final; data anterior renumera.
Programar data quando a final já passou (hoje > data da final): entra como PENDENCIA (Estado Trabalho), fora da numeração; a final não muda (ver 4.2).
Concluir (antecipa a cauda numerável → sai do ativo → a concluída vira a última numerável = final).
Reabrir (restaura a cauda → volta ao número anterior; a final volta para a maior data numerável).
6. Antecipação (por data, não por número)

Correção de uma brecha da regra atual: hoje a antecipação mira etapa_number maior — mas FINAL tem etapa_number = null e nunca seria antecipada. A antecipação passa a mirar por execution_date posterior à etapa concluída, para pegar também a FINAL.

Salvar CONCLUIDO na etapa X, na mesma transação (pendências ficam de fora — são o retorno a fazer, não se antecipam):

Etapas ativas sem is_pendencia do projeto com execution_date > X.execution_date → status = ANTECIPADA, work_completion_status = ANTECIPADO, anticipated_by_id = X, guardando previous_work_completion_status e previous_operational_status.
Recalcular classificação (X passa a ser a última ativa → FINAL).
Enquanto existir CONCLUIDO ativo: bloquear criar/copiar/inserir etapa, adicionar equipe, adiar e cancelar — exceto pendência (permitida sem reabrir). Máximo um CONCLUIDO ativo por projeto.

Reabrir CONCLUIDO reverte: restaura as antecipadas por X ao estado anterior e recalcula.

7. Pendência

Decisão (D2): pendência é o Estado Trabalho PENDENCIA, mantido como no banco (não vira derivação nem some do catálogo). Ver a semântica em 4.2: é uma programação para uma data após a etapa final, fora da numeração, sem mover a final.

Quando o programador programa uma data depois da final, o Estado Trabalho já entra como PENDENCIA.
A pendência fecha quando essa programação é concluída (Estado Trabalho → CONCLUIDO na própria pendência), ou conforme o resultado da execução.
Vínculo opcional resolve_pendencia_de_id: liga a pendência à etapa parcial que a originou, quando fizer sentido, para rastreio. Não é obrigatório (no dado atual, quase nenhuma pendência tem esse vínculo).
Lista "pendências a matar" = programações em PENDENCIA ainda não concluídas.

Isso é diferente do filtro derivado "a fazer/atrasada" (ativa + data), que continua existindo para a agenda. São listas com propósitos distintos.

8. Conflito de agenda por equipe

Uma equipe não pode ter duas alocações ativas com horário sobreposto na mesma data, em qualquer projeto do tenant.

Sobreposição: inicio_A < termino_B e inicio_B < termino_A. Encostar não conta (08–12 seguido de 12–17 passa).
Só contam alocações ativas: programming_team.status = ATIVA e etapa em PROGRAMADA/REPROGRAMADA. REMOVIDA/TRANSFERIDA/ADIADA/CANCELADA/ANTECIPADA liberam a agenda.
Data retroativa não é exceção; "atrasada" é só rótulo derivado.
Dentro da mesma etapa, equipe repetida é bloqueada (duplicata pura).
A checagem cruza programming_team com execution_date + hora_inicio/termino da etapa, varrendo todas as etapas ativas da equipe.

Roda em todo ponto que aloca equipe numa data: criar plano com equipes, adicionar equipe, copiar para datas, adiar com nova data e transferir equipe. Falhou em qualquer equipe → operação inteira falha (transacional, sem gravação parcial).

9. Fluxo de cadastro (ciente do plano)

Um ponto de entrada. Ao selecionar o projeto, o formulário se adapta:

Projeto sem plano → define as primeiras etapas.
Projeto com plano → mostra as etapas existentes; datas novas entram na sequência com prévia ao vivo da renumeração.

Não há modal "novo ou abrir" — o formulário mostra o plano. Como cada projeto tem um plano único (uma data = uma etapa), não há risco de programação paralela duplicada.

Cadastro por etapa com herança: a base é preenchida uma vez; cada etapa herda; qualquer campo pode ser sobrescrito naquela etapa. A etapa nova nasce com os dados da anterior; muda-se só o que difere. Editar a base depois → ação explícita "aplicar às etapas não alteradas" (não sobrescreve o que já foi ajustado).

Checagem em duas camadas (padrão atual): prévia no cliente (não autoritativa) + validação no save via RPC transacional com lock por projeto (autoritativa: conflitos, renumeração, gravação). Guard: projeto CONCLUIDO bloqueia inserir/editar o plano até reabrir — exceto pendência: criar uma etapa com is_pendencia = true (checkbox marcada no formulário Nova etapa) é permitido sem reabrir o projeto. É a marcação de pendência no formulário que aciona a exceção; etapa comum num projeto concluído continua bloqueada.

Segunda porta: clicar numa etapa da lista → "inserir etapa" abre o mesmo editor com o projeto carregado.

10. Botões

Essenciais: Nova programação, Editar, Adicionar equipe, Remover equipe, Adiar, Cancelar programação, Concluir/Reabrir, Detalhes, Histórico, e a checkbox de Pendência na etapa.

Adiar tem dois caminhos: nova data (→ REPROGRAMADA) ou deixar em espera (→ ADIADA, sem data). Dar data a uma etapa em espera → REPROGRAMADA. O editor comum mantém a data travada — remarcar é sempre pelo Adiar.

Fundem/cortam: Reprogramar não é botão — sai do Adiar com nova data. Copiar programação é opcional; "adicionar etapa a partir desta" cobre o comum. Transferir equipe só se a operação move equipe entre etapas com frequência.

11. RPCs

Novas/alteradas, todas SECURITY DEFINER, chamadas server-side, transacionais:

reclassify_project_stages(tenant, project) — coração (esqueleto na seção 12).
save_project_programming_plan(...) — cria/edita etapas do plano com herança; chama reclassify + checagem de conflito.
insert_project_programming_stage(...) — insere no meio/depois; usa reclassify.
remove_project_programming_team(programming_team_id, expectedUpdatedAt) — marca equipe REMOVIDA; libera agenda; histórico REMOVE_TEAM.
add_project_programming_team(...) — filha nova; checa conflito.
mark_project_completed_and_anticipate(...) — conclui, antecipa por data, reclassify.
reopen_project_completed(...) — restaura antecipadas, reclassify.
postpone / cancel de etapa — passam a chamar reclassify.
12. Esqueleto de reclassify_project_stages
sql
create or replace function reclassify_project_stages(p_tenant_id uuid, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int;
begin
  -- serializa por projeto dentro da transação da ação chamadora
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0));

  -- conjunto NUMERÁVEL: no calendário (a flag is_pendencia não muda o status de agenda)
  select count(*) into v_count
  from programming
  where tenant_id = p_tenant_id
    and project_id = p_project_id
    and status in ('PROGRAMADA','REPROGRAMADA');

  -- zera classificação de quem saiu do calendário (adiada, cancelada, antecipada)
  update programming
    set etapa_number = null, etapa_unica = false, etapa_final = false
    where tenant_id = p_tenant_id and project_id = p_project_id
      and status in ('ADIADA','CANCELADA','ANTECIPADA')
      and (etapa_number is not null or etapa_unica is not false or etapa_final is not false);

  for r in
    select id,
           row_number() over (order by execution_date) as pos  -- dense rank começa em 1
    from programming
    where tenant_id = p_tenant_id
      and project_id = p_project_id
      and status in ('PROGRAMADA','REPROGRAMADA')
    order by execution_date
  loop
    if v_count = 1 then
      update programming
        set etapa_number = null, etapa_unica = true, etapa_final = false
        where id = r.id
          and (etapa_number is not null or etapa_unica is not true or etapa_final is not false);
    elsif r.pos = v_count then
      update programming
        set etapa_number = null, etapa_unica = false, etapa_final = true
        where id = r.id
          and (etapa_final is not true or etapa_number is not null or etapa_unica is not false);
    else
      update programming
        set etapa_number = r.pos, etapa_unica = false, etapa_final = false
        where id = r.id
          and (etapa_number is distinct from r.pos or etapa_unica is not false or etapa_final is not false);
    end if;

    if found then
      perform append_project_programming_history_record(r.id, 'RECLASSIFY_STAGE');
    end if;
  end loop;
end;
$$;

Notas: sem recomputar grupo (a etapa é o grupo). A guarda de ETAPA ativa (equivalente à 275) continua validando, no commit, que cada etapa ativa está em exatamente um estado válido — a invariante sempre satisfaz. A antecipação e a conclusão chamam esta função depois de mudar o conjunto ativo.

13. Regras que mudam
Antes	Depois
Linha por equipe em project_programming	programming (etapa) + programming_team (equipe) + filhas
ETAPA digitada/sugerida	Derivada por posição/data
programming_group_id deriva o grupo	Eliminado; a etapa é o grupo
Adiamento preserva FINAL	FINAL recalculado (maior data)
Cancelamento não reclassifica	Cancelar/adiar dispara reclassify
Antecipação por etapa_number maior	Por execution_date posterior (pega a FINAL)
Documentos/campos replicados por equipe + sync	Uma vez na etapa; equipes herdam
PROGRAMMING_GROUP_STAGE_MISMATCH	Removido (coerência estrutural)
Remover equipe: não existe	Status REMOVIDA + RPC
—	BENEFICIO_ATINGIDO (parcial informativo)
—	Pendência via resolve_pendencia_de_id

Não muda: RLS, escopo por tenant_id, escrita crítica só por API/RPC service-role (migration 233), concorrência por expectedUpdatedAt, histórico em project_programming_history, e a exigência de Estado Trabalho em branco para etapas interrompidas.

14. Migração de dados (principal risco)
Colapsar cada programming_group_id de project_programming em uma linha programming, usando o valor canônico (mais recente por updated_at) para os campos que deveriam estar sincronizados — mesmo critério da migration 276.
Cada linha-de-equipe → uma programming_team.
Atividades/documentos → deduplicar para a etapa.
Repontar project_programming_history para programming_id (+ team_id quando fizer sentido).
Auditoria read-only antes, no padrão dos docs; nada de backfill sem conferir divergências.
15. Checklist de validação

Classificação:

1 etapa → única; 7 etapas → 1..6 + final.
Cancelar do meio renumera fechando o buraco; final segue a maior data.
Cancelar a final promove a penúltima; N→1 vira única.
Inserir entre datas renumera; inserir depois da final move a final.
Concluir a 5ª de 7 → 6ª e 7ª antecipadas, 5ª vira final; reabrir reverte.
Reclassify é atômico; falha faz rollback total.

Eixos e Estado Trabalho:

ADIADA/CANCELADA limpam Estado Trabalho.
BENEFICIO_ATINGIDO não antecipa, não bloqueia, não conta como encerramento.
Só um CONCLUIDO ativo por projeto; antecipação pega a FINAL (por data).

Equipe e agenda:

Mesma equipe, mesma data, horário sobreposto, projetos diferentes → bloqueia.
Horários encostados (08–12 / 12–17) → aceita.
Data retroativa checa conflito igual.
Remover equipe libera a agenda; remover a última deixa a etapa sem equipe (não cancela).

Cadastro:

Selecionar projeto com plano mostra as etapas; inserir data renumera na prévia.
Base herdada por todas; override por campo por etapa; editar base pergunta antes de aplicar.
Projeto CONCLUIDO bloqueia inserir/editar plano.
16. Importação em massa por Excel (melhoria)

Objetivo: cadastrar várias etapas (e suas equipes) de uma vez a partir de uma planilha. Reaproveita o padrão de import XLSX existente (import_project_forecast), mas com arquitetura estágiada em vez de leitura-e-gravação direta.

16.1. Formato da planilha

Uma linha por etapa. Colunas (todos os campos de cadastro da etapa): projeto_sob, data_execucao, periodo, hora_inicio, hora_termino, sgd_tipo, num_eq_numero, num_eq_tipo, equipes, descricao_servico, alimentador, campo_eletrico, desligamento_inicio, desligamento_fim, apoio, apoio_item, poste, estrutura, trafo, rede (km/m), clientes_afetados, anotacao.

Não vão na planilha (derivados/automáticos): classificação de etapa (etapa_number/unica/final), status (entra como PROGRAMADA) e work_completion_status (nasce em branco).

Herança: célula vazia herda a base/projeto; célula preenchida sobrescreve só naquela etapa — mesmo comportamento da tela, para não repetir tudo em toda linha.

Atividades e documentos (filhas com múltiplos itens) ficam numa aba separada ou entram pela tela depois; fora do escopo da v1 do template.

16.2. Equipes (muitas por etapa)

Uma etapa pode ter N equipes. Duas formas aceitas, ambas colapsam no mesmo resultado:

Forma A (recomendada): 1 linha por etapa; coluna equipes com nomes separados por ; (MK1; MK3; MK5; MK7). Escala para qualquer quantidade.
Forma B: 1 linha por equipe; linhas com mesmo projeto+data são agrupadas numa etapa (o cadastro precisa bater entre elas, senão é erro).

Regras: equipe repetida é colapsada (não é erro); nome de equipe inexistente no tenant é erro na linha; equipes vazio é permitido (etapa planejada sem alocar).

16.3. Agrupamento e validação
projeto + data = uma etapa (uma data = uma etapa). Linhas com cadastro divergente para a mesma data → erro.
Casamento por chave natural (sempre): com ou sem ID na linha, o import verifica se projeto SOB + data já existe. Existe → atualiza a etapa e reconcilia equipes; não existe → cria. Ausência de ID nunca significa "inserir como novo" — evita duplicata (D1).
Validações (as mesmas da tela): projeto existe e não está CONCLUIDO, tenant, permissão de import, conflito de agenda por horário por equipe (dentro do lote e contra o banco), campos coerentes.
Conflito por equipe, dois modos:
Estrito: qualquer equipe em conflito reprova a etapa inteira até corrigir.
Tolerante: cria a etapa com as equipes válidas e lista as recusadas com o motivo.
16.4. Arquitetura estágiada

Duas fases, separando validar de gravar:

Fase 1 — subir e validar:

Upload do arquivo bruto para o Storage (bucket).
Processador (Edge Function) lê do storage e escreve nas tabelas de staging:
import_job: id, tenant_id, user, page_key, file_path, status (uploaded/validating/validated/committing/committed/failed), contadores.
import_row: import_job_id, row_number, payload bruto (jsonb), campos parseados, project_id/team_ids resolvidos, validation_status, errors (jsonb).
Prévia/dry-run lê do import_row — mostra o que será criado e os erros por linha, sem tocar no banco final.

Fase 2 — confirmar e gravar: 4. Ao confirmar, o commit lê as linhas válidas, agrupa por projeto e, numa transação por projeto (lock por projeto): cria programming + programming_team + atividades, roda reclassify_project_stages e revalida conflitos como última barreira. 5. Estampa import_batch_id nas linhas criadas; import_job → committed. Relatório final: criados / ignorados / erros.

Benefícios sobre o modelo direto: arquivo guardado (auditoria/reprocessamento), erros persistidos e revisáveis sem re-upload, planilha grande não morre numa requisição (processo em lote/fila, sem estourar tempo/memória da Edge Function), e idempotência por import_batch_id (reenviar não duplica; chave natural projeto+data decide ignorar/atualizar/barrar).

Escrita crítica continua só por service role, com RLS e tenant; nada é gravado direto por authenticated (migration 233).