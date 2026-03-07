-- 008_timestamptz_data.sql
-- Converte colunas data para timestamptz (com hora).

alter table if exists public.requisicoes
  alter column data type timestamptz
  using (
    case
      when data ~ '^\d{2}/\d{2}/\d{4}$' then to_timestamp(data || ' 00:00:00', 'DD/MM/YYYY HH24:MI:SS')
      else data::timestamptz
    end
  );

alter table if exists public.stock_conflicts
  alter column data type timestamptz
  using (
    case
      when data ~ '^\d{2}/\d{2}/\d{4}$' then to_timestamp(data || ' 00:00:00', 'DD/MM/YYYY HH24:MI:SS')
      else data::timestamptz
    end
  );
