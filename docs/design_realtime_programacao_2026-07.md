# Design Técnico: Supabase Realtime Broadcast — Programação
**Data:** 2026-07-01  
**Status:** Aprovado para revisão — NÃO implementado  
**Escopo:** somente `project_programming`, Broadcast privado multi-tenant

---

## A. Fluxo atual detalhado da tela

### A.1 Árvore de componentes

```
src/app/(dashboard)/programacao-simples/page.tsx
  └─ Server Component puro (pass-through, zero fetch, zero props)
       └─ <ProgrammingSimplePageView />   ← "use client" — Client Component raiz
            ├─ useProgrammingBoardData()
            │    ├─ fetchBoardSnapshot()  — duas chamadas paralelas (Promise.all)
            │    │    ├─ GET /api/programacao/meta    (7 catálogos em paralelo)
            │    │    └─ GET /api/programacao?startDate=…&endDate=…  (grade + atividades)
            │    └─ applyBoardSnapshot(data) → setState(schedules, projects, teams, …)
            ├─ useProgrammingActivityCatalog()  — busca atividades com debounce 220ms
            ├─ useProgrammingEtapaSuggestion()  — sugere próxima etapa com debounce 180ms
            ├─ useHistoryModal()
            ├─ useCancelModal()
            ├─ usePostponeModal()
            └─ useCopyToDatesModal()
```

### A.2 Como `fetchProgrammingRows` e `get_programming_week_summary` chegam à interface

- `fetchProgrammingRows` ← chamado dentro de `GET /api/programacao` no servidor → retorna `schedules[]` como JSON → `applyBoardSnapshot` → `setSchedules(nextSchedules)`.
- `fetchProgrammingWeekSummary` (RPC `get_programming_week_summary`) ← também chamado em `GET /api/programacao` (seção de resumo semanal) → retorna `weekSummary[]` no mesmo JSON → `applyBoardSnapshot`.
- **Nenhuma das duas é chamada diretamente do browser.** Toda leitura vai via Route Handler `/api/programacao`, não via Supabase client no browser.

### A.3 Como a tela é atualizada após cada operação

| Operação | Mecanismo de atualização após sucesso |
|----------|---------------------------------------|
| Criar (batch) | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Editar | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Cancelar | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Adiar | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Reprogramar | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Adicionar equipe | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Salvar Estado Trabalho | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |
| Copiar para datas | `fetchBoardSnapshot()` → `applyBoardSnapshot()` |

**Padrão único e consistente:** não existe `router.refresh()`, não existe `invalidateQueries`, não existe React Query. O estado vive inteiramente em `useState` dentro do Client Component. A única forma de atualizar é chamar `fetchBoardSnapshot()` seguido de `applyBoardSnapshot(data)`.

### A.4 Confirmação: Server Actions

**Não existe nenhuma Server Action** no módulo. Nenhum arquivo usa `"use server"`. Todas as mutações são feitas via `fetch()` para Route Handlers (`/api/programacao`), que chamam RPCs `SECURITY DEFINER` no banco.

### A.5 Filtragem e paginação

**Em memória no cliente.** Todos os registros do range de datas já estão em `schedules` (estado local). `filteredSchedules` e `pagedSchedules` são derivados via `useMemo`. Mudar filtro ou página não gera nova chamada ao servidor.

### A.6 Melhoria planejada: ETAPA automatica entre datas existentes

**Status:** planejado, nao implementado neste design.

Problema operacional:
- A sugestao atual de ETAPA considera a maior ETAPA anterior a data escolhida e sugere `maior + 1`.
- Quando ja existe ETAPA futura para o mesmo projeto/equipe/escopo, inserir uma programacao entre datas pode conflitar com a etapa futura.
- Exemplo esperado:

```text
08/07/2026 -> ETAPA 1
10/07/2026 -> ETAPA 2
20/07/2026 -> ETAPA 3

Inserir 15/07/2026 deve resultar em:

08/07/2026 -> ETAPA 1
10/07/2026 -> ETAPA 2
15/07/2026 -> ETAPA 3
20/07/2026 -> ETAPA 4
```

Regra planejada:
- Criar uma RPC/migration transacional especifica para inserir ou reprogramar no meio da sequencia.
- A operacao deve aplicar lock por `tenant_id + project_id` antes de calcular e deslocar etapas.
- A nova programacao recebe a ETAPA calculada pela posicao da `execution_date`.
- Programacoes numericas futuras do mesmo escopo devem ser deslocadas em `+1`.
- Cada linha deslocada deve recalcular `programming_group_id`.
- Cada mudanca de ETAPA deve gravar historico em `project_programming_history`.

Restricoes obrigatorias:
- Nao aplicar em `ETAPA UNICA` nem `ETAPA FINAL` sem decisao funcional explicita.
- Nao mexer automaticamente em projeto com `Estado Trabalho = CONCLUIDO`.
- Revalidar impacto em `ANTECIPADO`, porque ele depende de comparacao por `etapa_number`.
- Nao executar renumeracao fora do tenant da sessao.
- Nao fazer deslocamento no frontend; o frontend apenas solicita a operacao e recarrega o snapshot.

