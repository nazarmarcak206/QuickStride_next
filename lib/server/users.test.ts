import { describe, expect, it } from "vitest";
import { RestError, type RestClient, type RestFilter, type RestInsertOptions, type RestRow, type RestSelectOptions } from "./supabaseRest";
import {
  findOrCreateUser,
  getOrCreateSettings,
  patchSettings,
  settingsOfRow,
  telegramFullName,
  TABLE_SETTINGS,
  TABLE_USERS,
  type AppUserRow,
  type UserSettingsRow,
} from "./users";
import type { TelegramAuthUser } from "./telegramAuth";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

const TELEGRAM_A: TelegramAuthUser = { id: 111111, firstName: "Оля", lastName: "Коваленко", username: "olya", photoUrl: "" };
const TELEGRAM_B: TelegramAuthUser = { id: 222222, firstName: "Іван", lastName: "", username: "ivanp", photoUrl: "" };

type Call = { op: string; table: string; body?: RestRow | RestRow[]; filters?: readonly RestFilter[] };

// Мини-база двох таблиць: crm_users (пошук за telegram_user_id) і crm_settings
// (пошук за owner_id). Дозволяє перевірити, що саме пише сервер.
function fakeDb(options: { users?: AppUserRow[]; settings?: UserSettingsRow[]; conflictOnInsert?: string } = {}): {
  rest: RestClient;
  calls: Call[];
  users: AppUserRow[];
  settings: UserSettingsRow[];
} {
  const users = [...(options.users ?? [])];
  const settings = [...(options.settings ?? [])];
  const calls: Call[] = [];
  let idSeq = 0;
  const matches = (row: RestRow, filters: readonly RestFilter[]): boolean =>
    filters.every(([column, , value]) => String(row[column]) === String(value));

  const rest: RestClient = {
    select: async <T extends RestRow>(table: string, opts?: RestSelectOptions): Promise<T[]> => {
      calls.push({ op: "select", table, filters: opts?.filters });
      const source = table === TABLE_USERS ? users : settings;
      const found = source.filter((row) => matches(row as RestRow, opts?.filters ?? []));
      return found as unknown as T[];
    },
    insert: async <T extends RestRow>(table: string, body: RestRow | RestRow[], opts?: RestInsertOptions): Promise<T[]> => {
      calls.push({ op: "insert", table, body });
      if (opts?.onConflict && options.conflictOnInsert === table) {
        throw new RestError(409, "duplicate key value violates unique constraint");
      }
      const rows = Array.isArray(body) ? body : [body];
      if (table === TABLE_USERS) {
        // Симулюємо default БД: uuid первинного ключа генерується сервером бази.
        const withIds = rows.map((row) => ({ id: `0000000${++idSeq}-1111-4111-8111-111111111111`, ...row }));
        users.push(...(withIds as unknown as AppUserRow[]));
        return withIds as unknown as T[];
      }
      settings.push(...(rows as unknown as UserSettingsRow[]));
      return rows as T[];
    },
    update: async <T extends RestRow>(table: string, patch: RestRow, filters: readonly RestFilter[]): Promise<T[]> => {
      calls.push({ op: "update", table, body: patch, filters });
      const source = table === TABLE_USERS ? users : settings;
      const touched = source.filter((row) => matches(row as RestRow, filters));
      for (const row of touched) Object.assign(row, patch);
      return touched as unknown as T[];
    },
    delete: async <T extends RestRow>(): Promise<T[]> => [],
    rpc: async (): Promise<unknown> => ({}),
  };
  return { rest, calls, users, settings };
}

