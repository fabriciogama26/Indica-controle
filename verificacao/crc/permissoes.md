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
| `role_page_permissions` | SELECT | Fallback de acesso por role (apenas `can_access`) |

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

Comportamento na gravacao de cada pagina:
- Toggle `enabled=true` → todas as 7 colunas = `true`
- Toggle `enabled=false` → todas as 7 colunas = `false`
- Historico em `app_user_permission_history` registra mudanca de `can_access`
- Concorrencia protegida por `FOR UPDATE` em `app_users` + check `updated_at`

Granularidade fina por acao (ex: liberar `read` sem `export`) requer UI dedicada futura
e mudanca no RPC para aceitar as 7 flags individualmente.

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
| `trg_app_users_default_page_permissions` | `app_users` AFTER INSERT | `ensure_app_user_default_page_permissions()` | Insere linha para cada tela ativa; todas as 7 colunas = `is_admin` ou `default_user_access` |
| `trg_app_pages_default_user_permissions` | `app_pages` AFTER INSERT | `ensure_app_page_default_user_permissions()` | Insere linha para cada usuario existente; todas as 7 colunas = `is_admin` ou `default_user_access` |

---

## Rotas que usam `requirePageAction`

| Rota | PageKey | Acoes usadas |
|---|---|---|
| `GET /api/programacao` | `programacao-simples` | `read` |
| `POST /api/programacao` (BATCH_CREATE) | `programacao-simples` | `create` |
| `PUT /api/programacao` | `programacao-simples` | `update` |
| `GET /api/projects` | `projetos` | `read` |
| `POST /api/projects` | `projetos` | `create` |
| `PUT /api/projects` | `projetos` | `update` |
| `PATCH /api/projects` (cancel) | `projetos` | `cancel` |
| `PATCH /api/projects` (activate) | `projetos` | `update` |
| `GET /api/mapa-programacao` | `mapa-programacao` | `read` |
| `GET /api/meta` | `meta` | `read` |
| `GET /api/stock-transfers/reversal` | `estoque` | `read` |
| `POST /api/stock-transfers/reversal` | `estoque` | `reverse` |
| `GET /api/team-stock-operations/reversal` | `estoque-equipes` | `read` |
| `POST /api/team-stock-operations/reversal` | `estoque-equipes` | `reverse` |
| `GET /api/dashboard-measurement` | `dashboard-medicao` | `read` |

---

## Historico de migrations relevantes

| Migration | Descricao |
|---|---|
| 026 | Removeu colunas `can_select`, `can_insert`, `can_update`; simplificou para apenas `can_access` |
| 077 | RPC `save_user_permissions` |
| 245 | Adicionou `default_user_access` em `app_pages`; triggers de default |
| 253 | Adicionou 6 colunas granulares; backfill; `user_has_page_action()` atualizada; triggers e RPC atualizados |
