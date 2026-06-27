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
## Verificacao desta entrega - 2026-06-27
- [x] Regra de Estado Trabalho canonico documentada: `PARCIAL` legado vira `PARCIAL_NAO_PLANEJADO`.
- [x] Regra de grupo documentada: sincronizacao generica usa `programming_group_id`.
- [x] Regra de conclusao documentada: `CONCLUIDO` nao propaga e bloqueia quando ha outra linha ativa no grupo.