describe("findOrCreateUser — вхід через Telegram без пароля і реєстрації", () => {
  it("перший вхід створює акаунт лише з telegram_user_id і рядок налаштувань", async () => {
    const { rest, calls, users, settings } = fakeDb();
    const { row, isNew } = await findOrCreateUser(rest, TELEGRAM_A);

    expect(isNew).toBe(true);
    expect(users).toHaveLength(1);
    // Жодних колонок, яких у реальній crm_users може не бути: окрім uuid
    // первинного ключа (його дає база) пишемо лише telegram_user_id.
    expect(Object.keys(users[0]!).sort()).toEqual(["id", "telegram_user_id"]);
    expect(users[0]!.telegram_user_id).toBe("111111");
    expect(settings[0]?.display_name).toBe("Оля Коваленко");
    expect(settings[0]?.owner_id).toBe(users[0]!.id);

    const userInsert = calls.find((call) => call.op === "insert" && call.table === TABLE_USERS);
    expect(userInsert?.body).toEqual({ telegram_user_id: "111111" });
    const settingsInsert = calls.find((call) => call.op === "insert" && call.table === TABLE_SETTINGS);
    expect(Object.keys(settingsInsert!.body as RestRow)).toContain("owner_id");
    expect(row.telegram_user_id).toBe("111111");
  });

  it("повторний вхід того ж акаунта не створює нового користувача", async () => {
    const existing: AppUserRow = { id: OWNER_A, telegram_user_id: "111111" };
    const { rest, calls, users } = fakeDb({
      users: [existing],
      settings: [{ owner_id: OWNER_A, display_name: "Оля Коваленко", base_currency: "UAH", time_zone: "Europe/Kyiv", updated_at: "" }],
    });
    const { row, isNew } = await findOrCreateUser(rest, TELEGRAM_A);

    expect(isNew).toBe(false);
    expect(row.id).toBe(OWNER_A);
    expect(users).toHaveLength(1);
    expect(calls.filter((call) => call.op === "insert")).toHaveLength(0);
    // Пошук іде за перевіреним telegram_user_id, а не за id із запиту клієнта.
    expect(calls[0].filters).toEqual([["telegram_user_id", "eq", "111111"]]);
  });

  it("два різні Telegram-акаунти — два різні власники даних", async () => {
    const { rest, users } = fakeDb();
    const first = await findOrCreateUser(rest, TELEGRAM_A);
    const second = await findOrCreateUser(rest, TELEGRAM_B);
    expect(first.isNew && second.isNew).toBe(true);
    expect(users.map((user) => String(user.telegram_user_id))).toEqual(["111111", "222222"]);
    expect(users[0].id).not.toBe(users[1].id);
  });

  it("паралельний перший вхід з іншого пристрою (409) не плодить акаунти", async () => {
    const existing: AppUserRow = { id: OWNER_A, telegram_user_id: "111111" };
    // Сценарій гонки: перший пошук нічого не знайшов → вставка дає 409 →
    // повторний пошук знаходить акаунт, створений сусіднім запитом.
    let selects = 0;
    const inserts: RestRow[] = [];
    const rest: RestClient = {
      select: async <T extends RestRow>(): Promise<T[]> => {
        selects += 1;
        return (selects === 1 ? [] : [existing]) as unknown as T[];
      },
      insert: async <T extends RestRow>(_table: string, body: RestRow | RestRow[]): Promise<T[]> => {
        inserts.push(...(Array.isArray(body) ? body : [body]));
        throw new RestError(409, "duplicate key value violates unique constraint");
      },
      update: async <T extends RestRow>(): Promise<T[]> => [],
      delete: async <T extends RestRow>(): Promise<T[]> => [],
      rpc: async (): Promise<unknown> => ({}),
    };
    const { row, isNew } = await findOrCreateUser(rest, TELEGRAM_A);
    expect(isNew).toBe(false);
    expect(row.id).toBe(OWNER_A);
    expect(selects).toBe(2);
    expect(inserts).toHaveLength(1);
  });

  it("імʼя з перевіреного initData скорочується до безпечної довжини", () => {
    expect(telegramFullName({ firstName: "Оля", lastName: "Коваленко" })).toBe("Оля Коваленко");
    expect(telegramFullName({ firstName: "Оля", lastName: "" })).toBe("Оля");
    expect(telegramFullName({ firstName: "А".repeat(80), lastName: "" })).toHaveLength(60);
  });
});

describe("налаштування профілю зберігаються в bazі за owner_id", () => {
  const row: UserSettingsRow = {
    owner_id: OWNER_A,
    display_name: "Оля",
    base_currency: "EUR",
    time_zone: "Europe/Kyiv",
    updated_at: "",
  };

  it("getOrCreateSettings шукає й створює рядок саме цього власника", async () => {
    const missing = fakeDb();
    const created = await getOrCreateSettings(missing.rest, OWNER_A);
    expect(created).toBeDefined();
    expect(missing.settings[0]?.owner_id).toBe(OWNER_A);
    expect(missing.calls.some((call) => call.filters?.some(([c, , v]) => c === "owner_id" && v === OWNER_A))).toBe(true);

    const present = fakeDb({ settings: [row] });
    const loaded = await present.rest.select<UserSettingsRow>(TABLE_SETTINGS, {
      filters: [["owner_id", "eq", OWNER_A]],
      limit: 1,
    });
    expect(loaded[0]?.base_currency).toBe("EUR");
  });

  it("patchSettings оновлює рядок, відфільтрований за owner_id", async () => {
    const { rest, calls, settings } = fakeDb({ settings: [{ ...row, base_currency: "UAH" }] });
    await patchSettings(rest, OWNER_A, { base_currency: "USD" });
    const update = calls.find((call) => call.op === "update");
    expect(update?.filters).toEqual([["owner_id", "eq", OWNER_A]]);
    expect(settings[0].base_currency).toBe("USD");
  });

  it("settingsOfRow повертає модель із стандартними значеннями для сміттєвих даних", () => {
    const settings = settingsOfRow({ ...row, base_currency: "Cats", time_zone: "Nowhere/Island" });
    expect(settings.baseCurrency).toBe("UAH");
    expect(settings.timeZone).toBe("Europe/Kyiv");
    expect(settingsOfRow(row).baseCurrency).toBe("EUR");
  });
});
