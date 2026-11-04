import { describe, expect, it } from "vitest";
import {
  SIMILAR_NAME_THRESHOLD,
  clientKindLabel,
  clientPaidByCurrency,
  clientPayments,
  clientProjects,
  findDuplicateClient,
  filterClients,
  isClientKind,
  nameSimilarity,
  normalizedClientName,
  suggestClients,
} from "./clients";
import { makeDemoState } from "./demoData";
import type { Client, CrmState, Payment, Project } from "./types";

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

// --- Тип клієнта -------------------------------------------------------------

function fixture(partial: Partial<Client> & { id: string }): Client {
  return { name: "", company: "", phone: "", telegram: "", email: "", note: "", kind: null, archived: false, createdAt: "", ...partial };
}

const directory: Client[] = [
  fixture({ id: "a", name: "Олена Марченко", company: "Misto Studio", telegram: "@olena", email: "olena@misto.ua" }),
  fixture({ id: "b", name: "Олена Коваленко", phone: "+380631112233" }),
  fixture({ id: "c", name: "Максим Савчук", company: "Law Office", kind: "Постійний" }),
  fixture({ id: "d", name: "Bonna Ceramics", kind: "Непостійний", archived: true }),
];

describe("тип клієнта", () => {
  it("демонстраційні дані містять обидва типи і запис без типу", () => {
    const kinds = state.clients.map((client) => client.kind);
    expect(kinds).toContain("Постійний");
    expect(kinds).toContain("Непостійний");
    expect(kinds.filter((kind) => kind === null)).toHaveLength(1);
  });

  it("запис без ознаки показується як «Не вказано», а не як «Непостійний»", () => {
    expect(clientKindLabel(null)).toBe("Не вказано");
    expect(clientKindLabel("Постійний")).toBe("Постійний");
  });

  it("перевірка типу приймає лише дві фірмові форми", () => {
    expect(isClientKind("Постійний")).toBe(true);
    expect(isClientKind("Непостійний")).toBe(true);
    expect(isClientKind("постійний")).toBe(false);
    expect(isClientKind(null)).toBe(false);
    expect(isClientKind(undefined)).toBe(false);
  });

  it("фільтр за типом бере саме цю групу", () => {
    expect(filterClients(directory, { archived: false, kind: "Постійний" }).map((c) => c.id)).toEqual(["c"]);
    expect(filterClients(directory, { archived: true, kind: "Непостійний" }).map((c) => c.id)).toEqual(["d"]);
  });

  it("фільтр «не вказано» — це старі записи без ознаки", () => {
    expect(filterClients(directory, { archived: false, kind: "не вказано" }).map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("фільтр «усі» не чіпає тип, а активний список не показує архів", () => {
    expect(filterClients(directory, { archived: false, kind: "усі" }).map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(filterClients(directory, { archived: true, kind: "усі" }).map((c) => c.id)).toEqual(["d"]);
  });

  it("пошук і тип працюють разом, список сортований за іменем", () => {
    const withQuery = filterClients(directory, { query: "олена", archived: false, kind: "усі" });
    expect(withQuery.map((c) => c.name)).toEqual(["Олена Коваленко", "Олена Марченко"]);
  });

  it("тип не впливає на фінанси: сума оплаченого та сама для будь-якого типу", () => {
    const olena = state.clients.find((c) => c.name === "Олена Марченко")!;
    const flipped: CrmState = {
      ...state,
      clients: state.clients.map((c) => (c.id === olena.id ? { ...c, kind: c.kind === "Постійний" ? "Непостійний" : "Постійний" } : c)),
    };
    expect(clientPaidByCurrency(flipped, olena.id)).toEqual(clientPaidByCurrency(state, olena.id));
    expect(clientProjects(flipped, olena.id)).toEqual(clientProjects(state, olena.id));
  });
});

// --- Ранжування пошуку у полі клієнта ---------------------------------------

describe("підказки клієнтів у формі", () => {
  it("порожній запит — увесь список без змін", () => {
    expect(suggestClients(directory, "")).toEqual(directory);
    expect(suggestClients(directory, "   ")).toEqual(directory);
  });

  it("точний збіг знаходить саме цю людину, а не однофамільця", () => {
    expect(suggestClients(directory, "Олена Марченко").map((c) => c.id)).toEqual(["a"]);
    expect(suggestClients(directory, "Максим").map((c) => c.id)).toEqual(["c"]);
  });

  it("пошук по середині імені та за другим словом працює", () => {
    expect(suggestClients(directory, "коваленко").map((c) => c.id)).toEqual(["b"]);
    expect(suggestClients(directory, " ceramics ").map((c) => c.id)).toEqual(["d"]);
  });

  it("одруківка знаходиться завдяки схожості — точний варіант перший", () => {
    const ids = suggestClients(directory, "Олена Марченка").map((c) => c.id);
    expect(ids[0]).toBe("a");
    expect(ids).not.toContain("c");
  });

  it("компонія, telegram та email — резервні варіанти пошуку", () => {
    expect(suggestClients(directory, "olena@misto.ua").map((c) => c.id)).toEqual(["a"]);
    expect(suggestClients(directory, "misto").map((c) => c.id)).toEqual(["a"]);
    expect(suggestClients(directory, "law office").map((c) => c.id)).toEqual(["c"]);
  });

  it("за запитом, на який немає нікого, список порожній — форма покаже кнопку створення", () => {
    expect(suggestClients(directory, "Іван Франко")).toEqual([]);
  });

  it("схожість: нормалізовані однакові імена — 1, одруківка вище порога, різні люди нижче", () => {
    expect(nameSimilarity("Олена Марченко", "олена  марченко")).toBe(1);
    expect(nameSimilarity("Олена Марченко", "Олена Марченка")).toBeGreaterThanOrEqual(SIMILAR_NAME_THRESHOLD);
    expect(nameSimilarity("Олена Марченко", "Максим Савчук")).toBeLessThan(SIMILAR_NAME_THRESHOLD);
    expect(nameSimilarity("", "А")).toBe(0);
  });

  it("архівований запис лишається у видачі: зв'язок з проєктом нікуди не дівся", () => {
    expect(suggestClients(directory, "Bonna").map((c) => c.id)).toEqual(["d"]);
  });

  it("точний збіг у списку не губиться через нульовий бал", () => {
    expect(suggestClients([fixture({ id: "z", name: "Тарас Шевченко" })], "Тарас Шевченко").map((c) => c.id)).toEqual(["z"]);
  });
});
