# Auditoria de Performance — Disk I/O em PostgreSQL/Supabase

Use este procedimento quando o usuário pedir auditoria de performance de banco, investigação de **High Disk I/O**, uso alto de memória, consultas lentas, índices, escalabilidade ou custo de Supabase neste repositório. No formato de blocos de [`gerar-prompt.md`](gerar-prompt.md).

<papel>
Você é uma IA atuando como auditora de performance de PostgreSQL/Supabase, arquitetura de dados e consumo de I/O numa aplicação Next.js multi-tenant. Seu trabalho não é listar queries "feias" — é separar: causa raiz comprovada por medição; causa provável por evidência estática; custo aceito conscientemente; e falso positivo.

**Regra principal: não criar, alterar ou remover índice, RPC, view ou query sem apresentar evidência, plano de execução antes/depois, impacto na escrita e forma de validação.**

**Regra do alvo: o alvo é o custo acumulado (`total_exec_time`), não a query mais lenta.** Uma query de 2 s × 10 execuções custa menos que uma de 150 ms × 100.000 execuções.
</papel>

<contexto>
Confirme tudo no repositório antes de assumir — não presuma que o cenário abaixo continua válido:
- Next.js 16 (App Router), TypeScript, React 19, `@supabase/supabase-js`, `@tanstack/react-query`, Vercel.
- SaaS multi-tenant: `tenant_id` nas tabelas de negócio, RLS ativa, resolução de usuário/tenant no servidor, header `x-tenant-id`.
- Migrations versionadas em `supabase/migrations/`; Edge Functions em `supabase/functions/`.
- **Verificar explicitamente qual cliente Supabase as rotas usam.** Se as rotas usam `service_role`, RLS é bypassada e **não** está no caminho quente — isso rebaixa todo achado de policy de ALTO para INFORMATIVO. Se usam o token do usuário, RLS volta a ser ALTO. Esta verificação muda a prioridade da auditoria inteira e deve ser a primeira coisa checada.
- Não há script `test`. Validação de front/UI é manual.

As 3 causas raiz que a documentação da Supabase aponta para High Disk I/O, e que organizam toda a auditoria:
1. **Uso alto de memória fazendo swap para disco** — medir por `temp_blks_read`/`temp_blks_written` e `Sort Method: external merge`.
2. **Cache hit baixo**, obrigando o PostgreSQL a buscar dados no armazenamento — medir por `shared_blks_hit / (shared_blks_hit + shared_blks_read)`; alvo ≥ 99%.
3. **Queries lentas** — a documentação chama atenção especificamente para queries acima de **~1 segundo**.
</contexto>

<escopo>
**Dentro:** ler, mapear, medir, classificar e relatar. Produzir migrations/RPCs SOMENTE se o usuário autorizar explicitamente a Etapa 6.
**Fora:** aplicar índice em lote sem medição; `DROP INDEX` sem confirmar `idx_scan` numa janela representativa; `REFRESH MATERIALIZED VIEW` ou qualquer comando de escrita em produção; alterar `work_mem`/parâmetros do servidor; recomendar upgrade de instância como primeira resposta.
</escopo>

<arquivos_a_inspecionar>
```
src/app/api/**/route.ts          API Routes
src/server/modules/**            controllers, handlers, queries
src/lib/server/**                helpers com acesso a banco
src/modules/dashboard/**         PageViews, hooks, paginação, refetch
src/lib/react-query/**           staleTime, refetchInterval, refetchOnWindowFocus
supabase/migrations/*.sql        índices, RLS, funções, views, triggers
supabase/functions/**            Edge Functions
scripts/supabase-monitoring-readonly.sql          ← já existe, NÃO reescrever
scripts/supabase-report-*.txt                     ← relatório para Supabase Reports
scripts/supabase-log-explorer-monitoring.sql      ← PostgREST / Edge Functions
Auditoria/*.md                                    ← auditoria anterior, se houver
```
Produza um mapa de: página → API/RPC → tabela(s) → filtros → índices existentes → índice recomendado → risco.
</arquivos_a_inspecionar>

<guias_obrigatorios>
`guias/guia_backend.md`, `guias/guia_frontend.md`, `guias/guia_sql.md`, `guias/guia_supabase.md`, `guias/guia_validacao.md`. Todo achado deve ser lido à luz das regras já documentadas nesses guias — um `.select('*')` encontrado aqui é o mesmo problema que `guia_backend.md` já proíbe. Divergência entre guia e código segue a seção 12 do `CLAUDE.md`: reportar, nunca resolver em silêncio.
</guias_obrigatorios>

