# CRC — Permissoes (app_user_page_permissions)

## Escopo

Controle de acesso por tela + acao para usuarios do sistema multi-tenant.
Cobre o guard server-side (`pageAuthorization.ts`), a funcao SQL `user_has_page_action()`,
o RPC de persistencia (`save_user_permissions`) e a autorizacao das Edge Functions
(`_shared/page_authorization.ts`).

---

## Tabelas acessadas

| Tabela | Operacao | Contexto |
|---|---|---|
| `app_user_page_permissions` | SELECT (7 colunas) | Guard server-side — verifica acao do usuario |
| `app_user_page_permissions` | INSERT / UPSERT | Trigger de novo usuario/tela; RPC save_user_permissions |
| `app_pages` | SELECT | Fallback de `default_user_access` quando sem linha de usuario |
| `app_roles` | SELECT | Admin short-circuit (`is_admin`) |
| `role_page_permissions` | SELECT (7 colunas) | Fallback de acesso por role e acao |
| `app_user_tenants` | SELECT | Escopo de usuario alvo vinculado ao tenant atual na tela de Permissoes |

---

## Colunas de `app_user_page_permissions` (pos-migration 253)

| Coluna | Acao mapeada | Backfill |
|---|---|---|
| `can_access` | `read` | — (pre-existia) |
| `can_create` | `create` | = `can_access` |
| `can_update` | `update` | = `can_access` |
| `can_cancel` | `cancel` | = `can_access` |
| `can_reverse` | `reverse` | = `can_access` |
| `can_import` | `import` | = `can_access` |
| `can_export` | `export` | = `can_access` |

---

## Guard server-side — `src/lib/server/pageAuthorization.ts`

Funcao publica: `requirePageAction({ context, pageKey, action }): Promise<PageActionAuthorization>`

Fluxo:
1. Admin short-circuit: `context.role.isAdmin → allowed (source: "admin")`
2. Busca linha em `app_user_page_permissions` com todas as 7 colunas.
3. Se encontrado: `granted = can_access && ACTION_COLUMN[action]`
4. Se nao encontrado: verifica `app_pages.default_user_access`; se falso → deny
5. Se default ok: verifica `role_page_permissions.can_access` do role do usuario
6. Role com `can_access=true` → `allowed (source: "role")` (acesso a tela = todas as acoes liberadas via role)

`ACTION_COLUMN`:
```
read    → can_access
create  → can_create
update  → can_update
cancel  → can_cancel
reverse → can_reverse
import  → can_import
export  → can_export
```

---

## Funcao SQL — `user_has_page_action(p_page_key text, p_action text)`

- Resolve `app_users` por `auth.uid()`
- Usa `CASE p_action WHEN 'read' THEN can_access WHEN 'create' THEN can_access AND can_create ...`
- Retorna `boolean`; `false` se usuario nao encontrado ou sem linha de permissao

---

## RPC — `save_user_permissions`

Parametros: `p_tenant_id, p_actor_user_id, p_target_user_id, p_role_id, p_ativo, p_permissions jsonb, p_expected_updated_at`

Excecao desde a migration 385: quando `p_role_id` aponta para `viewer`, a RPC grava apenas leitura.
Paginas fora da whitelist de consulta sao forçadas para `can_access=false`; paginas permitidas
ficam com `can_access=true` e todas as acoes (`can_create`, `can_update`, `can_cancel`,
`can_reverse`, `can_import`, `can_export`) = `false`.

Comportamento na gravacao de cada pagina:
- Toggle `enabled=true` → todas as 7 colunas = `true`
- Toggle `enabled=false` → todas as 7 colunas = `false`
- Historico em `app_user_permission_history` registra mudanca de `can_access`
- Concorrencia protegida por `FOR UPDATE` em `app_users` + check `updated_at`

Granularidade fina por acao (ex: liberar `read` sem `export`) requer UI dedicada futura
e mudanca no RPC para aceitar as 7 flags individualmente.

Desde a migration 386, a RPC tambem aceita usuario alvo cujo `app_users.tenant_id` seja
diferente de `p_tenant_id`, desde que exista vinculo ativo em `app_user_tenants` para o
tenant atual. Isso alinha o save com a busca/listagem da tela de Permissoes e evita que
um usuario multi-tenant apareca na UI mas falhe no salvamento.

---