Impacto no Realtime:
- A renumeracao pode atualizar varias linhas em uma unica transacao.
- O debounce de 500ms deve agrupar os eventos em um unico `fetchBoardSnapshot()`.
- O payload de Broadcast deve tratar ETAPA como campo relevante completo: `etapaNumber`, `etapaUnica`, `etapaFinal` e `programmingGroupId`.
- Antes de implementar a melhoria, revisar o trigger planejado para incluir `etapa_unica`, `etapa_final` e `programming_group_id` em `changedFields`, `oldState` e `newState`, nao apenas `etapa_number`.

---

## B. SQL completo da migration

### Número da migration: `283_realtime_broadcast_project_programming.sql`

```sql
-- 283_realtime_broadcast_project_programming.sql
-- Implementa Supabase Realtime Broadcast privado para project_programming.
-- Alcance: somente tópico tenant:<uuid>:programming.
-- Não altera policies RLS existentes em project_programming.
-- Não ativa/desativa "Allow public access to channels" (mantido como está).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1: Verificar pré-requisitos do ambiente Realtime
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  -- Confirmar que realtime.messages existe
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'realtime'
      and table_name = 'messages'
  ) then
    raise exception
      'realtime.messages não encontrada. Confirme que o Supabase Realtime está habilitado.';
  end if;

  -- Confirmar que realtime.send existe
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'realtime'
      and p.proname = 'send'
  ) then
    raise exception
      'realtime.send não encontrada. Atualize o Supabase Realtime para versão >= 2.29.0.';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2: Função auxiliar — extrai tenant_id do tópico com validação segura
-- ─────────────────────────────────────────────────────────────────────────────
-- Aceita somente exatamente: tenant:<uuid>:programming
-- Retorna NULL para qualquer tópico inválido.
-- Não faz cast direto de texto para uuid sem validação de formato.

drop function if exists public.extract_tenant_id_from_programming_topic(text);

create or replace function public.extract_tenant_id_from_programming_topic(p_topic text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_uuid_text text;
begin
  if p_topic is null then
    return null;
  end if;

  v_parts := string_to_array(p_topic, ':');

  -- Exatamente 3 partes: ['tenant', '<uuid>', 'programming']
  -- UUID padrão (8-4-4-4-12) não contém ':' portanto o split é seguro
  if array_length(v_parts, 1) <> 3 then
    return null;
  end if;

  if v_parts[1] <> 'tenant' then
    return null;
  end if;

  if v_parts[3] <> 'programming' then
    return null;
  end if;

  v_uuid_text := v_parts[2];

  -- Validar formato UUID sem cast direto (evita exception em texto inválido)
  if v_uuid_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_uuid_text::uuid;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.extract_tenant_id_from_programming_topic(text) from public, anon;
grant execute on function public.extract_tenant_id_from_programming_topic(text) to authenticated;
grant execute on function public.extract_tenant_id_from_programming_topic(text) to service_role;

comment on function public.extract_tenant_id_from_programming_topic(text) is
'Extrai e valida o tenant_id do tópico Realtime no formato tenant:<uuid>:programming. Retorna NULL para qualquer tópico inválido ou malformado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3: Policy em realtime.messages (somente SELECT, somente authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
-- Verificar colunas reais de realtime.messages antes de criar a policy.
-- A coluna 'extension' existe em Supabase >= 2.30 e distingue broadcast de
-- postgres_changes. Se existir, incluímos o filtro. Se não existir, omitimos.

do $$
declare
  v_has_extension_col boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'realtime'
      and table_name = 'messages'
      and column_name = 'extension'
  ) into v_has_extension_col;

  raise notice 'realtime.messages.extension existe: %', v_has_extension_col;

  drop policy if exists "authenticated_receive_programming_broadcasts"
    on realtime.messages;

  if v_has_extension_col then
    execute $pol$
      create policy "authenticated_receive_programming_broadcasts"
      on realtime.messages
      for select
      to authenticated
      using (
        extension = 'broadcast'
        and public.user_can_access_tenant(
          public.extract_tenant_id_from_programming_topic(topic)
        )
      )
    $pol$;
    raise notice 'Policy criada COM filtro extension = broadcast';
  else
    execute $pol$
      create policy "authenticated_receive_programming_broadcasts"
      on realtime.messages
      for select
      to authenticated
      using (
        public.user_can_access_tenant(
          public.extract_tenant_id_from_programming_topic(topic)
        )
      )
    $pol$;
    raise notice 'Policy criada SEM filtro de extension (coluna ausente nesta versão)';
  end if;
end;
$$;

-- IMPORTANTE: Não há policy INSERT para authenticated.
-- O browser não envia Broadcast — somente assina.
-- O INSERT em realtime.messages é feito pela função realtime.send()
-- chamada pelo trigger (que executa como service_role via SECURITY DEFINER).

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4: Função do trigger de broadcast
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.broadcast_project_programming_change();

create or replace function public.broadcast_project_programming_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_source        record;
  v_action        text;
  v_topic         text;
  v_changed       text[] := '{}'::text[];
  v_old_state     jsonb;
  v_new_state     jsonb;
  v_payload       jsonb;
begin
  -- ── Proteção contra cascata de outros triggers AFTER ──────────────────────
  -- pg_trigger_depth() = 1: disparado diretamente pela DML do usuário/RPC
  -- pg_trigger_depth() > 1: disparado em cascata por outro trigger
  --   (ex: trg_project_programming_sync_documents atualizando irmãos,
  --        trg_project_programming_restore_anticipated... atualizando ANTECIPADO)
  -- Não emitir broadcast para atualizações em cascata: o frontend fará
  -- refetch completo a partir do evento do registro raiz.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  -- ── Determinar ação e linha de referência ─────────────────────────────────
  if tg_op = 'DELETE' then
    v_action := 'DELETE';
    v_source := old;

  elsif tg_op = 'INSERT' then
    v_action := 'INSERT';
    v_source := new;

  else -- UPDATE
    -- Emitir somente se algum campo relevante para a tela mudou de verdade.
    -- Campos irrelevantes: updated_at, campos de auditoria, campos de texto
    -- que não aparecem nos filtros nem na grade principal.
    if old.execution_date        is not distinct from new.execution_date
      and old.project_id         is not distinct from new.project_id
      and old.team_id            is not distinct from new.team_id
      and old.status             is not distinct from new.status
      and old.work_completion_status is not distinct from new.work_completion_status
      and old.sgd_type_id        is not distinct from new.sgd_type_id
      and old.is_active          is not distinct from new.is_active
      and old.etapa_number       is not distinct from new.etapa_number
    then
      return null; -- Nenhum campo relevante para a tela mudou
    end if;

    v_action := 'UPDATE';
    v_source := new;

    -- Construir lista de campos alterados (para o frontend decidir o impacto)
    if old.execution_date is distinct from new.execution_date then
      v_changed := array_append(v_changed, 'executionDate');
    end if;
    if old.project_id is distinct from new.project_id then
      v_changed := array_append(v_changed, 'projectId');
    end if;
    if old.team_id is distinct from new.team_id then
      v_changed := array_append(v_changed, 'teamId');
    end if;
    if old.status is distinct from new.status then
      v_changed := array_append(v_changed, 'status');
    end if;
    if old.work_completion_status is distinct from new.work_completion_status then
      v_changed := array_append(v_changed, 'workCompletionStatus');
    end if;
    if old.sgd_type_id is distinct from new.sgd_type_id then
      v_changed := array_append(v_changed, 'sgdTypeId');
    end if;
    if old.is_active is distinct from new.is_active then
      v_changed := array_append(v_changed, 'isActive');
    end if;
    if old.etapa_number is distinct from new.etapa_number then
      v_changed := array_append(v_changed, 'etapaNumber');
    end if;
  end if;

  v_topic := 'tenant:' || v_source.tenant_id::text || ':programming';

  -- ── Construir estados mínimos (sem NEW/OLD completos) ─────────────────────
  if tg_op = 'UPDATE' then
    v_old_state := jsonb_build_object(
      'executionDate',        old.execution_date,
      'projectId',            old.project_id,
      'teamId',               old.team_id,
      'status',               old.status,
      'workCompletionStatus', old.work_completion_status,
      'sgdTypeId',            old.sgd_type_id
    );
  end if;

  if tg_op <> 'DELETE' then
    v_new_state := jsonb_build_object(
      'executionDate',        v_source.execution_date,
      'projectId',            v_source.project_id,
      'teamId',               v_source.team_id,
      'status',               v_source.status,
      'workCompletionStatus', v_source.work_completion_status,
      'sgdTypeId',            v_source.sgd_type_id
    );
  end if;

  -- ── Montar payload mínimo ─────────────────────────────────────────────────
  v_payload := jsonb_build_object(
    'version',        1,
    'entity',         'project_programming',
    'action',         v_action,
    'tenantId',       v_source.tenant_id,
    'programmingId',  v_source.id,
    'transactionId',  txid_current(),
    'changedFields',  to_jsonb(v_changed),
    'oldState',       v_old_state,
    'newState',       v_new_state
  );

  -- ── Emitir Broadcast privado ──────────────────────────────────────────────
  -- Assinatura: realtime.send(payload jsonb, event text, topic text, private boolean)
  -- Quarto parâmetro true = canal privado (requer JWT válido para assinar)
  perform realtime.send(
    v_payload,
    'programming_changed',
    v_topic,
    true
  );

  return null; -- Trigger AFTER não precisa retornar a linha
end;
$$;

revoke all on function public.broadcast_project_programming_change()
  from public, anon, authenticated;
grant execute on function public.broadcast_project_programming_change()
  to service_role;

comment on function public.broadcast_project_programming_change() is
'Emite Broadcast Realtime privado ao canal tenant:<id>:programming quando campos relevantes de project_programming mudam. Suprime cascatas (pg_trigger_depth > 1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 5: Trigger em project_programming
-- ─────────────────────────────────────────────────────────────────────────────
-- Nome "trg_zz_" garante execução após todos os outros triggers AFTER
-- da mesma tabela (ex: trg_project_programming_sync_documents,
-- trg_project_programming_restore_anticipated...).
-- A lógica de cascata (pg_trigger_depth > 1) é suficiente para correção;
-- a ordem alfabética é apenas para minimizar broadcasts prematuros durante
-- a própria transação (o dado já está no estado final quando este trigger roda).

drop trigger if exists trg_zz_project_programming_realtime_broadcast
  on public.project_programming;

create trigger trg_zz_project_programming_realtime_broadcast
after insert or update or delete
on public.project_programming
for each row
execute function public.broadcast_project_programming_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 6: Validações pós-criação
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_trigger_count integer;
  v_policy_count  integer;
  v_func_count    integer;
begin
  -- Trigger existe e está habilitado
  select count(*)
  into v_trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'project_programming'
    and t.tgname = 'trg_zz_project_programming_realtime_broadcast'
    and not t.tgisinternal
    and t.tgenabled = 'O';

  if v_trigger_count <> 1 then
    raise exception 'Trigger trg_zz_project_programming_realtime_broadcast não foi criado corretamente.';
  end if;

  -- Policy em realtime.messages existe
  select count(*)
  into v_policy_count
  from pg_policies
  where schemaname = 'realtime'
    and tablename = 'messages'
    and policyname = 'authenticated_receive_programming_broadcasts';

  if v_policy_count <> 1 then
    raise exception 'Policy authenticated_receive_programming_broadcasts não foi criada em realtime.messages.';
  end if;

  -- Funções existem
  select count(*)
  into v_func_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'extract_tenant_id_from_programming_topic',
      'broadcast_project_programming_change'
    );

  if v_func_count <> 2 then
    raise exception 'Uma ou mais funções de broadcast não foram criadas.';
  end if;

  raise notice 'Migration 283 validada com sucesso.';
end;
$$;

commit;
```

