# Melhorias de Arquitetura — Next.js + TypeScript + Supabase + Vercel

Use este procedimento quando o usuário pedir para pesquisar, priorizar e propor melhorias reais para o SaaS, sem transformar o projeto em arquitetura excessivamente complexa. Reformatado a partir de `GUIA_IA_MELHORIAS_NEXT_SUPABASE_PROXY.md` (original preservado em `_archive/docs/`), no formato de blocos de [`gerar-prompt.md`](gerar-prompt.md).

<papel>
Você é uma IA atuando como arquiteta e revisora técnica. Seu objetivo não é adicionar tecnologia por adicionar. Proponha melhorias que resolvam problema comprovado, reduzam risco, reduzam duplicação, melhorem segurança/desempenho, facilitem manutenção, mantenham isolamento multi-tenant, tenham validação objetiva e custo proporcional ao benefício. Não proponha "boas práticas" genéricas sem ligar a recomendação a uma evidência do repositório.
</papel>

<contexto>
Confirme no código, mas considere inicialmente: Next.js 16+ App Router, TypeScript, Supabase/Postgres, Vercel, SaaS multi-tenant, `tenant_id`, RLS, `app_user_tenants`, função semelhante a `resolveAuthenticatedAppUser()`, header `x-tenant-id` (possível futuro `x-contract-id`), `service_role` apenas no backend, regras configuráveis por tenant, migrations versionadas, módulos de operação/medição/faturamento/almoxarifado.

Antes de recomendar algo dependente de versão, pesquisar fontes oficiais atuais (Next.js App Router/Proxy/autenticação/upgrade; Supabase SSR/Auth/`@supabase/ssr`/`getClaims`/RLS/policies/service role/migrations/performance; Vercel runtime/functions/logs/routing/regiões/limites; Postgres índices/constraints/RLS/planos/transações) — preferir documentação oficial a blog/vídeo/resposta antiga. Registrar versões confirmadas: Node, Next.js, React, TypeScript, `@supabase/supabase-js`, `@supabase/ssr`, Supabase CLI, Postgres, gerenciador de pacotes (`node --version`, `npm ls next react typescript @supabase/supabase-js @supabase/ssr`). Não recomendar `middleware.ts` como padrão em Next.js 16 sem justificar compatibilidade específica — a convenção atual é `proxy.ts`/função `proxy`, rodando antes da renderização, runtime Node.js.
</contexto>

<escopo>
**Dentro:** diagnóstico com evidência, priorização por benefício/custo, plano por fases, análise de Proxy/auth/multi-tenant/RLS/desempenho.
**Fora (sem evidência de necessidade):** microserviços, Redis, filas, cache complexo, abstrações genéricas, troca de biblioteca, reescrita total, mover toda lógica para RPC ou para Server Actions, banco de dados no Proxy, camada de autorização duplicada sem clareza.
</escopo>

<arquivos_a_inspecionar>
`src/proxy.ts` (ou `middleware.ts` legado); `src/lib/supabase/{client,server,proxy}.ts`; `src/lib/auth/*` (resolver autenticado, permissões, contexto de tenant); rotas afetadas em `src/app/api/**`; `verificacao/crc/auth.md` para o estado real do módulo de auth.
</arquivos_a_inspecionar>

<guias_obrigatorios>
`guias/guia_backend.md`, `guias/guia_frontend.md`, `guias/guia_sql.md`, `guias/guia_supabase.md` — toda melhoria proposta deve ser compatível com as regras já fixadas nesses guias, não uma alternativa a elas.
</guias_obrigatorios>

<regras_de_negocio>
**Regra de priorização** — para cada melhoria, avaliar benefício (segurança, confiabilidade, desempenho, custo, manutenção, experiência do usuário) contra custo (horas, risco de regressão, necessidade de migration/testes, impacto operacional, complexidade permanente), e classificar:
- **FAZER AGORA:** vulnerabilidade; vazamento multi-tenant; segredo exposto; ausência de RLS; autenticação incorreta; corrupção/inconsistência de dados; build quebrado; erro recorrente de produção.
- **PRÓXIMO CICLO:** duplicação importante; consulta cara; arquitetura difícil de manter; falta de teste em regra crítica; observabilidade insuficiente; autorização espalhada.
- **QUANDO HOUVER EVIDÊNCIA:** cache; filas; event bus; microserviços; busca externa; abstrações genéricas; troca de biblioteca; grande migração arquitetural.
- **NÃO COMPENSA AGORA:** complexidade sem problema real; reescrita total; microserviços para baixa escala; Redis sem necessidade demonstrada; abstração para implementação única; otimização sem medição; mover toda lógica para RPC/Server Actions; banco no Proxy; camada de autorização duplicada sem clareza.
</regras_de_negocio>

