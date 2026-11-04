import { describe, expect, it } from "vitest";
import { projectOwnerName, reminderLinkMismatch } from "./reminders";
import type { Client, Project } from "./types";

function client(partial: Partial<Client> = {}): Client {
  return {
    id: "cli-1",
    name: "Олена Марченко",
    company: "Misto Studio",
    phone: "",
    telegram: "",
    email: "",
    note: "",
    kind: null,
    archived: false,
    createdAt: "",
    ...partial,
  };
}

function project(partial: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    clientId: "cli-1",
    title: "Сайт юридичної практики",
    description: "",
    amountMinor: 720_000,
    currency: "UAH",
    status: "У роботі",
    deadline: "",
    nextAction: "",
    note: "",
    createdAt: "",
    ...partial,
  };
}

const olena = client();
const maksim = client({ id: "cli-2", name: "Максим Савчук", company: "Law Office" });
const clients = [olena, maksim];

describe("клієнт проєкту", () => {
  it("називає прив'язаного клієнта", () => {
    expect(projectOwnerName(clients, project())).toBe("Олена Марченко");
  });

  it("проєкт без клієнта не має власника", () => {
    expect(projectOwnerName(clients, project({ clientId: null }))).toBeNull();
  });

  it("архівний клієнт теж називається — інакше попередження мовчало б", () => {
    expect(projectOwnerName([{ ...olena, archived: true }], project())).toBe("Олена Марченко");
  });

  it("не знайдений клієнт дає null, а не помилку", () => {
    expect(projectOwnerName([], project())).toBeNull();
    expect(projectOwnerName(clients, project({ clientId: "cli-9" }))).toBeNull();
  });
});

describe("зв'язок справи з проєктом і клієнтом", () => {
  it("той самий клієнт, що й у проєкті — без попередження", () => {
    expect(reminderLinkMismatch(clients, [project()], { clientId: "cli-1", projectId: "proj-1" })).toBeNull();
  });

  it("різні клієнт справи й клієнт проєкту — зрозумілий текст", () => {
    const note = reminderLinkMismatch(clients, [project()], { clientId: "cli-2", projectId: "proj-1" }) ?? "";
    expect(note).toContain("Клієнт справи — Максим Савчук");
    expect(note).toContain("а клієнт проєкту «Сайт юридичної практики» — Олена Марченко");
    expect(note).toContain("Зберегти можна");
  });

  it("справа лише з клієнтом, лише з проєктом і без прив'язок працюють як раніше", () => {
    expect(reminderLinkMismatch(clients, [project()], { clientId: "cli-2", projectId: "" })).toBeNull();
    expect(reminderLinkMismatch(clients, [project()], { clientId: "", projectId: "proj-1" })).toBeNull();
    expect(reminderLinkMismatch(clients, [project()], { clientId: "", projectId: "" })).toBeNull();
  });

  it("проєкт без клієнта не суперечить жодній прив'язці", () => {
    expect(reminderLinkMismatch(clients, [project({ clientId: null })], { clientId: "cli-2", projectId: "proj-1" })).toBeNull();
  });

  it("попереджає й коли клієнт проєкта в архіві", () => {
    const archived = [olena, maksim, { ...client({ id: "cli-3", name: "Ірина Бондаренко" }), archived: true }];
    const note = reminderLinkMismatch(archived, [project({ clientId: "cli-3" })], { clientId: "cli-2", projectId: "proj-1" }) ?? "";
    expect(note).toContain("Ірина Бондаренко");
  });

  it("відсутні чи нечіткі id не ламають перевірку", () => {
    expect(reminderLinkMismatch(clients, [project()], { clientId: "cli-9", projectId: "proj-1" })).toBeNull();
    expect(reminderLinkMismatch(clients, [project()], { clientId: "cli-1", projectId: "proj-9" })).toBeNull();
    expect(reminderLinkMismatch([], [], { clientId: "cli-1", projectId: "proj-1" })).toBeNull();
  });
});
