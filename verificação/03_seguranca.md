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
