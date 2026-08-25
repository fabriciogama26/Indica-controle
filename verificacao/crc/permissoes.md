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

> A tabela acima esta DESATUALIZADA e lista apenas o lado positivo, entao nao serve para concluir
> que o resto esta coberto. Conferido em 2026-08-25: 13 rotas que usam `requirePageAction` nao
> aparecem nela — `/api/materials`, `/api/materials/meta`, `/api/apuracao-fator-minimo`,
> `/api/stock-requisitions` (mais `/cancel`, `/claim`, `/fulfill`), `/api/stock-reversal-requests`,
> `/api/stock-transfers`, `/api/team-stock-operations` (mais `/day-foremen`, `/import`, `/meta`).
> Ao atualizar esta secao, atualizar tambem a seguinte: e a ausencia da contraparte negativa que
> deixou a lacuna invisivel ate 2026-08-25.

---

## Rotas de escrita SEM `requirePageAction`

Levantamento de 2026-08-25 sobre `src/app/api/**/route.ts`, considerando gate direto no arquivo da
rota **ou** no modulo de `src/server/modules/` para onde ela delega (`projects`, `medicao`,
`programacao-normalizada`, `cronograma-solicitacoes`, `warehouse-addressing`, `dashboard-*`).

| Total de rotas com handler de escrita | Com gate | Sem gate |
|---|---|---|
| 41 | 23 | 18 |

Das 18 sem gate, 4 usam outro mecanismo de autorizacao e nao sao lacuna:

| Rota | Mecanismo |
|---|---|
| `POST/DELETE /api/auth/active-tenant` | fluxo anterior a qualquer pagina; `DELETE` exige sessao valida antes de limpar cookie |
| `POST /api/auth/local-login` | fluxo anterior a qualquer pagina |
| `POST /api/app-users/[userId]/invite` | `resolveAdminOperator` |
| `PUT /api/app-users/[userId]/permissions` | `resolveAdminOperator` |

As 14 restantes validam apenas `resolveAuthenticatedAppUser` (autenticado + escopo de tenant):

| Rota | Handlers |
|---|---|
| `/api/activities` | `POST`, `PUT`, `PATCH` |
| `/api/composicao-equipe` | `POST`, `PUT` |
| `/api/controle-apr` | `POST`, `PUT`, `PATCH` |
| `/api/faturamento` | `POST`, `PUT`, `PATCH` |
| `/api/job-titles` | `POST`, `PUT`, `PATCH` |
| `/api/locacao` | `POST`, `PUT` |
| `/api/locacao/activities` | `POST`, `PUT` |
| `/api/locacao/materials` | `POST`, `PUT` |
| `/api/medicao` | `POST`, `PUT`, `PATCH` |
| `/api/medicao-asbuilt` | `POST`, `PUT`, `PATCH` |
| `/api/people` | `POST`, `PUT`, `PATCH` |
| `/api/stock-transfers/import` | `POST` |
| `/api/teams` | `POST`, `PUT`, `PATCH` |
| `/api/trafo-positions` | `POST` |

Nota sobre `/api/medicao`: existe `src/server/modules/medicao/authorization.ts`, mas ele exporta
apenas `authorizeMeasurementReadOrExportAction`, consumido por `/api/medicao/export` e
`/api/medicao/programming-sources`. Os handlers de escrita de `/api/medicao` nao passam por ele.

### Por que isso nao e apenas defesa em profundidade

`resolveAuthenticatedAppUser` devolve um cliente `service_role`
(`src/lib/server/appUsersAdmin.ts`), que nao passa por RLS, e as RPCs de escrita desses modulos
recebem `grant execute ... to service_role` (ex.: `save_job_title_record` /
`set_job_title_record_status` na migration 371). Nessas 14 rotas, portanto:

1. a matriz de permissoes por pagina/acao nunca e consultada;
2. a RLS nao funciona como barreira de reserva, porque o cliente a contorna;
3. o unico controle efetivo e `autenticado + pertence ao tenant`.

Consequencia a verificar antes de dimensionar a correcao: a migration 385 fechou `viewer` como
leitura apenas gravando `create/update/cancel/reverse/import/export = false`, mas essas colunas so
sao lidas por `requirePageAction` — em rota sem gate elas nao chegam a ser consultadas. Confirmar
em ambiente controlado se um `viewer` autenticado consegue escrever em uma dessas rotas.

Agravante de alcance: `/api/job-titles`, `/api/teams`, `/api/activities` e `/api/people` aceitam
`action = BATCH_IMPORT`, entao uma unica chamada sem gate grava ate 500 registros
(`MASS_IMPORT_ROW_LIMIT`) em vez de um.

Backlog: item aberto `[Seguranca][Autorizacao]` no topo de `TASKS.md`.

---

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
