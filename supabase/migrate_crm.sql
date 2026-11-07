-- ============================================================================
-- QuickStride CRM — МІГРАЦІЯ ДО НАЯВНОГО ПРОЄКТУ (crm_*), варіант для
-- порожніх таблиць (перевірено: у crm_users, crm_clients, crm_projects,
-- crm_payments, crm_reminders — 0 записів).
--
-- Фактична схема, з якою звірено код:
--   id uuid (PK), власник — owner_id uuid → crm_users.id
--   crm_payments.paid_on      date                     NOT NULL
--   crm_payments.payment_type text                     NOT NULL
--   crm_reminders.due_at      timestamp with time zone NOT NULL
--   crm_reminders.timezone    text                     NULL
--   crm_settings — відсутня, створюється тут (іншої таблиці для налаштувань
--   профілю в базі немає).
--
-- Що цей файл робить:
--   • Нічого не видаляє, не перейменовує і не перестворює; наявні обʼєкти
--     лише доповнюються відсутніми.
--   • Спершу перевіряє назви, типи й NOT NULL. Розбіжність → зупинка БЕЗ
--     жодних змін (не «мовчки пристосовується»).
--   • Перевіряє, що таблиці порожні АБО відповідне обмеження вже існує.
--     Тому повторний запуск після застосування — безпечний no-op.
--   • Додає обмеження ПОВНІСТЮ валідованими (без NOT VALID): на порожніх
--     таблицях валідація нічого не коштує, а гарантія є справжньою.
--   • Створює функцію атомарного запису проєкту з передоплатою.
--   • Вмикає RLS без політик і знімає права з anon/authenticated: до бази
--     ходить лише сервер із service_role після перевірки Telegram initData.
--
-- Перед застосуванням: supabase/probe_schema.sql.
-- Після: supabase/verify_after_migration.sql (лише читання + smoke-тест у
-- транзакції з відкатом).
-- ============================================================================

begin;

-- ── A. ПЕРЕВІРКА СХЕМИ: без неї жодних змін ────────────────────────────────

do $$
declare
  bad text;
begin
  select string_agg(t, ', ')
    into bad
    from unnest(array['crm_users','crm_clients','crm_projects','crm_payments','crm_reminders']) t
   where to_regclass('public.' || t) is null;
  if bad is not null then
    raise exception 'Міграцію зупинено: немає таблиць (%). Сперше виконайте supabase/probe_schema.sql.', bad;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='crm_users' and column_name='id' and data_type='uuid'
  ) then
    raise exception 'Міграцію зупинено: crm_users.id не має типу uuid.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='crm_users' and column_name='telegram_user_id'
  ) then
    raise exception 'Міграцію зупинено: у crm_users немає колонки telegram_user_id.';
  end if;

  select string_agg(t, ', ')
    into bad
    from unnest(array['crm_clients','crm_projects','crm_payments','crm_reminders']) t
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=t and c.column_name='owner_id' and c.data_type='uuid'
   );
  if bad is not null then
    raise exception 'Міграцію зупинено: без owner_id uuid у таблицях (%).', bad;
  end if;

  select string_agg(t, ', ')
    into bad
    from unnest(array['crm_clients','crm_projects','crm_payments','crm_reminders']) t
   where not exists (
     select 1 from pg_constraint c where c.conrelid = ('public.' || t)::regclass and c.contype = 'p'
   );
  if bad is not null then
    raise exception 'Міграцію зупинено: у таблицях (%) немає первинного ключа — повторні запити не були б безпечними.', bad;
  end if;

  -- Назви, типи й NOT NULL, на які спирається код (lib/server/columns.ts).
  select string_agg(
           format('%s.%s — очікується %s / %s, а є %s',
                  e.table_name, e.column_name, e.data_type, e.is_nullable,
                  coalesce(c.data_type || ' / ' || c.is_nullable, 'відсутня')),
           '; '
         )
    into bad
    from (values
      ('crm_payments','paid_on','date','NO'),
      ('crm_payments','payment_type','text','NO'),
      ('crm_reminders','due_at','timestamp with time zone','NO'),
      ('crm_reminders','timezone','text','YES')
    ) as e(table_name, column_name, data_type, is_nullable)
    left join information_schema.columns c
      on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
   where c.column_name is null
      or c.data_type <> e.data_type
      or c.is_nullable <> e.is_nullable;
  if bad is not null then
    raise exception 'Міграцію зупинено: %', bad;
  end if;
end $$;

