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

## Verificacao desta entrega - 2026-07-05
- [x] Regra de layout fisico ficou no backend/RPC, nao apenas na tela.
- [x] Regra de ocupacao de posicao unica ficou protegida por UNIQUE e RPC.
- [x] Nao aplicavel: esta etapa nao movimenta saldo de estoque.
- [x] Centro fisico foi identificado por `stock_centers` sem vinculo em `teams.stock_center_id`, nao por texto do nome.
