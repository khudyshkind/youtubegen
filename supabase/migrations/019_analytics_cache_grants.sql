-- analytics_cache и analytics_reports: выдать GRANT для service_role.
-- Таблицы созданы через Supabase Dashboard без GRANT-блоков,
-- из-за чего сервер-сайд кэш никогда не пишется и не читается —
-- каждый аналитический запрос заново вызывает Claude.

grant select, insert, update, delete on public.analytics_cache    to service_role;
grant select, insert, update, delete on public.analytics_reports   to service_role;

-- Повторить на случай, если после миграции роль authenticated потеряла привилегии
grant select, insert, update, delete on public.analytics_cache    to authenticated;
grant select, insert, update, delete on public.analytics_reports   to authenticated;
