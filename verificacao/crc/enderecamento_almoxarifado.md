# CRC - Enderecamento Almoxarifado

> Atualizado: 2026-07-05 | Modulo de configuracao e leitura do enderecamento fisico do almoxarifado.

---

## Visao Geral

**Telas:** Configuracao do Mapa do Almoxarifado; Mapa do Almoxarifado
**Rotas:** `/configuracao-mapa-almoxarifado`; `/mapa-almoxarifado`
**Page Keys:** `configuracao-mapa-almoxarifado`; `mapa-almoxarifado`
**Arquivo de documentacao:** `docs/Tela_Enderecamento_Almoxarifado_SaaS.txt`

**O que faz:**
> Permite configurar o layout fisico de prateleiras por centro de estoque e enderecar materiais em posicoes especificas sem movimentar saldo.

---

## Arquivos do Modulo

| Arquivo | Responsabilidade |
|---|---|
| `src/app/(dashboard)/configuracao-mapa-almoxarifado/page.tsx` | Entry point da configuracao |
| `src/app/(dashboard)/mapa-almoxarifado/page.tsx` | Entry point do mapa operacional |
| `src/modules/dashboard/enderecamento-almoxarifado/WarehouseMapConfigPageView.tsx` | Configuracao visual do grid e prateleiras |
| `src/modules/dashboard/enderecamento-almoxarifado/WarehouseAddressingMapPageView.tsx` | Leitura do mapa e atribuicao/remocao de endereco |
| `src/modules/dashboard/enderecamento-almoxarifado/types.ts` | Tipos do contrato frontend |
| `src/modules/dashboard/enderecamento-almoxarifado/api.ts` | Chamadas HTTP para as rotas do modulo |
| `src/modules/dashboard/enderecamento-almoxarifado/utils.ts` | Calculo de codigo de posicao, status e formatacao |
| `src/modules/dashboard/enderecamento-almoxarifado/constants.ts` | Limites de grid/andares/posicoes |
| `src/modules/dashboard/enderecamento-almoxarifado/WarehouseAddressing.module.css` | Estilos das duas telas |
| `src/server/modules/warehouse-addressing/handlers.ts` | Handlers server-side com auth/permissao e chamadas RPC |
| `src/app/api/warehouse-addressing/config/route.ts` | API de configuracao do mapa |
| `src/app/api/warehouse-addressing/config/history/route.ts` | API de historico paginado da configuracao do mapa |
| `src/app/api/warehouse-addressing/map/route.ts` | API de leitura/enderecamento |
| `supabase/migrations/289_warehouse_addressing_cell_clear_and_conflicts.sql` | RPC `clear_warehouse_cell_addresses` e `save_warehouse_map_config` com `conflicts` |
| `supabase/migrations/290_warehouse_map_config_history_snapshot.sql` | `save_warehouse_map_config` com snapshot `before`/`after` no `CONFIG_SAVE` |
| `supabase/migrations/291_warehouse_address_history_action_index.sql` | Indice composto `(tenant_id, map_id, action_type, created_at desc)` |
| `supabase/migrations/292_warehouse_addressing_multi_position.sql` | Remove unicidade por material; RPCs assign/clear por `address_id` |

---

## API Routes Utilizadas

| Metodo | Endpoint | O que faz | Queries |
|---|---|---|---|
| GET | `/api/warehouse-addressing/config` | Centros e configuracao por centro | auth + permissao + stock_centers + mapa/shelves/floors |
| POST | `/api/warehouse-addressing/config` | Salva layout via RPC | auth + permissao + RPC |
| GET | `/api/warehouse-addressing/map` | Carrega mapa, saldo, materiais e enderecos | auth + permissao + config + balances + addresses + materials |
| POST | `/api/warehouse-addressing/map` | Atribui endereco via RPC | auth + permissao + RPC |
| DELETE | `/api/warehouse-addressing/map` | Remove um endereco especifico (`addressId`) ou limpa todos os materiais de uma posicao (`coluna`+`linha`, sem `addressId`) via RPC | auth + permissao + RPC |
| GET | `/api/warehouse-addressing/config/history` | Historico paginado (5/pagina) de `CONFIG_SAVE` por mapa, com `createdByName` resolvido | auth + permissao + warehouse_address_history + app_users |

