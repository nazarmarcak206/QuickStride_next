import { describe, expect, it } from "vitest";
import { RestError, createRestClient, type RestClient, type RestFilter, type RestRow, type RestSelectOptions } from "./supabaseRest";
import {
  deletePaymentRow,
  deleteReminderRow,
  findProject,
  insertClient,
  insertPayment,
  insertProject,
  insertProjectWithPrepayment,
  insertReminder,
  updateProjectRow,
  listState,
  newRecordId,
  ownedFilters,
  requireOwnerId,
  updateClientRow,
  updatePaymentRow,
} from "./repo";
import type { Client, Payment, Reminder } from "../types";

// Реальна схема crm_*: ідентифікатори — uuid, власник — owner_id. Фікстури теж uuid.
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const USER = OWNER_A;
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";
const REMINDER_ID = "55555555-5555-4555-8555-555555555555";
// Час справи — місцевий; у базу він іде як момент у цьому поясі.
const KYIV = "Europe/Kyiv";

function sampleClient(name = "Клієнт"): Client {
  return {
    id: CLIENT_ID,
    name,
    company: "",
    phone: "",
    telegram: "",
    email: "",
    note: "",
    kind: null,
    archived: false,
    createdAt: "",
  };
}

function sampleReminder(): Reminder {
  return {
    id: REMINDER_ID,
    title: "Нагадування",
    datetime: "2026-11-10T12:00",
    clientId: null,
    projectId: null,
    done: false,
    createdAt: "",
  };
}

// ── REST-клієнт: URL, заголовки, помилки ────────────────────────────────────

type FetchCall = { url: string; method: string; headers: Record<string, string>; body?: string };

