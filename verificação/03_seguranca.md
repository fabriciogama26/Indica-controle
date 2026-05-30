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