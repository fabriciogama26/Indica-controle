# Integridade de Dados

## ❌ NÃO FAZER
- Sobrescrever registros sem verificar versão/conflito
- Fazer UPDATE parcial que zera campos não enviados
- Permitir inserção duplicada sem controle (unique)
- Permitir exclusão sem validar dependências
- Depender apenas do front para validação
- Salvar dados incompletos ou inconsistentes
- Ignorar concorrência (multiusuário)

## ✅ FAZER
- Validar dados no backend sempre
- Usar constraints no banco (UNIQUE, NOT NULL, FK)
- Usar transações em operações críticas
- Validar existência antes de atualizar/deletar
- Implementar controle de concorrência (updated_at ou version)
- Garantir consistência antes de salvar
- Tratar inserções duplicadas (idempotência quando necessário)
## Verificacao desta entrega - 2026-06-27
- [x] Migration 277 usa backfill transacional para normalizar `PARCIAL` legado e falha se sobrarem linhas inconsistentes.
- [x] Trigger novo bloqueia `CONCLUIDO` quando houver outra programacao ativa no mesmo `programming_group_id`.
- [x] Nao aplicavel: exclusao fisica de dados.

## Verificacao desta entrega - 2026-07-05
- [x] Migration 288 cria constraints para limites de estoque e posicao unica no mapa.
- [x] RPCs de configuracao e endereco validam tenant, centro, material e posicao antes de gravar.
- [x] Layout nao pode remover posicao ocupada sem realocar/remover o endereco antes.