<regras_de_negocio>
**Severidade:**
- **CRÍTICO** — I/O que já degrada produção; query > 1 s em rota de uso diário; spill para disco recorrente; teto silencioso de linhas que produz número errado no dashboard.
- **ALTO** — consulta frequente sem índice compatível; rota que carrega milhares de linhas para agregar em JavaScript; N+1 real em rota quente; import registro a registro.
- **MÉDIO** — índice duplicado/redundante; `ORDER BY` sem índice em volume moderado; paginação por `OFFSET` profundo; write amplification.
- **BAIXO** — colunas a mais no `SELECT`; índice inútil em tabela pequena; round-trip evitável de baixa frequência.
- **INFORMATIVO** — suspeita que exige medição para confirmar.

**Confiança:** Alta (evidência direta e reproduzível) / Média (forte indicação) / Baixa (hipótese). Nunca recomendar `DROP INDEX` definitivo com confiança baixa.

Para cada achado informar: arquivo e linha (ou objeto de banco); categoria; padrão de filtro real; índice atual; índice recomendado; qual das 3 causas raiz ataca; impacto na escrita; como validar; nível de confiança.
</regras_de_negocio>

<restricoes>
**Nunca tratar como achado automático:**
- `Seq Scan` — em tabela pequena é o plano ótimo. Confirmar `n_live_tup` antes de chamar de problema. `Seq Scan` só é achado em tabela grande com consulta seletiva.
- Índice rotulado "unused" por advisor ou com `idx_scan = 0` numa janela curta — pode ser de fechamento de mês, importação anual ou constraint.
- Índice `UNIQUE` com `idx_scan = 0` — existe para a constraint, não para leitura. **Nunca remover por esse motivo.**
- Chunking de `IN (...)` em blocos de 100/200/500 — é `⌈N/tamanho⌉` consultas para contornar limite de URL do PostgREST, **não** é N+1.

**Nunca fazer:**
- Criar índice em lote com base só em análise estática. Cada índice custa escrita e WAL em toda a tabela, permanentemente.
- Remover índice que sustenta constraint de unicidade ou regra de negócio.
- Propor materialized view quando o filtro do usuário é livre (datas arbitrárias, equipe, projeto) — matview não parametriza; nesse caso é RPC.
- Recomendar upgrade de instância antes de esgotar índice, agregação no banco e redução de linhas trafegadas.
- Executar comando de escrita em produção. `EXPLAIN ANALYZE` de `INSERT`/`UPDATE`/`DELETE` só dentro de `begin; … rollback;`.
- Reescrever `scripts/supabase-monitoring-readonly.sql` — ele já cobre o Nível B. Usar e estender.
</restricoes>

<plano_de_execucao>
**Etapa 0 — Reconhecimento.** Confirmar versões em `package.json`. Identificar qual cliente Supabase as rotas usam (`service_role` vs. token do usuário) — isso define se RLS entra na auditoria. Verificar se `Auditoria/` já existe com auditoria anterior a atualizar em vez de duplicar. Verificar se `scripts/supabase-monitoring-readonly.sql` existe.

**Etapa 1 — Nível A, análise estática.** Sem tocar produção. Percorrer a checklist obrigatória de 21 itens (abaixo). Extrair de `supabase/migrations/` o estado **vivo** dos índices, aplicando `CREATE INDEX` e `DROP INDEX` em ordem de migration — não o acumulado histórico, que superconta. Produzir o mapa `página → API → tabela → filtros → índice atual → recomendado → risco`.

**Etapa 2 — Nível B, queries reais.** Confirmar `pg_stat_statements`. Rodar o script de monitoramento existente. Coletar por query: `total_exec_time`, `mean_exec_time`, `calls`, `rows`, `shared_blks_hit`, `shared_blks_read`, `temp_blks_read`, `temp_blks_written`. Ordenar por `total_exec_time` e calcular `pct_do_tempo_total`. Cruzar cada rota de risco do Nível A com sua query real — a coluna `rows/call` confirma ou derruba o achado estático.

**Etapa 3 — Nível C, EXPLAIN.** Só para as candidatas eleitas pela Etapa 2. `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)`. Rodar duas vezes (cache frio e quente). Registrar plano/tempo/buffers antes, aplicar a correção proposta, registrar depois. **Veredito `REVERTER` é resultado legítimo** e deve ser documentado — índice que não muda plano é custo de escrita sem contrapartida.

**Etapa 4 — Nível D, arquitetura.** Contar consultas por rota e tabelas repetidas dentro da mesma rota. Identificar dashboards que fazem N consultas para N cards sobre as mesmas tabelas. Propor RPC única de agregação ou materialized view, conforme o critério de decisão. Verificar `staleTime`/`refetchInterval`/`refetchOnWindowFocus` e chamadas duplicadas por React/Next. Verificar imports registro a registro. **Procurar primeiro se o repositório já tem esse padrão resolvido em outro módulo** — estender padrão existente tem risco muito menor que introduzir arquitetura nova.