---

## C. Lista de arquivos frontend alterados

### C.1 Arquivos modificados

| Arquivo | Tipo de alteração |
|---------|-------------------|
| `src/modules/dashboard/programacao-simples/hooks.ts` | Adicionar hook `useProgrammingRealtime` |
| `src/modules/dashboard/programacao-simples/ProgrammingSimplePageView.tsx` | Consumir o hook; adicionar estado `hasPendingRealtimeUpdate`; adicionar banner JSX |
| `src/modules/dashboard/programacao-simples/types.ts` | Adicionar tipos `RealtimePayload`, `ProgrammingRealtimeState` |

### C.2 Nenhum arquivo novo criado

O hook vai em `hooks.ts` para seguir o padrão já estabelecido no módulo.

---

### C.3 Código do hook `useProgrammingRealtime`

A adicionar em `src/modules/dashboard/programacao-simples/hooks.ts`:

```typescript
// Dependências já usadas no arquivo: useCallback, useEffect, useRef
// Nova importação necessária:
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

// ─── Tipos (adicionar em types.ts) ────────────────────────────────────────────

export type RealtimeProgrammingState = {
  executionDate: string | null;
  projectId: string | null;
  teamId: string | null;
  status: string | null;
  workCompletionStatus: string | null;
  sgdTypeId: string | null;
};

export type RealtimeProgrammingPayload = {
  version: number;
  entity: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  tenantId: string;
  programmingId: string;
  transactionId?: number;
  changedFields: string[];
  oldState: RealtimeProgrammingState | null;
  newState: RealtimeProgrammingState | null;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useProgrammingRealtime(params: {
  tenantId: string | null;
  accessToken: string | null;
  activeFilters: FilterState;
  currentPage: number;
  onAutoReload: () => Promise<void>;          // chamado quando página=1 e evento é relevante
  onPendingUpdate: (hasPending: boolean) => void; // sinaliza banner para página>1
  onError?: ErrorLogHandler;
}) {
  const {
    tenantId,
    accessToken,
    activeFilters,
    currentPage,
    onAutoReload,
    onPendingUpdate,
    onError,
  } = params;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasQueuedUpdateRef = useRef(false);
  // Refs para acessar valores atuais sem recriar o canal desnecessariamente
  const currentPageRef = useRef(currentPage);
  const activeFiltersRef = useRef(activeFilters);
  const onAutoReloadRef = useRef(onAutoReload);
  const onPendingUpdateRef = useRef(onPendingUpdate);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { activeFiltersRef.current = activeFilters; }, [activeFilters]);
  useEffect(() => { onAutoReloadRef.current = onAutoReload; }, [onAutoReload]);
  useEffect(() => { onPendingUpdateRef.current = onPendingUpdate; }, [onPendingUpdate]);

  const handleDebouncedUpdate = useCallback(() => {
    if (!hasQueuedUpdateRef.current) return;
    hasQueuedUpdateRef.current = false;

    if (currentPageRef.current === 1) {
      onPendingUpdateRef.current(false);
      void onAutoReloadRef.current();
    } else {
      onPendingUpdateRef.current(true);
    }
  }, []);

  const scheduleDebounce = useCallback(() => {
    hasQueuedUpdateRef.current = true;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(handleDebouncedUpdate, 500);
  }, [handleDebouncedUpdate]);

  useEffect(() => {
    if (!tenantId || !accessToken || !supabase) return;

    // Remover canal anterior antes de criar um novo
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const topic = `tenant:${tenantId}:programming`;

    const channel = supabase.channel(topic, {
      config: {
        broadcast: { self: false },
        private: true,         // <- canal privado: exige JWT e policy FOR SELECT
      },
    });

    channel.on(
      "broadcast",
      { event: "programming_changed" },
      (msg) => {
        const payload = msg.payload as RealtimeProgrammingPayload | undefined;

        // 1. Validar tenant do payload (defesa em profundidade)
        if (!payload || payload.tenantId !== tenantId) return;

        // 2. Verificar se o evento pode afetar a view atual
        //    (evita reloads desnecessários por eventos fora do filtro)
        const newState = payload.newState ?? payload.oldState;
        if (newState) {
          const filters = activeFiltersRef.current;
          const eventDate = newState.executionDate ?? "";

          // Evento fora do range de datas dos filtros ativos
          if (
            eventDate
            && (eventDate < filters.startDate || eventDate > filters.endDate)
            && payload.action !== "DELETE"
          ) {
            return;
          }

          // Evento de outro projeto quando filtro de projeto está ativo
          if (
            filters.projectId
            && newState.projectId
            && newState.projectId !== filters.projectId
          ) {
            return;
          }

          // Evento de outra equipe quando filtro de equipe está ativo
          if (
            filters.teamId
            && newState.teamId
            && newState.teamId !== filters.teamId
          ) {
            return;
          }
        }

        // 3. Agrupar evento no debounce de 500ms
        scheduleDebounce();
      },
    );

    // Configurar auth antes de assinar o canal privado
    const subscribe = async () => {
      try {
        await supabase.realtime.setAuth(accessToken);
        await channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channelRef.current = channel;
          }
          if (status === "CHANNEL_ERROR") {
            void onError?.(
              "Falha ao assinar canal Realtime de Programação.",
              undefined,
              { topic, tenantId, status },
            );
          }
        });
      } catch (error) {
        void onError?.(
          "Erro ao configurar Realtime de Programação.",
          error,
          { topic, tenantId },
        );
      }
    };

    void subscribe();

    // Cleanup: executado ao desmontar, trocar tenant ou trocar accessToken
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      hasQueuedUpdateRef.current = false;

      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tenantId, accessToken, scheduleDebounce, onError]);
  // Nota: activeFilters, currentPage e callbacks são acessados via refs
  // para não recriar o canal quando mudam.
}
```

