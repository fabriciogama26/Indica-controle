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
