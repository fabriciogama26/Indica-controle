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