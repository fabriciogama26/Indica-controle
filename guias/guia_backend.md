# Guia de Backend

## 1. Escopo

Obrigatório sempre que a tarefa:
- criar ou alterar uma API Route (`src/app/api/**/route.ts`);
- criar ou alterar um módulo server-side (`src/server/modules/<dominio>/**`);
- alterar fluxo operacional com gravação de negócio (`Programacao`, `Locacao`, `Entrada`, `Saida`, `Medicao`, `Requisicao`, `Faturamento` ou equivalente);
- criar uma tela nova que liste, pagine ou agregue dados.

Para regras específicas de SQL/PL-pgSQL/RLS/migrations, ver [`guia_sql.md`](guia_sql.md). Para Auth/Edge Functions/CLI Supabase, ver [`guia_supabase.md`](guia_supabase.md). Para o protocolo de checklist pré-PR, ver [`guia_validacao.md`](guia_validacao.md).

## 2. Fontes de verdade

- Código real dos módulos já corrigidos: `src/app/api/medicao/route.ts`, `src/app/api/medicao-asbuilt/route.ts`, `src/app/api/programacao/route.ts` e `src/app/api/programacao/meta/route.ts`, `src/server/modules/programacao/*`.
- `docs/arquitetura/padrao-performance-backend.md` — exemplos de código completos para paginação, cache de catálogo e `Promise.all` (este guia resume as regras; o arquivo mantém os exemplos e o histórico de aplicação por tela).
- `verificacao/crc/*.md` — dados de instância por módulo (rotas, tabelas, número de queries).
- `CLAUDE.md`, seção 5 (arquitetura real do projeto).

## 3. Regras obrigatórias

### Estrutura de módulo
1. Toda tela nova ou refatorada segue:
   ```
   src/modules/dashboard/<nome-tela>/
     types.ts | constants.ts | utils.ts
     <NomeTela>PageView.tsx        (máx. 800-1000 linhas)
     <NomeTela>PageView.module.css
   ```
   Módulos grandes usam subpastas (`api/`, `components/`, `hooks/`, `validators/`, `constants/`, `types/`, `services/`, `utils/`, `styles/`, `index.ts`).
2. Backend correspondente fica em `src/server/modules/<dominio>/` (`controller.ts`, `service.ts`, `repository.ts`, `validator.ts`, `dto.ts`). Rota em `src/app/api/<rota>` delega para o módulo — rota não contém regra de negócio.
3. Feature não importa regra de negócio de feature irmã (ex.: `programacao-simples` não importa `modules/estoque/*`). Comunicação entre domínios via contrato explícito em `core`/`server/modules`/API/RPC.
4. Toda feature expõe fachada pública (`index.ts`). Import de infraestrutura compartilhada (Supabase client, auth, logger, formatadores) é permitido; import de domínio irmão é acoplamento indevido.
5. `shared`/`lib`/`utils`/`services`/`helpers` globais só contêm infraestrutura universal — nunca regra de domínio.
6. Funções duplicadas são proibidas: usar `src/lib/utils/formatters.ts` (`formatDate`, `formatDateTime`, `toIsoDate`), `src/lib/utils/csv.ts` (`downloadCsvFile`), `src/lib/utils/parsers.ts` (`parseNonNegativeInteger`, `parsePositiveNumber`).
7. `route.ts`/controller acima de 1.500 linhas exige plano de modularização registrado no TXT da tela (`programacao/route.ts` já está em ~4.500 linhas — CRÍTICO, não adicionar feature nova sem plano).

### Autorização server-side
8. Toda rota/API/Edge Function valida `page_key` e a ação (`read`, `create`, `update`, `cancel`, `reverse`, `import`, `export`) no servidor via `requirePageAction`. Esconder menu ou desabilitar botão no frontend não é autorização.
9. Rotas com service role executam o guard antes de qualquer SELECT/RPC/escrita.
10. Nenhuma rota aceita `tenant_id`, `actor_user_id`, role ou auditoria vindos do body/cliente como fonte de verdade — sempre derivados da sessão (`resolveAuthenticatedAppUser`).

### Escrita, transação e concorrência
11. Valor final, campos complementares, histórico essencial e snapshots obrigatórios são gravados na mesma RPC/transação. Proibido salvar o valor e corrigir campo complementar depois do commit, ou atualizar registro e gravar histórico essencial em chamada posterior.
12. Efeito pós-commit só pode ser visual/cache/notificação, e deve retornar sucesso com aviso (nunca erro falso) se falhar depois do commit.
13. A RPC/handler retorna o registro final salvo e o `updated_at` final — evitar "salvar e buscar de novo" para confirmar sucesso.
14. `PUT`/`PATCH` em tela multi-usuário exige `expectedUpdatedAt` (ou `version`). Conflito retorna **409** com `currentRecord`, `currentUpdatedAt`, `updatedBy`, `changedFields`.
15. Verificação `SELECT` antes de `INSERT` para unicidade não é suficiente — usar `UNIQUE`/`EXCLUSION constraint` ou `advisory lock` (ver [`guia_sql.md`](guia_sql.md)).
16. Lote/importação: declarar no contrato se é atômico total (uma RPC, rollback integral) ou parcial (resposta por linha, sem responder erro global depois de commit parcial). Se qualquer item falhar num lote atômico, o lote inteiro faz rollback.
17. Operações críticas retentáveis (POST/PUT/PATCH e importação em massa) aceitam idempotency key, persistida por tenant + usuário + rota + hash do request; expira e não pode ser reutilizada com payload diferente.
18. Se uma operação crítica ainda depender de passo pós-save fora da transação, isso deve ser apontado explicitamente como lacuna de integridade no relatório da tarefa.

