# Tráfego e Egress — Verificação Obrigatória

> Criado: 2026-06 | Aplica-se a: todas as rotas de API e qualquer ponto que faça request ao Supabase.
> Egress = dados transferidos do Supabase para a Vercel (e da Vercel para o browser). Cada MB custa dinheiro e latência.

---

## O QUE É EGRESS E POR QUE IMPORTA

No modelo Supabase + Vercel:
- **Egress 1:** Supabase → Vercel (query retorna registros para a API Route)
- **Egress 2:** Vercel → Browser (JSON da resposta chega ao cliente)
- **Custo duplo:** dados viajam duas vezes para cada request

Um endpoint que retorna 50.000 registros pode gerar:
- 5-20 MB de egress por request
- Timeout de Vercel Function (limite de execução)
- Lentidão para o usuário
- Custo crescente com uso

---

## REGRAS DE TAMANHO DE RESPOSTA

### ❌ NÃO FAZER

- Retornar mais de 500 registros em uma única response sem justificativa documentada
- Usar `.limit(10000)` ou maior em qualquer endpoint de listagem sem paginação
- Usar `.limit(50000)` — este valor indica que a lógica precisa ser movida para RPC no banco
- Retornar dados brutos de dashboard quando o front só precisa de totais e percentuais
- Incluir campos de auditoria (`created_by`, `updated_by`, `canceled_by`, timestamps de sistema) na resposta de listagem quando o front não os exibe
- Retornar histórico completo quando a tela só mostra os últimos 10 itens

### ✅ FAZER

- Definir um limite máximo explícito e documentado para cada endpoint
- Paginar listagens operacionais com `pageSize` padrão de 50-100
- Para dashboards: retornar resumo calculado no banco (RPC) em vez de lista de registros
- Logar tamanho da resposta em produção quando acima de 100KB
- Selecionar apenas as colunas que o front-end realmente renderiza
- Usar `Content-Encoding: gzip` (Vercel ativa automaticamente, mas a JSON comprimível ajuda mais)

---

## LIMITES RECOMENDADOS POR TIPO DE ENDPOINT

| Tipo | Limite máximo | Observação |
|---|---|---|
| Listagem CRUD (projetos, pessoas, materiais) | 100-200 | Paginar, com filtro de status/período |
| Listagem operacional (programação, medição) | 200-500 | Filtro de semana/mês obrigatório |
| Autocomplete / busca rápida | 20-40 | Busca por texto, retornar só id+label |
| Dashboard / resumo | sem registros brutos | Usar RPC que retorna totais |
| Exportação CSV/XLSX | sem limite prático | Mas em background/stream, não em JSON |
| Catálogos (tipos, categorias) | 500 | Raramente mudam, cachear |
| Histórico de auditoria | 20-50 | Paginar, mostrar os mais recentes |

---

## MONITORAMENTO DE TRÁFEGO

### Como verificar tamanho de resposta hoje

No browser (DevTools → Network):
1. Abrir a tela desejada
2. Filtrar por `XHR` ou `Fetch`
3. Clicar em cada request para `/api/...`
4. Ver coluna `Size` — acima de 100KB é sinal de alerta

No Supabase (Dashboard → Logs → API):
1. Filtrar por método e path
2. Ver campo `response_body_size` ou duração
3. Queries lentas (> 500ms) indicam falta de índice ou volume alto

### Log recomendado no código

```typescript
// Adicionar em endpoints que retornam listas:
function logResponseSize(pathname: string, payload: unknown) {
  if (process.env.NODE_ENV !== "production") return;
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > 102_400) { // 100KB
    console.warn(`[EGRESS] ${pathname} → ${(bytes / 1024).toFixed(1)}KB`);
  }
}

// Uso:
const response = { data: rows, total, page };
logResponseSize(request.nextUrl.pathname, response);
return NextResponse.json(response);
```

---

## REGRAS DE CACHE — QUANDO USAR E QUANDO NÃO USAR

### Pode usar cache (dados que não mudam por usuário/operação):

| Dado | Cache sugerido | Como |
|---|---|---|
| Catálogos (tipos de equipe, cargo, atividade) | 5-10 min | `unstable_cache` ou React Query `staleTime` |
| Dados de configuração do tenant | 2-5 min | `unstable_cache` com tag do tenant |
| Metadados de tela (`/api/*/meta`) | 1-2 min | `unstable_cache` |
| Opções de autocomplete | 30s | React Query `staleTime` |

### NÃO usar cache (dados operacionais em tempo real):

| Dado | Por quê não cachear |
|---|---|
| Programações do dia | Múltiplos usuários editam simultaneamente |
| Saldo de estoque | Pode mudar a qualquer momento |
| Status de medição | Atualizado durante a execução |
| Permissões do usuário | Podem ser revogadas pelo admin |
| Sessão/auth | Token já tem expiração própria |

### Implementação com `unstable_cache` (Next.js):

```typescript
import { unstable_cache } from "next/cache";

// Para catálogos: cache por tenant, revalidar a cada 5 minutos
const getCatalogoCached = unstable_cache(
  async (tenantId: string) => {
    const { data } = await supabase
      .from("programming_reason_catalog")
      .select("code, label_pt, requires_notes, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    return data ?? [];
  },
  ["programming-reason-catalog"],
  {
    revalidate: 300, // 5 minutos
    tags: [`tenant-catalog-${tenantId}`], // para invalidar manualmente se o admin alterar
  }
);

// Invalidar cache quando admin alterar o catálogo:
import { revalidateTag } from "next/cache";
revalidateTag(`tenant-catalog-${tenantId}`);
```