function fetchCapture(response: { status?: number; body?: unknown } = {}): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    if (response.status && response.status >= 400) {
      return new Response(JSON.stringify({ message: "помилка доступу" }), { status: response.status });
    }
    return new Response(JSON.stringify(response.body ?? []), { status: response.status || 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function restFromFetch(fetchImpl: typeof fetch): RestClient {
  return createRestClient({ url: "https://db.example/", serviceRoleKey: "service-key", fetchImpl });
}

describe("createRestClient", () => {
  it("фільтри потрапляють у запит, заголовки — service-role", async () => {
    const { calls, fetchImpl } = fetchCapture({ body: [] });
    await restFromFetch(fetchImpl).select("crm_payments", {
      filters: [
        ["owner_id", "eq", "u1"],
        ["project_id", "eq", "p1"],
      ],
    });
    const url = new URL(calls[0].url);
    expect(calls[0].url).toContain("/rest/v1/crm_payments?");
    expect(url.searchParams.get("owner_id")).toBe("eq.u1");
    expect(url.searchParams.get("project_id")).toBe("eq.p1");
    expect(calls[0].headers.apikey).toBe("service-key");
    expect(calls[0].headers.authorization).toBe("Bearer service-key");
  });

  it("insert із onConflict додає Prefer з ignore-duplicates", async () => {
    const { calls, fetchImpl } = fetchCapture({ body: [] });
    await restFromFetch(fetchImpl).insert("crm_payments", { id: PAYMENT_ID }, { onConflict: "id", ignoreDuplicates: true });
    expect(calls[0].headers.prefer).toContain("resolution=ignore-duplicates");
    expect(new URL(calls[0].url).searchParams.get("on_conflict")).toBe("id");
  });

  it("rpc викликає Postgres-функцію POST /rest/v1/rpc/<name>", async () => {
    const { calls, fetchImpl } = fetchCapture({ body: { project: {}, payment: null } });
    await restFromFetch(fetchImpl).rpc("qs_create_project_with_prepayment", { p_owner_id: OWNER_A });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/rest/v1/rpc/qs_create_project_with_prepayment");
    expect(JSON.parse(calls[0].body ?? "{}")).toMatchObject({ p_owner_id: OWNER_A });
  });

  it("недоступна база дає RestError зі статусом 0", async () => {
    const failing: typeof fetch = async () => {
      throw new Error("connection refused");
    };
    await expect(restFromFetch(failing).select("crm_clients")).rejects.toMatchObject({ status: 0 });
  });

  it("відповідь не-2xx перетворюється на RestError зі статусом", async () => {
    const { fetchImpl } = fetchCapture({ status: 401 });
    await expect(restFromFetch(fetchImpl).select("crm_clients")).rejects.toBeInstanceOf(RestError);
    await expect(restFromFetch(fetchImpl).select("crm_clients")).rejects.toMatchObject({
      status: 401,
      message: "помилка доступу",
    });
  });
});

// ── Запити репозиторію: кожен скоуплено за owner_id ─────────────────────────

function recordingClient(rows: RestRow[] = []): {
  client: RestClient;
  calls: { op: string; table: string; filters?: readonly RestFilter[]; body?: unknown }[];
} {
  const calls: { op: string; table: string; filters?: readonly RestFilter[]; body?: unknown }[] = [];
  const rest: RestClient = {
    select: async <T extends RestRow>(table: string, options?: RestSelectOptions): Promise<T[]> => {
      calls.push({ op: "select", table, filters: options?.filters });
      return rows as T[];
    },
    insert: async <T extends RestRow>(table: string, body: RestRow | RestRow[]): Promise<T[]> => {
      calls.push({ op: "insert", table, body });
      return rows as T[];
    },
    update: async <T extends RestRow>(table: string, patch: RestRow, filters: readonly RestFilter[]): Promise<T[]> => {
      calls.push({ op: "update", table, filters, body: patch });
      return rows as T[];
    },
    delete: async <T extends RestRow>(table: string, filters: readonly RestFilter[]): Promise<T[]> => {
      calls.push({ op: "delete", table, filters });
      return rows as T[];
    },
    rpc: async (): Promise<unknown> => [],
  };
  return { client: rest, calls };
}

function expectOwnerIdFilter(filters: readonly RestFilter[] | undefined): void {
  expect(filters).toContainEqual(["owner_id", "eq", USER]);
}

describe("repo: скоупинг за owner_id", () => {
  it("listState запитує всі таблиці з фільтром owner_id", async () => {
    const { client: rest, calls } = recordingClient([
      { id: CLIENT_ID, owner_id: OWNER_A, name: "Клієнт", created_at: "2026-11-01T09:00:00Z" },
    ]);
    const state = await listState(rest, USER, KYIV);
    expect(calls.map((call) => call.table).sort()).toEqual([
      "crm_clients",
      "crm_payments",
      "crm_projects",
      "crm_reminders",
    ]);
    for (const call of calls) expectOwnerIdFilter(call.filters);
    expect(state.clients[0]).toMatchObject({ id: CLIENT_ID, name: "Клієнт" });
  });

  it("вставка рядка несе owner_id сесії", async () => {
    const { client: rest, calls } = recordingClient([{ id: CLIENT_ID, owner_id: OWNER_A, name: "Клієнт" }]);
    await insertClient(rest, USER, sampleClient());
    const insert = calls.find((call) => call.op === "insert");
    expect((insert?.body as RestRow)?.owner_id).toBe(USER);
  });

  it("оновлення фільтрується і за id, і за owner_id", async () => {
    const { client: rest, calls } = recordingClient([{ id: CLIENT_ID, owner_id: OWNER_A, name: "Нове ім'я" }]);
    await updateClientRow(rest, USER, CLIENT_ID, { name: "Нове ім'я" });
    const call = calls.find((entry) => entry.op === "update");
    expect(call?.filters).toEqual([
      ["id", "eq", CLIENT_ID],
      ["owner_id", "eq", USER],
    ]);
  });

  it("не-uuid власника чи запису відкидається до запиту до бази", async () => {
    const { client: rest, calls } = recordingClient([]);
    await expect(listState(rest, "", KYIV)).rejects.toThrow();
    await expect(listState(rest, "не-uuid", KYIV)).rejects.toThrow();
    await expect(updateClientRow(rest, USER, "client-42", { name: "x" })).rejects.toThrow();
    await expect(deletePaymentRow(rest, USER, "../etc/passwd")).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(requireOwnerId(OWNER_B)).toBe(OWNER_B);
    expect(() => ownedFilters(OWNER_A, "не-uuid")).toThrow();
  });
});

// ── Ізоляція двох користувачів на ін-меморі-базі, що фільтрує за owner_id ───

function fakeDb(): RestClient {
  const tables = new Map<string, RestRow[]>();
  const rowsOf = (table: string): RestRow[] => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const matches = (row: RestRow, filters: readonly RestFilter[]): boolean =>
    filters.every(([column, op, value]) =>
      op === "in" ? (value as readonly string[]).includes(String(row[column])) : String(row[column]) === String(value)
    );
  return {
    select: async <T extends RestRow>(table: string, options?: RestSelectOptions): Promise<T[]> => {
      const found = rowsOf(table).filter((row) => matches(row, options?.filters ?? []));
      return (options?.limit === undefined ? found : found.slice(0, options.limit)) as T[];
    },
    insert: async <T extends RestRow>(table: string, body: RestRow | RestRow[]): Promise<T[]> => {
      const store = rowsOf(table);
      const inserted: RestRow[] = [];
      for (const row of Array.isArray(body) ? body : [body]) {
        if (store.some((existing) => String(existing.id) === String(row.id))) continue; // on conflict do nothing
        store.push({ ...row });
        inserted.push(row);
      }
      return inserted as T[];
    },
    update: async <T extends RestRow>(table: string, patch: RestRow, filters: readonly RestFilter[]): Promise<T[]> => {
      const touched = rowsOf(table).filter((row) => matches(row, filters));
      for (const row of touched) Object.assign(row, patch);
      return touched as T[];
    },
    delete: async <T extends RestRow>(table: string, filters: readonly RestFilter[]): Promise<T[]> => {
      const store = rowsOf(table);
      const doomed = store.filter((row) => matches(row, filters));
      tables.set(
        table,
        store.filter((row) => !doomed.includes(row))
      );
      return doomed as T[];
    },
    rpc: async (): Promise<unknown> => ({}),
  };
}

describe("ізоляція двох тестових користувачів", () => {
  it("користувач B не бачить даних користувача A", async () => {
    const rest = fakeDb();
    await insertClient(rest, OWNER_A, sampleClient("Клієнт A"));
    const stateA = await listState(rest, OWNER_A, KYIV);
    const stateB = await listState(rest, OWNER_B, KYIV);
    expect(stateA.clients).toHaveLength(1);
    expect(stateB.clients).toHaveLength(0);
  });

  it("чужий запис не читається, не оновлюється і не видаляється за прямим uuid", async () => {
    const rest = fakeDb();
    await insertClient(rest, OWNER_A, sampleClient("Клієнт A"));
    await insertReminder(rest, OWNER_A, sampleReminder(), KYIV);

    await expect(updateClientRow(rest, OWNER_B, CLIENT_ID, { name: "Злам" })).resolves.toBeNull();
    await expect(deleteReminderRow(rest, OWNER_B, REMINDER_ID)).resolves.toBe(false);
    await expect(findProject(rest, OWNER_B, CLIENT_ID)).resolves.toBeNull();

    const stateA = await listState(rest, OWNER_A, KYIV);
    expect(stateA.clients[0]?.name).toBe("Клієнт A");
    expect(stateA.reminders).toHaveLength(1);
  });

  it("власник змінює власний запис", async () => {
    const rest = fakeDb();
    await insertClient(rest, OWNER_A, sampleClient("Клієнт A"));
    const updated = await updateClientRow(rest, OWNER_A, CLIENT_ID, { name: "Перейменований" });
    expect(updated?.name).toBe("Перейменований");
  });
});

// ── Повторні оплати та атомарний запис ──────────────────────────────────────

describe("insertPayment: захист від повторних оплат", () => {
  const payment: Payment = {
    id: PAYMENT_ID,
    projectId: PROJECT_ID,
    amountMinor: 150000,
    currency: "UAH",
    date: "2026-11-06",
    type: "Передоплата",
    note: "",
    createdAt: "2026-11-06T10:00:00.000Z",
  };

  it("перший запис створює оплату і повертає duplicate: false", async () => {
    const { client: rest, calls } = recordingClient([{ id: PAYMENT_ID, owner_id: USER, amount_minor: 150000 }]);
    const result = await insertPayment(rest, USER, payment);
    expect(result.duplicate).toBe(false);
    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.table).toBe("crm_payments");
    expect((insert?.body as RestRow)?.owner_id).toBe(USER);
  });

  it("порожня відповідь insert → оплату вже записано → duplicate: true", async () => {
    const calls: { op: string; table?: string; filters?: readonly RestFilter[] }[] = [];
    const rest: RestClient = {
      select: async <T extends RestRow>(table: string, options?: RestSelectOptions): Promise<T[]> => {
        calls.push({ op: "select", table, filters: options?.filters });
        return [{ id: PAYMENT_ID, owner_id: USER, amount_minor: 150000 }] as unknown as T[];
      },
      insert: async <T extends RestRow>(): Promise<T[]> => {
        calls.push({ op: "insert" });
        return [];
      },
      update: async <T extends RestRow>(): Promise<T[]> => [],
      delete: async <T extends RestRow>(): Promise<T[]> => [],
      rpc: async (): Promise<unknown> => [],
    };
    const result = await insertPayment(rest, USER, payment);
    expect(result.duplicate).toBe(true);
    const select = calls.find((call) => call.op === "select");
    expectOwnerIdFilter(select?.filters);
    expect(select?.filters).toContainEqual(["id", "eq", PAYMENT_ID]);
  });

  it(" id приймається лише uuid; згенерований сервером — теж uuid", () => {
    const generated = newRecordId(undefined);
    expect(generated.ok && generated.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(newRecordId(PAYMENT_ID)).toEqual({ ok: true, value: PAYMENT_ID });
    expect(newRecordId("pay-1").ok).toBe(false);
    expect(newRecordId("imp-user-c1").ok).toBe(false);
    expect(newRecordId("../etc/passwd").ok).toBe(false);
    expect(newRecordId("іньєкція").ok).toBe(false);
  });
});

describe("insertProjectWithPrepayment: атомарний RPC", () => {
  const project = {
    id: PROJECT_ID,
    clientId: null,
    title: "Проєкт",
    description: "",
    amountMinor: 1_000_000,
    currency: "UAH" as const,
    status: "Новий" as const,
    deadline: "",
    nextAction: "",
    note: "",
    createdAt: "2026-11-06T10:00:00.000Z",
  };

  function rpcClient(response: unknown): {
    client: RestClient;
    state: { call: { fn: string; args: Record<string, unknown> } | null };
  } {
    const state: { call: { fn: string; args: Record<string, unknown> } | null } = { call: null };
    return {
      client: {
        ...recordingClient().client,
        rpc: async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
          state.call = { fn, args };
          return response;
        },
      },
      state,
    };
  }

  const prepayment = { id: PAYMENT_ID, amountMinor: 400_000, date: "2026-11-06" };

  it("викликає Postgres-функцію з owner_id сесії та даними проєкту й оплати", async () => {
    const { client, state } = rpcClient({
      project: { ...project, owner_id: USER, amount_minor: 1_000_000, created_at: "2026-11-06T10:00:00Z" },
      payment: {
        id: PAYMENT_ID,
        owner_id: USER,
        project_id: PROJECT_ID,
        amount_minor: 400_000,
        currency: "UAH",
        date: "2026-11-06",
        type: "Передоплата",
        note: "",
        created_at: "2026-11-06T10:00:00Z",
      },
    });
    const result = await insertProjectWithPrepayment(client, USER, project, prepayment);
    expect(state.call?.fn).toBe("qs_create_project_with_prepayment");
    expect(state.call?.args.p_owner_id).toBe(USER);
    expect(state.call?.args.p_project).toMatchObject({ id: PROJECT_ID, amount_minor: 1_000_000, currency: "UAH" });
    expect(state.call?.args.p_payment).toMatchObject({ id: PAYMENT_ID, amount_minor: 400_000, payment_type: "Передоплата" });
    expect(result.project.amountMinor).toBe(1_000_000);
    expect(result.payment?.amountMinor).toBe(400_000);
  });

  it("повторна спроба повертає вже записані рядки без дублікатів", async () => {
    const { client } = rpcClient({
      project: { id: PROJECT_ID, owner_id: USER, amount_minor: 1_000_000, currency: "UAH", created_at: "2026-11-06T10:00:00Z" },
      payment: {
        id: PAYMENT_ID,
        owner_id: USER,
        project_id: PROJECT_ID,
        amount_minor: 400_000,
        currency: "UAH",
        type: "Передоплата",
        created_at: "2026-11-06T10:00:00Z",
      },
    });
    const result = await insertProjectWithPrepayment(client, USER, project, prepayment);
    expect(result.project.id).toBe(PROJECT_ID);
    expect(result.payment?.id).toBe(PAYMENT_ID);
  });

  it("відповідь без проєкту — помилка, а не тиша", async () => {
    const { client } = rpcClient({});
    await expect(insertProjectWithPrepayment(client, USER, project, prepayment)).rejects.toThrow();
  });

  it("не-uuid власника не потрапляє в RPC взагалі", async () => {
    const { client, state } = rpcClient({ project: { id: PROJECT_ID } });
    await expect(insertProjectWithPrepayment(client, "підставлений", project, prepayment)).rejects.toThrow();
    expect(state.call).toBeNull();
  });

  it("RPC-аргументи несуть фактичні колонки бази (paid_on, payment_type)", async () => {
    const { client, state } = rpcClient({
      project: { id: PROJECT_ID, owner_id: USER, amount_minor: 1_000_000, currency: "UAH" },
      payment: { id: PAYMENT_ID, owner_id: USER, project_id: PROJECT_ID, amount_minor: 400_000, currency: "UAH", paid_on: "2026-11-06", payment_type: "Передоплата" },
    });
    const result = await insertProjectWithPrepayment(client, USER, project, prepayment);
    expect(state.call?.args.p_payment).toMatchObject({ paid_on: "2026-11-06", payment_type: "Передоплата" });
    expect(state.call?.args.p_payment).not.toHaveProperty("date");
    expect(state.call?.args.p_payment).not.toHaveProperty("type");
    // Повернений рядок бази знову стає внутрішньою моделлю.
    expect(result.payment?.date).toBe("2026-11-06");
    expect(result.payment?.type).toBe("Передоплата");
  });
});

describe("crm_projects.deadline (date NULL)", () => {
  const project = {
    id: PROJECT_ID,
    clientId: null,
    title: "Проєкт",
    description: "",
    amountMinor: 1_000_000,
    currency: "UAH" as const,
    status: "У роботі" as const,
    deadline: "",
    nextAction: "",
    note: "",
    createdAt: "2026-11-06T10:00:00.000Z",
  };

  it("вставка без дедлайну йде як NULL, а не порожній рядок", async () => {
    const { client: rest, calls } = recordingClient([{ id: PROJECT_ID, owner_id: USER, title: "Проєкт", deadline: null }]);
    await insertProject(rest, USER, project);
    const body = calls.find((call) => call.op === "insert")?.body as RestRow;
    expect(body.deadline).toBeNull();
  });

  it("вставка з дедлайном зберігає дату", async () => {
    const { client: rest, calls } = recordingClient([
      { id: PROJECT_ID, owner_id: USER, title: "Проєкт", deadline: "2026-12-20" },
    ]);
    await insertProject(rest, USER, { ...project, deadline: "2026-12-20" });
    const body = calls.find((call) => call.op === "insert")?.body as RestRow;
    expect(body.deadline).toBe("2026-12-20");
  });

  it("патч: зняття дедлайну пише NULL, поставлення — дату", async () => {
    const { client: rest, calls } = recordingClient([{ id: PROJECT_ID, owner_id: USER, deadline: null }]);
    await updateProjectRow(rest, USER, PROJECT_ID, { deadline: "" });
    expect((calls.find((call) => call.op === "update")?.body as RestRow).deadline).toBeNull();

    const second = recordingClient([{ id: PROJECT_ID, owner_id: USER, deadline: "2026-12-01" }]);
    await updateProjectRow(second.client, USER, PROJECT_ID, { deadline: "2026-12-01" });
    expect((second.calls.find((call) => call.op === "update")?.body as RestRow).deadline).toBe("2026-12-01");
  });

  it("читання: date → YYYY-MM-DD, NULL → порожній рядок моделі", async () => {
    const withDate = recordingClient([{ id: PROJECT_ID, owner_id: USER, title: "Проєкт", deadline: "2026-12-20T00:00:00", created_at: "2026-11-01T09:00:00Z" }]);
    const loaded = await findProject(withDate.client, USER, PROJECT_ID);
    expect(loaded?.deadline).toBe("2026-12-20");

    const without = recordingClient([{ id: PROJECT_ID, owner_id: USER, title: "Проєкт", deadline: null }]);
    expect((await findProject(without.client, USER, PROJECT_ID))?.deadline).toBe("");
  });

  it("RPC: порожній дедлайн летить у базу як null", async () => {
    const { client, state } = (() => {
      const captured: { args?: Record<string, unknown> } = {};
      return {
        client: {
          ...recordingClient().client,
          rpc: async (_fn: string, args: Record<string, unknown>) => {
            captured.args = args;
            return { project: { id: PROJECT_ID, owner_id: USER, deadline: null }, payment: null };
          },
        },
        state: captured,
      };
    })();
    const result = await insertProjectWithPrepayment(client, USER, project, { id: PAYMENT_ID, amountMinor: 1000, date: "2026-11-06" });
    expect((state.args?.p_project as RestRow).deadline).toBeNull();
    expect(result.project.deadline).toBe("");
  });
});

// ── Читання/запис через фактичні назви колонок ──────────────────────────────

describe("відповідність реальних колонок у запитах", () => {
  const payment: Payment = {
    id: PAYMENT_ID,
    projectId: PROJECT_ID,
    amountMinor: 250000,
    currency: "UAH",
    date: "2026-11-05",
    type: "Доплата",
    note: "",
    createdAt: "2026-11-05T10:00:00.000Z",
  };

  it("insertPayment пише paid_on і payment_type", async () => {
    const { client: rest, calls } = recordingClient([{ id: PAYMENT_ID, owner_id: USER, paid_on: "2026-11-05", payment_type: "Доплата", amount_minor: 250000, currency: "UAH" }]);
    const result = await insertPayment(rest, USER, payment);
    const body = calls.find((call) => call.op === "insert")?.body as RestRow;
    expect(body.paid_on).toBe("2026-11-05");
    expect(body.payment_type).toBe("Доплата");
    expect(body.date).toBeUndefined();
    expect(body.type).toBeUndefined();
    expect(result.payment.date).toBe("2026-11-05");
    expect(result.payment.type).toBe("Доплата");
  });

  it("updatePaymentRow перекладає ключі патчу", async () => {
    const { client: rest, calls } = recordingClient([{ id: PAYMENT_ID, owner_id: USER, paid_on: "2026-11-06", payment_type: "Передоплата" }]);
    const saved = await updatePaymentRow(rest, USER, PAYMENT_ID, { date: "2026-11-06", type: "Передоплата" });
    const body = calls.find((call) => call.op === "update")?.body as RestRow;
    expect(body).toMatchObject({ paid_on: "2026-11-06", payment_type: "Передоплата" });
    expect(saved?.date).toBe("2026-11-06");
  });

  it("listState читає через реальні колонки й нормалізує формат", async () => {
    const { client: rest } = recordingClient([
      {
        id: REMINDER_ID,
        owner_id: OWNER_A,
        title: "Справа",
        due_at: "2026-11-10 12:00:00",
        done: false,
        created_at: "2026-11-01T09:00:00Z",
      },
    ]);
    const state = await listState(rest, USER, KYIV);
    expect(state.reminders[0]?.datetime).toBe("2026-11-10T12:00");
    // інтерфейс ріже цей рядок за позиціями — формат має бути стабільним
    expect(state.reminders[0]?.datetime.slice(0, 10)).toBe("2026-11-10");
    expect(state.reminders[0]?.datetime.slice(11, 16)).toBe("12:00");
  });

  it("insertReminder пише пару колонок: due_at (місцево → момент) і timezone", async () => {
    const { client: rest, calls } = recordingClient([
      { id: REMINDER_ID, owner_id: USER, title: "Нагадування", due_at: "2026-11-10T10:00:00.000Z", timezone: KYIV, done: false },
    ]);
    const saved = await insertReminder(rest, USER, sampleReminder(), KYIV);
    const body = calls.find((call) => call.op === "insert")?.body as RestRow;
    // 12:00 за Києвом (зимовий час, UTC+2) = 10:00Z
    expect(body.due_at).toBe("2026-11-10T10:00:00.000Z");
    expect(body.timezone).toBe(KYIV);
    expect(body.datetime).toBeUndefined();
    // прочитаний рядок знову стає місцевим часом
    expect(saved.datetime).toBe("2026-11-10T12:00");
  });

  it("той самий момент у поясі власника з іншого поясу читається інакше", async () => {
    const row = { id: REMINDER_ID, owner_id: USER, title: "Нагадування", due_at: "2026-11-10T10:00:00.000Z", timezone: KYIV, done: false };
    const { client: rest } = recordingClient([row]);
    const state = await listState(rest, USER, "Asia/Tashkent");
    // рядок має власний пояс — він і вирішальний
    expect(state.reminders[0]?.datetime).toBe("2026-11-10T12:00");
    const legacy = { ...row, timezone: null };
    const legacyRest = recordingClient([legacy]).client;
    const legacyState = await listState(legacyRest, USER, "Asia/Tashkent");
    // без поясу рядка — пояс налаштувань власника: 10:00Z = 15:00 у Ташкенті
    expect(legacyState.reminders[0]?.datetime).toBe("2026-11-10T15:00");
  });

  it("порожня дата справи відхиляється до запиту (due_at у базі NOT NULL)", async () => {
    const { client: rest, calls } = recordingClient([]);
    await expect(insertReminder(rest, USER, { ...sampleReminder(), datetime: "" }, KYIV)).rejects.toThrow("Дата й час");
    expect(calls).toHaveLength(0);
  });
});