### Regras de negócio
19. Regra crítica nunca fica só no frontend nem depende de botão desabilitado como controle.
20. Regras reutilizáveis viram função/service central — proibido duplicar validação de status/permissão em múltiplos arquivos.
21. Toda transição de status é validada no backend.

### Performance — banco de dados
22. Proibido `.select("*")` — sempre listar as colunas necessárias.
23. Proibido `.limit()` acima de 1.000 em rota de listagem; acima de 1.000 exige justificativa documentada no TXT da tela. `.limit(50000)` ou mais indica que a lógica deve virar RPC de agregação.
24. Filtros sempre no banco — proibido `data.filter(...)` sobre lista completa trazida para o Node.
25. Filtro **nativo** (existe como coluna, ou resolvível via `.in("id", [...])` antes da query principal) vai direto ao banco. Filtro **derivado** (calculado em runtime cruzando tabelas, sem coluna própria) vira pós-filtro aplicado **somente nos itens da página já retornada** — nunca sobre o dataset completo. Quando isso deixa o `total` aproximado, documentar o trade-off no TXT da tela.
26. Toda query de histórico/auditoria tem `.limit()` explícito: **50** para histórico exibido em modal/tela; até **500** para listas de cruzamento de IDs de uso interno.
27. Dashboard que retorna dados brutos quando o front só exibe totais/percentuais deve virar RPC SQL de agregação — nunca somar/agregar no Node.
28. Toda coluna nova usada como filtro frequente exige migration com índice antes do PR.

### Performance — cliente Supabase, auth e cache
29. `getSupabaseAdmin()` usa singleton — nunca criar um novo cliente por request.
30. `resolveAuthenticatedAppUser` usa cache por token com TTL máximo de 60s (recomendado 30-45s) para reduzir queries de auth repetidas.
31. Proibido chamar `supabase.auth.getUser()`/`getSession()` ou `/api/auth/session-access` dentro de componentes — usar `useAuth()` (ver [`guia_frontend.md`](guia_frontend.md)).
32. Toda rota que retorna lista grande loga o tamanho da resposta se acima de 100KB (`[PERF]`/`[EGRESS]`).
33. Dados de catálogo (raramente alterados) usam `unstable_cache` com `revalidate` de 5-10 min, por tenant. Dados operacionais (programação, medição, saldo, permissões, sessão) **nunca** usam cache.
34. Catálogos e listagem operacional expõem endpoints separados desde o início (`/api/<modulo>/meta` + `/api/<modulo>`), nunca misturados num único payload que recarrega tudo a cada request. Endpoint principal aceita `?meta=0` para pular o que o front já carregou pelo `/meta`.
35. Toda query independente dentro da mesma rota roda em paralelo com `Promise.all` — proibido `await` sequencial sem dependência real entre os dados. Query condicional usa `Promise.resolve(valorPadrao)` no lugar dela dentro do mesmo array, mantendo o paralelismo.

### Tratamento de erros e auditoria
36. Proibido `catch {}` vazio ou engolir erro sem log.
37. Nunca expor stack trace ao usuário nem retornar erro genérico sem contexto — resposta de erro tem categoria (validação, não autenticado, não autorizado, não encontrado, conflito, regra de negócio, banco, integração, inesperado) e mensagem objetiva.
38. Todo erro é logado com contexto: `requestId`, `tenantId`, `userId`, entidade/operação — nunca logar JWT, senha, refresh token, service role ou payload sensível.
39. Toda operação que altera dado crítico (estoque, entradas/saídas, acidentes, permissões) gera log/auditoria: `created_at`/`updated_at`, usuário responsável, histórico de alteração.
40. Erro de tela é registrado com `useErrorLogger("<modulo>")` com tag do módulo.

## 4. Fluxo recomendado

1. Verificar se já existe padrão equivalente implementado (Medição, Medição As Built, Programação) e reaproveitar a arquitetura — não reinventar.
2. Definir se a tela tem lista operacional + catálogo estático → dois endpoints desde o início.
3. Implementar o handler/RPC com transação completa (valor final + campos complementares + histórico na mesma operação).
4. Adicionar `expectedUpdatedAt`/409 se a tela é multi-usuário.
5. Paralelizar queries independentes com `Promise.all`.
6. Rodar o checklist de [`guia_validacao.md`](guia_validacao.md) antes do PR.

## 5. Exemplos

**Pedido:** "Adiciona um filtro por atividade na listagem de Medição, calculado a partir de outra tabela."
**Comportamento esperado:** o filtro é derivado (não existe coluna `activity_id` em `project_measurement_orders`); pré-resolver os IDs elegíveis via `project_measurement_order_items` filtrando por `tenant_id` + `service_activity_id`, depois usar `.in("id", ids)` na query principal — nunca trazer tudo e filtrar no Node. Referência real: `activityOrderIdSet` em `src/app/api/medicao/route.ts`.

**Pedido:** "Cria um dashboard que mostra o total faturado por equipe no mês."
**Comportamento esperado:** RPC SQL com `GROUP BY`/`SUM` no Postgres retornando só o resumo; a rota não busca as ordens brutas para somar em JS.

## 6. Guardrails

Nunca:
- Criar uma rota que aceite `tenant_id` do body como fonte de verdade.
- Fazer `SELECT` antes de `INSERT` para checar unicidade sem `UNIQUE`/`EXCLUSION constraint` no banco.
- Deixar uma escrita crítica sem `expectedUpdatedAt` numa tela multi-usuário.
- Somar/agregar em JavaScript o que o Postgres resolve com `GROUP BY`.
- Criar um novo `SupabaseClient` a cada request.
- Deixar uma feature importar regra de domínio de uma feature irmã.

## 7. Validação

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build` (para mudanças que afetam rota/build)
- Checklist completo de [`guia_validacao.md`](guia_validacao.md) marcado no TXT da tela.
