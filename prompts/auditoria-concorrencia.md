# Auditoria de Concorrência, Consistência Transacional e Conflitos de Estado

Use este procedimento quando o usuário pedir auditoria de concorrência, "duas ações ao mesmo tempo no mesmo registro", lost update, condição de corrida, idempotência, ou perguntar o que acontece quando dois usuários/processos/abas alteram a mesma entidade simultaneamente. No formato de blocos de [`gerar-prompt.md`](gerar-prompt.md).

<papel>
Você é uma IA atuando como auditora de concorrência, consistência transacional e máquina de estados numa aplicação Next.js multi-tenant sobre Postgres/Supabase. Seu trabalho não é constatar "existe `FOR UPDATE`" e parar — é responder, para cada entidade mutável com mais de uma ação de escrita, uma pergunta central:

**Para cada entidade mutável do sistema, simule duas operações concorrentes incompatíveis e prove que não existe sobrescrita silenciosa, transição inválida de estado, efeito duplicado ou perda de dados. Identifique também se a proteção ocorre atomicamente no banco ou depende de validação feita antes no backend.**

Auditar não é só usuário × usuário. Inclui usuário × importação, usuário × rotina automática/job e operação × retry HTTP — conflitos que costumam passar batido porque não têm dois humanos clicando ao mesmo tempo.
</papel>

<contexto>
Confirme tudo no repositório antes de assumir — não presuma que o cenário abaixo continua válido:
- Next.js 16 (App Router), TypeScript, `@supabase/supabase-js`, Vercel. SaaS multi-tenant: `tenant_id` em toda tabela de negócio, RLS ativa, `resolveAuthenticatedAppUser` no servidor.
- **Verificar explicitamente qual cliente Supabase cada rota usa.** A maioria das rotas de escrita deste projeto usa `getSupabaseAdmin()` (`service_role`), fora de RLS — nesse caso a proteção de concorrência não pode depender de policy, tem que estar na query/RPC em si.
- O padrão já estabelecido no repositório para módulos corrigidos (`medicao`, `medicao-asbuilt`, `programacao-normalizada`, `projects`, `people`, `teams`, `materials`, `activities`, `job-titles`, `composicao-equipe`, `controle-apr`, `faturamento`, entre outros) é RPC `SECURITY DEFINER` com `SELECT ... FOR UPDATE` + `p_expected_updated_at` obrigatório, retornando `{ success:false, status:409, reason:'CONCURRENT_MODIFICATION' }` no conflito. **Não é o único jeito correto** — um `UPDATE` condicionado a `.eq("status", X).eq("updated_at", lido)` já executado pelo client `service_role` (fora de RLS) também fecha a corrida sem precisar de RPC nova; foi a correção aplicada em `cronograma-solicitacoes` em 2026-08-15 (ver `<exemplos>`). A auditoria deve reconhecer os dois padrões como válidos e só cobrar RPC quando a regra de negócio precisar mesmo de transação com múltiplas tabelas.
- `guias/guia_backend.md` regra 14 já exige `expectedUpdatedAt`/`version` obrigatório e 409 com `currentRecord`, `currentUpdatedAt`, `updatedBy`, `changedFields`. `guias/guia_sql.md` regra 10 já exige `UNIQUE`/`EXCLUSION constraint` ou `advisory lock`/`SELECT FOR UPDATE` para concorrência — nunca só checagem otimista no Node. Todo achado desta auditoria deve ser lido à luz dessas regras já documentadas, não como descoberta nova.
- Não há script `test`. Validação de front/UI é manual.
</contexto>

<escopo>
**Dentro:** ler, mapear, simular mentalmente as corridas, classificar por risco e relatar. Produzir migration/RPC/handler SOMENTE se o usuário autorizar explicitamente a etapa de correção.
**Fora:** reescrever em RPC um módulo que já é atômico via `UPDATE` condicionado só por preferência estética; impor uma regra universal de "ação X sempre vence ação Y" sem matriz de precedência por entidade; testes de carga/chaos em produção.
</escopo>

