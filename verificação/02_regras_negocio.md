# Regras de Negócio

## ❌ NÃO FAZER
- Colocar regra crítica apenas no frontend
- Depender de botão desabilitado como regra
- Duplicar regra de negócio em múltiplos arquivos
- Permitir alteração de status sem validação
- Ignorar validação de permissão no backend

## ✅ FAZER
- Centralizar regras no backend
- Validar todas ações críticas no servidor
- Criar funções/services para regras reutilizáveis
- Controlar transições de status
- Garantir consistência independente do frontend