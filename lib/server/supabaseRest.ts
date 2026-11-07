// Мінімальний PostgREST-клієнт під service-role ключ. Замість supabase-js —
// звичайний fetch: усі запити видно як функції з явними фільтрами, що дає
// змогу тестами перевіряти, що кожен запит до таблиць скоуплено за owner_id.
export type RestFilter = readonly [column: string, op: "eq" | "neq" | "in", value: string | readonly string[]];

export type RestSelectOptions = {
  filters?: readonly RestFilter[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
};

export type RestInsertOptions = {
  onConflict?: string;
  ignoreDuplicates?: boolean;
  merge?: boolean;
};

export type RestRow = Record<string, unknown>;

export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: string
  ) {
    super(message);
  }
}

export type RestClient = {
  select: <T extends RestRow>(table: string, options?: RestSelectOptions) => Promise<T[]>;
  insert: <T extends RestRow>(table: string, rows: RestRow | RestRow[], options?: RestInsertOptions) => Promise<T[]>;
  update: <T extends RestRow>(table: string, patch: RestRow, filters: readonly RestFilter[]) => Promise<T[]>;
  delete: <T extends RestRow>(table: string, filters: readonly RestFilter[]) => Promise<T[]>;
  // Виклик Postgres-функції (RPC). Скалярна відповідь повертається як є,
  // setof — як масив; виклик сам звужує тип під свою функцію.
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
};

export function createRestClient(config: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): RestClient {
  const doFetch = config.fetchImpl ?? fetch;
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;

  function searchParams(filters?: readonly RestFilter[], extra?: Record<string, string>): string {
    const params = new URLSearchParams({ select: "*" });
    for (const [column, op, value] of filters ?? []) {
      const encoded = Array.isArray(value)
        ? `(${value.map((item) => `"${String(item).replace(/"/g, '\\"')}"`).join(",")})`
        : String(value);
      params.append(column, `${op}.${encoded}`);
    }
    for (const [key, value] of Object.entries(extra ?? {})) params.append(key, value);
    return params.toString();
  }

  async function request<T extends RestRow>(
    method: string,
    table: string,
    search: string,
    body?: unknown,
    prefer?: string[]
  ): Promise<T[]> {
    const headers: Record<string, string> = {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer?.length) headers.Prefer = prefer.join(",");
    let response: Response;
    try {
      response = await doFetch(`${base}/${table}?${search}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new RestError(0, `Supabase недоступний: ${error instanceof Error ? error.message : "невідома помилка"}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = `Supabase ${method} ${table} → ${response.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // Тіло не JSON — лишається стандартний текст помилки.
      }
      throw new RestError(response.status, message, text || undefined);
    }
    if (response.status === 204) return [];
    const text = await response.text();
    return text ? (JSON.parse(text) as T[]) : [];
  }

  return {
    select: (table, options) => {
      const extra: Record<string, string> = {};
      if (options?.order) {
        extra.order = `${options.order.column}.${options.order.ascending === false ? "desc" : "asc"}`;
      }
      if (options?.limit !== undefined) extra.limit = String(options.limit);
      return request("GET", table, searchParams(options?.filters, extra));
    },
    insert: (table, rows, options) => {
      const prefer = ["return=representation"];
      if (options?.ignoreDuplicates) prefer.push("resolution=ignore-duplicates");
      else if (options?.merge) prefer.push("resolution=merge-duplicates");
      const extra: Record<string, string> = {};
      if (options?.onConflict) extra.on_conflict = options.onConflict;
      return request("POST", table, searchParams(undefined, extra), rows, prefer);
    },
    rpc: (fn, args) => request("POST", `rpc/${fn}`, "", args, ["return=representation"]),
    update: (table, patch, filters) => request("PATCH", table, searchParams(filters), patch, ["return=representation"]),
    delete: (table, filters) => request("DELETE", table, searchParams(filters), undefined, ["return=representation"]),
  };
}