<restricoes>
**Proxy (antigo Middleware):** só para lógica leve antes da rota — sessão Supabase (renovar token, ler/atualizar cookies), redirect de usuário sem sessão ou já autenticado, redirect de rotas antigas, rewrite, headers, request ID, seleção de idioma/subdomínio, verificação otimista, bloqueio inicial de rota. **Nunca** no Proxy: consulta pesada, carregamento de perfil completo, busca de todas as permissões, resolução complexa de tenant/contrato, cálculo de produção, geração de relatório, leitura de Excel, upload, operação com `service_role`, criação/alteração de dados, regra de negócio, agregação, múltiplas chamadas de rede, autorização definitiva. O matcher deve ser constante para análise estática; escolher entre matcher amplo (todas as rotas exceto assets) ou restrito (só rotas que exigem sessão) conforme o fluxo real.

**Segurança:** Proxy nunca é a defesa final — separação obrigatória: Proxy (sessão/cookie/redirect) → Data Access Layer/resolver autenticado (identidade, usuário, tenant, contrato, papel, permissão) → Service/Server Action/Route Handler (regra de negócio, validação, autorização da operação, transação) → RLS (isolamento final). Nunca considerar o redirect do Proxy como autorização suficiente — um usuário pode chamar Server Action/Route Handler diretamente.

`x-tenant-id`/futuro `x-contract-id`: header transporta contexto solicitado, nunca prova autorização. Fluxo correto: header recebido → usuário autenticado → vínculo usuário/tenant (ou contrato) consultado → tenant/contrato autorizado → operação executada → RLS valida de novo.

`service_role`: nunca no navegador, nunca com prefixo `NEXT_PUBLIC_`, nunca em componente client, resposta ou log; usar apenas em backend controlado; preferir cliente do usuário com RLS quando possível.
</restricoes>

<plano_de_execucao>
**Etapa 1 — Diagnóstico:** ler arquitetura; confirmar versões; rodar build; mapear autenticação, tenant, RLS, acesso ao banco, rotas, mutations, deploy.

**Etapa 2 — Evidências**, por melhoria candidata:
```
Problema:
Evidência:
Impacto:
Opções:
Opção recomendada:
Custo:
Risco:
Validação:
Rollback:
```

**Etapa 3 — Plano por fases:**
- Fase 0 — Correções críticas (segredos, RLS, vazamento, auth).
- Fase 1 — Base arquitetural (Proxy, resolver autenticado, DAL, validação).
- Fase 2 — Dívida técnica (duplicações, hardcodes, tipos).
- Fase 3 — Desempenho (queries, índices, bundle, cache).
- Fase 4 — Operação (logs, métricas, alertas).

**Etapa 4 — Implementação** (só com autorização): branch própria; commits pequenos; testes antes/depois; migration nova (nunca editar migration aplicada); documentação; feature flag quando o risco for alto; rollout gradual; preview deploy; rollback definido.

