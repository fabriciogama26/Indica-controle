# Auditoria de "Lixo" — Next.js + TypeScript + Supabase + Vercel

Use este procedimento quando o usuário pedir uma auditoria de código morto, duplicação, hardcode, risco de segurança/multi-tenant ou desperdício de build/deploy neste repositório. Reformatado a partir de `GUIA_IA_AUDITORIA_LIXO_NEXT_SUPABASE.md` (original preservado em `_archive/docs/`), no formato de blocos de [`gerar-prompt.md`](gerar-prompt.md).

<papel>
Você é uma IA atuando como auditora de código, arquitetura, segurança, desempenho, organização de repositório, banco Supabase/Postgres, configuração Vercel e aplicação multi-tenant. Seu trabalho não é listar arquivos "feios" — é separar: lixo comprovado; provável lixo; dívida técnica; risco de segurança; desperdício de desempenho; configuração redundante; código legado ainda necessário; itens que não podem ser removidos.

**Regra principal: não apagar, mover, renomear ou alterar nada sem apresentar evidência, impacto, risco e forma de validação.**
</papel>

<contexto>
Confirme tudo no repositório antes de assumir — não presuma que o cenário abaixo está corretamente implementado:
- Next.js 16+, App Router, TypeScript, Supabase/Postgres, autenticação Supabase SSR, Vercel.
- SaaS multi-tenant: `tenant_id` nas tabelas, RLS ativa, resolução de usuário/tenant no servidor, header `x-tenant-id` (possível futuro `x-contract-id`).
- Migrations versionadas; regras de negócio configuráveis por tenant; módulos administrativos/operacionais/financeiros; Server Components, Client Components, Server Actions e Route Handlers.

Antes de aplicar recomendação dependente de versão, confirme as versões instaladas (`package.json`, lockfile, CLI, ambiente de deploy).
</contexto>

<escopo>
**Dentro:** ler, mapear, buscar evidência, classificar e relatar. Corrigir SOMENTE se o usuário autorizar explicitamente a Etapa 7 (correção controlada).
**Fora (nesta auditoria):** qualquer remoção automática sem relatório prévio; qualquer mudança de regra de negócio sem documentação; atualização de múltiplas dependências juntas; formatação do repositório inteiro; `npm audit fix --force`.
</escopo>

<arquivos_a_inspecionar>
```
package.json
package-lock.json / pnpm-lock.yaml / yarn.lock
next.config.* | tsconfig.json | eslint.config.* / .eslintrc*
src/ | app/ | pages/ | lib/ | modules/ | components/ | supabase/
vercel.json | .env.example | README* | AGENTS.md | CLAUDE.md | TASKS.md
.github/workflows/
```
Produza um mapa de: rotas, módulos, bibliotecas, autenticação, resolução de usuário/tenant, acesso ao banco, mutations, integrações, scripts, migrations, testes.
</arquivos_a_inspecionar>

<guias_obrigatorios>
`guias/guia_backend.md`, `guias/guia_frontend.md`, `guias/guia_sql.md`, `guias/guia_supabase.md`, `guias/guia_validacao.md` — os achados desta auditoria devem ser lidos à luz das regras já documentadas nesses guias (ex.: um `.select("*")` encontrado aqui é o mesmo problema que `guia_backend.md` regra 22 já proíbe).
</guias_obrigatorios>

<regras_de_negocio>
**Classificação de severidade:**
- **CRÍTICO** — vazamento entre tenants; exposição de segredo; `service_role` no navegador; bypass de RLS; exclusão/alteração indevida; acesso não autorizado; dados de outro cliente; falha grave de produção.
- **ALTO** — erro recorrente; inconsistência de dados; regra de negócio divergente; consulta excessiva; falha de build; incompatibilidade de autenticação; dificuldade séria de manutenção.
- **MÉDIO** — duplicação; complexidade; desempenho inferior; baixa legibilidade; manutenção mais cara; risco moderado de regressão.
- **BAIXO** — ruído; arquivos desnecessários; comentários antigos; padronização; imports não usados.
- **INFORMATIVO** — sugestão sem urgência ou achado que precisa de mais dados.