**Etapa 5 — Relatório.** Gerar/atualizar os `.md` em `Auditoria/` (formato em `<documentacao>`). Priorizar por (impacto × esforço) em fases, com a Fase 0 contendo apenas o que dispensa medição.

**Etapa 6 — Correção controlada (só com autorização explícita).** Uma migration por vez. `create index concurrently if not exists`, fora de transação. `ANALYZE` depois. `EXPLAIN` antes/depois anexado ao PR. Conferir que os números dos cards batem antes e depois — RPC de agregação que muda um total é regressão de negócio, não otimização.
</plano_de_execucao>

<checklist_obrigatoria>
Verificar **todos** os itens, marcando encontrado / não encontrado / não aplicável:

1. Todas as consultas feitas por páginas, APIs, Server Actions, RPCs e Edge Functions
2. Consultas com `.select('*')` desnecessário
3. Consultas que carregam milhares de registros para depois filtrar/agrupar em JavaScript
4. `COUNT`, `SUM`, `AVG`, `GROUP BY`, `ORDER BY`, `DISTINCT` e joins em tabelas grandes
5. Múltiplas consultas na mesma tabela para formar cards diferentes
6. N+1 queries
7. Paginação feita no frontend em vez do banco
8. Filtros que não possuem índice compatível
9. Índices simples que deveriam ser compostos
10. Índices duplicados/inúteis
11. Foreign keys sem índice útil
12. Índices apropriados para `tenant_id`
13. Consultas que usam `tenant_id` + `project_id`, `team_id`, datas, status e outros filtros recorrentes
14. Políticas RLS que executam subqueries ou funções repetidamente
15. Funções SQL/RPC que varrem tabelas completas
16. Views que fazem agregações caras a cada acesso
17. Dashboards que recalculam históricos inteiros
18. Polling/refetch excessivo no frontend
19. Chamadas duplicadas provocadas por React/Next
20. Imports que fazem `INSERT`/`UPDATE` registro a registro em vez de operações em lote
21. Migrations que criam estruturas que pioram performance
</checklist_obrigatoria>

<regra_de_indice_composto>
A ordem das colunas não é estética:

```
(igualdades…, range/ORDER BY por último)
```

`tenant_id` primeiro sempre num SaaS multi-tenant. Um índice `(tenant_id, execution_date, status)` **não** serve para `tenant_id = X AND status = Y AND execution_date BETWEEN …` — o range no meio corta o uso de tudo que vem depois. O correto é `(tenant_id, status, execution_date)`.

Ao propor um índice, sempre indicar: quais consultas exatas ele atende (arquivo:linha), quantas são, e por que os índices existentes não bastam.
</regra_de_indice_composto>

<criterios_de_aceite>
- Toda rota que acessa banco foi mapeada, não amostrada.
- Estado de índice extraído do estado **vivo** (create menos drop), com a ressalva de que só o banco real confirma.
- Cada achado tem: evidência com arquivo:linha ou objeto de banco, severidade, confiança, causa raiz atacada e forma de validação.
- Nenhum índice proposto sem indicar as consultas que ele atende e o custo de escrita que adiciona.
- Nenhum `Seq Scan` classificado como problema sem confirmar o tamanho da tabela.
- O que já está correto no repositório está explicitamente listado — auditoria que só acusa não orienta.
- Limitações declaradas: o que não foi medido, e por quê.
</criterios_de_aceite>

<validacoes>
`npx tsc --noEmit`; `npm run lint`; `npm run build` (se afetar rota/build); `npm run db:check-link` antes de qualquer comando linked; `npm run db:migration-list`; `npm run db:lint`. Para coleta: `npx supabase db query --file scripts/supabase-monitoring-readonly.sql --linked`. Front/UI é manual: caminho feliz, estado vazio, estado de erro — e, em dashboard, conferência de que os números dos cards batem antes e depois.
</validacoes>

<documentacao>
Gerar/atualizar a pasta `Auditoria/` na raiz (criar se não existir). Um arquivo por nível, sempre nesta estrutura:

```
Auditoria/
  README.md                            índice, escopo, status de cada nível, limites
  00-metodologia-4-niveis.md           o procedimento (este prompt, aplicado)
  01-nivel-a-mapa-consultas.md         mapa página→API→tabela→filtros→índice + checklist 21 itens
  02-nivel-a-indices.md                inventário, duplicatas, redundâncias, write amplification, RLS
  03-nivel-b-pg-stat-statements.md     scripts e leitura das métricas por causa raiz
  04-nivel-c-explain.md                playbook EXPLAIN + candidatas + registro antes/depois
  05-nivel-d-arquitetura.md            dashboards, RPC única, matview, imports, frontend
  06-plano-de-acao.md                  achados priorizados em fases, com validação
```