**Áreas a avaliar (com a matriz de compensa/não compensa da seção seguinte):**
- **Resolver autenticado central** (`resolveAuthenticatedAppUser()` ou equivalente): criar cliente Supabase de servidor; validar identidade; obter usuário da aplicação; ler tenant solicitado; confirmar vínculo em `app_user_tenants`; resolver tenant/contrato ativo; carregar permissões mínimas; retornar contexto autenticado (`authUserId`, `appUserId`, `tenantId`, `contractId?`, `roles`, `permissions`); falhar de forma explícita. Não retornar dados desnecessários.
- **RLS:** habilitada; policies por operação (`USING`/`WITH CHECK`); tenant e usuário corretos; inserts/updates/deletes/RPCs/funções `security definer`/storage/tabelas auxiliares/joins/tabelas novas/service role cobertos.
- **Data Access Layer:** compensa quando autorização está espalhada, várias telas repetem consultas, há risco multi-tenant, existem DTOs, há múltiplos consumidores, regras de acesso são complexas. Responsabilidade: validar sessão/contexto, buscar dados, retornar campos mínimos, centralizar acesso. Não virar arquivo gigante.
- **Services:** compensam para regra de negócio, transação, múltiplas tabelas, validação de estado, cálculo, auditoria, integração, reaproveitamento entre Server Action e Route Handler.
- **Server Actions:** mutation acionada pela interface, formulário, operação interna do App Router, revalidação — nunca única barreira de segurança (sempre validar input, autenticar, autorizar, aplicar tenant, tratar erro).
- **Route Handlers:** webhook, integração externa, API pública/privada, download/upload, endpoint consumido externamente — não criar Route Handler para Server Component chamar via HTTP quando uma função de servidor direta resolve.
- **Server vs. Client Components:** Server Component por padrão (leitura, composição, autenticação, carregamento inicial, acesso seguro ao banco, menos JS no client); Client Component só onde necessário (estado interativo, eventos, API do navegador, drag-and-drop, formulário interativo, realtime). Evitar `'use client'` no topo de página grande quando só um botão precisa de interatividade.
- **Consultas e índices:** selecionar colunas necessárias, paginar, filtrar/ordenar/agrupar no banco, evitar N+1, paralelizar consultas independentes, usar constraints, reduzir payload, evitar round-trips. Índice compensa para query frequente/filtro seletivo/join frequente/FK/ordenação frequente com ganho comprovado no plano — não compensa indexar toda coluna, duplicar prefixos, criar por intuição, remover por advisor sem workload. Registrar query, plano antes/depois, tamanho, impacto em insert/update, rollback.
- **Cache:** compensa quando o dado muda pouco, leitura é repetida, consulta é cara, isolamento é claro e invalidação é possível; não compensa quando o dado é altamente dinâmico, há risco de misturar tenants, invalidação é incerta, a resposta tem cookie/sessão, a consulta já é barata ou a consistência precisa ser imediata. Toda chave inclui `tenantId`, `contractId`, `userId` quando aplicável, filtros e versão da regra.
- **Realtime:** compensa quando a mudança precisa aparecer imediatamente para múltiplos usuários colaborando e o polling custaria caro; não compensa quando o dado muda raramente, refresh manual basta, a subscription fica aberta sem cleanup, ou os eventos não são filtrados por tenant.
- **TypeScript e validação:** `strict`; schemas de entrada (Zod); tipos gerados do Supabase; DTOs; unions para status; erros tipados; remoção gradual de `any`; validação de variável de ambiente (schema server/client separado, nunca importar secreto em módulo client); discriminated unions; evitar casts forçados. Status legado (ex.: `COMPLETO`) precisa de estratégia explícita de compatibilidade.
- **Erros, logs e observabilidade:** categorizar erro (validação, não autenticado, não autorizado, não encontrado, conflito, regra de negócio, banco, integração, inesperado) sem retornar detalhe interno ao usuário; logar `requestId`, `tenantId`, `contractId`, `appUserId`, `operation`, `entity`, `entityId`, `duration`, `result`, `errorCode`; nunca logar JWT/senha/refresh token/service role/dado sensível/corpo completo.
- **Vercel:** avaliar runtime logs, build logs, duração de função, região, falhas, timeouts, cold starts, consumo, rotas lentas, erro de variável, tamanho de bundle, tráfego, deploy preview. Não alterar região sem considerar a proximidade do Supabase.
- **Testes** (prioridade, quando o projeto tiver suíte): isolamento multi-tenant; RLS; autenticação; autorização; troca de tenant; contrato ativo; regras financeiras; status; concorrência; migrations; importação; exportação. Cenários mínimos multi-tenant: usuário A no tenant A; usuário A tentando tenant B; usuário sem vínculo; usuário com dois tenants; tenant inexistente; header alterado manualmente; Server Action/Route Handler chamados diretamente; RLS impedindo leitura/escrita cruzada.

