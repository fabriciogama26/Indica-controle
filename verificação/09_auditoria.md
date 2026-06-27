# Auditoria e Rastreabilidade

## ❌ NÃO FAZER
- Permitir alteração sem registro
- Não registrar exclusões
- Não saber quem alterou o dado
- Permitir ações críticas sem log

## ✅ FAZER
- Registrar created_at e updated_at
- Registrar usuário responsável
- Criar histórico de alterações
- Logar ações críticas
- Implementar rastreabilidade
## Verificacao desta entrega - 2026-06-27
- [x] Backfill de `PARCIAL` legado registra historico tecnico em `project_programming_history`.
- [x] Sincronizacao por grupo registra historico com metadata `work-completion-group-sync`.
- [x] Nao aplicavel: criacao de tabela nova de auditoria.
