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