<arquivos_a_inspecionar>
```
src/app/api/**/route.ts          rotas PUT/PATCH/DELETE e mudança de status
src/server/modules/**/handlers.ts, queries.ts   regra de negócio e acesso a dado
src/lib/server/**                helpers de escrita compartilhados (ex.: stockRequisitions.ts, stockTransfers.ts)
supabase/migrations/*.sql        RPCs SECURITY DEFINER, procurar "for update", "for no key update", constraints UNIQUE/EXCLUSION, advisory lock
src/modules/dashboard/**         tratamento de 409 no frontend, mensagens de conflito, o que acontece com o formulário do usuário que perde a corrida
```
Produza um mapa de: entidade → ações de escrita que ela sofre → endpoint/handler → RPC (se houver) → tabela(s) envolvida(s).
</arquivos_a_inspecionar>

<guias_obrigatorios>
`guias/guia_backend.md` (regras 11-18, escrita/transação/concorrência), `guias/guia_sql.md` (regras 6-10, constraints/índices/concorrência), `guias/guia_validacao.md`. Divergência entre guia e código segue a seção 12 do `CLAUDE.md`: reportar, nunca resolver em silêncio.
</guias_obrigatorios>

<regras_de_negocio>
**Severidade:**
- **CRÍTICO** — sobrescrita silenciosa comprovável (nenhuma das duas requisições recebe erro) em entidade financeira, de estoque ou que dispara efeito colateral irreversível; transição de estado que o negócio proíbe e o banco permite (ex.: `CANCELADO → FECHADO`).
- **ALTO** — padrão `SELECT` em memória → regra em JS → `UPDATE` sem `WHERE` condicionado a versão/status, em entidade crítica, mesmo sem prova ainda de incidente real; ação não idempotente em fluxo financeiro/estoque sujeito a duplo clique ou retry.
- **MÉDIO** — proteção atômica existe (lock ou `WHERE` condicional) mas o 409 é genérico: não diz quem alterou, não devolve `currentRecord`, formulário do usuário é apagado sem opção de recuperar o que ele digitou.
- **BAIXO** — falta idempotência em ação não crítica (ex.: reenvio de notificação); lock protege só a linha principal quando itens filhos também deveriam entrar na mesma unidade de consistência, mas o filho não tem regra própria de concorrência que dependa disso.
- **INFORMATIVO** — hipótese que exige teste manual de duas abas para confirmar.

**Confiança:** Alta (rastreado no código até o `UPDATE`/RPC final e confirmado no schema) / Média (padrão do handler sugere o problema, mas depende de comportamento do driver/Postgres não testado) / Baixa (suspeita por analogia com outro módulo, não lida no código desta entidade).
</regras_de_negocio>

<restricoes>
**Nunca aceitar como evidência suficiente:**
- "A rota usa RPC" — sem confirmar que a RPC específica tem `SELECT ... FOR UPDATE`/`UPDATE ... WHERE` condicional e não só grava direto.
- "Tem `expectedUpdatedAt` no payload" — sem confirmar que o backend **rejeita** quando ausente (opcional não é proteção, é sugestão).
- "Tem checagem de status" — sem confirmar que a checagem está na MESMA operação atômica que o `UPDATE`, não numa leitura anterior separada por uma janela de tempo.

**Nunca propor como correção universal:**
- "Edição sempre tem prioridade sobre cancelamento" como regra genérica — priorização é decisão de negócio por entidade (ver `<matriz_de_precedencia>`); existem casos em que cancelamento tem que vencer.
- Reescrever em RPC/PL-pgSQL um handler que já pode ficar atômico com `UPDATE ... WHERE status = X AND updated_at = Y` executado pelo client `service_role` — RPC nova é justificada quando a operação precisa gravar em mais de uma tabela na mesma transação, não por preferência.
- Apagar o formulário do usuário que perde a corrida sem alternativa — a correção de UX mínima é mostrar quem alterou e permitir recarregar ou reaplicar, não só travar o botão.
</restricoes>

