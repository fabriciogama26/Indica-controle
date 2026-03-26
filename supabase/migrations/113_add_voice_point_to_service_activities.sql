-- 113_add_voice_point_to_service_activities.sql
-- Adiciona voice_point na base de atividades para uso na Medicao.

alter table if exists public.service_activities
  add column if not exists voice_point numeric(14, 6);

update public.service_activities
set voice_point = 1
where voice_point is null;

alter table if exists public.service_activities
  alter column voice_point set default 1;

alter table if exists public.service_activities
  alter column voice_point set not null;

alter table if exists public.service_activities
  drop constraint if exists chk_service_activities_voice_point_positive;

alter table if exists public.service_activities
  add constraint chk_service_activities_voice_point_positive
  check (voice_point > 0);
