# CRC — Autenticação e Sessão

> Atualizado: 2026-06 | Módulo transversal — afeta todas as 68 rotas de API.
> ⚠️ Qualquer mudança aqui afeta 100% do sistema. Testar com cuidado.

---

## Visão Geral

**Módulo:** Auth e Sessão (não tem tela própria — é infraestrutura)
**Page Key:** `—` (não requer permissão, é a base)
**Afeta:** Todas as 68 rotas de API, `AuthContext`, `useAuth`

**O que faz:**
> Gerencia autenticação de usuários (login, logout, sessão), resolução de tenant, carregamento de permissões por página e controle de inatividade.

---

## Arquivos do Módulo

| Arquivo | Responsabilidade |
|---|---|
| `src/context/AuthContext.tsx` | Contexto client-side — sessão, idle timeout, sincronização de token |
| `src/services/auth/auth.service.ts` | Login, logout, hidratação, sincronização de tokens |
| `src/hooks/useAuth.ts` | Hook de acesso ao AuthContext |
| `src/lib/supabase/client.ts` | Cliente Supabase para o front-end |
| **`src/lib/server/appUsersAdmin.ts`** | **Resolução de auth no servidor — chamado em TODA rota de API** |
| `src/lib/server/pageAuthorization.ts` | Verificação de permissão por page_key e action |
| `src/app/api/auth/local-login/route.ts` | Login local (desenvolvimento) |
| `src/app/api/auth/session-access/route.ts` | Carrega permissões da sessão |

---

## Fluxo de Autenticação

```
1. Usuário entra na tela de login
2. POST /functions/v1/auth-login-web (Supabase Edge Function)
   → retorna access_token + refresh_token
3. auth.service.ts persiste sessão em localStorage (INDICA.saas.auth)
4. GET /api/auth/session-access
   → retorna user, pageAccess, hasCustomPermissions
5. AuthContext armazena a sessão completa
6. useAuth() expõe para todos os componentes

Idle Timeout:
  - setInterval de 15s verifica tempo desde última atividade
  - Após 30min sem atividade → expira sessão automaticamente
  - Eventos de atividade: pointerdown, keydown, mousemove, touchstart, scroll
```

---

## Queries por Request (impacto em TODA rota de API)

```
resolveAuthenticatedAppUser (appUsersAdmin.ts):
  1. supabase.auth.getUser(token)     → Supabase Auth
  2. app_users.select(...)            → WHERE auth_user_id = $1
  3. app_roles.select(...)            → WHERE id = $1
  4. app_user_tenants.select(...)     → WHERE user_id = $1 AND ativo = true

requirePageAction (pageAuthorization.ts):
  5. app_user_page_permissions.select(...)  → WHERE tenant_id, user_id, page_key, action

Total por request: 4-5 queries ANTES de qualquer dado de negócio
Com 68 rotas e páginas que carregam 5-10 APIs: centenas de queries de auth por sessão de uso
```

---

## Tabelas Supabase Acessadas

| Tabela | Operação | Frequência | Índice necessário |
|---|---|---|---|
| `app_users` | SELECT | A cada request | ✅ `(auth_user_id)` obrigatório |
| `app_roles` | SELECT | A cada request | ✅ `(id)` — provavelmente já existe como PK |
| `app_user_tenants` | SELECT | A cada request | ✅ `(user_id, ativo)` obrigatório |
| `app_user_page_permissions` | SELECT | A cada request com permissão | ✅ `(tenant_id, user_id, page_key)` |

---

## Regras de Negócio Principais

1. **Todo endpoint** deve chamar `resolveAuthenticatedAppUser` antes de qualquer operação.
2. **Tenant isolation:** `activeTenantId` resolvido a partir do header `x-tenant-id` ou tenant padrão do usuário. Nunca confiar no tenant vindo do body do request.
3. **Usuário inativo:** `ativo = false` retorna 403 imediatamente, sem consultar dados de negócio.
4. **Multi-tenant:** Admin pode ter acesso a múltiplos tenants via `app_user_tenants`. O tenant ativo é resolvido no servidor.
5. **Permissões customizadas:** Se o usuário tem entradas em `app_user_page_permissions`, elas sobrescrevem o padrão da role.
6. **Token expirado:** `TOKEN_EXPIRED` limpa sessão sem chamar `supabase.auth.signOut()` (para evitar loop).

---

## Pontos de Atenção (Riscos)

- [x] **CRÍTICO:** `getSupabaseAdmin()` cria novo cliente Supabase a cada request — usar singleton.
- [x] **CRÍTICO:** `resolveAuthenticatedAppUser` faz 4 queries sem cache — implementar cache por token (TTL 45s).
- [ ] Cache de auth NÃO deve sobreviver à desativação do usuário (TTL máximo de 60s).
- [ ] Ao adicionar cache, validar que `is_admin` e tenant disponível são re-verificados quando o token mudar.
- [ ] `pageAuthorization.ts` — verificar se query de permissões também precisa de cache ou índice.

---

## Colaboradores

| Módulo | Como usa |
|---|---|
| Todas as 68 rotas | `resolveAuthenticatedAppUser` → `requirePageAction` |
| `AuthContext.tsx` | `supabase.auth.onAuthStateChange` para TOKEN_REFRESHED |
| `auth.service.ts` | `hydrateSessionAccess` → chama `/api/auth/session-access` |

---

## Histórico de Mudanças Estruturais

| Data | O que mudou |
|---|---|
| 2026-06 | CRC criado com identificação dos problemas de criação de client e ausência de cache |