<plano_de_execucao>
**Etapa 0 — Reconhecimento.** Confirmar qual cliente Supabase cada domínio usa (`service_role` vs. token do usuário) — isso decide se RLS entra como camada de proteção ou é irrelevante ali. Listar os módulos já auditados/corrigidos (ver `<contexto>`) para não duplicar trabalho.

**Etapa 1 — Mapear entidades mutáveis.** Toda tela que tem **edição + pelo menos uma ação que muda estado** (cancelar, concluir, excluir, aprovar, reabrir, transferir, encerrar, verificar) entra na auditoria. Usar `<telas_prioritarias>` como ponto de partida, mas varrer `src/app/api/**` e `src/server/modules/**` por conta própria — a lista é um piso, não um teto.

**Etapa 2 — Para cada entidade, rodar os 7 pontos.** Ver `<checklist_obrigatoria>`. Não pular nenhum ponto mesmo quando o primeiro já parecer "protegido" — lock na linha principal não implica atomicidade multi-tabela, e atomicidade não implica idempotência.

**Etapa 3 — Simular a matriz de cenários concorrentes.** Ver `<matriz_de_cenarios>`. Para cada combinação aplicável à entidade (nem toda entidade tem "aprovar × reprovar", por exemplo), descrever o que o código faz hoje, não o que deveria fazer.

**Etapa 4 — Montar a matriz de relatório.** Ver `<matriz_de_relatorio>`. Uma linha por combinação entidade + par de ações, não uma linha por tela.

**Etapa 5 — Priorizar e relatar.** Achados por severidade, com o que já está correto listado explicitamente (auditoria que só acusa não orienta).

**Etapa 6 — Correção controlada (só com autorização explícita).** Uma entidade por vez. Preferir `UPDATE` condicionado quando a escrita já é `service_role` e a regra cabe numa tabela; RPC com `FOR UPDATE` quando envolve múltiplas tabelas na mesma transação. Toda correção de backend que devolve 409 enriquecido (`currentRecord`/`updatedBy`/`changedFields`) deve ter contrapartida no frontend — não deixar o payload novo invisível para o usuário.
</plano_de_execucao>

<checklist_obrigatoria>
Verificar os **7 pontos**, para cada entidade mutável, marcando confirmado / não confirmado / não aplicável:

**1. Lost update / controle de versão.** Toda alteração crítica responde "estou alterando exatamente a versão que o usuário carregou?". Procurar `updated_at`/`version`/`revision`/`expectedUpdatedAt`/`expectedVersion` e confirmar que são **obrigatórios**, não opcionais (`if (expectedUpdatedAt && ...)` é o antipadrão — só valida se o cliente decidir mandar). `UPDATE ... WHERE id = X` sem condição de versão que afetar 0 linhas quando a versão não bate deve devolver 409 `CONCURRENT_MODIFICATION`, nunca sucesso silencioso.

**2. Atomicidade da operação.** Procurar o padrão perigoso `SELECT` → regra em JavaScript → `UPDATE`, com uma janela real entre leitura e escrita onde outra requisição pode intercalar. Marcar como achado sempre que a validação de status/versão acontece numa consulta separada do `UPDATE` final, sem que o próprio `UPDATE` repita a condição no `WHERE` (ou sem `SELECT ... FOR UPDATE` dentro da mesma transação). O ideal é `BEGIN → SELECT FOR UPDATE → validar → UPDATE → COMMIT` ou uma única operação condicional atômica (`UPDATE ... WHERE <condição de estado e versão>`, checando linhas afetadas).

**3. Máquina de estados.** Não basta impedir duas ações simultâneas — verificar que só transições de estado permitidas são aceitas. Procurar endpoints que fazem `status = requestedStatus` direto, sem checar o status atual contra uma tabela/lista de transições válidas. `estado atual + ação solicitada` deve resultar em `estado permitido` ou erro explícito — nunca em atribuição incondicional.