-- ── B. ВОРОТО ДАНИХ: обмеження створюються валідованими, тому на таблицях із
--      рядами їх має бути вже (інакше невідомі дані міг би «прийняти» лише
--      окремий узгоджений крок із NOT VALID). ────────────────────────────────

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['crm_clients','crm_projects','crm_payments','crm_reminders'] loop
    if exists (
      select 1 from pg_constraint c
       where c.conrelid = ('public.' || t)::regclass and c.conname = t || '_owner_id_fkey'
    ) then
      continue; -- обмеження вже є — повторний запуск не чіпає даних
    end if;
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'Міграцію зупинено: % містить % рядків без обмеження власника. Підтвердьте, що дані мають належати існуючим акаунтам, і застосуйте обмеження окремим кроком.', t, n;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid='public.crm_payments'::regclass and conname='crm_payments_project_id_fkey'
  ) then
    select count(*) into n from public.crm_payments;
    if n > 0 then
      raise exception 'Міграцію зупинено: crm_payments містить % рядків без обмеження звʼязку з проєктом.', n;
    end if;
  end if;
end $$;

-- ── C. Налаштування профілю: crm_settings ──────────────────────────────────

create table if not exists public.crm_settings (
  owner_id uuid primary key references public.crm_users (id) on delete cascade,
  display_name text not null default '',
  base_currency text not null default 'UAH',
  time_zone text not null default 'Europe/Kyiv',
  updated_at timestamptz not null default now()
);

-- ── D. Індекс власника: кожен запит фільтрується за owner_id ───────────────

do $$
declare
  t text;
begin
  foreach t in array array['crm_clients','crm_projects','crm_payments','crm_reminders'] loop
    if not exists (
      select 1 from pg_class i join pg_namespace n on n.oid = i.relnamespace
       where n.nspname='public' and i.relname = t || '_owner_id_idx'
    ) then
      execute format('create index %I on public.%I (owner_id)', t || '_owner_id_idx', t);
    end if;
  end loop;

  if not exists (
    select 1 from pg_class i join pg_namespace n on n.oid = i.relnamespace
     where n.nspname='public' and i.relname = 'crm_payments_owner_project_idx'
  ) then
    create index crm_payments_owner_project_idx on public.crm_payments (owner_id, project_id);
  end if;
end $$;

-- ── E. Власник і звʼязки: чого НЕ робити двічі ─────────────────────────────
-- У базі вже існують складені зовнішні ключі, які самі по собі гарантують,
-- що посилання веде до запису ТОГО САМОГО власника (і тієї самої валюти для
-- оплат). Тому міграція шукає покриття за НАБОРОМ КОЛОНОК, а не по назві:
--   • якщо колонку вже покриває будь-який FK (одинарний чи складений) —
--     нічого не додається, а наявне правило видалення лише повідомляється;
--   • одинарний FK навмисно НЕ створюється «на всякий випадок»: він не
--     скасовує й не перевизначає складений, а лише дублює перевірку, і
--     вводить в оману щодо того, що станеться при видаленні.
-- Додатково: owner_id → crm_users — це інше відношення (рядок має належати
-- реальному акаунту), складені ключі його не покривають, тому воно додається.

do $$
declare
  rel record;
  covering record;
  found boolean;
  sets_null_owner boolean;
  sets_null_project boolean;