---

## Tabelas Supabase Acessadas

| Tabela | Operacao | Filtros principais | Indice necessario |
|---|---|---|---|
| `warehouse_maps` | SELECT/RPC | tenant_id, stock_center_id | existe |
| `warehouse_shelves` | SELECT/RPC | tenant_id, map_id | existe |
| `warehouse_shelf_floors` | SELECT/RPC | tenant_id, shelf_id | existe |
| `warehouse_material_addresses` | SELECT/RPC | tenant_id, map_id, material_id | existe |
| `warehouse_address_history` | INSERT RPC / SELECT | tenant_id, map_id, action_type | indice composto (291) |
| `stock_center_balances` | SELECT | tenant_id, stock_center_id | existente do estoque |
| `materials` | SELECT/RPC | tenant_id, id | existente |

---

## Regras de Negocio Principais

1. **Endereco por centro:** mapa e endereco pertencem a `tenant_id + stock_center_id`.
2. **Posicao unica:** uma posicao fisica so pode ter um material por mapa (nao muda).
3. **Multi-posicao por material (migration 292):** um material PODE ter varios enderecos (posicoes) no mesmo mapa — nao ha mais unicidade por `material_id`. Cada endereco e so um marcador de presenca (sem quantidade). `assign_warehouse_material_address` usa `p_address_id` opcional para diferenciar "criar novo endereco" (nulo) de "editar/realocar um endereco especifico" (preenchido); `clear_warehouse_material_address` remove por `p_address_id`.
4. **Layout protegido:** nao salvar layout que remova posicao ocupada; a RPC `save_warehouse_map_config` retorna `conflicts` (material/posicao) para a tela orientar o usuario.
5. **Saldo intocado:** atribuir endereco nao altera estoque.
6. **Limpeza por posicao:** `clear_warehouse_cell_addresses` remove de uma vez todos os materiais enderecados numa celula (coluna+linha), independente de andar/posicao/tipo, para liberar a posicao antes de mover a prateleira/baia/pallet na configuracao.
7. **Historico de configuracao:** todo `CONFIG_SAVE` grava snapshot `before`/`after` (colunas, linhas, prateleiras/andares) em `warehouse_address_history.details`; a tela exibe isso paginado (5/pagina) com quem alterou.
8. **Edicao local, 1 save = 1 historico:** adicionar/remover/editar celulas no grid so muda estado React (`setConfig`); nenhuma chamada de API acontece ate o clique em `Salvar`. Isso limita o crescimento do historico a "numero de vezes que o usuario salva", nao a "numero de celulas mexidas" — por isso nao ha rotina de retencao/limpeza do historico por enquanto (decisao consciente, nao pendencia).
9. **Concorrencia sem sobrescrita silenciosa:** se `save_warehouse_map_config` retornar `CONCURRENT_MODIFICATION`, a tela recarrega a configuracao atual automaticamente, mas NUNCA reenvia sozinha as edicoes antigas por cima da versao nova (o payload e o layout inteiro, nao um patch incremental) — o usuario sempre precisa refazer e confirmar as alteracoes.

---

## Pontos de Atencao (Riscos)