**4. Prioridade entre ações — matriz de precedência, não regra universal.** Não aceitar "edição sempre vence" como conclusão pronta. Para cada par de ações conflitantes da entidade, documentar a regra desejada (ver `<matriz_de_precedencia>`). A regra mínima aceitável, na ausência de regra de negócio explícita: nenhuma ação destrutiva ou de mudança de estado pode invalidar silenciosamente uma edição baseada em versão anterior — quem perde a corrida recebe conflito explícito, mesmo que a regra de negócio determine que a outra ação deveria vencer.

**5. Locks — mecanismo e escopo.** Identificar `FOR UPDATE`, `FOR NO KEY UPDATE`, advisory lock, CAS/versionamento, lock de aplicação. Depois verificar o **escopo real**: se a operação grava também em itens filhos, histórico, saldo ou estoque, travar só a linha principal pode não bastar. Perguntar explicitamente qual é a unidade real de consistência da operação (ex.: "medição + itens da medição" pode precisar ser uma única unidade transacional) e se o código atual trata como tal.

**6. Idempotência.** Problema distinto de concorrência entre usuários: o mesmo usuário/cliente executando a mesma operação duas vezes (duplo clique, timeout com retry do frontend, retry de proxy). Pergunta central: "se eu executar exatamente a mesma requisição duas vezes, o segundo request causa efeito adicional?". Fiscalizar prioritariamente ações financeiras, de estoque, de medição e de criação de movimentos. Se a resposta for sim, é achado — não presumir que "o botão fica desabilitado durante o request" resolve, porque não cobre retry de rede nem duas abas.

**7. UX do conflito.** Não é suficiente devolver 409. Verificar o que a tela faz com ele: mostra quem alterou, quando, quais campos mudaram e o estado atual? Oferece recarregar/comparar/reaplicar, ou simplesmente apaga o formulário do usuário? Tratar "409 sem informação nenhuma para o usuário" como achado de MÉDIO mesmo quando o backend está correto.
</checklist_obrigatoria>

<matriz_de_cenarios>
Para cada entidade, aplicar as combinações relevantes (nem toda entidade tem todas):

| Cenário concorrente | O que verificar |
|---|---|
| Editar × Editar | Um usuário consegue sobrescrever silenciosamente o outro? |
| Editar × Cancelar | Cancelamento pode invalidar edição em andamento sem avisar? |
| Editar × Excluir | A edição consegue recriar/alterar algo já excluído? |
| Editar × Concluir | Edição consegue alterar registro depois de concluído? |
| Cancelar × Concluir | Qual estado ganha? Existe regra determinística, ou é corrida? |
| Cancelar × Reabrir | Pode terminar em estado incorreto (ex.: cancelado E reaberto)? |
| Aprovar × Reprovar | Há corrida entre decisões opostas sobre o mesmo registro? |
| Salvar × Salvar | Há lost update (segundo save apaga campos do primeiro)? |
| Duplo clique | A mesma ação pode executar duas vezes com efeito duplicado? |
| Retry HTTP × ação original | A operação é idempotente? |
| Aba antiga × registro atualizado | Existe detecção de dado obsoleto (stale) antes de salvar? |
| Importação × edição manual | Importação consegue sobrescrever trabalho humano em andamento? |
| Automação/job × usuário | Rotina em background pode disputar com operação manual? |

Adicionar outras combinações específicas da entidade quando existirem (ex.: "atender requisição × cancelar requisição" em estoque).
</matriz_de_cenarios>

<matriz_de_precedencia>
Para entidades com mais de uma ação de mudança de estado, produzir uma tabela assim (exemplo ilustrativo, adaptar por entidade real):

| Ação A | Ação B | Regra desejada |
|---|---|---|
| Editando | Cancelar | Cancelamento não pode destruir edição silenciosamente |
| Editando | Fechar/Concluir | Detectar conflito, não sobrescrever |
| Editando | Editando | Segundo save detecta versão antiga |
| Cancelar | Fechar/Concluir | Apenas uma operação vence, por regra explícita da entidade |
| Fechar | Reabrir | Segunda operação precisa conhecer o novo estado antes de agir |

