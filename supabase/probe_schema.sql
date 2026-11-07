-- ============================================================================
-- QuickStride CRM — ЗВІРКА ФАКТИЧНОЇ СХЕМИ (лише читання, нічого не змінює)
--
-- Код сервера очікує реальної схеми проєкту QuickStride:
--   crm_users(id uuid, telegram_user_id),
--   crm_clients / crm_projects / crm_payments / crm_reminders — id uuid,
--   власник owner_id (uuid → crm_users.id), а в crm_payments колонки
--   paid_on і payment_type, у crm_reminders — due_at.
--
-- Підтверджено перевіркою бази: crm_settings наразі НЕ існує — її створює
-- supabase/migrate_crm.sql (адитивно). Внутрішні назви моделі (date, type,
-- datetime) перекладаються у фактичні колонки в lib/server/columns.ts.
--
-- Виконайте цей файл в Supabase SQL Editor і порівняйте вивід з очікуваннями.
-- Старі версії schema.sql (з app_users, clients, user_id, текстовими id)
-- застосовувати не можна: вони не відповідають цій базі.
-- ============================================================================

-- 1. Колонки наявних таблиць.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('crm_users','crm_clients','crm_projects','crm_payments','crm_reminders','crm_settings')
 order by table_name, ordinal_position;

-- 2. Обмеження та індекси.
select c.conrelid::regclass as table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
 where c.connamespace = 'public'::regnamespace
   and c.conrelid::regclass::text like 'crm_%'
 order by 1, 2;

-- 3. Чи збігаються колонки власника з очікуванням owner_id (uuid).
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('crm_clients','crm_projects','crm_payments','crm_reminders')
   and column_name in ('owner_id','user_id')
 order by table_name;

-- 4. Ключові для застосунку колонки: чого бракує відносно очікувань коду.
with expected(table_name, column_name) as (
  values
    ('crm_users',     'id'), ('crm_users',     'telegram_user_id'),
    ('crm_clients',   'id'), ('crm_clients',   'owner_id'),
    ('crm_clients',   'name'), ('crm_clients', 'company'), ('crm_clients', 'phone'),
    ('crm_clients',   'telegram'), ('crm_clients', 'email'), ('crm_clients', 'note'),
    ('crm_clients',   'kind'), ('crm_clients', 'archived'), ('crm_clients', 'created_at'),
    ('crm_projects',  'id'), ('crm_projects',  'owner_id'), ('crm_projects', 'client_id'),
    ('crm_projects',  'title'), ('crm_projects', 'description'), ('crm_projects', 'amount_minor'),
    ('crm_projects',  'currency'), ('crm_projects', 'status'), ('crm_projects', 'deadline'),
    ('crm_projects',  'next_action'), ('crm_projects', 'note'), ('crm_projects', 'created_at'),
    ('crm_payments',  'id'), ('crm_payments',  'owner_id'), ('crm_payments', 'project_id'),
    ('crm_payments',  'amount_minor'), ('crm_payments', 'currency'), ('crm_payments', 'paid_on'),
    ('crm_payments',  'payment_type'), ('crm_payments', 'note'), ('crm_payments', 'created_at'),
    ('crm_reminders', 'id'), ('crm_reminders', 'owner_id'), ('crm_reminders', 'title'),
    ('crm_reminders', 'due_at'), ('crm_reminders', 'timezone'), ('crm_reminders', 'client_id'),
    ('crm_reminders', 'project_id'),
    ('crm_reminders', 'done'), ('crm_reminders', 'created_at')
)
select e.table_name, e.column_name,
       case when c.column_name is null then 'ВІДСУТНЯ — узгодити' else 'ок (' || c.data_type || ')' end as status
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = e.table_name and c.column_name = e.column_name
 order by status desc, e.table_name, e.column_name;

-- 4b. Типи, на які спирається код: id та owner_id мають бути uuid.
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('crm_users','crm_clients','crm_projects','crm_payments','crm_reminders')
   and column_name in ('id','owner_id','telegram_user_id','client_id','project_id')
 order by table_name, column_name;

-- 4c. crm_settings (налаштування профілю) — має бути відсутня: створює міграція.
select to_regclass('public.crm_settings') as crm_settings,
       case when to_regclass('public.crm_settings') is null
            then 'не існує — створить її supabase/migrate_crm.sql'
            else 'вже існує — міграція нічого в ній не перестворить' end as статус;