begin
  -- 1) Власник: NOT NULL + FK на crm_users (якщо ще не покрито).
  for rel in
    select t::text as tbl from unnest(array['crm_clients','crm_projects','crm_payments','crm_reminders']) t
  loop
    -- NOT NULL для owner_id застосовуємо лише якщо він НЕ бере участі в
    -- наявному FK з ON DELETE SET NULL: інакше «відвʼязати від клієнта»
    -- раптом стало б помилкою, тобто міграція змінила б поведінку даних.
    select exists (
      select 1
        from pg_constraint k
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
       where k.contype = 'f'
         and k.conrelid = ('public.' || rel.tbl)::regclass
         and k.confdeltype = 'n'
         and a.attname = 'owner_id'
    ) into sets_null_owner;

    if sets_null_owner then
      raise notice '%.owner_id NOT NULL НЕ застосовано: наявний складений FK з ON DELETE SET NULL поклав би NULL у цю колонку. Правило власника тримають цей FK і сервер.', rel.tbl;
    else
      execute format('alter table public.%I alter column owner_id set not null', rel.tbl);
      raise notice '%.owner_id → NOT NULL застосовано', rel.tbl;
    end if;

    select exists (
      select 1
        from pg_constraint k
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
       where k.contype = 'f'
         and k.conrelid = ('public.' || rel.tbl)::regclass
         and k.confrelid = 'public.crm_users'::regclass
         and a.attname = 'owner_id'
    ) into found;

    if not found then
      execute format(
        'alter table public.%I add constraint %I foreign key (owner_id) references public.crm_users (id) on delete cascade',
        rel.tbl, rel.tbl || '_owner_id_fkey'
      );
      raise notice '%.owner_id → crm_users.id додано (ON DELETE CASCADE)', rel.tbl;
    else
      raise notice '%.owner_id → crm_users.id вже покрито — не дублюємо', rel.tbl;
    end if;
  end loop;

  -- 2) Звʼязки всередині даних: лише там, де колонку ще ніщо не покриває.
  for rel in
    select * from (values
      ('crm_projects','client_id','crm_clients','SET NULL'),
      ('crm_payments','project_id','crm_projects','CASCADE'),
      ('crm_reminders','client_id','crm_clients','SET NULL'),
      ('crm_reminders','project_id','crm_projects','SET NULL')
    ) as e(tbl, col, target, action)
  loop
    select exists (
      select 1
        from pg_constraint k
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
       where k.contype = 'f'
         and k.conrelid = ('public.' || rel.tbl)::regclass
         and a.attname = rel.col
    ) into found;

    if found then
      for covering in
        select k.conname,
               (select string_agg(att.attname, ',' order by u.ord)
                  from unnest(k.conkey) with ordinality u(attnum, ord)
                  join pg_attribute att on att.attrelid = k.conrelid and att.attnum = u.attnum) as local_cols,
               k.confrelid::regclass::text as ref_table,
               (select string_agg(att.attname, ',' order by u.ord)
                  from unnest(k.confkey) with ordinality u(attnum, ord)
                  join pg_attribute att on att.attrelid = k.confrelid and att.attnum = u.attnum) as ref_cols,
               case k.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                                  when 'd' then 'SET DEFAULT' when 'r' then 'RESTRICT'
                                  else 'NO ACTION' end as on_delete
          from pg_constraint k
         where k.contype = 'f'
           and k.conrelid = ('public.' || rel.tbl)::regclass
           and exists (
             select 1 from unnest(k.conkey) u(attnum)
               join pg_attribute att on att.attrelid = k.conrelid and att.attnum = u.attnum
              where att.attname = rel.col
           )
      loop
        raise notice 'звʼязок % .% вже покрито: FK % (% → % .%) ON DELETE % — нічого не додаємо',
          rel.tbl, rel.col, covering.conname, covering.local_cols, covering.ref_table,
          covering.ref_cols, covering.on_delete;
      end loop;
    else
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I (id) on delete %s',
        rel.tbl, rel.tbl || '_' || rel.col || '_fkey', rel.col, rel.target, rel.action
      );
      raise notice 'звʼязок % .% покрито новим FK (ON DELETE %)', rel.tbl, rel.col, rel.action;
    end if;
  end loop;

  -- 3) Оплата без проєкту неможлива за правилами продукту. NOT NULL додаємо
  --    лише якщо жоден наявний FK з ON DELETE SET NULL не використовує цю
  --    колонку — інакше це правило змінило б поведінку видалення проєкту.
  select exists (
    select 1
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
     where k.contype = 'f'
       and k.conrelid = 'public.crm_payments'::regclass
       and k.confdeltype = 'n'
       and a.attname = 'project_id'
  ) into sets_null_project;

  if sets_null_project then
    raise notice 'crm_payments.project_id NOT NULL НЕ застосовано: наявний FK з ON DELETE SET NULL поклав би NULL у цю колонку';
  elsif (select count(*) from information_schema.columns
           where table_schema='public' and table_name='crm_payments'
             and column_name='project_id' and is_nullable='YES') > 0 then
    alter table public.crm_payments alter column project_id set not null;
    raise notice 'crm_payments.project_id → NOT NULL застосовано (правило продукту)';
  else
    raise notice 'crm_payments.project_id уже NOT NULL';
  end if;
end $$;