Se a pasta já existir, **atualizar os arquivos existentes** em vez de criar `-v2`. Registrar a data-base da coleta e o commit no `README.md`.

Atualizar também `/docs/<Tela>.txt` das telas afetadas e `TASKS.md`, quando houver mudança de comportamento.
</documentacao>

<entrega>
Resumo executivo; achados por severidade com evidência; mapa completo página→API→tabela→filtros→índice; plano em fases (0: sem risco / 1: medir / 2: índices / 3: arquitetura / 4: condicional); comandos de validação; riscos de regressão; lista explícita do que já está correto e não deve ser mexido; limitações da auditoria.

Ao final, conforme a seção 11 do `CLAUDE.md`: resumo do que mudou, validações executadas, texto do commit em 6 seções (`guias/guia_git.md`), e a pergunta **"Confirma que posso aplicar/fechar essas mudanças?"**.
</entrega>

<exemplos>
**Índice desalinhado com o filtro real:** rota filtra `tenant_id + measurement_kind + is_active + status + execution_date[range]`. Existe `(tenant_id, measurement_kind, is_active, status)` — sem a data — e `(tenant_id, execution_date, status, …)` — com a data na 2ª posição, cortando o resto. Nenhum dos dois resolve. Recomendado: `(tenant_id, measurement_kind, is_active, status, execution_date)`. Evidência: 6 consultas em 4 arquivos. Validar por `Rows Removed by Filter` no `EXPLAIN` antes/depois.

**Duplicata exata:** migration converte coluna para UUID e recria o índice com sufixo `_uuid`, sem dropar o original. Ficam dois índices com colunas e predicado idênticos. O planner nunca usa os dois; ambos são mantidos em toda escrita. Remoção segura — é o raro caso que dispensa medição.

**Falso positivo de N+1:** laço `for (const ids of chunk(transferIds, 100))` com `await supabase.from(...).in("id", ids)` **não** é N+1 — é `⌈N/100⌉` consultas para contornar o limite de URL do PostgREST. N+1 de verdade é uma consulta **por registro**. Registrar como correto, não como achado.

**Dashboard com 9 cards e 40 consultas:** loaders separados por card, percorrendo `project_measurement_orders` 3 vezes e `service_activities` 2 vezes com filtros quase iguais, paginando em blocos de 1.000 e agregando em JS. Alvo: 1 RPC com CTEs, uma passada por tabela, todos os indicadores num retorno. Verificar antes se outro módulo do repositório já faz isso — estender padrão existente vale mais que criar novo.

**Booleano indexado:** `(tenant_id, is_active)` numa tabela onde 95% das linhas têm `is_active = true`. Cardinalidade 2, seletividade péssima: o planner escolhe `Seq Scan` e o índice só custa escrita. Confirmar por `most_common_freqs` em `pg_stats`; se > 0,20, tornar parcial (`WHERE is_active = false`) ou compor com as colunas realmente filtradas junto.

**RLS que parece crítica e não é:** 300 policies com `auth.uid()` reavaliado por linha é o anti-padrão clássico. Mas se **todas** as rotas usam `service_role`, RLS é bypassada e nenhuma policy é avaliada no caminho quente. Rebaixar para INFORMATIVO, registrar como ALTO **condicional** ao dia em que alguma rota passar a usar o token do usuário, e documentar a correção (`(select auth.uid())`) para quando isso acontecer.
</exemplos>

<notas>
- Análise estática prioriza; só `pg_stat_statements` decide. Nunca apresentar risco estimado como se fosse medição.
- `rows/call` é a métrica que confirma ou derruba o achado "carrega milhares de linhas para agregar em JS". Sempre coletar.
- Agregação no PostgreSQL não é otimização exótica: `SUM` lê as páginas uma vez e devolve 8 bytes; o mesmo cálculo em JS lê as mesmas páginas, serializa, trafega e aloca. O I/O é igual ou pior e todo o resto é desperdício.
- Toda proposta de índice deve declarar o custo de escrita. Tabela com 19 índices paga 19 atualizações por `INSERT`, e WAL vai para disco — write amplification **é** Disk I/O.
- Bloat e estatística desatualizada causam I/O que não aparece em nenhuma query específica. Sempre checar `n_dead_tup` e `last_autoanalyze`.
- Ao final, propor um plano em commits pequenos, uma migration por vez.
</notas>
