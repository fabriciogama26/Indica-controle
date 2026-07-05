# Segurança

## ❌ NÃO FAZER
- Expor tokens, senhas ou chaves no frontend
- Usar NEXT_PUBLIC para dados sensíveis
- Permitir acesso por ID sem validar dono (IDOR)
- Retornar dados de outro usuário
- Aceitar input sem sanitização
- Permitir upload sem validação
- Logar dados sensíveis

## ✅ FAZER
- Validar autenticação em todas rotas protegidas
- Validar autorização (owner/tenant/role)
- Sanitizar inputs (XSS, injection)
- Usar variáveis seguras no backend
- Implementar rate limit em rotas críticas
- Validar acesso antes de retornar dados
## Verificacao desta entrega - 2026-06-27
- [x] Migration 277 nao cria rota/API nova.
- [x] Funcoes SECURITY DEFINER novas/recriadas revogam `public`, `anon` e `authenticated` e concedem execute para `service_role`.
- [x] Nao aplicavel: mudanca de menu/permissao de tela.

## Verificacao desta entrega - 2026-07-04
- [x] `GET /api/medicao/export` valida sessao com `resolveAuthenticatedAppUser`.
- [x] `GET /api/medicao/export` exige `requirePageAction` com `page_key=medicao` e `action=export`.
- [x] A rota nao recebe nem confia em `tenant_id`, usuario, role ou auditoria vindos do cliente.

## Verificacao desta entrega - 2026-07-05
- [x] Novas rotas `/api/warehouse-addressing/*` validam sessao e `requirePageAction`.
- [x] `GET/POST/PUT/PATCH /api/materials` e `GET /api/materials/meta` passaram a exigir `requirePageAction`.
- [x] RPCs novas revogam `public`, `anon` e `authenticated`, concedendo EXECUTE apenas para `service_role`.
