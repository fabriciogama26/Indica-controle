# Multi-Tenant

## ❌ NÃO FAZER
- Buscar dados sem filtrar por tenant
- Misturar dados de usuários diferentes
- Confiar no frontend para filtrar dados
- Usar cache compartilhado sem isolamento

## ✅ FAZER
- Filtrar TODAS queries por tenant_id
- Validar tenant no backend
- Garantir isolamento completo de dados
- Incluir tenant_id em inserts
- Testar vazamento entre contas