---

## REGRAS ANTI-SOBREPOSIÇÃO DE DADOS

> Esta seção cobre o risco de perda ou duplicação de dados por race condition ou gravação parcial.

### ❌ NÃO FAZER

- Verificar unicidade com `SELECT ... WHERE` antes de `INSERT` sem constraint no banco
  - Dois usuários simultâneos passam no check ao mesmo tempo e ambos fazem INSERT
- Salvar campos obrigatórios em duas chamadas separadas (campo base + campo complementar)
  - Se a segunda chamada falhar, o registro fica incompleto no banco
- Fazer `UPDATE` sem `expectedUpdatedAt` em telas multi-usuário
  - Usuário A salva em cima do que Usuário B acabou de alterar (dados perdidos)
- Interpretar erro de resposta HTTP como falha de gravação sem verificar no banco
  - O dado pode ter sido salvo e o erro ser só de resposta

### ✅ FAZER

- Usar `UNIQUE constraint` ou `EXCLUSION constraint` no banco para garantir unicidade
- Usar `advisory lock` ou `SELECT FOR UPDATE` para operações críticas de exclusividade
- Salvar todos os campos obrigatórios na mesma RPC/transação
- Exigir `expectedUpdatedAt` em todo PUT/PATCH que o usuário possa conflitar
- Retornar `409 Conflict` com o registro atual, quem alterou e quais campos mudaram
- Usar idempotency key em operações que podem ser retentadas

### Exemplo: constraint para evitar sobreposição de programação

```sql
-- Prevenção de sobreposição de horário na mesma equipe no mesmo dia:
-- (exige extensão btree_gist para range overlap check)
ALTER TABLE project_programming
ADD CONSTRAINT no_team_time_overlap
EXCLUDE USING gist (
  tenant_id WITH =,
  team_id WITH =,
  execution_date WITH =,
  tsrange(start_time::timestamp, end_time::timestamp) WITH &&
)
WHERE (status IN ('PROGRAMADA', 'REPROGRAMADA'));
```

### Exemplo: resposta 409 com dados do conflito

```typescript
// No handler de PUT/PATCH:
if (hasUpdatedAtConflict(currentRecord.updated_at, payload.expectedUpdatedAt)) {
  return NextResponse.json({
    error: "conflict",
    message: "Este registro foi alterado por outro usuário.",
    currentRecord: {
      id: currentRecord.id,
      updatedAt: currentRecord.updated_at,
      updatedBy: currentRecord.updated_by_name,
      changedFields: detectChangedFields(currentRecord, payload),
    },
  }, { status: 409 });
}
```

---

## Checklist de tráfego e egress por PR

- [ ] O endpoint retorna menos de 500 registros por request (ou está paginando)?
- [ ] Não há `.limit(50000)` — se sim, reescrever como RPC de agregação
- [ ] Dashboard retorna apenas resumo (totais, percentuais)? Não dados brutos?
- [ ] Log de tamanho de resposta foi adicionado?
- [ ] Dados de catálogo usam cache? (`unstable_cache` ou `staleTime`)
- [ ] Dados operacionais (programação, medição, saldo) NÃO usam cache?
- [ ] Operações de gravação têm constraint de unicidade no banco?
- [ ] PUT/PATCH exigem `expectedUpdatedAt`?
- [ ] Conflito retorna 409 com `currentRecord`, `updatedBy` e `changedFields`?
- [ ] Gravação de campos obrigatórios está na mesma transação/RPC?

## Verificacao desta entrega - 2026-07-04
- [x] Exportacao CSV de Medicao nao trafega mais todas as paginas como JSON para o browser antes do download.
- [x] O browser recebe um arquivo `text/csv` final pela rota `/api/medicao/export`.
- [x] A rota processa em paginas internas de ate 500 registros e registra tamanho de CSV acima de 100KB.
- [x] Nao aplicavel: nao houve dashboard novo, escrita em banco, PUT/PATCH ou schema.

## Verificacao desta entrega - 2026-07-04 - Modal compartilhado
- [x] Mudanca posterior nao altera volume de trafego nem formato dos CSVs existentes.
- [x] Exportacoes locais continuam usando os mesmos dados ja carregados pela tela.
- [x] Nao aplicavel: nenhuma rota nova alem de `/api/medicao/export` ja documentada.

## Verificacao desta entrega - 2026-07-05
- [x] Endpoints novos filtram por centro de estoque e retornam apenas layout, saldos e enderecos do centro selecionado.
- [x] Nao ha `.limit(50000)` nem dashboard com dados brutos agregados no navegador.
- [x] Lacuna registrada: proxima etapa deve medir tamanho real da resposta no navegador e adicionar log `[EGRESS]` se ultrapassar 100KB em producao.
- [x] Centros inelegiveis de equipe sao removidos antes de consultar saldo/material do mapa, reduzindo payload operacional.
- [x] Enderecamento em massa envia apenas `materialId` e endereco de ate 100 itens; nao reenvia lista completa de materiais.

## Verificacao desta entrega - 2026-07-05 - Dashboard Medicao
- [x] Resposta final do dashboard nao ganhou novos campos nem dados brutos adicionais.
- [x] Leitura de itens foi fragmentada em chunks de 200 IDs para reduzir risco de falha por `.in` extenso, sem aumentar o volume final enviado ao browser.
- [x] Nao aplicavel: nenhuma exportacao, escrita, PUT/PATCH ou schema foi alterado.