A regra "quem perde recebe conflito explícito" é o piso não-negociável; qual ação **deveria** vencer por regra de negócio é decisão específica de cada entidade, não uma constante do sistema.
</matriz_de_precedencia>

<telas_prioritarias>
Regra de entrada: qualquer tela com mais de uma ação de escrita sobre a mesma entidade entra na auditoria. Prioridade máxima para as que combinam edição + mudança de status, edição + exclusão, movimentação financeira, movimentação de estoque, aprovação/reprovação, cancelamento/reabertura, processamento em lote ou automação concorrendo com usuário. Ponto de partida conhecido neste repositório (confirmar se a lista mudou antes de assumir): Medição, Medição As Built, Faturamento, Programação (Normalizada), Cronograma de Solicitações, Projetos, Requisições de Estoque, Entrada/Transferência de Estoque, Transferências de Equipe, Composição de Equipe, Controle de APR, Cadastros com ativar/inativar (Materiais, Pessoas, Cargos, Equipes), Endereçamento de Armazém, Posições de Trafo, qualquer fluxo de importação em lote. Não é lista fechada — varrer o repositório confirma ou adiciona.
</telas_prioritarias>

<matriz_de_relatorio>
Não aceitar como entrega "Tela X está protegida com FOR UPDATE". O relatório final é uma tabela, uma linha por combinação entidade + par de ações, com estas colunas obrigatórias:

| Coluna | Conteúdo |
|---|---|
| Tela | Nome da tela/módulo |
| Entidade | Tabela/registro principal |
| Ação A / Ação B | Par de ações do cenário simulado |
| Endpoint envolvido | `src/app/api/.../route.ts` |
| RPC envolvida | Nome da função SQL, ou "nenhuma (UPDATE direto)" |
| Tabela(s) envolvida(s) | Todas as tabelas tocadas pela operação |
| Transação? | Sim/Não — se sim, onde começa e termina |
| FOR UPDATE / lock? | Tipo de lock, ou "nenhum" |
| expectedUpdatedAt/version? | Obrigatório / opcional / ausente |
| Validação do estado atual? | Na mesma operação atômica, ou em leitura separada |
| Idempotência? | Confirmada / não confirmada / não aplicável |
| Retorno HTTP de conflito? | Código e `reason` devolvidos |
| Frontend trata 409? | Sim/Não e como |
| Há perda do formulário? | Sim/Não |
| Há audit log? | Sim/Não, onde |
| `updated_by` disponível? | Sim/Não |
| Resultado da corrida (hoje) | O que realmente acontece, medido no código |
| Risco | 🔴 Crítico / 🟡 Médio / 🟢 Protegido |
| Correção proposta | Ou "—" quando já está correto |
</matriz_de_relatorio>

<criterios_de_aceite>
- Toda entidade com mais de uma ação de escrita foi mapeada, não amostrada.
- Cada achado tem: entidade, par de ações, evidência com arquivo:linha, severidade, confiança, qual dos 7 pontos falhou, e como validar manualmente (duas abas).
- Nenhuma entidade classificada como "protegida" sem confirmar atomicidade (ponto 2) e não só a existência de lock (ponto 5).
- Nenhuma recomendação de "prioridade universal" entre ações — toda recomendação de precedência é por entidade, com justificativa de negócio.
- O que já está correto está explicitamente listado, com o mecanismo que o protege (RPC+FOR UPDATE, ou UPDATE condicionado por status+updated_at).
- Limitações declaradas: quais cenários não foram testados manualmente (duas abas reais) e ficaram só em análise estática.
</criterios_de_aceite>

<validacoes>
`npx tsc --noEmit`; `npm run lint` (inclui `lint:size` — se a correção crescer arquivo já no baseline, usar `npm run lint:size:accept -- <caminho>`); `npm run build` (se afetar rota/build). Front/UI é manual: abrir a mesma entidade em duas abas/sessões, disparar o par de ações do cenário quase ao mesmo tempo, confirmar que quem perde recebe conflito explícito (não sucesso silencioso) e que o formulário não é apagado sem alternativa.
</validacoes>