## Edge Functions — `_shared/page_authorization.ts`

Funcao publica: `requirePageAccess(supabase, appUser, pageKey, action)`

- Sem `auth.uid()` — recebe `appUser` explicitamente (service-role)
- Admin short-circuit por `app_roles.is_admin`
- Seleciona as 7 colunas granulares; checa `can_access && ACTION_COLUMN[action]`
- Sem fallback para `role_page_permissions` (edge functions requerem linha explicita)

Acoes usadas nas Edge Functions:
- `import_project_forecast`: `requirePageAccess(sb, user, 'projetos', 'import')`
- `import_project_activity_forecast`: `requirePageAccess(sb, user, 'projetos', 'import')`

---

## Triggers

| Trigger | Tabela | Funcao | Efeito |
|---|---|---|---|
| `trg_app_pages_force_blocked_by_default` | `app_pages` BEFORE INSERT | `force_new_app_page_blocked_by_default()` | Forca `default_user_access = false`; tela nova nasce bloqueada mesmo que a migration passe `true` |
| `trg_app_users_default_page_permissions` | `app_users` AFTER INSERT | `ensure_app_user_default_page_permissions()` | Insere linha para cada tela ativa; todas as 7 colunas = `is_admin` ou `default_user_access` |
| `trg_app_pages_default_user_permissions` | `app_pages` AFTER INSERT | `ensure_app_page_default_user_permissions()` | Insere linha para cada usuario existente; todas as 7 colunas = `is_admin` ou `default_user_access` |

**Ordem importa.** No `insert into app_pages`, o BEFORE roda antes do AFTER: o trigger de matriz
sempre enxerga `default_user_access = false`. E o AFTER ja criou a linha de todos os usuarios
antes de qualquer backfill escrito na mesma migration — backfill com
`on conflict (tenant_id, user_id, page_key) do nothing` e sempre no-op (incidente da migration
355, ver `docs/Tela_Permissoes_SaaS.txt`, Atualizacao 2026-08). Usar `do update` quando o
backfill precisar definir valor por usuario.

Liberar uma tela para usuarios comuns exige passo EXPLICITO e posterior ao INSERT:
`update app_pages set default_user_access = true ...` + backfill em
`app_user_page_permissions` (padrao da migration 348).

---

## Onde o gate e aplicado

A tabela manual que existia aqui foi removida em 2026-08-25: ela listava 15 rotas, estava 13 rotas
desatualizada e, por so mostrar o lado positivo, nao servia para responder a pergunta que importa
("esta rota esta protegida?"). Duas fontes substituem ela.

**1. Mapa por handler de escrita** — secao seguinte deste documento, mantida junto com o codigo.

**2. Regeneracao** — para conferir o estado real a qualquer momento:

```bash
# rotas que aplicam o gate no proprio arquivo
grep -rln "requirePageAction\|authorizePageAction" src/app/api --include=route.ts

# rotas que delegam: o gate esta no modulo, nao na rota
grep -rln "requirePageAction" src/server/modules
```

Um `route.ts` sem ocorrencia **nao** significa rota sem gate: varias delegam para
`src/server/modules/` (`projects`, `medicao`, `programacao-normalizada`,
`cronograma-solicitacoes`, `warehouse-addressing`, `dashboard-measurement`,
`dashboard-portfolio`), onde a autorizacao fica centralizada em `authorization.ts`,
`handlers.ts` ou `controller.ts`. Qualquer varredura que ignore esse nivel produz falso positivo.

## Cobertura de `requirePageAction` nas rotas de escrita

Ultima varredura: 2026-08-25, sobre `src/app/api/**/route.ts`, considerando gate direto no arquivo
da rota **ou** no modulo de `src/server/modules/` para onde ela delega.

| Total de rotas com handler de escrita | Com gate | Sem gate |
|---|---|---|
| 41 | 37 | 4 |

As 4 sem gate usam outro mecanismo e nao sao lacuna:

| Rota | Mecanismo |
|---|---|
| `POST/DELETE /api/auth/active-tenant` | fluxo anterior a qualquer pagina |
| `POST /api/auth/local-login` | fluxo anterior a qualquer pagina |
| `POST /api/app-users/[userId]/invite` | `resolveAdminOperator` |
| `PUT /api/app-users/[userId]/permissions` | `resolveAdminOperator` |

### Helper padrao