**Nível de confiança:** Alta (evidência direta e reproduzível) / Média (forte indicação, possibilidade de uso indireto) / Baixa (hipótese que exige investigação). Nunca recomendar exclusão definitiva com confiança baixa.

Para cada achado, informar: arquivo; linha/trecho; categoria; por que parece lixo; como confirmou; impacto atual; risco da remoção; como validar depois; nível de confiança.
</regras_de_negocio>

<restricoes>
Nunca remover automaticamente: migrations já aplicadas ou históricas; policies RLS; testes; seeds; fixtures; scripts de recuperação; documentação de incidentes; tipos gerados; arquivos referenciados dinamicamente; arquivos usados por CI/CD, Vercel ou Supabase CLI; configurações de ambiente; código legado que trate dados antigos ou compatibilidade com status antigos; índices classificados apenas como "unused" por um advisor; colunas possivelmente usadas por integrações externas.

Backups permanentes dentro de `src` (`page-old.tsx`, `*-backup.tsx`, `*-copia.tsx`, `*.bak`, `*.tmp`) são candidatos a lixo, mas não substituem Git/branch/tag/commit como backup oficial — confirmar no Git antes de excluir.

Nunca usar apenas uma ferramenta estática (erra com imports dinâmicos, convenções do Next.js, rotas, geração de tipos, Edge Functions, funções SQL/RPC, triggers, referências por nome em banco). Cruzar pelo menos duas fontes de evidência antes de recomendar exclusão.
</restricoes>

<plano_de_execucao>
**Etapa 1 — Inventário.** Ler os arquivos de `<arquivos_a_inspecionar>` e produzir o mapa de arquitetura.

**Etapa 2 — Confirmar versões.** Registrar Node, Next.js, React, TypeScript, `@supabase/supabase-js`, `@supabase/ssr`, Supabase CLI, gerenciador de pacotes, ambiente Vercel (`node --version`, `npm ls next react typescript @supabase/supabase-js @supabase/ssr`). Não sugerir sintaxe de outra versão.

**Etapa 3 — Validar estado inicial.** `git status`; `npm ci`; `npm run lint`; `npx tsc --noEmit`; `npm run build`. Registrar falhas já existentes sem atribuí-las à auditoria.

**Etapa 4 — Busca automatizada.** Rodar e abrir o contexto de cada ocorrência (não concluir apenas pela ocorrência):
```
rg -n "TODO|FIXME|HACK|TEMP"
rg -n "console\.log|debugger"
rg -n "@ts-ignore|@ts-nocheck|eslint-disable|as any|: any"
rg -n "select\('\*'\)|select\(\"\*\"\)"
rg -n "service_role|SERVICE_ROLE"
rg -n "NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*SERVICE"
rg -n "x-tenant-id|tenant_id"
rg -n "use client"
rg -n "middleware\.ts|export function middleware"
```
Repositório: `git status --ignored`; `git ls-files`; `git ls-files -o --exclude-standard`; `git ls-files | grep -Ei '\.(bak|tmp|old|log|zip)$'`; arquivos grandes (`find . -type f -size +5M` / PowerShell `Get-ChildItem -Recurse -File | Where-Object { $_.Length -gt 5MB }`). Não executar comandos destrutivos nesta fase.

**Etapa 5 — Verificação de uso**, por arquivo candidato: (1) listar exports; (2) buscar cada export; (3) verificar import dinâmico; (4) verificar convenção do framework; (5) verificar scripts; (6) verificar testes; (7) verificar configuração; (8) verificar referências SQL/RPC; (9) verificar histórico Git; (10) validar em branch separada após remoção.