-- 4d. Типи й NOT NULL, на які спирається код: усе, що не збігається,
-- міграція відхиляє (розділ A5), тому порівняйте заздалегідь.
with expected(table_name, column_name, data_type, is_nullable) as (
  values
    ('crm_payments','paid_on','date','NO'),
    ('crm_payments','payment_type','text','NO'),
    ('crm_reminders','due_at','timestamp with time zone','NO'),
    ('crm_reminders','timezone','text','YES')
)
select e.table_name, e.column_name,
       e.data_type || ' / ' || e.is_nullable as очікуємо,
       coalesce(c.data_type || ' / ' || c.is_nullable, 'КОЛОНКИ НЕМАЄ') as фактично,
       case
         when c.column_name is null then 'РІЗНИЦЯ — додати колонку'
         when c.data_type <> e.data_type or c.is_nullable <> e.is_nullable then 'РІЗНИЦЯ — узгодити код і міграцію'
         else 'збігається'
       end as вердикт
  from expected e
  left join information_schema.columns c
    on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
 order by вердикт desc, e.table_name;

-- 5. Скільки даних уже є (кількості виводяться NOTICE, щоб не падати на
--    відсутній ще crm_settings).
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['crm_users','crm_clients','crm_projects','crm_payments','crm_reminders','crm_settings'] loop
    if to_regclass('public.' || t) is null then
      raise notice '%: НЕ ІСНУЄ (створить її migrate_crm.sql)', t;
    else
      execute format('select count(*) from public.%I', t) into n;
      raise notice '%: % рядків', t, n;
    end if;
  end loop;
end $$;

-- 6. Що вже створено в цих таблицях: обмеження, індекси, RLS.
--    Міграція пропускає все, що вже є, тому це «поточний стан» перед нею.
select c.conrelid::regclass::text as table_name, c.conname, c.contype::text as kind,
       c.convalidated as validated, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
 where c.connamespace = 'public'::regnamespace
   and c.conrelid::regclass::text like 'crm_%'
 order by 1, 2;

select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename like 'crm_%'
 order by 1, 2;

select relname as table_name, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace and relname like 'crm_%'
 order by 1;

-- 6b. Складені зовнішні ключі: які колонки покривають і що станеться при
--     видаленні. Міграція НЕ створює однакових одинарних FK поверх них.
select con.conrelid::regclass::text as table_name,
       con.conname,
       (select string_agg(att.attname, ', ' order by u.ord)
          from unnest(con.conkey) with ordinality u(attnum, ord)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum) as local_columns,
       con.confrelid::regclass::text as ref_table,
       (select string_agg(att.attname, ', ' order by u.ord)
          from unnest(con.confkey) with ordinality u(attnum, ord)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = u.attnum) as ref_columns,
       case con.confdeltype when 'a' then 'NO ACTION (видалення заблоковане)'
                            when 'r' then 'RESTRICT (видалення заблоковане)'
                            when 'c' then 'CASCADE (діти видалються)'
                            when 'n' then 'SET NULL (посилання зніметься)'
                            else 'SET DEFAULT' end as on_delete,
       con.convalidated as validated
  from pg_constraint con
 where con.contype = 'f'
   and con.connamespace = 'public'::regnamespace
   and con.conrelid::regclass::text like 'crm_%'
 order by 1, array_length(con.conkey, 1) desc, 2;

-- 6c. Чи є одинарні FK, які міграція могла б задублювати.
select con.conrelid::regclass::text as table_name, con.conname,
       (select att.attname from unnest(con.conkey) u(attnum)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum limit 1) as single_column
  from pg_constraint con
 where con.contype = 'f' and array_length(con.conkey, 1) = 1
   and con.conrelid::regclass::text like 'crm_%'
 order by 1, 2;

-- 7. Функції, які вже можуть конфліктувати з міграцією.
select p.proname, pg_get_function_identity_arguments(p.oid) as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'qs_%'
 order by 1;

-- 8. Чи застосовували раніше якийсь скрипт через Supabase CLI. Порожньо —
--    значить, історії міграцій у базі немає.
select to_regclass('supabase_migrations.schema_migrations') as migrations_table;
do $$
declare
  r record;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'історії міграцій немає (таблиці supabase_migrations.schema_migrations не існує)';
    return;
  end if;
  for r in select version, name, applied_at from supabase_migrations.schema_migrations order by version limit 20 loop
    raise notice 'застосовано: % — % (%)]', r.version, r.name, r.applied_at;
  end loop;
end $$;

-- 9. Побічні таблиці зі СТАРОЇ схеми (app_users, clients, payments, …).
--    Вони не мають існувати: якщо є — не чіпаємо й узгоджуємо окремо.
select tablename as legacy_table
  from pg_tables
 where schemaname = 'public'
   and tablename in ('app_users','user_settings','clients','projects','payments','reminders')
 order by 1;

-- 10. Ролі, на які міграція знімає права (мають існувати в Supabase).
select rolname from pg_roles where rolname in ('anon','authenticated','service_role') order by 1;
