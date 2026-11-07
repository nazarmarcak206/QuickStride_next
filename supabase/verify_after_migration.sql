-- ============================================================================
-- QuickStride CRM — ПЕРЕВІРКА ПІСЛЯ МІГРАЦІЇ
--
-- Read-only: нічого не змінює. Розділ I — єдиний, де щось записується, —
-- робить це всередині транзакції та завершується ROLLBACK, тому в базі не
-- лишається жодного тестового рядка.
-- Виконувати в Supabase SQL Editor після supabase/migrate_crm.sql.
-- ============================================================================

-- ── A. Структура: назви, типи, NOT NULL ─────────────────────────────────────
select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as default_value
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('crm_users','crm_settings','crm_clients','crm_projects','crm_payments','crm_reminders')
 order by table_name, ordinal_position;

-- ── B. Очікування по обмеженнях: що має бути і чи валідоване ───────────────
with expected(conrelid, conname) as (
  values
    ('crm_clients'::regclass,  'crm_clients_owner_id_fkey'),
    ('crm_projects'::regclass, 'crm_projects_owner_id_fkey'),
    ('crm_payments'::regclass, 'crm_payments_owner_id_fkey'),
    ('crm_reminders'::regclass,'crm_reminders_owner_id_fkey'),
    ('crm_projects'::regclass, 'crm_projects_client_id_fkey'),
    ('crm_payments'::regclass, 'crm_payments_project_id_fkey'),
    ('crm_reminders'::regclass,'crm_reminders_client_id_fkey'),
    ('crm_reminders'::regclass,'crm_reminders_project_id_fkey'),
    ('crm_projects'::regclass, 'crm_projects_amount_check'),
    ('crm_payments'::regclass, 'crm_payments_amount_check'),
    ('crm_projects'::regclass, 'crm_projects_currency_check'),
    ('crm_payments'::regclass, 'crm_payments_currency_check'),
    ('crm_settings'::regclass, 'crm_settings_currency_check'),
    ('crm_projects'::regclass, 'crm_projects_status_check'),
    ('crm_payments'::regclass, 'crm_payments_payment_type_check'),
    ('crm_clients'::regclass,  'crm_clients_kind_check'),
    ('crm_reminders'::regclass,'crm_reminders_timezone_check')
)
select e.conrelid::text as table_name, e.conname as expected_constraint,
       case
         when c.conname is null then 'ВІДСУТНЄ — міграція не застосована повністю'
         when not c.convalidated then 'є, але NOT VALID — перевірте, чи були дані'
         else 'ок (валідоване)'
       end as вердикт
  from expected e
  left join pg_constraint c
    on c.conrelid = e.conrelid and c.conname = e.conname and c.connamespace = 'public'::regnamespace
 order by вердикт, table_name, expected_constraint;

-- ── B2. Повне дерево зовнішніх ключів: переконатися, що складені
--     лишились і одинарних дублікатів не зʼявилося.
select con.conrelid::regclass::text as table_name, con.conname,
       (select string_agg(att.attname, ',' order by u.ord)
          from unnest(con.conkey) with ordinality u(attnum, ord)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum) as local_columns,
       con.confrelid::regclass::text as ref_table,
       case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                            when 'n' then 'SET NULL' else 'SET DEFAULT' end as on_delete,
       con.convalidated as validated
  from pg_constraint con
 where con.contype = 'f' and con.conrelid::regclass::text like 'crm_%'
 order by 1, array_length(con.conkey, 1) desc, 2;

-- Очікувано: складені ключі — ті самі, що й до міграції; додані — лише
-- owner_id → crm_users (4 доменні таблиці + crm_settings).

-- ── C. NOT NULL на колонках власника й обовʼязкових датах ───────────────────
select table_name, column_name, is_nullable,
       case when is_nullable = 'NO' then 'ок' else 'ПОВИННО БУТИ NO' end as вердикт
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name in ('crm_clients','crm_projects','crm_payments','crm_reminders') and column_name = 'owner_id')
     or (table_name = 'crm_payments' and column_name in ('paid_on','payment_type','project_id'))
     or (table_name = 'crm_reminders' and column_name = 'due_at'))
 order by table_name, column_name;