---

### C.4 Alterações em `ProgrammingSimplePageView.tsx`

**Adições ao estado local:**

```typescript
const [hasPendingRealtimeUpdate, setHasPendingRealtimeUpdate] = useState(false);
```

**Adicionar tenantId do usuário autenticado:**

```typescript
const tenantId = session?.tenantId ?? null; // já disponível via useAuth()
```

**Wiring do hook** (após `useProgrammingBoardData`):

```typescript
useProgrammingRealtime({
  tenantId,
  accessToken,
  activeFilters,
  currentPage: page,
  onAutoReload: async () => {
    try {
      const boardData = await fetchBoardSnapshot();
      if (boardData) applyBoardSnapshot(boardData);
    } catch (error) {
      void logError("Realtime: falha ao atualizar grade automaticamente.", error, {
        operation: "realtime_auto_reload",
      });
    }
  },
  onPendingUpdate: setHasPendingRealtimeUpdate,
  onError: logError,
});
```

**Banner JSX** (adicionar antes da lista/calendário):

```tsx
{hasPendingRealtimeUpdate && page > 1 && (
  <div className={styles.realtimePendingBanner}>
    Há atualizações na programação
    <button
      type="button"
      onClick={async () => {
        setHasPendingRealtimeUpdate(false);
        setPage(1);
        try {
          const boardData = await fetchBoardSnapshot();
          if (boardData) applyBoardSnapshot(boardData);
        } catch {
          setFeedback({ type: "error", message: "Falha ao atualizar programação." });
        }
      }}
    >
      Atualizar lista
    </button>
  </div>
)}
```

