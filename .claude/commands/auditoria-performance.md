---
description: Audita performance PostgreSQL/Supabase focada em Disk I/O, memória, queries redundantes, índices, RLS e escalabilidade, em 4 níveis (ver prompts/auditoria-performance.md)
---

Siga exatamente o procedimento definido em `prompts/auditoria-performance.md` deste repositório. Leia esse arquivo completo antes de começar — ele contém o papel, o contexto, as restrições (o que nunca tratar como achado automático), o plano de execução em 7 etapas, a checklist obrigatória de 21 itens, a regra de ordem de colunas em índice composto, os critérios de aceite e o formato de saída obrigatório na pasta `Auditoria/`.

Argumento opcional (módulo/tela a priorizar, ex. "medicao" ou "dash-estoque"): $ARGUMENTS

Regra principal: não criar, alterar ou remover índice, RPC, view ou query sem apresentar evidência, plano de execução antes/depois, impacto na escrita e forma de validação.

Regra do alvo: o alvo é o **custo acumulado** (`total_exec_time`), não a query mais lenta. 150 ms × 100.000 execuções custa muito mais que 2 s × 10 execuções.

Ordem obrigatória:

1. **Etapa 0** — confirmar versões em `package.json`; identificar qual cliente Supabase as rotas usam (`service_role` vs. token do usuário, porque isso define se RLS entra na auditoria); verificar se `Auditoria/` já existe (atualizar, não duplicar) e se `scripts/supabase-monitoring-readonly.sql` já existe (usar, não reescrever).
2. **Nível A** — análise estática de `src/` e `supabase/`, percorrendo a checklist de 21 itens e extraindo o estado **vivo** dos índices (create menos drop, em ordem de migration).
3. **Nível B** — `pg_stat_statements` via `npm run db:check-link` + `npx supabase db query --file scripts/supabase-monitoring-readonly.sql --linked`.
4. **Nível C** — `EXPLAIN (ANALYZE, BUFFERS)` só nas candidatas que o Nível B elegeu.
5. **Nível D** — arquitetura: dashboards que fazem N consultas para N cards, RPC única, matview, imports em lote, refetch no frontend.
6. **Relatório** em `Auditoria/*.md`.
7. **Correção** somente com autorização explícita do usuário.

Não pular o Nível B: criar índice com base apenas em análise estática custa escrita permanente em tabela quente para acelerar consulta de frequência desconhecida. A única exceção é remoção de índice **exatamente duplicado**.

Ao final, apresentar o texto do commit conforme `guias/guia_git.md` e perguntar **"Confirma que posso aplicar/fechar essas mudanças?"** antes de encerrar.
