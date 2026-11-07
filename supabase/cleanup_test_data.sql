-- ============================================================================
-- QuickStride CRM — ПРИБИРАННЯ ТЕСТОВИХ ЗАПИСІВ ПІСЛЯ ПЕРЕВІРКИ В TELEGRAM
--
-- Скрипт видаляє лише те, що належить конкретним тестовим акаунтам, за
-- якими ви входили. Нічого не чіпає, доки ви не зміните TELEGRAM_ID нижче
-- і не запустите блок DELETE свідомо.
--
-- Порядок: 1) подивитися, що видалиться; 2) видалити.
-- ============================================================================

-- ── 1. Перегляд (лише читання) ──────────────────────────────────────────────
-- Впишіть числові Telegram id тестових акаунтів.
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
select 'клієнти' as таблиця, count(*)::int as рядків from crm_clients where owner_id in (select id from test_accounts)
union all select 'проєкти', count(*)::int from crm_projects where owner_id in (select id from test_accounts)
union all select 'оплати', count(*)::int from crm_payments where owner_id in (select id from test_accounts)
union all select 'справи', count(*)::int from crm_reminders where owner_id in (select id from test_accounts)
union all select 'налаштування', count(*)::int from crm_settings where owner_id in (select id from test_accounts)
union all select 'акаунти', count(*)::int from crm_users where id in (select id from test_accounts);

-- Якщо замість очікуваних чисел видно 0 — тестових акаунтів у базі немає,
-- видалення не потрібне. Якщо видно більше, ніж ви створювали, — зупиніться
-- і перевірте, чи не вписали ви id робочого акаунта.

-- ── 2. Видалення (розкоментувати після перевірки цифр вище) ─────────────────
-- Дочірні записи йдуть першими; акаунт — останнім, його налаштування
-- приберуться через ON DELETE CASCADE.
/*
begin;

with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_reminders where owner_id in (select id from test_accounts);
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_payments where owner_id in (select id from test_accounts);
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_projects where owner_id in (select id from test_accounts);
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_clients where owner_id in (select id from test_accounts);
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_settings where owner_id in (select id from test_accounts);
with test_accounts as (
  select id from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2'])
)
delete from crm_users where id in (select id from test_accounts);

commit;
*/

-- ── 3. Контроль після видалення ─────────────────────────────────────────────
select count(*)::int as лишилось_тестових_акаунтів
  from crm_users where telegram_user_id = any (array['ЗАМІНИТИ_НА_ID_1','ЗАМІНИТИ_НА_ID_2']);