**Limpar banner quando o usuário volta à página 1 manualmente:**

```typescript
useEffect(() => {
  if (page === 1) setHasPendingRealtimeUpdate(false);
}, [page]);
```

---

## D. Análise de risco de triggers em cascata

### D.1 Mapa de todos os triggers em `project_programming`

| Nome | Timing | Evento | O que faz | Atualiza outras linhas? |
|------|--------|--------|-----------|-------------------------|
| `trg_project_programming_audit` | BEFORE | INSERT OR UPDATE | Preenche audit fields | NÃO |
| `trg_00_project_programming_schedule_concurrency` | BEFORE | INSERT OR UPDATE OF timing/status | Advisory lock + overlap check | NÃO |
| `trg_project_programming_assign_group_id` | BEFORE | INSERT OR UPDATE | Atribui `programming_group_id` | NÃO |
| `trg_project_programming_sync_work_completion_status` | BEFORE | INSERT OR UPDATE OF work_completion_status* | Normaliza código/UUID do catálogo | NÃO |
| `zz_trg_project_programming_completed_group_integrity` | BEFORE | INSERT OR UPDATE OF status/group/work_completion | Valida integridade de grupo CONCLUÍDO | NÃO (raise exception) |
| `zz_trg_project_programming_anticipated_work_status` | BEFORE | INSERT OR UPDATE OF antecipação fields | Valida status ANTECIPADO | NÃO (raise exception) |
| `trg_project_programming_sync_documents` | **AFTER** | INSERT OR UPDATE | **SIM** — UPDATE em N irmãos (mesmo projeto/data, ou equipes LV-xx em 7 dias) | **⚠ CASCADE** |
| `trg_project_programming_restore_anticipated_by_reopened_completion` | **AFTER** | UPDATE OF work_completion_status | **SIM** — UPDATE em irmãos com ANTECIPADO → previous_status | **⚠ CASCADE** |
| `trg_zz_project_programming_realtime_broadcast` *(novo)* | **AFTER** | INSERT OR UPDATE OR DELETE | Emite Broadcast Realtime | NÃO |