`authorizePageAction(context, pageKey, action)` em `src/lib/server/routeAuthorization.ts` aplica
`requirePageAction` e devolve a resposta de erro pronta (`{ message, code }`, status 403 ou 500) ou
`null` para seguir. Usar este helper em rota nova em vez de repetir o bloco.

### Acao por handler

| Rota | pageKey | create | update | cancel | import |
|---|---|---|---|---|---|
| `/api/job-titles` | `cargo` | POST unitario | PUT, PATCH ativar | PATCH cancelar | POST `BATCH_IMPORT` |
| `/api/teams` | `equipes` | POST unitario | PUT, PATCH ativar/permutar | PATCH cancelar | POST `BATCH_IMPORT` |
| `/api/activities` | `atividades` | POST unitario | PUT, PATCH ativar | PATCH cancelar | POST `BATCH_IMPORT` |
| `/api/people` | `pessoas` | POST unitario | PUT, PATCH ativar | PATCH cancelar | POST `BATCH_IMPORT` |
| `/api/medicao` | `medicao` | POST | PUT, PATCH FECHAR/ABRIR | PATCH CANCELAR | `BATCH_IMPORT_PARTIAL` |
| `/api/medicao-asbuilt` | `medicao-asbuilt` | POST | PUT, PATCH FECHAR/ABRIR | PATCH CANCELAR | `BATCH_IMPORT_PARTIAL` |
| `/api/faturamento` | `faturamento` | POST | PUT, PATCH FECHAR/ABRIR | PATCH CANCELAR | `BATCH_IMPORT_PARTIAL` |
| `/api/controle-apr` | `controle-apr` | POST | PUT, PATCH situacao | — | — |
| `/api/locacao` (+ `/activities`, `/materials`) | `locacao` | POST | PUT | — | — |
| `/api/composicao-equipe` | `composicao-equipe` | POST | PUT | — | — |
| `/api/trafo-positions` | `posicao-trafo` | — | POST (RET) | — | — |
| `/api/stock-transfers/import` | `entrada` | — | — | — | POST |

O cadastro em massa usa `import`, nao `create`, e o gate fica **dentro** do ramo do
`BATCH_IMPORT` — padrao de permissao granular do CLAUDE.md. Isso permite revogar importacao sem
tirar o cadastro unitario, o que importa porque uma chamada de lote grava ate 500 registros
(`MASS_IMPORT_ROW_LIMIT`).

### Checagem manual duplicada, ainda existente

`/api/faturamento` e `/api/medicao-asbuilt` tem `ensureBillingPageAccess` e
`ensureAsbuiltMeasurementPageAccess`: verificacao propria que consulta apenas `can_access`, ignora
as colunas granulares e nao consulta `app_pages.default_user_access`. Elas cobrem o `read` dessas
rotas e dos sub-endpoints de meta/catalogo, e por isso foram mantidas quando os gates de escrita
entraram. Unificar em `requirePageAction` e limpeza pendente: a ordem de fallback nao e a mesma
(`requirePageAction` exige `default_user_access = true` antes de olhar `role_page_permissions`),
entao a troca precisa ser validada contra dado real.

### Lacuna remanescente: gates de leitura

Este levantamento cobriu apenas handlers de escrita. A maioria das rotas acima segue sem
`requirePageAction` com acao `read` nos respectivos `GET`.

## Historico de migrations relevantes

| Migration | Descricao |
|---|---|
| 026 | Removeu colunas `can_select`, `can_insert`, `can_update`; simplificou para apenas `can_access` |
| 077 | RPC `save_user_permissions` |
| 245 | Adicionou `default_user_access` em `app_pages`; triggers de default |
| 253 | Adicionou 6 colunas granulares; backfill; `user_has_page_action()` atualizada; triggers e RPC atualizados |
| 348 | Padrao de liberacao explicita de tela para o papel `user` (default + role template + backfill das 7 colunas + historico) |
| 355 | Cadastrou `medicao-visualizacao` herdando `default_user_access` de `medicao` — liberou a tela para todos por engano |
| 356 | Trigger BEFORE INSERT `force_new_app_page_blocked_by_default()`; corrigiu `medicao-visualizacao` para `false` |
| 385 | Reduz roles ativos para `admin`, `user`, `viewer`; migra `master`/`supervisor`; fecha `viewer` como leitura apenas tambem na RPC |