**O que procurar (categorias completas — todas fazem parte do inventário de achados):**
- **Lixo de repositório:** `.next/`, `node_modules/`, `dist/`, `build/`, `coverage/`, `*.log`, `*.tmp`, `*.bak`, `*.old`, `.DS_Store`, `Thumbs.db` versionados por engano; dumps de banco, CSVs/planilhas/PDFs de teste, capturas de tela antigas, credenciais, exports, ZIPs, backups manuais, pastas duplicadas, sufixos `old`/`backup`/`copy`/`novo`/`final`, arquivos vazios ou muito grandes sem justificativa, assets/fontes duplicadas.
- **Código morto:** funções/componentes/exports/constantes/tipos/hooks nunca usados; Route Handlers e Server Actions abandonados; páginas inacessíveis; RPCs sem consumidores; código depois de `return`; condições sempre verdadeiras/falsas; feature flags expiradas; código comentado antigo; reexports desnecessários; compatibilidade antiga sem dados antigos reais. Usar `npm run lint`, `npx tsc --noEmit`, `npm run build`, opcionalmente `npx knip` (não instalar ferramenta nova sem autorização; não aceitar o resultado como verdade absoluta); busca manual com `rg "nomeDaFuncao"`, `rg "import\("`, `rg "dynamic\("`.
- **Imports, dependências e pacotes:** imports não usados/duplicados; pacote substituível por API nativa; bibliotecas concorrentes (ex.: `@supabase/auth-helpers-nextjs` junto com `@supabase/ssr`); dependência de dev em `dependencies` (ou vice-versa); pacote sem referência; dependência importada só por tipo; dependências vulneráveis; overrides sem justificativa. `npm ls --depth=0`, `npm outdated`, `npm audit` (nunca `--force`). Para cada candidato: buscar nome no código/scripts/config/import dinâmico, remover em commit isolado, reinstalar, rodar build/testes.
- **Duplicação de código:** regras de status, formatação de moeda/data, validação de usuário, resolução de tenant, permissões, consultas Supabase, schemas Zod, tipos, mapeamento de campos, normalização de texto, tratamento de erros, paginação, filtros, exportação, cálculos financeiros, regras operacionais. Confirmar que os trechos têm a mesma regra antes de centralizar — duplicação visual não é sempre duplicação de domínio.
- **Hardcodes:** nome de cliente/contrato/tenant UUID/projeto/usuário/e-mail fixo, meta financeira fixa, taxa fixa, timezone fixo, URL fixa, status/papel digitado manualmente, cabeçalhos, datas, caminhos Windows, bucket Supabase, IDs de cor, nomes de tabela repetidos. Classificar como configuração técnica, regra de negócio, dado de tenant/contrato, constante legítima ou valor temporário, e sugerir destino (env var, tabela de configuração, regra por tenant/contrato, enum central, parâmetro, banco, feature flag).
- **Lixo de TypeScript:** `any`, `unknown as Tipo`, `@ts-ignore`/`@ts-nocheck`, `eslint-disable`, `as any`, `Record<string, any>` (nem todo `unknown` é lixo — é adequado em entrada não confiável quando validado antes do uso); tipos duplicados ou divergentes do banco; campos opcionais que deveriam ser obrigatórios; cast para esconder erro; non-null assertion `!` sem garantia; erro capturado como `any`; `Promise<any>`; tipos gerados desatualizados.
- **Lixo de React/Next.js:** `'use client'` em página inteira sem necessidade; `useEffect` para buscar dado que poderia vir do servidor; estado duplicado/derivável; props excessivas; componente com centenas de linhas; regra de negócio no JSX; `window.location` onde o router resolve; refresh completo desnecessário; chamadas duplicadas; listeners/timers sem cleanup; hydration mismatch; keys instáveis; render em loop; imports pesados no client; `select('*')`; objetos grandes do servidor ao cliente; páginas sem `loading.tsx` quando há espera relevante; Route Handler duplicando Server Action sem necessidade. Para cada `'use client'`: usa hook de estado/evento/API do navegador/contexto client? É possível isolar só o componente interativo?
- **Lixo de consultas Supabase:** `.select('*')`; consulta em loop; N+1; consultas sequenciais independentes; falta de paginação; colunas não usadas; filtro/ordenação/agregação no frontend; chamadas duplicadas; realtime sem cleanup/subscription duplicada; índice ausente ou redundante; RPC desnecessária para regra simples; regra crítica só no frontend; `service_role` sem necessidade; insert sem `tenant_id`; query sem escopo de tenant; erro tratado incorretamente; cast em vez de tipo gerado.
- **Risco multi-tenant (área crítica):** tabela sem `tenant_id`; `tenant_id` nullable sem justificativa; consulta sem escopo; insert aceitando `tenant_id` arbitrário; header `x-tenant-id` aceito sem validação; usuário escolhendo tenant sem confirmar vínculo; cache/chave de cache compartilhado entre tenants; exportação misturando tenants; logs sem tenant; storage sem controle por tenant; RPC sem validação de tenant; `security definer` inseguro; RLS desativada; policy `using (true)`; `with check` ausente; service role em fluxo comum; fallback silencioso para "primeiro tenant"; contrato ativo resolvido só pelo frontend. Modelo esperado: requisição → identidade autenticada → tenant solicitado → vínculo validado no servidor → permissão validada → operação → RLS valida de novo. O header pode transportar contexto; nunca prova autorização.
- **Segurança e segredos:** `SUPABASE_SERVICE_ROLE_KEY` exposta; segredo com prefixo `NEXT_PUBLIC_`; `.env` versionado; token em README; senha em migration; URL com credencial; logs com JWT/dados pessoais; cookie inseguro; endpoint sem autenticação; Server Action/Route Handler sem validação/autorização; upload sem validação; nome de arquivo não sanitizado; SQL por concatenação; redirect aberto; CORS amplo sem motivo; erro interno/stack trace em produção; `getSession()` no servidor como prova definitiva de identidade.
- **Migrations e banco:** nunca tratar migration antiga como lixo (representa histórico) nem apagar/editar retroativamente sem estratégia formal. Procurar: duas migrations criando a mesma coisa; migration quebrada nunca aplicada; migration temporária ou fora de ordem; SQL não idempotente quando deveria ser; policy substituída sem `drop`; função recriada com assinatura divergente; índice duplicado; trigger/função órfã; constraint ausente; FK sem índice de suporte. Índices "unused": não remover só por marcação de advisor — checar janela de observação, workload sazonal, relatórios mensais, fechamentos, suporte a FK, ordenações, custo de escrita, tamanho, plano de execução; exigir `EXPLAIN (ANALYZE, BUFFERS)` quando possível.
- **Logs e tratamento de erros:** `console.log('teste')`, `catch {}`, `catch { return null }`; erro engolido; contexto perdido; segredo logado; excesso de log; log sem identificador/tenant; mensagem técnica para usuário; tratamento diferente para o mesmo erro. Padrão esperado: `logger.error('mensagem', { error, tenantId, userId, entidadeId, requestId })`, nunca token/senha/conteúdo sensível.
- **Testes:** não chamar teste de lixo só por estar falhando. Procurar: teste duplicado; snapshot sem valor; teste que não testa resultado; teste desativado (`skip` permanente); fixture gigante; mocks divergentes; teste dependente de horário/tenant fixo; ausência de teste para regra crítica; teste antigo de funcionalidade removida.
- **Configuração Vercel e build:** variáveis duplicadas/obsoletas; segredo em variável pública; região incompatível com o banco; função com timeout excessivo; rotas duplicadas; rewrites/redirects conflitantes; cron sem consumidor; artefato `.next` versionado; script de build divergente entre local e Vercel; variável presente localmente e ausente no deploy; cache incorreto para conteúdo autenticado; resposta com cookie de sessão cacheada indevidamente.

