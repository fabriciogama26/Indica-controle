# Qualidade Operacional

## ❌ NÃO FAZER
- Fazer deploy sem teste mínimo
- Não ter backup
- Misturar ambiente dev e produção
- Ignorar erros em produção

## ✅ FAZER
- Criar ambiente separado (dev/homolog/prod)
- Implementar backup
- Monitorar erros
- Validar funcionalidades críticas antes de deploy
- Ter rollback preparado

## Verificacao desta entrega - 2026-07-05
- [x] Nao foi executado deploy, migration linked, repair, reset ou link automatico.
- [x] Validacao local executada com `npx tsc --noEmit` e `npm run lint`.
- [ ] Antes de deploy: confirmar project ref Supabase e executar `npm run db:migration-list`/`npm run db:lint` somente se o link estiver correto.
- [x] Regra operacional ajustada para selecionar somente almoxarifado fisico; centros de equipe nao entram no enderecamento.
- [x] Pallet e lote de enderecamento ficam dentro da mesma migration 288 antes de aplicar no ambiente Supabase.

## Verificacao desta entrega - 2026-07-05 - Dashboard Medicao
- [x] Nao foi executado deploy, migration linked, repair, reset ou link automatico.
- [x] Correcao limitada a leitura da API; nao houve migration nem alteracao de ambiente.
- [ ] Antes de deploy: confirmar project ref Supabase e executar `npm run db:migration-list`/`npm run db:lint` somente se o link estiver correto.
