import type { Client, CrmState, Payment, Project, Reminder } from "./types";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return iso(d);
}

function daysAhead(days: number): string {
  return daysAgo(-days);
}

function stamp(date: Date): string {
  return date.toISOString();
}

let seedCounter = 0;
// Детерміновані id для демоданих: стабільні між перезавантаженнями,
// щоб localStorage не створював дублікатів при повторному сідуванні.
function seedId(prefix: string): string {
  seedCounter += 1;
  return `${prefix}-demo-${String(seedCounter).padStart(3, "0")}`;
}

// Усі записи — демонстраційні. Живуть у localStorage до натискання «Скинути демодані».
export function makeDemoState(): CrmState {
  seedCounter = 0;
  const now = new Date();

  const clients: Client[] = [
    {
      id: seedId("client"),
      name: "Олена Марченко",
      company: "Misto Studio",
      phone: "+380 67 111 22 33",
      telegram: "@olenamk",
      email: "olena@mistostudio.ua",
      note: "Віддає перевагу коротким оновленням у Telegram.",
      archived: false,
      createdAt: stamp(new Date(now.getFullYear(), 7, 12)),
    },
    {
      id: seedId("client"),
      name: "Андрій Коваленко",
      company: "Northline Coffee",
      phone: "+380 50 222 33 44",
      telegram: "@akoval",
      email: "andrii@northline.coffee",
      note: "Погоджує контент самостійно.",
      archived: false,
      createdAt: stamp(new Date(now.getFullYear(), 6, 3)),
    },
    {
      id: seedId("client"),
      name: "Максим Савчук",
      company: "Savchuk Legal",
      phone: "+380 63 333 44 55",
      telegram: "@savchuk",
      email: "max@savchuk.legal",
      note: "Потрібна доступна версія сайту.",
      archived: false,
      createdAt: stamp(new Date(now.getFullYear(), 4, 20)),
    },
    {
      id: seedId("client"),
      name: "Bonna Ceramics",
      company: "Bonna Ceramics GmbH",
      phone: "",
      telegram: "@bonnaceramics",
      email: "hello@bonnaceramics.com",
      note: "Запуск колекції — кінець місяця.",
      archived: false,
      createdAt: stamp(new Date(now.getFullYear(), 8, 5)),
    },
  ];

  const projects: Project[] = [
    {
      id: seedId("project"),
      clientId: clients[0].id,
      title: "Редизайн головної сторінки",
      description: "Новий макет головної та мобільна адаптація.",
      amountMinor: 3_600_000,
      currency: "UAH",
      status: "У роботі",
      deadline: daysAhead(12),
      nextAction: "Надіслати другий варіант макета",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth(), 4)),
    },
    {
      id: seedId("project"),
      clientId: clients[2].id,
      title: "Сайт юридичної практики",
      description: "Лендінг із формою первинної консультації.",
      amountMinor: 9_000_000,
      currency: "UAH",
      status: "У роботі",
      deadline: daysAhead(21),
      nextAction: "Узгодити структуру сторінок",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 1, 18)),
    },
    {
      id: seedId("project"),
      clientId: clients[1].id,
      title: "Контент-план на листопад",
      description: "Календар публікацій і 12 постів.",
      amountMinor: 1_500_000,
      currency: "UAH",
      status: "Очікує клієнта",
      deadline: daysAhead(5),
      nextAction: "Дочекатися узгодження від Андрія",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth(), 10)),
    },
    {
      id: seedId("project"),
      clientId: clients[3].id,
      title: "Айдентика осінньої колекції",
      description: "Логотип-система, пакування, гайдлайн.",
      amountMinor: 2_400_000,
      currency: "UAH",
      status: "Завершений",
      deadline: daysAgo(9),
      nextAction: "",
      note: "Останню доплату клієнт обіцяв наступного тижня.",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 2, 14)),
    },
    {
      id: seedId("project"),
      clientId: clients[0].id,
      title: "Портфоліо-сайт (версія EN)",
      description: "Дворічна мова сайту для закордонних клієнтів.",
      amountMinor: 120_000,
      currency: "EUR",
      status: "Обговорення",
      deadline: daysAhead(30),
      nextAction: "Надіслати фінальну пропозицію",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth(), 20)),
    },
  ];

  const payments: Payment[] = [
    {
      id: seedId("payment"),
      projectId: projects[0].id,
      amountMinor: 1_000_000,
      currency: "UAH",
      date: daysAgo(3),
      type: "Передоплата",
      note: "50% після підписання",
      createdAt: stamp(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)
      ),
    },
    {
      id: seedId("payment"),
      projectId: projects[1].id,
      amountMinor: 2_500_000,
      currency: "UAH",
      date: daysAgo(6),
      type: "Передоплата",
      note: "",
      createdAt: stamp(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
      ),
    },
    {
      id: seedId("payment"),
      projectId: projects[3].id,
      amountMinor: 1_000_000,
      currency: "UAH",
      date: daysAgo(24),
      type: "Доплата",
      note: "Другий етап",
      createdAt: stamp(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 24)
      ),
    },
    {
      id: seedId("payment"),
      projectId: projects[3].id,
      amountMinor: 900_000,
      currency: "UAH",
      date: daysAgo(38),
      type: "Передоплата",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 1, 12)),
    },
    {
      id: seedId("payment"),
      projectId: projects[1].id,
      amountMinor: 1_800_000,
      currency: "UAH",
      date: daysAgo(41),
      type: "Передоплата",
      note: "Стартовий внесок",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 1, 9)),
    },
    {
      id: seedId("payment"),
      projectId: projects[3].id,
      amountMinor: 500_000,
      currency: "UAH",
      date: daysAgo(67),
      type: "Передоплата",
      note: "",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 2, 20)),
    },
    {
      id: seedId("payment"),
      projectId: projects[4].id,
      amountMinor: 20_000,
      currency: "EUR",
      date: daysAgo(52),
      type: "Передоплата",
      note: "Бронювання дедлайну",
      createdAt: stamp(new Date(now.getFullYear(), now.getMonth() - 1, 27)),
    },
  ];

  const reminders: Reminder[] = [
    {
      id: seedId("reminder"),
      title: "Надіслати другий варіант макета",
      datetime: `${todayAt(11, 30)}`,
      clientId: clients[0].id,
      projectId: projects[0].id,
      done: false,
      createdAt: stamp(now),
    },
    {
      id: seedId("reminder"),
      title: "Нагадати про фінальну доплату за айдентику",
      datetime: `${todayAt(15, 0)}`,
      clientId: clients[3].id,
      projectId: projects[3].id,
      done: false,
      createdAt: stamp(now),
    },
    {
      id: seedId("reminder"),
      title: "Дізнатися рішення щодо контент-плану",
      datetime: `${todayAt(18, 0)}`,
      clientId: clients[1].id,
      projectId: projects[2].id,
      done: true,
      createdAt: stamp(now),
    },
    {
      id: seedId("reminder"),
      title: "Надіслати пропозицію по портфоліо-сайту",
      datetime: `${daysAhead(2)}T10:00`,
      clientId: clients[0].id,
      projectId: projects[4].id,
      done: false,
      createdAt: stamp(now),
    },
  ];

  return { clients, projects, payments, reminders };
}

function todayAt(hours: number, minutes: number): string {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return `${iso(d)}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
