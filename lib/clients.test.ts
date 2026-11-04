import { describe, expect, it } from "vitest";
import { clientPaidByCurrency, clientPayments, clientProjects, findDuplicateClient, normalizedClientName } from "./clients";
import { makeDemoState } from "./demoData";
import type { CrmState, Payment, Project } from "./types";

const state = makeDemoState();

describe("пошук дублікатів клієнтів", () => {
  it("знаходить збіг незалежно від регістра і зайвих пробілів", () => {
    const match = findDuplicateClient(state.clients, "  олена   марченко ");
    expect(match?.name).toBe("Олена Марченко");
  });

  it("ігнорує самого клієнта під час редагування", () => {
    const client = state.clients[0];
    expect(findDuplicateClient(state.clients, client.name, client.id)).toBeNull();
  });

  it("не плутає різних людей зі схожими іменами", () => {
    expect(findDuplicateClient(state.clients, "Олена Коваленко")).toBeNull();
  });

  it("порожнє ім'я не вважається дублікатом", () => {
    expect(findDuplicateClient(state.clients, "   ")).toBeNull();
    expect(normalizedClientName("   ")).toBe("");
  });
});

describe("пов'язані дані клієнта", () => {
  it("проєкти клієнта відповідають його id", () => {
    const client = state.clients.find((c) => c.name === "Олена Марченко")!;
    const projects = clientProjects(state, client.id);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((p) => p.clientId === client.id)).toBe(true);
  });

  it("оплати клієнта — це оплати його проєктів", () => {
    const client = state.clients.find((c) => c.name === "Максим Савчук")!;
    const projectIds = new Set(clientProjects(state, client.id).map((p) => p.id));
    const payments = clientPayments(state, client.id);
    expect(payments.length).toBeGreaterThan(0);
    expect(payments.every((p) => projectIds.has(p.projectId))).toBe(true);
  });

  it("оплачено рахується окремо за кожною валютою", () => {
    const olena = state.clients.find((c) => c.name === "Олена Марченко")!;
    const paid = clientPaidByCurrency(state, olena.id);
    const uah = paid.find((row) => row.currency === "UAH");
    const eur = paid.find((row) => row.currency === "EUR");
    expect((uah?.minor ?? 0)).toBeGreaterThan(0);
    // Портфоліо-сайт Олени — в EUR: 200 передоплати
    expect(eur?.minor).toBe(20_000);
  });

  it("клієнт без проєктів і оплат дає порожні результати, без помилок", () => {
    const empty: CrmState = { clients: [], projects: [], payments: [], reminders: [] };
    expect(clientProjects(empty, "x")).toEqual([]);
    expect(clientPayments(empty, "x")).toEqual([]);
    expect(clientPaidByCurrency(empty, "x")).toEqual([]);
  });

  it("архівування клієнта не впливає на його проєкти й оплати", () => {
    const client = state.clients[0];
    const archived: CrmState = {
      ...state,
      clients: state.clients.map((c) => (c.id === client.id ? { ...c, archived: true } : c)),
    };
    expect(clientProjects(archived, client.id)).toEqual(clientProjects(state, client.id));
    expect(clientPaidByCurrency(archived, client.id)).toEqual(clientPaidByCurrency(state, client.id));
  });

  it("оплати рахуються після редагування суми запису", () => {
    const client = state.clients[0];
    const before = clientPaidByCurrency(state, client.id).find((r) => r.currency === "UAH")!.minor;
    const editedPayments: Payment[] = state.payments.map((p) =>
      p.currency === "UAH" && state.projects.find((pr) => pr.id === p.projectId)?.clientId === client.id
        ? { ...p, amountMinor: p.amountMinor + 1_000 }
        : p,
    );
    const edited: CrmState = { ...state, payments: editedPayments };
    const after = clientPaidByCurrency(edited, client.id).find((r) => r.currency === "UAH")!.minor;
    expect(after).toBe(before + 1_000);
  });

  it("довідково: проєкти не втрачають clientId після архівування", () => {
    const client = state.clients[0];
    const projectsBefore: Project[] = state.projects.filter((p) => p.clientId === client.id);
    expect(projectsBefore.length).toBeGreaterThan(0);
    const archivedClients = state.clients.map((c) => (c.id === client.id ? { ...c, archived: true } : c));
    const projectsAfter = state.projects.filter((p) => archivedClients.find((c) => c.id === p.clientId)?.id === client.id);
    expect(projectsAfter.length).toBe(projectsBefore.length);
  });
});