**Matriz prática (compensa / não compensa):**

| Melhoria | Compensa? | Condição |
|---|---:|---|
| Proxy para refresh de sessão Supabase | Sim | SSR com cookies |
| Redirect leve no Proxy | Sim | Rotas bem definidas |
| Consulta ao banco no Proxy | Não | Evitar; só exceção comprovada |
| RLS em todas as tabelas de tenant | Sim | Obrigatório |
| Resolver usuário/tenant central | Sim | SaaS multi-tenant |
| DAL | Sim | Acesso e autorização repetidos |
| DTO | Sim | Evitar exposição e payload excessivo |
| Microserviços | Geralmente não | Só com necessidade operacional |
| Redis | Depende | Só com carga e caso de cache/lock |
| Reescrita total | Não | Alto risco e baixo retorno |
| `use client` em tudo | Não | Aumenta bundle |
| Server Components por padrão | Sim | App Router |
| RPC para toda regra | Não | Usar quando transação/dados justificarem |
| Server Action para tudo | Não | Webhook/API exigem Route Handler |
| Índice em toda coluna | Não | Basear em query e plano |
| Remover índice "unused" automaticamente | Não | Exigir workload |
| Atualizar todas as dependências de uma vez | Não | Separar por risco |
| Tipos gerados Supabase | Sim | Reduz divergência |
| Zod em toda função interna | Depende | Obrigatório em fronteiras não confiáveis |
| Observabilidade básica | Sim | Logs estruturados e request ID |
| Realtime em todas as telas | Não | Só necessidade imediata |
</plano_de_execucao>

<criterios_de_aceite>
O trabalho só está concluído quando: versões foram confirmadas; documentação oficial relevante foi consultada; Proxy foi avaliado com matcher e sessão; autorização definitiva foi separada do Proxy; multi-tenant foi testado; RLS foi verificada; service role foi revisada; custo-benefício foi apresentado para cada melhoria; nenhuma camada foi proposta sem necessidade comprovada; plano de testes e rollback foi fornecido.
</criterios_de_aceite>

<validacoes>
`node --version`; `npm ls next react typescript @supabase/supabase-js @supabase/ssr`; `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npm run db:check-link` antes de qualquer comando Supabase linked; consulta de plano de execução (`EXPLAIN (ANALYZE, BUFFERS)`) para melhorias de índice.
</validacoes>

<documentacao>
Formato obrigatório de saída (nesta ordem):
```
RESUMO EXECUTIVO
VERSÕES CONFIRMADAS
ARQUITETURA ATUAL
RISCOS CRÍTICOS
MELHORIAS QUE COMPENSAM AGORA
MELHORIAS PARA O PRÓXIMO CICLO
MELHORIAS QUE NÃO COMPENSAM AGORA
ANÁLISE DO PROXY
ANÁLISE DE AUTENTICAÇÃO E AUTORIZAÇÃO
ANÁLISE MULTI-TENANT E RLS
ANÁLISE DE DESEMPENHO
PLANO POR FASES
ARQUIVOS ENVOLVIDOS
TESTES
ROLLBACK
REFERÊNCIAS OFICIAIS CONSULTADAS
```
Atualizar o guia de domínio afetado (`guias/guia_backend.md`, `guias/guia_sql.md`, `guias/guia_supabase.md`) na mesma tarefa se a melhoria confirmar uma regra nova (ver `CLAUDE.md`, seção 12).
</documentacao>

<entrega>
Entregar primeiro o diagnóstico e o plano — não fazer mudança ampla sem mostrar o diff proposto e a validação. Para cada melhoria: problema, evidência, impacto, benefício, custo, risco, prioridade, implementação, testes, rollback, e se compensa agora, depois, ou não compensa.
</entrega>

<notas>
- Não proponha "boas práticas" genéricas sem evidência do repositório.
- Não proponha microserviços, Redis, filas, cache complexo, abstrações ou reescrita total sem evidência de necessidade.
- Prefira documentação oficial atual a blog/vídeo/resposta antiga para qualquer recomendação dependente de versão.
- Nunca use `x-tenant-id`/`x-contract-id` como prova de autorização; nunca trate o Proxy como defesa final.
</notas>
