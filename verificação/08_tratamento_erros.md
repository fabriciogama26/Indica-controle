# Tratamento de Erros

## ❌ NÃO FAZER
- Usar catch vazio
- Ignorar erro
- Expor stack trace ao usuário
- Retornar erro genérico sem contexto

## ✅ FAZER
- Tratar todos erros no backend
- Retornar mensagem clara para o frontend
- Logar erro com contexto
- Criar padrão de resposta de erro
- Usar try/catch corretamente
## Verificacao desta entrega - 2026-06-27
- [x] Migration 277 falha com mensagens detalhadas quando encontra `PARCIAL` remanescente.
- [x] Migration 277 falha com detalhes quando encontra `CONCLUIDO` com outra linha ativa no grupo.
- [x] Trigger retorna SQLSTATE `23514` para violacao de grupo operacional.

## Verificacao desta entrega - 2026-07-04
- [x] `GET /api/medicao/export` retorna mensagens objetivas para tipo invalido, sessao invalida, permissao negada e ausencia de registros.
- [x] Frontend le erro JSON da rota de exportacao e exibe feedback ao usuario.
- [x] Nao ha exposicao de stack trace na resposta HTTP.
