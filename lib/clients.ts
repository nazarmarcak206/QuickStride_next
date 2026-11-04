import type { Client, CrmState, Currency, Payment, Project } from "./types";

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
