import type { Client, ClientKind, CrmState, Currency, Payment, Project } from "./types";

// Нормалізоване ім'я для порівняння: без пробілів на краях, нижній регістр.
export function normalizedClientName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Пошук можливого дубліката за ім'ям. Ми не об'єднуємо дублікати автоматично —
// лише попереджаємо, рішення залишається за користувачем.
export function findDuplicateClient(clients: Client[], name: string, excludeId?: string): Client | null {
  const target = normalizedClientName(name);
  if (!target) return null;
  return clients.find((client) => client.id !== excludeId && normalizedClientName(client.name) === target) ?? null;
}

export function clientProjects(state: CrmState, clientId: string): Project[] {
  return state.projects.filter((project) => project.clientId === clientId);
}

export function clientPayments(state: CrmState, clientId: string): Payment[] {
  const projectIds = new Set(clientProjects(state, clientId).map((project) => project.id));
  return state.payments.filter((payment) => projectIds.has(payment.projectId));
}

// Отримані оплати клієнта за всіма його проєктами, окремо за кожною валютою.
// Валюти не об'єднуємо й не конвертуємо.
export function clientPaidByCurrency(state: CrmState, clientId: string): { currency: Currency; minor: number }[] {
  const map = new Map<Currency, number>();
  for (const payment of clientPayments(state, clientId)) {
    map.set(payment.currency, (map.get(payment.currency) ?? 0) + payment.amountMinor);
  }
  return [...map.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function clientSearchText(client: Client): string {
  return `${client.name} ${client.company} ${client.phone} ${client.telegram} ${client.email}`.toLowerCase();
}

// --- Тип клієнта -------------------------------------------------------------

// Старі записи не мають ознаки. В інтерфейсі «Не вказано» пунктом вибору не є:
// такий клієнт просто не має позначки, а перепризначити тип йому можна лише
// вручну. Фільтр за цим значенням лишається — це безпечний спосіб знайти всі
// записи без типу, нічого не змінюючи.
export const KIND_NOT_SET = "Не вказано";

export function clientKindLabel(kind: ClientKind | null): string {
  return kind ?? KIND_NOT_SET;
}

export function isClientKind(value: unknown): value is ClientKind {
  return value === "Постійний" || value === "Непостійний";
}

// Тип — лише позначка: фільтр і список. Статуси проєктів і фінанси від нього
// не залежать, тому тут немає жодних грошових розрахунків.
export function filterClients(
  clients: Client[],
  filter: { query?: string; archived: boolean; kind: ClientKind | "усі" | "не вказано" }
): Client[] {
  const value = (filter.query ?? "").trim().toLowerCase();
  return clients
    .filter((client) => (filter.archived ? client.archived : !client.archived))
    .filter((client) => {
      if (filter.kind === "усі") return true;
      if (filter.kind === "не вказано") return client.kind === null;
      return client.kind === filter.kind;
    })
    .filter((client) => !value || clientSearchText(client).includes(value))
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));
}

// --- Пошук схожих записів -----------------------------------------------------

// Коефіцієнт Дайса по біграмах: ловить одруківки («Марченко» / «Марченка»),
// які префіксний пошук уже не знаходить.
function bigrams(value: string): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const pair = value.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
}

export function nameSimilarity(a: string, b: string): number {
  const left = normalizedClientName(a);
  const right = normalizedClientName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let shared = 0;
  for (const [pair, count] of leftPairs) shared += Math.min(count, rightPairs.get(pair) ?? 0);
  return (2 * shared) / (left.length - 1 + right.length - 1);
}

// Поріг: «Олена Марченко» проти «Олена Марченка» ≈ 0.85, а проти зовсім
// іншої людини — значно нижче.
export const SIMILAR_NAME_THRESHOLD = 0.6;

// Ранжування для поля клієнта у формі проєкту: точний збіг → початок імені →
// початок слова → частина рядка → схоже ім'я → решта контактних полів.
export function suggestClients(clients: Client[], query: string): Client[] {
  const needle = normalizedClientName(query);
  if (!needle) return clients;
  const scored = clients
    .map((client) => ({ client, score: suggestScore(client, needle) }))
    .filter((row) => row.score >= 0);
  scored.sort((a, b) => a.score - b.score || a.client.name.localeCompare(b.client.name, "uk"));
  return scored.map((row) => row.client);
}

function suggestScore(client: Client, needle: string): number {
  const name = normalizedClientName(client.name);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.split(" ").some((part) => part.startsWith(needle))) return 2;
  if (name.includes(needle)) return 3;
  if (nameSimilarity(name, needle) >= SIMILAR_NAME_THRESHOLD) return 4;
  const extra = `${client.company} ${client.telegram.replace(/^@/, "")} ${client.email}`.toLowerCase();
  if (extra.includes(needle)) return 5;
  return -1;
}

