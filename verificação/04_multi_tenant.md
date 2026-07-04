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
## Verificacao desta entrega - 2026-06-27
- [x] Backfill e catalogo filtram por `tenant_id`.
- [x] Sincronizacao de Estado Trabalho filtra por `tenant_id` e `programming_group_id`.
- [x] Bloqueio de `CONCLUIDO` verifica somente linhas do mesmo `tenant_id`.

## Verificacao desta entrega - 2026-07-04
- [x] Exportacao de Medicao deriva tenant da sessao autenticada.
- [x] A rota reaproveita a listagem `/api/medicao`, que filtra dados por `tenant_id` no servidor.
- [x] Nao aplicavel: nenhuma escrita, migration, FK ou RLS alterada.