- [x] Ha concorrencia em realocacao: RPC exige `expectedUpdatedAt` quando endereco ja existe.
- [x] Ha risco de remocao de posicao ocupada: RPC bloqueia.
- [x] Faltava forma de limpar em lote os materiais de uma posicao antes de mudar o layout: resolvido com `clear_warehouse_cell_addresses` + botao `Limpar posicao`.
- [x] Erro de conflito ao salvar layout nao dizia quais materiais bloqueavam: resolvido com `conflicts` detalhado na resposta e exibicao em tela.
- [x] Erro `CONCURRENT_MODIFICATION` exigia F5 manual para recarregar: resolvido com recarregamento automatico da configuracao ao detectar o conflito (sem reenviar edicoes antigas sozinho).
- [x] Nao havia rastreabilidade de quem alterou o layout do mapa e o que mudou: resolvido com historico paginado (`warehouse_address_history` + snapshot before/after + modal `Historico`).
- [x] Faltava indice por `action_type` em `warehouse_address_history` para a nova leitura paginada de `CONFIG_SAVE`: resolvido com indice composto (migration 291).
- [x] Mensagem do historico confundia "salvo sem mudanca" com "registro antigo sem snapshot": corrigido para distinguir os dois casos.
- [x] Modal "Atribuir endereco" aceitava `Andar`/`Posicao` fora do configurado na prateleira (inputs numericos sem `max`, so bloqueados pelo backend no submit): resolvido trocando para `<select>` com os valores reais da prateleira.
- [x] "Limpar posicao" usava `window.confirm` nativo do navegador (feio, inconsistente com o resto do app): resolvido com modal proprio (`clearCellConfirm`) no mesmo padrao visual das outras telas.
- [x] Material so podia ter um endereco por mapa, nao representava estoque fisico dividido entre prateleiras: resolvido (migration 292) removendo a unicidade por material; endereco continua sem quantidade (decisao consciente — ver Regra 3 e nota abaixo).
- [x] Apos a migration 292, a lista "Materiais para enderecar" (`addressableMaterials` em `WarehouseAddressingMapPageView.tsx`) ainda filtrava por "zero enderecos", entao o material sumia da lista assim que ganhava 1 endereco — impedia justamente o caso de uso da feature (endereca-lo numa segunda posicao). Resolvido: lista mostra todo material com saldo > 0, independente de ja ter endereco, com indicador "Ja enderecado em N posicao(oes)" por linha.
- [ ] Sem quantidade por endereco, nao ha como saber "quanto" de um material esta em cada posicao, so "que esta la". Se no futuro isso virar necessidade real, ver nota de decisao no CRC (quantidade nao ficaria sincronizada automaticamente com o saldo sem reescrever todo o subsistema de movimentacao de estoque).
- [ ] Medir payload real da tela com tenant grande e adicionar log de egress se necessario.
- [x] Pontinho de ocupacao por andar (3 cores fixas, sem numero) nao distinguia 1/3 de 2/3 (ambos viravam a mesma bolinha amarela): resolvido com selo `floorBadge` mostrando "ocupado/total" e cor gradual via `color-mix`. Comparativo visual (anel/selo/barra) feito antes de decidir, usuario escolheu o selo numerico pela clareza e por ser alvo de clique maior (o indicador precisa ser clicavel pra selecionar o andar).
- [x] Busca por material so marcava a celula combinante com borda azul, sem destacar por contraste: resolvido com efeito "holofote" (`dimmedCell` apaga/dessatura as celulas sem match enquanto ha busca ativa; `highlightCell` ganhou sombra mais forte e leve zoom no match).
- [ ] QA visual mobile/desktop pendente.
- [ ] Melhoria futura sugerida pelo usuario (fora de escopo): na Configuracao do Mapa, definir uma "capacidade" por prateleira/baia/pallet (quantidade ou volume que cabe fisicamente ali), independente do saldo do material. Reconhecido como potencialmente complexo; nao implementado, so registrado para avaliacao futura.

---

## Historico de Mudancas Estruturais

