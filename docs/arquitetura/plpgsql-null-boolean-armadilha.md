# Armadilha: boolean NULL em PL/pgSQL em triggers

> **As regras canônicas vivem em [`guias/guia_sql.md`](../../guias/guia_sql.md).** Este arquivo é mantido como referência complementar — contém o incidente completo (migrations 279→282) e o script de diagnóstico. Em caso de divergência entre este arquivo e `guias/guia_sql.md`, o guia prevalece; atualize este arquivo na mesma tarefa que atualizar a regra.

## O problema

Em PostgreSQL, qualquer comparação envolvendo `NULL` retorna `NULL` — não `FALSE`:

```sql
NULL in ('CONCLUIDO', 'COMPLETO')  = NULL
NULL like 'CONCLUIDO%'             = NULL
NULL OR NULL OR NULL OR NULL       = NULL
```

Em PL/pgSQL, `IF <expressão> THEN` só executa o corpo quando a expressão avalia `TRUE`.  
`NULL` não é `TRUE` → o corpo **não executa**, mas também **não provoca erro**.

Variáveis declaradas com `boolean := false` e depois **re-atribuídas** com uma expressão NULL-possível perdem o `false` inicial:

```sql
v_is_completed boolean := false;  -- inicial
v_is_completed := (
  v_text in ('CONCLUIDO', 'COMPLETO')  -- NULL quando v_text é NULL
  or v_text like 'CONCLUIDO%'          -- NULL
);
-- agora v_is_completed = NULL, não false!
```

---

## Onde isso causa bugs silenciosos

### Gatilho BEFORE com early-return por condição NULL

```sql
-- BUGADO: se v_new_is_completed = NULL, o IF não dispara (null ≠ true)
-- e o trigger CONTINUA para o check de irmãos → exception falsa!
if new.status not in ('PROGRAMADA','REPROGRAMADA') or not v_new_is_completed then
  return new;  -- NÃO executa quando not NULL = NULL
end if;
```

### Incident registrado (migration 282, 2026-06-29)

Trigger `enforce_completed_work_status_group_integrity` usava:
```sql
v_new_is_completed := (
  v_new_text_status in ('CONCLUIDO', 'COMPLETO')
  or v_new_text_status like 'CONCLUIDO%'
  or v_new_id_status in ('CONCLUIDO', 'COMPLETO')
  or v_new_id_status like 'CONCLUIDO%'
);
```

Quando `v_new_text_status = NULL` e `v_new_id_status = NULL` (row com Estado Trabalho vazio):
- Toda a expressão = `NULL`
- `v_new_is_completed = NULL`
- `if ... or not v_new_is_completed then` = `if NULL then` → não executa
- Trigger continuava até o EXISTS de irmãos → lançava exception incorretamente

**Diagnóstico usado:** substituiu a mensagem de exception por `RAISE EXCEPTION 'DEBUG: new_wcs=[%] ...'` para capturar os valores reais no momento do disparo. O debug revelou `new_wcs=[NULL] new_wcs_id=[NULL]`, provando que o early-return não disparou.

---

## Regra de prevenção obrigatória

### Em todo trigger PL/pgSQL: usar `COALESCE` em atribuições booleanas

```sql
-- CORRETO
v_new_is_completed := coalesce(
  v_new_text_status in ('CONCLUIDO', 'COMPLETO')
  or v_new_text_status like 'CONCLUIDO%'
  or v_new_id_status in ('CONCLUIDO', 'COMPLETO')
  or v_new_id_status like 'CONCLUIDO%',
  false   -- garante false quando todos os inputs são NULL
);
```

### Alternativa: guards IS NOT NULL antes de comparar

```sql
v_new_is_completed := (
  (v_new_text_status is not null and v_new_text_status in ('CONCLUIDO', 'COMPLETO'))
  or (v_new_text_status is not null and v_new_text_status like 'CONCLUIDO%')
  or (v_new_id_status is not null and v_new_id_status in ('CONCLUIDO', 'COMPLETO'))
  or (v_new_id_status is not null and v_new_id_status like 'CONCLUIDO%')
);
-- sem NULL nos operadores → sem NULL no resultado
```

### Regra de checklist para novas funções de trigger

Antes de abrir merge request com função de trigger:

- [ ] Toda variável `boolean` que recebe expressão composta tem `COALESCE(..., false)` ou guards `IS NOT NULL`
- [ ] Todo `IF <variável_booleana> THEN` onde a variável pode ser NULL usa `IF COALESCE(var, false) THEN` ou `IF var = TRUE THEN`
- [ ] Expressões booleanas que dependem de `text` ou `uuid` buscados via `SELECT INTO` (que podem retornar NULL por `NOT FOUND`) são protegidas
- [ ] A função tem pelo menos um caso de teste com todos os campos NULáveis como NULL

---

## Como debugar triggers que disparam incorretamente

### Técnica: substituir a exception por mensagem diagnóstica

Temporariamente, substitui a mensagem normal da exception pelos valores de estado no momento do disparo:

```sql
raise exception
  'DEBUG id=% status=% new_wcs=[%] new_wcs_id=[%] v_bool=%',
  new.id, new.status,
  coalesce(new.work_completion_status, 'NULL'),
  coalesce(new.work_completion_status_id::text, 'NULL'),
  v_new_is_completed
  using errcode = '23514';
```

O erro aparece no frontend com todos os valores exatos. Depois de identificar a causa, restaurar a versão de produção.

---

## Referências no código

- `supabase/migrations/282_fix_completed_group_integrity_null_boolean.sql` — fix aplicado
- `supabase/migrations/279_harden_completed_group_integrity_transition.sql` — introduziu o bug
- `supabase/migrations/280_fix_completed_group_integrity_on_reprogram.sql` — bypass parcial (não corrigiu NULL)
- `supabase/migrations/281_fix_completed_group_bypass_canonical_code.sql` — bypass canônico (não corrigiu NULL)
- `scripts/debug-trigger-capture-281.sql` — script diagnóstico que revelou o NULL