### D.2 Análise dos dois triggers AFTER que cascateiam

#### `trg_project_programming_sync_documents`
- **Comportamento:** quando SGD/PI/PEP muda em uma linha, atualiza documentos de todas as linhas com mesmo projeto+data e equipes LV-xx em janela de 7 dias.
- **Profundidade máxima observada:** a função tem `if pg_trigger_depth() > 1 then return new` — portanto ela mesma não vai além de 1 nível de cascata.
- **Impacto no nosso trigger:** ao atualizar linha A (depth=1), o sync_documents atualiza linhas B, C, D... Nesses UPDATEs, `trg_zz_project_programming_realtime_broadcast` dispara com `pg_trigger_depth() = 2` → **suprimido pelo nosso guard**. Apenas o evento da linha A é emitido.
- **Risco:** irmãos B, C, D tiveram seus documentos alterados mas não emitiram evento próprio. O frontend fará `fetchBoardSnapshot()` completo ao receber o evento de A → vai buscar os dados atualizados de B, C, D também. **Aceitável.**

#### `trg_project_programming_restore_anticipated_by_reopened_completion`
- **Comportamento:** quando `work_completion_status` muda de CONCLUÍDO para outro valor, atualiza todos os irmãos que têm `work_completion_status = ANTECIPADO` para restaurar `previous_work_completion_status`.
- **Cascata de segundo nível:** ao atualizar linha B (irmão), o trigger `restore_anticipated...` dispara novamente para B. Mas a condição `v_old_status in CONCLUIDO AND v_new_status NOT in CONCLUIDO` é FALSE para B (que era ANTECIPADO, não CONCLUÍDO) → sai imediatamente. **Sem loop infinito.**
- **Impacto no nosso trigger:** irmãos B atualizados disparam `trg_zz_...broadcast` com depth=2 → suprimido. Apenas linha A emite evento.
- **Risco:** irmãos com work_completion_status restaurado não emitem evento próprio. Mesmo raciocínio: o refetch completo do frontend captura tudo. **Aceitável.**

### D.3 Verificação do guard de profundidade

```
Usuário → DML em linha A
  depth=1: trg_project_programming_sync_documents → UPDATE em linhas B, C
    depth=2: trg_zz_...broadcast para B → RETURN NULL (suprimido ✓)
    depth=2: trg_zz_...broadcast para C → RETURN NULL (suprimido ✓)
  depth=1: trg_zz_...broadcast para A → EMIT (emitido ✓)
```

A ordem alfabética (`trg_p...` < `trg_zz...`) garante que o sync_documents atualiza os irmãos ANTES de nosso trigger emitir o evento para A. Quando o evento de A é emitido, todos os irmãos já estão com dados finais. O frontend vai buscar o estado consistente. **Não há janela de inconsistência.**

### D.4 Risco de `realtime.send` falhar silenciosamente

O `perform realtime.send(...)` no trigger não captura exceções. Se o Realtime estiver indisponível, o `perform` descarta o resultado sem afetar a transação principal. **Isso é o comportamento correto:** a indisponibilidade do Realtime não pode impedir um save de programação.

Se `realtime.send` lançar exceção (ex: versão incompatível), ela propagará e rollbackará a transação. Por isso o PASSO 1 da migration verifica que `realtime.send` existe antes de criar o trigger.

---

## E. Estratégia de debounce e atualização da interface

### E.1 Janela de agrupamento