- 2026-07-05: Criada RPC `clear_warehouse_cell_addresses` (limpeza em lote por coluna+linha) e recriada `save_warehouse_map_config` para retornar `conflicts` no bloqueio `ADDRESSES_OUTSIDE_NEW_LAYOUT` (migration 289). `handleWarehouseAddressDelete` passou a rotear a limpeza por celula quando o corpo traz `coluna`+`linha` sem `materialId`. Botao `Limpar posicao` adicionado em `WarehouseAddressingMapPageView.tsx`; lista de conflitos exibida em `WarehouseMapConfigPageView.tsx`.
- 2026-07-05: Migration 290 recria `save_warehouse_map_config` para gravar snapshot `before`/`after` no `CONFIG_SAVE`. Criado `handleWarehouseConfigHistoryGet` + rota `config/history` (paginacao 5/pagina, `createdByName` via `app_users`). Adicionado modal `Historico` em `WarehouseMapConfigPageView.tsx`; nova funcao `summarizeConfigHistoryChanges` em `utils.ts`. Cor da celula `Prateleira` trocada de branco para lilas no CSS compartilhado.
- 2026-07-05: Autoaudioria pos-entrega encontrou 3 pontos (mensagem enganosa de historico sem diff, falta de indice por `action_type`, payload de snapshot sem retencao). Corrigidos: (1) mensagem do historico distingue "sem alteracoes de layout" de "registro anterior a este recurso"; (2) migration 291 cria indice composto substituindo o indice antigo; (3) confirmado que edicao e local (1 save = 1 historico), decisao de nao criar retencao/limpeza por ora. Trocado o botao `Recarregar` manual por recarregamento automatico da configuracao ao detectar `CONCURRENT_MODIFICATION`, sem nunca reenviar edicoes antigas sozinho.
- 2026-07-05: Movido o botao `Salvar` da Configuracao do Mapa para o cabecalho (ao lado de `Historico`), usando `form="warehouse-map-config-form"`. Corrigido o modal `Atribuir endereco` de `WarehouseAddressingMapPageView.tsx`: `Andar`/`Posicao` eram inputs numericos sem `max` (aceitavam qualquer numero, so bloqueados pelo backend no submit); viraram `<select>` com os valores reais da prateleira/baia/pallet selecionada, reenquadrando a posicao ao trocar prateleira/andar. Adicionado `clamp` compartilhado em `utils.ts`.
- 2026-07-05: Substituido o `window.confirm` nativo do "Limpar posicao" por um modal proprio (`clearCellConfirm` + `.modalOverlay`/`.modalCard` ja usados nas outras telas do modulo), com botoes `Cancelar` e `Remover endereco`.
- 2026-07-05: Migration 292 remove `warehouse_material_addresses_unique_material`, permitindo o mesmo material em mais de uma posicao (sem quantidade — decisao tomada apos discutir que sincronizar quantidade com o saldo exigiria reescrever todo o subsistema de movimentacao de estoque, fora de escopo). `assign_warehouse_material_address` ganhou `p_address_id` opcional (nulo = novo endereco, preenchido = editar um especifico); `assign_warehouse_material_addresses_batch` parou de bloquear material repetido/ja enderecado; `clear_warehouse_material_address` passou a identificar por `p_address_id`. Backend (`handlers.ts`) e frontend (`WarehouseAddressingMapPageView.tsx`, `types.ts`, `utils.ts`) reescritos para `materiais[].enderecos: []` (lista) no lugar de campos soltos por material; novo estado `selectedAddress` e botao "Adicionar outro endereco"; "Realocar"/"Remover endereco" operam por endereco especifico.
- 2026-07-05: Corrigida a lista "Materiais para enderecar" (renomeada de "Sem endereco"): filtrava por zero enderecos, entao o material sumia da lista assim que ganhava 1, impedindo endereca-lo numa segunda posicao. `addressableMaterials` (renomeado de `unaddressedMaterials`) passou a filtrar so por saldo > 0; linha da lista mostra "Ja enderecado em N posicao(oes)" quando aplicavel. Mensagens de CSV em massa e template ajustadas (nao exige mais "sem endereco").
- 2026-07-05: Feito comparativo visual (artifact) de 3 alternativas ao pontinho de ocupacao por andar (anel de progresso, selo numerico, barra segmentada); usuario escolheu o selo numerico apos lembrar que o indicador precisa continuar clicavel (selecionar andar) — pilula com texto e area de toque maior leu melhor como botao que um circulo pequeno. Implementado `floorBadge` (selo "ocupado/total", cor via `color-mix`) substituindo `.floorDot`; nova `floorOccupancyCounts` em `utils.ts` no lugar de `floorOccupancyStatus`. Tambem trocada a busca por material de "so borda azul no match" para efeito holofote (`dimmedCell` apaga o resto do grid enquanto ha busca ativa).

---

## Colaboradores

| Modulo / Arquivo | Como usa |
|---|---|
| `src/lib/server/appUsersAdmin.ts` | Auth e tenant em todas as rotas |
| `src/lib/server/pageAuthorization.ts` | Controle de permissao por page/action |
| `src/app/api/materials/route.ts` | Limites de estoque minimo/maximo usados no status do mapa |
| `stock_center_balances` | Fonte da quantidade atual exibida no mapa |
