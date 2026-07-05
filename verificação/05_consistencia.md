# Consistência de Dados

## ❌ NÃO FAZER
- Usar nomes de campos diferentes entre front/back/db
- Tratar tipo errado (string vs number)
- Ignorar timezone em datas
- Deixar enums inconsistentes
- Enviar campos inesperados sem validação

## ✅ FAZER
- Padronizar nomes de campos
- Validar tipos no backend
- Usar schema de validação (Zod/Yup)
- Garantir consistência entre camadas
- Tratar datas corretamente (UTC)
## Verificacao desta entrega - 2026-06-27
- [x] Tipo frontend `WorkCompletionStatus` foi fechado nos codigos canonicos.
- [x] Normalizadores backend/frontend convertem aliases legados para codigos canonicos.
- [x] Docs e TASKS foram atualizados com a regra final.

## Verificacao desta entrega - 2026-07-05
- [x] Tipos compartilhados do mapa seguem `ConfiguracaoMapa`, `Prateleira`, `AndarConfig` e `Material`.
- [x] Campos de limite usam `stock_minimum`/`stock_maximum` no banco e `stockMinimum`/`stockMaximum` na API/frontend.
- [x] `npx tsc --noEmit` executado sem erros.
- [x] `StockCenterOption` explicita `centerKind = PHYSICAL_WAREHOUSE` para diferenciar a lista do cadastro geral de centros.
- [x] Tipo `StorageType = SHELF | PALLET` foi propagado entre banco, server module e frontend.
- [x] Constantes frontend foram separadas em `MAX_COLUMN_COUNT=15`, `MAX_LINE_COUNT=20`, `MAX_FLOORS=10` e `MAX_POSITIONS_PER_FLOOR=10`.