-- ── F. Обмеження суми, валюти й значень (валідовані) ───────────────────────
-- correspondent до lib/types.ts: той самий список, що й інтерфейс.

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.crm_projects'::regclass and conname='crm_projects_amount_check') then
    alter table public.crm_projects add constraint crm_projects_amount_check check (amount_minor >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_payments'::regclass and conname='crm_payments_amount_check') then
    alter table public.crm_payments add constraint crm_payments_amount_check check (amount_minor >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.crm_projects'::regclass and conname='crm_projects_currency_check') then
    alter table public.crm_projects add constraint crm_projects_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_payments'::regclass and conname='crm_payments_currency_check') then
    alter table public.crm_payments add constraint crm_payments_currency_check check (currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_settings'::regclass and conname='crm_settings_currency_check') then
    alter table public.crm_settings add constraint crm_settings_currency_check check (base_currency ~ '^[A-Z]{3}$');
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.crm_projects'::regclass and conname='crm_projects_status_check') then
    alter table public.crm_projects add constraint crm_projects_status_check check (status in
      ('Новий','Обговорення','У роботі','Очікує клієнта','Завершений','Скасований'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_payments'::regclass and conname='crm_payments_payment_type_check') then
    alter table public.crm_payments add constraint crm_payments_payment_type_check check (payment_type in
      ('Передоплата','Доплата','Інша оплата'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_clients'::regclass and conname='crm_clients_kind_check') then
    alter table public.crm_clients add constraint crm_clients_kind_check check (kind is null or kind in
      ('Постійний','Непостійний'));
  end if;

  -- Назва поясу: від неї залежить, котру годину показати за absolute due_at.
  if not exists (select 1 from pg_constraint where conrelid='public.crm_reminders'::regclass and conname='crm_reminders_timezone_check') then
    alter table public.crm_reminders add constraint crm_reminders_timezone_check check (
      timezone is null or timezone ~ '^[A-Za-z]+([_+/-][A-Za-z0-9+]+)+$' or timezone ~ '^(UTC|GMT|Etc/[A-Za-z0-9+/]+)$'
    );
  end if;
end $$;

-- ── G. Атомарний запис проєкту з передоплатою ──────────────────────────────
-- Одна транзакція: або обидва записи, або жоден. Повторний виклик із тими
-- самими uuid не створює дублікатів — повертає наявні рядки.
-- Викликається лише сервером (service_role).

do $$
declare
  missing text;
begin
  select string_agg(e.t || '.' || e.c, ', ')
    into missing
    from (values
      ('crm_projects','id'), ('crm_projects','owner_id'), ('crm_projects','client_id'),
      ('crm_projects','title'), ('crm_projects','description'), ('crm_projects','amount_minor'),
      ('crm_projects','currency'), ('crm_projects','status'), ('crm_projects','deadline'),
      ('crm_projects','next_action'), ('crm_projects','note'),
      ('crm_payments','id'), ('crm_payments','owner_id'), ('crm_payments','project_id'),
      ('crm_payments','amount_minor'), ('crm_payments','currency'), ('crm_payments','paid_on'),
      ('crm_payments','payment_type'), ('crm_payments','note')
    ) as e(t, c)
   where not exists (
     select 1 from information_schema.columns i
      where i.table_schema='public' and i.table_name=e.t and i.column_name=e.c
   );

  if missing is not null then
    raise exception 'Міграцію зупинено: функції потрібні колонки, яких немає: %', missing;
  end if;

  execute $func$
    create or replace function public.qs_create_project_with_prepayment(
      p_owner_id uuid,
      p_project jsonb,
      p_payment jsonb default null
    )
    returns jsonb
    language plpgsql
    security invoker
    set search_path = public
    as $body$
    declare
      v_project crm_projects%rowtype;
      v_payment crm_payments%rowtype;
      v_client_owner uuid;
      -- Типи беремо з самих колонок: plpgsql сам призведе текстові значення
      -- з jsonb до date (paid_on) і text (payment_type).
      v_paid_on crm_payments.paid_on%type;
      v_payment_type crm_payments.payment_type%type;
      -- deadline — date NULL: «дедлайну немає» має бути NULL, а не ''
      -- (порожній рядок для date некоректний).
      v_deadline crm_projects.deadline%type;
    begin
      if p_owner_id is null then
        raise exception 'Не вказано власника проєкту';
      end if;

      -- Клієнт проєкту має належати тому самому власнику.
      if coalesce(p_project->>'client_id', '') <> '' then
        select owner_id into v_client_owner from crm_clients where id = (p_project->>'client_id')::uuid;
        if not found then
          raise exception 'Клієнта не знайдено' using errcode = 'P0002';
        end if;
        if v_client_owner is distinct from p_owner_id then
          raise exception 'Клієнт належить іншому користувачу' using errcode = '42501';
        end if;
      end if;

      -- deadline: date-колонка не приймає текстовий вираз просто у values,
      -- тому значення йде через змінну з типом колонки (NULL лишається NULL).
      v_deadline := nullif(p_project->>'deadline', '');

      -- Повторна спроба після збою: наявний проєкт не дублюється.
      insert into crm_projects (id, owner_id, client_id, title, description, amount_minor, currency, status, deadline, next_action, note)
      values (
        (p_project->>'id')::uuid,
        p_owner_id,
        nullif(p_project->>'client_id', '')::uuid,
        coalesce(p_project->>'title', ''),
        coalesce(p_project->>'description', ''),
        coalesce((p_project->>'amount_minor')::bigint, 0),
        coalesce(nullif(p_project->>'currency', ''), 'UAH'),
        coalesce(p_project->>'status', 'Новий'),
        v_deadline,
        coalesce(p_project->>'next_action', ''),
        coalesce(p_project->>'note', '')
      )
      on conflict (id) do nothing
      returning * into v_project;

      if v_project.id is null then
        select * into v_project from crm_projects where id = (p_project->>'id')::uuid;
        if not found then
          raise exception 'Проєкт не записано';
        end if;
        if v_project.owner_id is distinct from p_owner_id then
          raise exception 'Проєкт належить іншому користувачу' using errcode = '42501';
        end if;
      end if;

      -- Передоплата: лише в валюті проєкту, лише додатна сума.
      if p_payment is not null and coalesce((p_payment->>'amount_minor')::bigint, 0) > 0 then
        if coalesce(nullif(p_payment->>'currency', ''), v_project.currency) is distinct from v_project.currency then
          raise exception 'Оплата має бути у валюті проєкту' using errcode = '23514';
        end if;

        -- paid_on у базі date NOT NULL: порожнє значення означає «сьогодні».
        v_paid_on := coalesce(nullif(p_payment->>'paid_on', ''), current_date::text);
        v_payment_type := coalesce(nullif(p_payment->>'payment_type', ''), 'Передоплата');

        insert into crm_payments (id, owner_id, project_id, amount_minor, currency, paid_on, payment_type, note)
        values (
          (p_payment->>'id')::uuid,
          p_owner_id,
          v_project.id,
          (p_payment->>'amount_minor')::bigint,
          v_project.currency,
          v_paid_on,
          v_payment_type,
          coalesce(p_payment->>'note', '')
        )
        on conflict (id) do nothing
        returning * into v_payment;

        if v_payment.id is null then
          select * into v_payment from crm_payments where id = (p_payment->>'id')::uuid;
          if found and (v_payment.owner_id is distinct from p_owner_id or v_payment.project_id is distinct from v_project.id) then
            raise exception 'Оплата з таким id вже належить іншому запису' using errcode = '42501';
          end if;
        end if;
      end if;

      return jsonb_build_object(
        'project', to_jsonb(v_project),
        'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end
      );
    end;
    $body$;
  $func$;

  -- Права знімаємо з anon/authenticated і з PUBLIC. IMPORTANT: service_role в
  -- Supabase тримає доступ саме через PUBLIC, тому після відкликання його
  -- надаємо явно — інакше сервер не зміг би викликати цю функцію.
  revoke execute on function public.qs_create_project_with_prepayment(uuid, jsonb, jsonb) from anon, authenticated, public;
  grant execute on function public.qs_create_project_with_prepayment(uuid, jsonb, jsonb) to service_role;
end $$;

-- ── H. Модель доступу: лише через сервер ────────────────────────────────────
-- RLS без політик = заборона будь-якого прямого доступу для anon/authenticated.
-- Застосунок ходить у базу виключно сервером із service_role після перевірки
-- Telegram initData. Права знімаються і на випадок витоку публічного ключа.

do $$
declare
  t text;
begin
  foreach t in array array['crm_users','crm_settings','crm_clients','crm_projects','crm_payments','crm_reminders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- Явно, а не «через PUBLIC»: сервісний роль має залишитися єдиним, хто
    -- ходить у базу. Без цього кроку випадкове перевизначення стандартних
    -- прав Supabase обірвало б весь застосунок.
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  grant usage on schema public to service_role;
end $$;

commit;

-- Готово. Перевірте результат скриптом supabase/verify_after_migration.sql
-- (лише читання; smoke-тест функції виконується в транзакції з відкатом).
