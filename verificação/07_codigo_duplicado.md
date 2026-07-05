# Código Duplicado

## ❌ NÃO FAZER
- Copiar e colar lógica de negócio
- Duplicar validações
- Criar funções similares com pequenas diferenças
- Espalhar queries iguais em vários arquivos

## ✅ FAZER
- Criar funções reutilizáveis
- Centralizar lógica
- Usar services/helpers
- Refatorar código repetido

## Verificacao desta entrega - 2026-07-04
- [x] Modal de geracao de exportacao foi extraido para `src/components/ui/ExportProgressModal.tsx`.
- [x] CSS do modal saiu de `MeasurementPageView.module.css` e foi centralizado em `ExportProgressModal.module.css`.
- [x] `CsvExportButton` passou a renderizar o modal compartilhado quando recebe `isLoading`.
- [x] Exportacoes locais que nao usam `CsvExportButton` reutilizam o mesmo `ExportProgressModal`, sem criar modais duplicados por tela.
- [x] Nao aplicavel: nenhuma regra de negocio foi movida para componente compartilhado.

## Verificacao desta entrega - 2026-07-05
- [x] Modulo novo separa tipos, API, utils, constantes, PageViews e CSS.
- [x] Rotas novas delegam regra para `src/server/modules/warehouse-addressing/handlers.ts`.
- [x] Nao aplicavel: nao houve extracao global de utilitarios nesta etapa.
- [x] Regra de centro fisico ficou centralizada em `fetchPhysicalWarehouseStockCenters` no server e `is_physical_warehouse_stock_center` no banco.