<documentacao>
Atualizar `/docs/<Tela>.txt` de cada tela corrigida (seção "Atualizacao YYYY-MM", mapeando arquivos/funções tocadas e comportamento antes/depois) e `TASKS.md`. Se o achado revelar que um guia já deveria ter pego isso e não pegou, seguir a seção 12 do `CLAUDE.md` — reportar a divergência e, se confirmada, atualizar o guia na mesma tarefa.
</documentacao>

<entrega>
Resumo executivo (quantas entidades auditadas, quantas protegidas, quantas com achado); matriz de relatório completa; matriz de precedência por entidade com achado; achados por severidade com evidência; plano de correção priorizado; o que já está correto listado explicitamente; limitações da auditoria.

Ao final, conforme a seção 11 do `CLAUDE.md`: resumo do que mudou, validações executadas, texto do commit em 6 seções (`guias/guia_git.md`), e a pergunta **"Confirma que posso aplicar/fechar essas mudanças?"**.
</entrega>

<exemplos>
**Precedente real deste repositório (2026-08-15):** auditoria disparada por dúvida sobre a tela de Medição ("se um usuário edita e outro cancela ao mesmo tempo") varreu 20+ módulos de escrita. Achado: quase todos já usavam RPC com `SELECT ... FOR UPDATE` + `expectedUpdatedAt` obrigatório (🟢, ponto 1 e 2 confirmados) — a lacuna real era o ponto 7 (UX do conflito): o 409 devolvia só `{ message, reason }`, sem `currentRecord`/`updatedBy`. Único módulo 🔴 de verdade: Cronograma de Solicitações (`src/server/modules/cronograma-solicitacoes/handlers.ts`) — fazia `SELECT` em memória + `UPDATE` sem `WHERE` condicionado a `status`/`updated_at` (ponto 2 falhou) e `expectedUpdatedAt` era opcional (ponto 1 falhou). Correção: `UPDATE` passou a levar `.eq("status", "PENDENTE").eq("updated_at", current.updated_at)`, sem precisar de RPC nova (a escrita já era `service_role`, fora de RLS). Ver `docs/Tela_Cronograma_Solicitacoes_SaaS.txt` e `docs/Tela_Medicao_SaaS.txt`, seção "Atualizacao 2026-08-15", e `TASKS.md` para o texto completo.

**Antipadrão do ponto 2 (atomicidade), forma genérica:**
```ts
const current = await supabase.from("tabela").select("*").eq("id", id).single();
if (current.status === "PENDENTE") {
  await supabase.from("tabela").update({ status: "CANCELADO" }).eq("id", id);
}
```
Entre o `select` e o `update` outra requisição pode ter mudado `status`. Correção mínima sem transação nova: `update(...).eq("id", id).eq("status", "PENDENTE").eq("updated_at", current.updated_at)` e checar se alguma linha foi afetada.

**Antipadrão do ponto 3 (máquina de estados):** endpoint de troca de status que faz `update({ status: body.status })` aceitando qualquer valor do payload, sem lista de transições permitidas — permite `CANCELADO → FECHADO` se o cliente mandar esse valor, mesmo que a regra de negócio nunca preveja isso.
</exemplos>

<notas>
- "Existe `FOR UPDATE`" é o começo da auditoria, não o fim — sempre completar os 7 pontos.
- Prioridade entre ações é decisão de negócio por entidade; a auditoria propõe a matriz, não decide sozinha qual ação vence.
- Idempotência (mesmo usuário, duplo clique/retry) é um problema diferente de concorrência (dois usuários) — os dois entram na auditoria, não são intercambiáveis.
- Correção de 409 sem contrapartida no frontend é correção incompleta: o payload enriquecido só tem valor se a tela mostrar quem alterou o registro.
</notas>
