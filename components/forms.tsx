"use client";

import { useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import {
  CURRENCIES,
  PAYMENT_TYPES,
  type Client,
  type Currency,
  type Payment,
  type PaymentType,
  type Project,
  type ProjectStatus,
  type Reminder,
} from "@/lib/types";
import { todayISO } from "@/lib/money";
import { overpayNotice, projectCurrencyLockNote, receivedAfterMinor } from "@/lib/payments";
import { projectOwnerName, reminderLinkMismatch } from "@/lib/reminders";
import { ListPicker, type PickerOption } from "./ListPicker";
import { statusOptions } from "./StatusPicker";

// Кожна форма захищена від повторного надсилання: перший submit блокує
// повторні виклики, поки батьківський компонент не закриє форму.
function useSingleSubmit() {
  const submitted = useRef(false);
  return () => {
    if (submitted.current) return false;
    submitted.current = true;
    return true;
  };
}

export const currencyOptions: PickerOption<Currency>[] = CURRENCIES.map((currency) => ({
  value: currency,
  label: currency,
  hint:
    currency === "UAH"
      ? "Українська гривня"
      : currency === "EUR"
        ? "Євро"
        : "Долар США",
}));

export const paymentTypeOptions: PickerOption<PaymentType>[] = PAYMENT_TYPES.map((type) => ({
  value: type,
  label: type,
  hint:
    type === "Передоплата"
      ? "Отримано до старту роботи"
      : type === "Доплата"
        ? "Частина погодженої суми"
        : "Будь-яке інше надходження",
}));

export type PaymentInput = Omit<Payment, "id" | "createdAt" | "projectId">;

// Валюта оплати для MVP завжди дорівнює валюті проєкту: окремого вибору немає,
// а логіка збереження (store.addPayment) перевіряє це ще раз.
// Переплата не заборонена — форма попереджає заздалегідь і все одно записує.
export function PaymentForm({
  project,
  payments = [],
  onSubmit,
}: {
  project: Project;
  payments?: Payment[];
  onSubmit: (input: PaymentInput) => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [type, setType] = useState<PaymentType>("Доплата");
  const [note, setNote] = useState("");
  const guard = useSingleSubmit();

  const valid = Number.parseFloat(amount.replace(",", ".")) > 0;
  const enteredMinor = Math.round(
    (Number.parseFloat(amount.replace(",", ".")) || 0) * 100
  );
  const overpay = valid
    ? overpayNotice(project, receivedAfterMinor(project, payments, { amountMinor: enteredMinor, currency: project.currency }))
    : null;

  return (
    <form
      className="form-stack"
      onSubmit={event => {
        event.preventDefault();
        if (!guard() || !valid) return;
        onSubmit({
          amountMinor: Math.round(
            Number.parseFloat(amount.replace(",", ".")) * 100
          ),
          currency: project.currency,
          date,
          type,
          note: note.trim(),
        });
      }}
    >
      <label className="field">
        Сума, {project.currency}
        <input
          autoFocus
          required
          inputMode="decimal"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          placeholder="3000"
        />
      </label>
      <div className="form-row">
        <span className="field">
          <span className="field-label">Валюта проєкту</span>
          <span className="picker-static">{project.currency}</span>
        </span>
        <label className="field">
          Дата
          <input
            type="date"
            required
            value={date}
            onChange={event => setDate(event.target.value)}
          />
        </label>
      </div>
      <ListPicker
        label="Тип оплати"
        title="Тип оплати"
        options={paymentTypeOptions}
        value={type}
        onChange={setType}
      />
      <label className="field">
        Нотатка (необов’язково)
        <input
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="Наприклад, частина за етап 2"
        />
      </label>
      {overpay && (
        <p className="form-warn">
          <CircleAlert size={13} />
          <span>{overpay}</span>
        </p>
      )}
      <button type="submit" className="button-primary" disabled={!valid}>
        Записати оплату
      </button>
      <p className="form-hint">
        Оплата записується у валюті проєкту — {project.currency}. Конвертації
        немає, тому різні валюти не складаються в одну суму.
      </p>
    </form>
  );
}

export type ProjectInput = Omit<Project, "id" | "createdAt">;

export function clientPickerOptions(clients: Client[]): PickerOption<string>[] {
  return [
    { value: "", label: "Без клієнта", hint: "Можна прив'язати пізніше" },
    ...clients.map(client => ({
      value: client.id,
      label: client.archived ? `${client.name} · архів` : client.name,
      hint: client.archived ? "архівований — зв'язок збережеться" : client.company || undefined,
    })),
  ];
}

// У формі редагування показуємо й архівованого клієнта, прив'язаного до проєкту:
// інакше поле брехливо показує «Без клієнта», хоча зв'язок нікуди не дівся.
export function projectClientOptions(clients: Client[], selectedId: string): PickerOption<string>[] {
  const available = clients.filter(
    client => !client.archived || client.id === selectedId
  );
  return clientPickerOptions(available);
}

// У списку проєктів справи показуємо, чий це проєкт: без імені клієнта
// прив'язати не до тієї людини дуже легко.
export function projectPickerOptions(projects: Project[], clients: Client[]): PickerOption<string>[] {
  return [
    { value: "", label: "Без проєкту", hint: "Просто нагадування" },
    ...projects.map(project => {
      const owner = projectOwnerName(clients, project);
      return {
        value: project.id,
        label: project.title,
        hint: owner ? `${owner} · ${project.status}` : project.status,
      };
    }),
  ];
}

export function ProjectForm({
  clients,
  initial,
  payments = [],
  onSubmit,
}: {
  clients: Client[];
  initial?: Project;
  payments?: Payment[];
  onSubmit: (input: ProjectInput) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [amount, setAmount] = useState(
    initial ? String(initial.amountMinor / 100) : ""
  );
  const [currency, setCurrency] = useState<Currency>(
    initial?.currency ?? "UAH"
  );
  const [status, setStatus] = useState<ProjectStatus>(
    initial?.status ?? "Новий"
  );
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [nextAction, setNextAction] = useState(initial?.nextAction ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const guard = useSingleSubmit();

  const currencyLocked = Boolean(initial) && payments.length > 0;

  return (
    <form
      className="form-stack"
      onSubmit={event => {
        event.preventDefault();
        if (!guard() || !title.trim()) return;
        onSubmit({
          title: title.trim(),
          clientId: clientId || null,
          amountMinor: Math.round(
            (Number.parseFloat(amount.replace(",", ".")) || 0) * 100
          ),
          currency: initial && currencyLocked ? initial.currency : currency,
          status,
          deadline,
          nextAction: nextAction.trim(),
          description: description.trim(),
          note: initial?.note ?? "",
        });
      }}
    >
      <label className="field">
        Назва проєкту
        <input
          autoFocus
          required
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Наприклад, редизайн сайту"
        />
      </label>
      <ListPicker
        label="Клієнт"
        title="Клієнт проєкту"
        options={projectClientOptions(clients, clientId)}
        value={clientId}
        placeholder="Без клієнта"
        onChange={setClientId}
      />
      <div className="form-row">
        <label className="field">
          Погоджена сума
          <input
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.target.value)}
            placeholder="10000"
          />
        </label>
        <ListPicker
          label="Валюта"
          title="Валюта проєкту"
          options={currencyOptions}
          value={currency}
          onChange={setCurrency}
          disabled={currencyLocked}
        />
      </div>
      {currencyLocked && initial && (
        <p className="form-hint">{projectCurrencyLockNote(payments)}</p>
      )}
      <div className="form-row">
        <ListPicker
          label="Статус"
          title="Статус проєкту"
          options={statusOptions()}
          value={status}
          onChange={setStatus}
        />
        <label className="field">
          Дедлайн
          <input
            type="date"
            value={deadline}
            onChange={event => setDeadline(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Наступна дія
        <input
          value={nextAction}
          onChange={event => setNextAction(event.target.value)}
          placeholder="Наприклад, надіслати макет"
        />
      </label>
      <label className="field">
        Опис (необов’язково)
        <textarea
          value={description}
          onChange={event => setDescription(event.target.value)}
          rows={2}
        />
      </label>
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : "Створити проєкт"}
      </button>
    </form>
  );
}

export type ClientInput = Omit<Client, "id" | "createdAt" | "archived">;

export function ClientForm({
  initial,
  onSubmit,
}: {
  initial?: Client;
  onSubmit: (input: ClientInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [telegram, setTelegram] = useState(initial?.telegram ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const guard = useSingleSubmit();

  return (
    <form
      className="form-stack"
      onSubmit={event => {
        event.preventDefault();
        if (!guard() || !name.trim()) return;
        onSubmit({
          name: name.trim(),
          company: company.trim(),
          phone: phone.trim(),
          telegram: telegram.trim(),
          email: email.trim(),
          note: note.trim(),
        });
      }}
    >
      <label className="field">
        Ім’я або назва
        <input
          autoFocus
          required
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Наприклад, Марія Шевченко"
        />
      </label>
      <label className="field">
        Компанія (необов’язково)
        <input
          value={company}
          onChange={event => setCompany(event.target.value)}
        />
      </label>
      <label className="field">
        Телефон (необов’язково)
        <input
          type="tel"
          value={phone}
          onChange={event => setPhone(event.target.value)}
          placeholder="+380…"
        />
      </label>
      <div className="form-row">
        <label className="field">
          Telegram (необов’язково)
          <input
            value={telegram}
            onChange={event => setTelegram(event.target.value)}
            placeholder="@nickname"
          />
        </label>
        <label className="field">
          Email (необов’язково)
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        Нотатки (необов’язково)
        <textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          rows={2}
        />
      </label>
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : "Додати клієнта"}
      </button>
    </form>
  );
}

export type ReminderInput = Omit<Reminder, "id" | "createdAt" | "done">;

export function ReminderForm({
  projects,
  clients,
  initial,
  onSubmit,
}: {
  projects: Project[];
  clients: Client[];
  initial?: Reminder;
  onSubmit: (input: ReminderInput) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial ? initial.datetime.slice(0, 10) : todayISO());
  const [time, setTime] = useState(initial ? initial.datetime.slice(11, 16) : "09:00");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const guard = useSingleSubmit();

  const projectOptions = projectPickerOptions(projects, clients);
  // Різні клієнт і проєкт — підозра, а не заборона: попереджаємо й записуємо.
  const mismatch = reminderLinkMismatch(clients, projects, { clientId, projectId });

  return (
    <form
      className="form-stack"
      onSubmit={event => {
        event.preventDefault();
        if (!guard() || !title.trim()) return;
        onSubmit({
          title: title.trim(),
          datetime: `${date}T${time}`,
          clientId: clientId || null,
          projectId: projectId || null,
        });
      }}
    >
      <label className="field">
        Що зробити
        <input
          autoFocus
          required
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Наприклад, написати клієнту"
        />
      </label>
      <div className="form-row">
        <label className="field">
          Дата
          <input
            type="date"
            required
            value={date}
            onChange={event => setDate(event.target.value)}
          />
        </label>
        <label className="field">
          Час
          <input
            type="time"
            required
            value={time}
            onChange={event => setTime(event.target.value)}
          />
        </label>
      </div>
      <ListPicker
        label="Клієнт (необов’язково)"
        title="Клієнт справи"
        options={projectClientOptions(clients, clientId)}
        value={clientId}
        placeholder="Без клієнта"
        onChange={setClientId}
      />
      <ListPicker
        label="Проєкт (необов’язково)"
        title="Проєкт справи"
        options={projectOptions}
        value={projectId}
        placeholder="Без проєкту"
        onChange={setProjectId}
      />
      {mismatch && (
        <p className="form-warn">
          <CircleAlert size={13} />
          <span>{mismatch}</span>
        </p>
      )}
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : "Додати справу"}
      </button>
      <p className="form-hint">
        Час — локальний для вашого пристрою. Нагадування в чаті бота з’являться
        після підключення сервера.
      </p>
    </form>
  );
}
