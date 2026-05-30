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