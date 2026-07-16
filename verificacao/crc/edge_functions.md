# CRC — Edge Functions (Importacoes XLSX)

> CRC = Componente / Responsabilidade / Colaboradores
> Atualizar sempre que houver mudanca estrutural nos Edge Functions ou em _shared/.

---

## Visao Geral

**Tipo:** Deno Edge Functions (Supabase)
**Page Key (permissao):** `projetos` (action: `import` → coluna `can_insert`)

Recebem upload de arquivo XLSX via multipart/form-data, validam autenticacao
e permissao do usuario, parseem a planilha, e chamam RPCs para inserir
previsoes por projeto. Retornam 200 (sucesso total), 207 (parcial por projeto)
ou 4xx/5xx (erro de validacao ou autenticacao).

---

## Arquivos do Modulo

| Arquivo | Responsabilidade |
|---|---|
| `supabase/edge_functions/import_project_forecast/index.ts` | Importacao de materiais previstos por projeto |
| `supabase/edge_functions/import_project_activity_forecast/index.ts` | Importacao de atividades previstas por projeto |
| `supabase/edge_functions/_shared/http.ts` | corsHeaders (ALLOWED_ORIGIN env), respond(), getBearerToken() |
| `supabase/edge_functions/_shared/xlsx.ts` | parseWorkbook(), tipos ParsedRow/ImportIssue, utilitarios de normalizacao |
| `supabase/edge_functions/_shared/supabase.ts` | createServiceClient() com service_role |
| `supabase/edge_functions/_shared/page_authorization.ts` | requirePageAccess() + requireActiveTenant() |

---

## Dependencias Externas (RPCs)

| RPC | Funcao |
|---|---|
| `precheck_project_material_forecast_import` | Valida se importacao pode ser feita (precheck) |
| `append_project_material_forecast` | Insere materiais previstos atomicamente por projeto |
| `precheck_project_activity_forecast_import` | Valida se importacao pode ser feita (precheck) |
| `append_project_activity_forecast` | Insere atividades previstas atomicamente por projeto |

---

## Tabelas Supabase Acessadas

| Tabela | Operacao | Observacao |
|---|---|---|
| `app_users` | SELECT | auth_user_id → tenant_id, ativo, role_id |
| `tenants` | SELECT | Verifica campo `ativo` |
| `app_roles` | SELECT | is_admin para short-circuit de permissao |
| `app_user_page_permissions` | SELECT | can_access + can_insert para page `projetos` |
| `project` | SELECT | sob → id, filtrado por tenant_id |
| `materials` | SELECT | codigo → id, filtrado por tenant_id |
| `service_activities` | SELECT | code → id, filtrado por tenant_id + ativo=true |
| `project_material_forecast` | SELECT | Checagem de duplicatas antes de inserir |
| `project_activity_forecast` | SELECT | Checagem de duplicatas antes de inserir |

---

## Regras de Negocio Principais

1. **Autenticacao:** Bearer token validado via `supabase.auth.getUser()`. Sem token ou token invalido → 401.
2. **Tenant ativo:** `tenants.ativo` deve ser `true` antes de qualquer operacao. Inativo → 403.
3. **Permissao de importacao:** `app_user_page_permissions.can_access = true AND can_insert = true` para page `projetos`. Admins (`app_roles.is_admin = true`) passam direto.
4. **Atomicidade por projeto:** Falha em um projeto nao interrompe os demais. Loop usa `continue` em erros. Resposta 207 lista `projectsSucceeded` e `projectsFailed`.
5. **Idempotencia parcial:** Linhas ja existentes no projeto sao ignoradas (skipped), nao causam erro. Contadas em `skippedRows`.
6. **CORS:** Origem controlada por env `ALLOWED_ORIGIN` (default `*`). Configurar no Supabase Secrets.
7. **Tamanho maximo:** 5MB por arquivo XLSX.
8. **Cabecalho obrigatorio:** Colunas `projeto`, `codigo`, `quantidade` (normalizadas — sem acento, lowercase, underscores).

---

## Resposta da API

| Status | Significado |
|---|---|
| 200 | Todos os projetos importados com sucesso |
| 207 | Importacao parcial — `projectsFailed[]` indica quais projetos falharam e o motivo |
| 400 | Erro de validacao na planilha (cabecalho, campos invalidos, projetos/itens nao encontrados) |
| 401 | Nao autenticado ou sessao invalida |
| 403 | Sem permissao, tenant inativo ou usuario inativo |
| 405 | Metodo nao permitido (apenas POST) |
| 500 | Erro interno (query falhou) |

---

## Pontos de Atencao (Riscos)

- [x] Concorrencia: precheck RPC por projeto previne conflitos de estado
- [x] Gravacao parcial: 207 informa exatamente quais projetos foram gravados
- [ ] Rate limiting: nao implementado (requer Deno KV — fora de escopo atual)
- [x] Tamanho de planilha: limitado a 5MB, parseado em memoria (Deno)

---

## Historico de Mudancas Relevantes

| Data | Mudanca |
|---|---|
| 2026-06-21 | Extracao de _shared/ (http, xlsx, supabase, page_authorization); correcao de action mapping (import→can_insert); requireActiveTenant; atomicidade por projeto com 207 parcial; CORS por ALLOWED_ORIGIN env |
