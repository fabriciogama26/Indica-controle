# Performance

## ❌ NÃO FAZER
- Fazer query sem filtro
- Buscar dados desnecessários
- Fazer múltiplas queries repetidas (N+1)
- Renderizar componentes desnecessariamente
- Carregar listas grandes sem paginação

## ✅ FAZER
- Usar paginação
- Otimizar queries (select apenas necessário)
- Usar índices no banco
- Evitar re-render desnecessário
- Usar cache com controle de invalidação