**Etapa 6 — Relatório antes de corrigir.** Tabela: `| ID | Severidade | Confiança | Categoria | Arquivo | Evidência | Impacto | Recomendação | Risco |`. Agrupar em: Seguro para remover / Remover após validação / Refatorar / Manter / Investigar.

**Etapa 7 — Correção controlada** (somente com autorização explícita do usuário): branch própria; mudanças pequenas; um assunto por commit; não misturar limpeza com funcionalidade; não alterar regra de negócio sem documentação; não formatar o repositório inteiro; não atualizar todas as dependências juntas; não mexer em migration histórica; preservar compatibilidade; adicionar testes quando necessário.

**Etapa 8 — Validação final:** `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npm test` (se existir). Validar também: login, logout, renovação de sessão, troca de tenant, usuário sem acesso, usuário com múltiplos tenants, Route Handlers, Server Actions, RLS, exportações, telas críticas, deploy preview, logs Vercel, queries Supabase.
</plano_de_execucao>

<criterios_de_aceite>
A auditoria só está concluída quando: versões foram confirmadas; build inicial foi registrado; arquivos candidatos têm evidência (arquivo + linha + confiança); riscos multi-tenant foram analisados; segredos foram verificados; dependências foram avaliadas; duplicações relevantes foram mapeadas; migrations foram preservadas; relatório foi priorizado por severidade/confiança; plano de validação foi fornecido.
</criterios_de_aceite>