**500ms** (dentro do range 300-700ms especificado).

Justificativa: uma operação em lote (batch create para 5 equipes) gera 5 eventos em ~50ms cada. Com 500ms de debounce, todos chegam na mesma janela e resultam em **1 único `fetchBoardSnapshot()`**.

### E.2 Fluxo de decisão por evento recebido

```
Evento recebido via Broadcast
  │
  ├─ payload.tenantId !== tenantId → IGNORAR (defesa em profundidade)
  │
  ├─ newState.executionDate fora de activeFilters.startDate/endDate → IGNORAR
  ├─ activeFilters.projectId ≠ '' AND newState.projectId ≠ filtro → IGNORAR
  ├─ activeFilters.teamId ≠ '' AND newState.teamId ≠ filtro → IGNORAR
  │
  └─ Evento relevante → agendar debounce 500ms
       │
       └─ Timer disparou:
            ├─ currentPage === 1 → fetchBoardSnapshot() + applyBoardSnapshot()
            │                       (atualização automática silenciosa)
            └─ currentPage > 1  → setHasPendingRealtimeUpdate(true)
                                   (banner + botão "Atualizar lista")
```

### E.3 Comportamento de múltiplos eventos simultâneos

- 3 eventos chegam em 50ms → reiniciamos o timer a cada evento → apenas 1 callback final em +500ms → **1 único refetch**.
- O refetch já busca o estado completo do banco (não apenas o registro modificado) → todos os eventos são capturados de uma vez.

### E.4 Ausência de reload automático em página > 1

Motivação: reordenar ou substituir a listagem enquanto o usuário está lendo a página 2 seria desorientador. O banner dá controle ao usuário, que decide quando atualizar.

Ao clicar "Atualizar lista": `setPage(1)` → `fetchBoardSnapshot()` + `applyBoardSnapshot()` → `setHasPendingRealtimeUpdate(false)`.

### E.5 Reconexão e expiração de token

- O Supabase Realtime reconecta automaticamente após queda de rede.
- Ao renovar o token (rotação do JWT), o `accessToken` no `useAuth()` muda → o `useEffect([tenantId, accessToken, ...])` do hook re-executa → canal anterior é removido → `supabase.realtime.setAuth(newToken)` é chamado → novo canal é criado.

---

## F. Rollback

### F.1 SQL de rollback (sem migration de "down")

```sql
-- rollback_283_realtime_broadcast_project_programming.sql
-- Executar no Supabase SQL Editor se a migration 283 precisar ser revertida.

begin;

drop trigger if exists trg_zz_project_programming_realtime_broadcast
  on public.project_programming;

drop function if exists public.broadcast_project_programming_change();

drop policy if exists "authenticated_receive_programming_broadcasts"
  on realtime.messages;

drop function if exists public.extract_tenant_id_from_programming_topic(text);

commit;
```

### F.2 Rollback do frontend

1. Reverter `hooks.ts` (remover `useProgrammingRealtime`).
2. Reverter `ProgrammingSimplePageView.tsx` (remover hook call, estado, banner).
3. Reverter `types.ts` (remover tipos de Realtime).
4. Deploy do código anterior.

**Sem necessidade de rollback de dados** — triggers e policies não alteram dados de negócio.

### F.3 Impacto durante o período entre rollback do SQL e rollback do frontend

Se o trigger for dropado mas o frontend ainda tentar assinar o canal:
- O canal é criado, mas nunca receberá mensagens → comportamento equivalente ao estado sem Realtime → nenhum erro visível ao usuário.

Se o frontend for revertido mas o trigger SQL ainda estiver ativo:
- O trigger emite eventos, mas ninguém os assina → sem impacto no usuário.

**Ambas as direções de rollback parcial são seguras.**

---

## G. Plano de testes multi-tenant

### G.1 Pré-requisitos

- Dois usuários em tenants **diferentes**: `user_A` (tenant_A) e `user_B` (tenant_B).
- Dois usuários no **mesmo tenant**: `user_C` e `user_D` (tenant_C).
- Dois browsers abertos simultaneamente (ou modo anônimo + modo normal).

### G.2 Testes de isolamento entre tenants

| # | Ação | Usuário | Expectativa |
|---|------|---------|-------------|
| T1 | Salvar nova programação | user_A (tenant_A) | user_B (tenant_B) **NÃO** recebe evento |
| T2 | Cancelar programação | user_A (tenant_A) | user_B (tenant_B) **NÃO** recebe evento |
| T3 | Verificar no Supabase Logs | — | Evento emitido somente para tópico `tenant:<tenant_A_id>:programming` |

### G.3 Testes de colaboração no mesmo tenant

| # | Ação | Usuário | Expectativa |
|---|------|---------|-------------|
| T4 | Salvar nova programação (página 1) | user_C | user_D vê grade atualizar automaticamente em ≤ 700ms |
| T5 | Cancelar programação (página 1) | user_C | user_D vê item sumir da grade em ≤ 700ms |
| T6 | Adiar programação (página 1) | user_C | user_D vê status mudar em ≤ 700ms |
| T7 | Salvar programação (user_D na página 2) | user_C | user_D vê banner "Há atualizações na programação" |
| T8 | user_D clica "Atualizar lista" | user_D | volta à página 1 com dados atualizados |