-- ── D. Індекси власника ─────────────────────────────────────────────────────
select tablename, indexname,
       case when indexname like '%owner%' then 'ок' else 'перевірити' end as вердикт
  from pg_indexes
 where schemaname = 'public' and tablename like 'crm_%' and indexname like '%owner%'
 order by tablename, indexname;

-- ── E. Права доступу: anon/authenticated не повинні мати жодних ─────────────
select table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name like 'crm_%'
   and grantee in ('anon','authenticated')
 order by table_name, privilege_type;
-- Очікуваний результат: порожньо (0 рядків).

-- ── F1. service_role — єдиний, хто ходить у базу (має мати повні права) ────
select rolname as role,
       has_database_privilege(rolname, current_database(), 'connect') as can_connect,
       has_schema_privilege(rolname, 'public', 'usage') as schema_usage,
       has_table_privilege(rolname, 'public.crm_clients', 'select') as clients_select,
       has_table_privilege(rolname, 'public.crm_payments', 'insert') as payments_insert,
       has_table_privilege(rolname, 'public.crm_settings', 'update') as settings_update
  from (values ('anon'),('authenticated'),('service_role')) as r(rolname)
 order by 1;
-- Очікувано: anon/authenticated — скрізь false; service_role — усюди true.

-- ── F. RLS: увімкнено на всіх шести таблицях ───────────────────────────────
select c.relname as table_name,
       case when c.relrowsecurity then 'увімкнено' else 'ВИМКНЕНО — перевірте міграцію' end as rls,
       (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('crm_users','crm_settings','crm_clients','crm_projects','crm_payments','crm_reminders')
 order by 1;
-- Очікувано: rls = увімкнено, policies = 0 (доступ лише через сервер).

-- ── G. Функція атомарного запису ────────────────────────────────────────────
select p.proname,
       pg_get_function_identity_arguments(p.oid) as signature,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'qs_create_project_with_prepayment';
-- Очікувано: рядок є; anon/authenticated = false; service_role = true.

-- ── H. Аудит цілісності власників (наявні дані мають бути чисті) ────────────
-- Усі чотири запити мають повернути 0: жодного запису без власника й жодного
-- звʼязку через межі власників.
select 'crm_clients без owner_id' as перевірка, count(*)::int as порушень from crm_clients where owner_id is null
union all
select 'crm_projects без owner_id', count(*)::int from crm_projects where owner_id is null
union all
select 'crm_payments без owner_id', count(*)::int from crm_payments where owner_id is null
union all
select 'crm_reminders без owner_id', count(*)::int from crm_reminders where owner_id is null
union all
select 'оплати чужого проєкту', count(*)::int
  from crm_payments p join crm_projects j on j.id = p.project_id
 where p.owner_id <> j.owner_id
union all
select 'проєкти з чужим клієнтом', count(*)::int
  from crm_projects j join crm_clients c on c.id = j.client_id
 where j.owner_id <> c.owner_id
union all
select 'справи з чужим клієнтом', count(*)::int
  from crm_reminders r join crm_clients c on c.id = r.client_id
 where r.owner_id <> c.owner_id
union all
select 'справи з чужим проєктом', count(*)::int
  from crm_reminders r join crm_projects j on j.id = r.project_id
 where r.owner_id <> j.owner_id
union all
select 'налаштування без акаунта', count(*)::int
  from crm_settings s left join crm_users u on u.id = s.owner_id
 where u.id is null;

-- ── I. Функціональний smoke-тест (усе в межах транзакції з відкатом) ───────
-- Перевіряє на СПРАВДЖНІЙ базі: атомарність, ідемпотентність, перевірку
-- власника, валюту та NOT NULL. Очікувані помилки ловляться у вкладені
-- блоки EXCEPTION — вони не абортують зовнішню транзакцію.
-- В кінці ROLLBACK: жодного тестового рядка в базі не залишається.
begin;

insert into crm_users (id, telegram_user_id) values
  ('00000000-0000-4000-8000-0000000000aa', '9000000001'),
  ('00000000-0000-4000-8000-0000000000bb', '9000000002');
insert into crm_clients (id, owner_id, name)
  values ('00000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-0000000000aa', 'Smoke клієнт');

do $$
declare
  v_row record;
begin
  -- 1) проєкт + передоплата одним викликом
  select * into v_row from qs_create_project_with_prepayment(
    '00000000-0000-4000-8000-0000000000aa'::uuid,
    '{"id":"00000000-0000-4000-8000-0000000000d1","client_id":"00000000-0000-4000-8000-0000000000c1","title":"Smoke проєкт","description":"","amount_minor":2000000,"currency":"EUR","status":"У роботі","deadline":"","next_action":"","note":""}'::jsonb,
    '{"id":"00000000-0000-4000-8000-0000000000e1","amount_minor":500000,"currency":"EUR","paid_on":"2026-11-06","payment_type":"Передоплата","note":"smoke"}'::jsonb
  );
  if (select count(*) from crm_projects where id = '00000000-0000-4000-8000-0000000000d1') = 1
     and (select count(*) from crm_payments
           where project_id = '00000000-0000-4000-8000-0000000000d1'
             and currency = 'EUR' and paid_on is not null and payment_type = 'Передоплата') = 1 then
    raise notice '1. атомарність: ок — проєкт і передоплата створені разом';
  else
    raise notice '1. атомарність: ПРОВАЛ';
  end if;

  -- 2) повторний виклик із тими самими uuid
  perform qs_create_project_with_prepayment(
    '00000000-0000-4000-8000-0000000000aa'::uuid,
    '{"id":"00000000-0000-4000-8000-0000000000d1","client_id":"00000000-0000-4000-8000-0000000000c1","title":"Smoke проєкт","description":"","amount_minor":2000000,"currency":"EUR","status":"У роботі","deadline":"","next_action":"","note":""}'::jsonb,
    '{"id":"00000000-0000-4000-8000-0000000000e1","amount_minor":500000,"currency":"EUR","paid_on":"2026-11-06","payment_type":"Передоплата","note":"smoke"}'::jsonb
  );
  if (select count(*) from crm_payments where project_id = '00000000-0000-4000-8000-0000000000d1') = 1 then
    raise notice '2. ідемпотентність: ок — дублікатів немає';
  else
    raise notice '2. ідемпотентність: ПРОВАЛ — зʼявився дублікат';
  end if;

  -- 3) чужий клієнт (інший власник) має бути відхилений
  begin
    perform qs_create_project_with_prepayment(
      '00000000-0000-4000-8000-0000000000bb'::uuid,
      '{"id":"00000000-0000-4000-8000-0000000000d2","client_id":"00000000-0000-4000-8000-0000000000c1","title":"Чужий","description":"","amount_minor":1,"currency":"EUR","status":"Новий","deadline":"","next_action":"","note":""}'::jsonb,
      null
    );
    raise notice '3. чужий клієнт: ПРОВАЛ — помилки не було';
  exception when others then
    if (select count(*) from crm_projects where id = '00000000-0000-4000-8000-0000000000d2') = 0 then
      raise notice '3. чужий клієнт: ок — відхилено (%s)', sqlerrm;
    else
      raise notice '3. чужий клієнт: ПРОВАЛ — проєкт створено попри помилку';
    end if;
  end;

  -- 4) оплата в іншій валюті: помилка І відкат проєкту (або обидва, або жоден)
  begin
    perform qs_create_project_with_prepayment(
      '00000000-0000-4000-8000-0000000000aa'::uuid,
      '{"id":"00000000-0000-4000-8000-0000000000d3","client_id":"","title":"Валюта","description":"","amount_minor":1,"currency":"EUR","status":"Новий","deadline":"","next_action":"","note":""}'::jsonb,
      '{"id":"00000000-0000-4000-8000-0000000000e3","amount_minor":1,"currency":"USD","paid_on":"2026-11-06","payment_type":"Передоплата","note":""}'::jsonb
    );
    raise notice '4. валюта: ПРОВАЛ — змішування валют пройшло';
  exception when others then
    if (select count(*) from crm_projects where id = '00000000-0000-4000-8000-0000000000d3') = 0 then
      raise notice '4. валюта: ок — відхилено, проєкт відкатувався (%s)', sqlerrm;
    else
      raise notice '4. валюта: ПРОВАЛ — проєкт лишився після відмови оплати';
    end if;
  end;

  -- 5a) deadline: date NULL — порожній дедлайн зберігається як NULL
  insert into crm_projects (id, owner_id, client_id, title, amount_minor, currency, status, deadline)
    values ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000aa',
            '00000000-0000-4000-8000-0000000000c1', 'Без дедлайну', 1, 'EUR', 'Новий', null);
  if (select deadline is null from crm_projects where id = '00000000-0000-4000-8000-0000000000d4') then
    raise notice '5a. deadline: ок — NULL зберігається і читається як «не задано»';
  else
    raise notice '5a. deadline: ПРОВАЛ — NULL не зберігся';
  end if;

  begin
    insert into crm_projects (id, owner_id, client_id, title, amount_minor, currency, status, deadline)
      values ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-0000000000c1', 'Помилка', 1, 'EUR', 'Новий', '');
    raise notice '5a. deadline: ПРОВАЛ — порожній рядок прийнято як date';
  exception when others then
    raise notice '5a. deadline: ок — '' відхиляється типом (тому код пише NULL)';
  end;

  -- 5b) наслідки видалення повʼязаних записів (правило бере наявний складений FK)
  begin
    delete from crm_clients where id = '00000000-0000-4000-8000-0000000000c1';
    if (select client_id is null from crm_projects where id = '00000000-0000-4000-8000-0000000000d1') then
      raise notice '5b. видалення клієнта: посилання зняте (SET NULL) — проєкт лишився';
    else
      raise notice '5b. видалення клієнта: дозволене, правило — каскад/відвʼязка, перевірте наслідки для проєктів';
    end if;
  exception when foreign_key_violation then
    raise notice '5b. видалення клієнта: заблоковане (NO ACTION) — спершу потрібно видалити чи перевʼязати проєкти';
  end;

  -- 5c) NOT NULL на due_at і paid_on
  begin
    insert into crm_reminders (id, owner_id, title, due_at)
      values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000aa', 'без дати', null);
    raise notice '5c. NOT NULL: ПРОВАЛ — due_at NULL прийнявся';
  exception when not_null_violation then
    raise notice '5c. NOT NULL: ок — due_at без значення відхилено';
  when others then
    raise notice '5c. NOT NULL: інша помилка — %s', sqlerrm;
  end;

  begin
    insert into crm_payments (id, owner_id, project_id, amount_minor, currency, paid_on, payment_type)
      values ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-0000000000d1', 1, 'EUR', null, 'Доплата');
    raise notice '5c. NOT NULL: ПРОВАЛ — paid_on NULL прийнявся';
  exception when not_null_violation then
    raise notice '5c. NOT NULL: ок — paid_on без значення відхилено';
  when others then
    raise notice '5c. NOT NULL: інша помилка — %s', sqlerrm;
  end;

  -- 6) CHECK на суму й валюту
  begin
    insert into crm_projects (id, owner_id, title, amount_minor, currency, status)
      values ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000aa', 'мінус', -1, 'EUR', 'Новий');
    raise notice '6. CHECK: ПРОВАЛ — відʼємну суму прийнято';
  exception when check_violation then
    raise notice '6. CHECK: ок — відʼємну суму відхилено';
  when others then
    raise notice '6. CHECK: інша помилка — %s', sqlerrm;
  end;

  -- 7) посилання на неіснуючий проєкт неможливе навіть прямим записом
  begin
    insert into crm_payments (id, owner_id, project_id, amount_minor, currency, paid_on, payment_type)
      values ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-00000000dead', 1, 'EUR', current_date, 'Доплата');
    raise notice '7. FK: ПРОВАЛ — оплату на неіснуючий проєкт прийнято';
  exception when foreign_key_violation then
    raise notice '7. FK: ок — посилання на неіснуючий проєкт відхилено';
  when others then
    raise notice '7. FK: інша помилка — %s', sqlerrm;
  end;

  -- 8) акаунт із чужим owner_id неможливий
  begin
    insert into crm_settings (owner_id, display_name)
      values ('00000000-0000-4000-8000-00000000dead', 'без акаунта');
    raise notice '8. FK власника: ПРОВАЛ — налаштування без акаунта прийнято';
  exception when foreign_key_violation then
    raise notice '8. FK власника: ок — неіснуючий owner_id відхилено';
  when others then
    raise notice '8. FK власника: інша помилка — %s', sqlerrm;
  end;

end $$;

rollback;

-- Має повернути 0: тестових записів після відкату не лишилось.
select (select count(*) from crm_users where telegram_user_id in ('9000000001','9000000002')) as лишилось_тестових_записів,
       (select count(*) from crm_projects where id::text like '00000000-0000-4%') as лишилось_проєктів;