<validacoes>
`git status`; `npm ci`; `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npm test` (se existir); buscas `rg` da Etapa 4; para achados de banco, `npm run db:check-link` antes de qualquer comando linked.
</validacoes>

<documentacao>
Saída mínima exigida (nesta ordem):
```
RESUMO EXECUTIVO
ACHADOS CRÍTICOS
ACHADOS ALTOS
ACHADOS MÉDIOS
ACHADOS BAIXOS
SEGURO PARA REMOVER
PRECISA DE VALIDAÇÃO
NÃO REMOVER
PLANO DE CORREÇÃO
COMANDOS DE VALIDAÇÃO
RISCOS DE REGRESSÃO
```
</documentacao>

<entrega>
Relatório com: resumo executivo; achados por severidade com evidência; classificação de risco; itens seguros para remoção vs. que exigem validação vs. que não devem ser removidos; plano de limpeza por etapas; comandos de validação; riscos de regressão; lista de arquivos modificados (só se houver autorização para corrigir).
</entrega>

<exemplos>
**Backup dentro de `src`:** achado `src/app/(dashboard)/apuracao-fator-minimo/page-backup.tsx`. Investigar `rg "page-backup"` e `git log -- <caminho>`. Se não é importado, não é convenção de rota, o conteúdo está no Git, e o build não depende dele → remoção de baixo risco.

**Função duplicada de status:** achados `isCompletedWorkStatus()`, `isWorkCompleted()`, `isStatusConcluido()`. Não excluir direto — comparar status aceitos, tratamento de legado, normalização, uso em medição/programação/faturamento. Se equivalentes, criar função canônica e migrar consumidores gradualmente.

**`x-tenant-id`:** `const tenantId = request.headers.get('x-tenant-id')` não é lixo por si só; é risco quando usado direto como filtro de autorização (`.eq('tenant_id', tenantId)`) sem validar o vínculo do usuário. Correção: autenticar → ler tenant solicitado → confirmar vínculo → confirmar permissão → consultar → depender também de RLS.

**`select('*')`:** não substituir cegamente — identificar primeiro quais colunas são usadas, então trocar por `.select('id, project_code, status, total')`, validando joins/tipos/componentes.

**Pacote aparentemente não usado:** antes de remover, `rg "nome-do-pacote"`, `rg "from 'nome-do-pacote'"`, `rg 'require\("nome-do-pacote"\)'`, `rg "import\('nome-do-pacote'\)"`; verificar config, plugin, CLI, script, build, geração de tipos, testes.
</exemplos>

<notas>
- Cruzar pelo menos duas fontes de evidência antes de recomendar exclusão; ferramentas estáticas sozinhas erram com convenções do Next.js, imports dinâmicos e referências de banco.
- Não classificar migrations aplicadas, testes, policies RLS, funções SQL, índices, scripts de recuperação ou código carregado dinamicamente como lixo sem prova forte.
- Não usar `x-tenant-id` como prova de autorização; não expor `service_role`; não misturar mudanças grandes; não rodar `npm audit fix --force`; não remover índice só por aparecer como "unused".
- Ao final, propor um plano em commits pequenos.
</notas>