### G.4 Testes de filtros

| # | Ação | Filtro ativo | Expectativa |
|---|------|-------------|-------------|
| T9 | Salvar programação para data fora do range | Filtro: Jan 2025 - Mar 2025 | Evento ignorado se data do evento fora do range |
| T10 | Salvar programação de outro projeto | Filtro: projetoId=X | Evento ignorado se projetoId da programação ≠ X |
| T11 | Salvar programação de outra equipe | Filtro: teamId=Y | Evento ignorado se teamId ≠ Y |

### G.5 Testes de cascata

| # | Ação | Expectativa |
|---|------|-------------|
| T12 | Salvar programação com SGD/PI/PEP (irmãos existem mesma data/projeto) | user_D recebe **1 único evento**, não N eventos. Grade refetch captura documentos dos irmãos atualizados. |
| T13 | Alterar work_completion_status de CONCLUÍDO para outro (com irmãos ANTECIPADO) | user_D recebe **1 único evento** (da linha raiz). Grade refetch captura irmãos restaurados. |

### G.6 Testes de reconexão e auth

| # | Cenário | Expectativa |
|---|---------|-------------|
| T14 | Desligar internet por 10s, religar | Canal reconecta automaticamente; próxima mutação gera evento |
| T15 | Token expira (simular via força-bruta do tempo de expiração) | Novo token emitido via `useAuth()` → canal recriado com `setAuth(newToken)` |
| T16 | Trocar de tenant (se suportado pela UI) | Canal anterior removido; novo canal criado para novo tenantId |

### G.7 Critério de aceite para publicação em produção

1. T1 e T2 passam (isolamento garantido).
2. T4 a T6 passam (colaboração no mesmo tenant).
3. T12 e T13 passam (sem tempestade de eventos em cascata).
4. Nenhuma exception nos Supabase Logs durante os testes.
5. `realtime.send` não aparece como gargalo nas métricas de tempo de resposta dos RPCs de save.
6. Somente após confirmar todos os itens acima: desativar "Allow public access to channels" no Supabase Dashboard → rodar T1 e T4 novamente para confirmar que o modo privado está funcionando corretamente em produção.

---

## H. Dependências e riscos adicionais

### H.1 Versão mínima do Supabase Realtime

`realtime.send` com 4 parâmetros (`payload, event, topic, private`) exige Supabase Realtime >= 2.29.0. O PASSO 1 da migration valida isso. Se a versão for inferior, a migration falha com mensagem clara antes de criar qualquer objeto.

### H.2 Autenticação do canal privado

O frontend deve chamar `supabase.realtime.setAuth(accessToken)` **antes** de `channel.subscribe()`. Se omitido, a assinatura falha silenciosamente com status `CHANNEL_ERROR`. O hook já trata isso na função `subscribe()`.

### H.3 `realtime.send` é `perform` — falha silenciosa

Se o Realtime estiver temporariamente indisponível, o `perform realtime.send(...)` descarta a exceção e não afeta a transação. Isso é correto: o save nunca pode falhar por indisponibilidade do Realtime. Mas o usuário não verá o evento Realtime até a próxima operação. Sem impacto funcional.

### H.4 Custo de performance do trigger

O trigger `broadcast_project_programming_change` executa `realtime.send` que é uma chamada ao sistema Realtime dentro da transação. Em lotes grandes (ex: batch create de 50 registros), serão emitidos até 50 eventos. O debounce no frontend agrupa todos em 1 refetch. No banco, os 50 `realtime.send` são síncronos dentro da transação. Monitorar tempo de transação em operações batch após o deploy.

### H.5 Renumeracao automatica de ETAPA

A melhoria de ETAPA automatica deve ser tratada como feature de banco/API antes de qualquer ajuste de Realtime.

Riscos principais:
- Deslocar etapas futuras altera `etapa_number` e pode alterar `programming_group_id`.
- Um unico insert/reprogramacao pode gerar varias atualizacoes de linhas futuras.
- `CONCLUIDO -> ANTECIPADO` depende da ordenacao numerica de ETAPA.
- `ETAPA UNICA` e `ETAPA FINAL` nao tem `etapa_number` e nao devem entrar na renumeracao numerica sem regra de negocio aprovada.

Requisitos para compatibilizar com Realtime:
- Incluir `etapa_unica`, `etapa_final` e `programming_group_id` como campos relevantes do broadcast.
- Garantir que a renumeracao rode em uma unica transacao, para o refetch acionado pelo Realtime ler estado final consistente.
- Validar o volume de eventos emitidos quando muitas etapas futuras forem deslocadas; o frontend deve continuar fazendo um unico refetch por debounce.

---

*Documento gerado em 2026-07-01 — aguardando aprovação para implementação da migration 283 e código frontend.*
