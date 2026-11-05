"use client";

import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Plus } from "lucide-react";
import {
  CLIENT_KINDS,
  CURRENCIES,
  PAYMENT_TYPES,
  type Client,
  type ClientKind,
  type Currency,
  type Payment,
  type PaymentType,
  type Project,
  type ProjectStatus,
  type Reminder,
} from "@/lib/types";
import { formatMoney, toMinor, todayISO } from "@/lib/money";
import { overpayNotice, overpayNoticeFor, projectCurrencyLockNote, receivedAfterMinor } from "@/lib/payments";
import { findDuplicateClient, clientKindLabel, isClientKind, suggestClients } from "@/lib/clients";
import { remainingAfterPrepayment, type ProjectInput } from "@/lib/projectCreate";
import { projectOwnerName, reminderLinkMismatch } from "@/lib/reminders";
import { ListPicker, PickerSheet, type PickerOption } from "./ListPicker";
import { Sheet } from "./ui";
import { statusOptions } from "./StatusPicker";
import { haptic } from "@/lib/telegram";
import { useSettings } from "@/lib/settingsStore";

// Кожна форма захищена від повторного надсилання: перший submit блокує
// повторні виклики, поки батьківський компонент не закриє форму.
// При помилці надсилання блокування знімається — дані полів лишаються, і
// користувач може виправити значення та спробувати ще раз.
function useSingleSubmit() {
  const submitted = useRef(false);
  const claim = useCallback(() => {
    if (submitted.current) return false;
    submitted.current = true;
    return true;
  }, []);
  const release = useCallback(() => {
    submitted.current = false;
  }, []);
  return { claim, release };
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

// У виборі лишаються лише два реальні типи. «Не вказано» пунктом не є:
// записи без ознаки (усі старі) не перепризначуються автоматично й не
// перетворюються на «Непостійний» — вони просто не мають позначки в списку.
export const clientKindOptions: PickerOption<string>[] = CLIENT_KINDS.map((kind) => ({
  value: kind,
  label: kind,
  hint: kind === "Постійний" ? "Повертається з новими проєктами" : "Одиничний запит",
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
  const [notice, setNotice] = useState("");
  const { claim, release } = useSingleSubmit();

  const valid = toMinor(amount) > 0;
  const enteredMinor = toMinor(amount);
  const overpay = valid
    ? overpayNotice(project, receivedAfterMinor(project, payments, { amountMinor: enteredMinor, currency: project.currency }))
    : null;

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!claim()) return;
        setNotice("");
        try {
          onSubmit({ amountMinor: enteredMinor, currency: project.currency, date, type, note: note.trim() });
        } catch (error) {
          // Запис відхилено (наприклад, валюта не збігається з проєктом) —
          // блокування знято, суму можна виправити й надіслати ще раз.
          release();
          setNotice(error instanceof Error ? error.message : "Не вдалося записати оплату.");
        }
      }}
    >
      <label className="field">
        Сума, {project.currency}
        <input
          autoFocus
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
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
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      <ListPicker label="Тип оплати" title="Тип оплати" options={paymentTypeOptions} value={type} onChange={setType} />
      <label className="field">
        Нотатка (необов’язково)
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Наприклад, частина за етап 2" />
      </label>
      {overpay && <WarnNote text={overpay} />}
      {notice && <WarnNote text={notice} />}
      <button type="submit" className="button-primary" disabled={!valid}>
        Записати оплату
      </button>
      <p className="form-hint">Оплата — у валюті проєкту; конвертації немає.</p>
    </form>
  );
}

function WarnNote({ text }: { text: string }) {
  return (
    <p className="form-warn" role="alert">
      <CircleAlert size={13} />
      <span>{text}</span>
    </p>
  );
}

export type { ProjectInput };

// Створення проєкту окреме від редагування: передоплата є лише в новому
// проєкті, де ще немає жодного запису оплати.
export type ProjectSubmit = { project: ProjectInput; prepaymentMinor: number };

// У списку справ показуємо, чий це проєкт: без імені клієнта прив'язати
// не до тієї людини дуже легко.
export function projectPickerOptions(projects: Project[], clients: Client[]): PickerOption<string>[] {
  return [
    { value: "", label: "Без проєкту", hint: "Просто нагадування" },
    ...projects.map((project) => {
      const owner = projectOwnerName(clients, project);
      return {
        value: project.id,
        label: project.title,
        hint: owner ? `${owner} · ${project.status}` : project.status,
      };
    }),
  ];
}

/**
 * Підказка під іменем клієнта у списку вибору: архів, компанія та тип.
 * «Не вказано» не показуємо — це не інформація, а її відсутність.
 */
function clientHint(client: Client): string {
  return [
    client.archived ? "архівований" : client.company,
    client.kind === null ? "" : clientKindLabel(client.kind),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ProjectForm({
  clients,
  initial,
  payments = [],
  onCreateClient,
  onSubmit,
}: {
  clients: Client[];
  initial?: Project;
  payments?: Payment[];
  onCreateClient?: (input: ClientInput) => Client;
  onSubmit: (submit: ProjectSubmit) => void;
}) {
  const { settings } = useSettings();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amountMinor / 100) : "");
  const [prepay, setPrepay] = useState("");
  // Новий проєкт стартує з основної валюти в налаштуваннях; редагування
  // завжди показує валюту самого проєкту, бо налаштування старі записи не міняють.
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? settings.baseCurrency);
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "Новий");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [nextAction, setNextAction] = useState(initial?.nextAction ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState("");
  const { claim, release } = useSingleSubmit();

  const currencyLocked = Boolean(initial) && payments.length > 0;
  const amountMinor = toMinor(amount);
  const prepayMinor = initial ? 0 : toMinor(prepay);
  const remainingMinor = remainingAfterPrepayment(amountMinor, prepayMinor);
  const overpay = prepayMinor > 0 ? overpayNoticeFor(amountMinor, currency, prepayMinor) : null;

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        // Спершу заявляємо блокування і лише потім перевіряємо поля:
        // інакше другий submit зніме блокування першого, і проєкт створиться двічі.
        if (!claim()) return;
        if (!title.trim()) {
          release();
          setError("Вкажіть назву проєкту.");
          return;
        }
        setError("");
        try {
          onSubmit({
            project: {
              title: title.trim(),
              clientId: clientId || null,
              amountMinor,
              currency: initial && currencyLocked ? initial.currency : currency,
              status,
              deadline,
              nextAction: nextAction.trim(),
              description: description.trim(),
              note: initial?.note ?? "",
            },
            prepaymentMinor: prepayMinor,
          });
        } catch (caught) {
          // Поля лишаються заповненими: блокування знято, форму можна надіслати ще раз.
          release();
          setError(caught instanceof Error ? caught.message : "Не вдалося зберегти проєкт.");
        }
      }}
    >
      <label className="field">
        Назва проєкту
        <input
          autoFocus
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Наприклад, редизайн сайту"
        />
      </label>
      <ClientField
        clients={clients}
        value={clientId}
        onCreateClient={onCreateClient}
        onChange={(id) => {
          setClientId(id);
          setError("");
        }}
      />
      <div className="form-row">
        <label className="field">
          Погоджена сума
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10000" />
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
      {currencyLocked && initial && <p className="form-hint">{projectCurrencyLockNote(payments)}</p>}
      {!initial && (
        <>
          <label className="field">
            Отримана передоплата (необов’язково)
            <input
              inputMode="decimal"
              value={prepay}
              onChange={(event) => setPrepay(event.target.value)}
              placeholder={amount ? String(Math.round((amountMinor / 100) * 0.5)) : "0"}
            />
          </label>
          <div className="prepay-summary" aria-live="polite">
            <div className="prepay-line">
              <span>Погоджено</span>
              <strong>{formatMoney(amountMinor, currency)}</strong>
            </div>
            <div className="prepay-line">
              <span>Мінус передоплата</span>
              <strong>−{formatMoney(prepayMinor, currency)}</strong>
            </div>
            <div className="prepay-line total">
              <span>Залишок очікується</span>
              <strong className={remainingMinor > 0 ? "accent" : "positive"}>{formatMoney(remainingMinor, currency)}</strong>
            </div>
          </div>
          {overpay && <WarnNote text={overpay} />}
        </>
      )}
      <div className="form-row">
        <ListPicker label="Статус" title="Статус проєкту" options={statusOptions()} value={status} onChange={setStatus} />
        <label className="field">
          Дедлайн
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
      </div>
      <label className="field">
        Наступна дія
        <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="Наприклад, надіслати макет" />
      </label>
      <label className="field">
        Опис (необов’язково)
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
      </label>
      {error && <WarnNote text={error} />}
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : "Створити проєкт"}
      </button>
    </form>
  );
}

/**
 * Поле клієнта у формі проєкту: пошук за іменем одразу в списку, вибір наявного
 * або швидке створення нового — не виходячи з форми. Об'єднання записів
 * автоматично не робиться: збіг показується як збіг, рішення за людиною.
 */
export function ClientField({
  clients,
  value,
  label = "Клієнт",
  title = "Клієнт проєкту",
  onCreateClient,
  onChange,
}: {
  clients: Client[];
  value: string;
  label?: string;
  title?: string;
  onCreateClient?: (input: ClientInput) => Client;
  onChange: (clientId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState("");
  const labelId = useId();
  const valueId = useId();

  // Вибраний архівований клієнт лишається в списку: інакше поле брехливо
  // показувало б «Без клієнта», хоча зв'язок нікуди не дівся.
  const available = clients.filter((client) => !client.archived || client.id === value);
  const selected = available.find((client) => client.id === value);
  const matches = suggestClients(available, query);
  const exact = findDuplicateClient(available, query);
  const searching = Boolean(query.trim());
  // Ім'я для швидкого створення: зайві пробіли прибираємо, регістр не чіпаємо.
  const createName = query.trim().replace(/\s+/g, " ");
  // «Без клієнта» — не відповідь на пошук: під запитами лишаємо лише збіги,
  // інакше список ніби щось знайшов, хоча людини там немає.
  const options: PickerOption<string>[] = [
    ...(searching ? [] : [{ value: "", label: "Без клієнта", hint: "Можна прив'язати пізніше" }]),
    ...matches.map((client) => ({
      value: client.id,
      label: client.archived ? `${client.name} · архів` : client.name,
      hint: clientHint(client) || undefined,
    })),
  ];

  return (
    <span className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        className="picker-trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          haptic("light");
          setQuery("");
          setOpen(true);
        }}
      >
        <span className={`picker-value ${selected ? "" : "is-placeholder"}`} id={valueId}>
          {selected ? selected.name : "Без клієнта"}
        </span>
        <ChevronDown size={15} className="picker-chevron" aria-hidden="true" />
      </button>
      {createdId && createdId === value && (
        <span className="form-hint">Клієнта створено в довіднику та прив'язано до проєкту.</span>
      )}

      {open && (
        <PickerSheet
          title={title}
          options={options}
          value={value}
          search={{ value: query, onChange: setQuery, placeholder: "Ім’я клієнта…" }}
          empty={
            <p className="card-empty">
              За запитом «{createName}» нікого немає. {onCreateClient ? "Нижче — кнопка створення." : ""}
            </p>
          }
          onSelect={(next) => onChange(next)}
          onClose={() => setOpen(false)}
          footer={
            onCreateClient && (
              <div className="sheet-create">
                {exact && (
                  <p className="form-warn">
                    <CircleAlert size={13} />
                    <span>«{exact.name}» уже є в списку — виберіть його звідси, щоб не заводити другий запис на ту саму людину.</span>
                  </p>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    haptic("light");
                    setCreating(true);
                  }}
                >
                  <Plus size={15} /> Створити {createName ? `«${createName}»` : "клієнта"}
                </button>
              </div>
            )
          }
        />
      )}

      {creating && onCreateClient && (
        <Sheet title="Новий клієнт" variant="form" onClose={() => setCreating(false)}>
          <ClientForm
            variant="quick"
            initialName={createName}
            existing={clients}
            onSubmit={(input) => {
              const client = onCreateClient(input);
              setCreatedId(client.id);
              onChange(client.id);
              setCreating(false);
              setOpen(false);
              setQuery("");
              haptic("success");
            }}
          />
        </Sheet>
      )}
    </span>
  );
}

export type ClientInput = Omit<Client, "id" | "createdAt" | "archived">;

export function ClientForm({
  initial,
  initialName,
  existing = [],
  variant = "full",
  onSubmit,
}: {
  initial?: Client;
  initialName?: string;
  existing?: Client[];
  variant?: "full" | "quick";
  onSubmit: (input: ClientInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? initialName ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [telegram, setTelegram] = useState(initial?.telegram ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [kind, setKind] = useState<string>(initial?.kind ?? "");
  // Записи без типу лишаються без типу, доки людина сама не обере значення:
  // поле виводимо з ладу лише після реальної зміни, а не «автоматом».
  const [kindKnown, setKindKnown] = useState(Boolean(initial?.kind));
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const [askDuplicate, setAskDuplicate] = useState(false);
  const { claim, release } = useSingleSubmit();
  const quick = variant === "quick";

  const clash = findDuplicateClient(existing, name, initial?.id);

  const save = () => {
    // Запис іде лише звідси: і основна кнопка, і «усе одно» проходять через
    // блокування повторного надсилання, тож подвійний тап не створює друга.
    if (!claim()) return;
    setError("");
    try {
      onSubmit({
        name: name.trim(),
        company: quick ? "" : company.trim(),
        phone: phone.trim(),
        telegram: telegram.trim(),
        email: quick ? "" : email.trim(),
        note: quick ? "" : note.trim(),
        kind: isClientKind(kind) ? kind : null,
      });
    } catch (caught) {
      release();
      setError(caught instanceof Error ? caught.message : "Не вдалося зберегти клієнта.");
    }
  };

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) {
          setError("Вкажіть ім’я або назву.");
          return;
        }
        // Збіг імені — не системний confirm(), а дія всередині форми: у WebView
        // Telegram нативний діалог може й не показатися, і створення «не працює».
        if (clash) {
          setAskDuplicate(true);
          return;
        }
        setAskDuplicate(false);
        save();
      }}
    >
      <label className="field">
        Ім’я або назва
        <input
          autoFocus
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setAskDuplicate(false);
          }}
          placeholder="Наприклад, Марія Шевченко"
        />
      </label>
      {quick && (
        <p className="form-hint">
          Обов'язкове лише ім’я. Решту деталей можна доповнити пізніше в розділі «Клієнти».
        </p>
      )}
      {!quick && (
        <label className="field">
          Компанія (необов’язково)
          <input value={company} onChange={(event) => setCompany(event.target.value)} />
        </label>
      )}
      <div className="form-row">
        <label className="field">
          Telegram (необов’язково)
          <input value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="@nickname" />
        </label>
        <label className="field">
          Телефон (необов’язково)
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+380…" />
        </label>
      </div>
      {!quick && (
        <label className="field">
          Email (необов’язково)
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      )}
      {initial && !kindKnown ? (
        <button type="button" className="text-link" onClick={() => setKindKnown(true)}>
          Додати тип клієнта
        </button>
      ) : (
        <ListPicker
          label="Тип клієнта"
          title="Тип клієнта"
          options={clientKindOptions}
          value={kind}
          placeholder="Оберіть тип"
          onChange={(next) => {
            setKind(next);
            setKindKnown(true);
          }}
        />
      )}
      {!quick && (
        <label className="field">
          Нотатки (необов’язково)
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
        </label>
      )}
      {askDuplicate && clash && (
        <div className="form-warn" role="alert">
          <CircleAlert size={13} />
          <span>
            {initial
              ? `Клієнт зі схожим ім'ям уже є: «${clash.name}».`
              : `Схоже, «${clash.name}» уже є в довіднику. Дублікати автоматично не об'єднуються.`}{" "}
            <button type="button" className="text-link" onClick={save}>
              {initial ? "Усе одно зберегти" : "Усе одно створити"}
            </button>
          </span>
        </div>
      )}
      {error && <WarnNote text={error} />}
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : quick ? "Створити й прив'язати" : "Додати клієнта"}
      </button>
    </form>
  );
}

export type ReminderInput = Omit<Reminder, "id" | "createdAt" | "done">;

export function ReminderForm({
  projects,
  clients,
  initial,
  onCreateClient,
  onSubmit,
}: {
  projects: Project[];
  clients: Client[];
  initial?: Reminder;
  onCreateClient?: (input: ClientInput) => Client;
  onSubmit: (input: ReminderInput) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial ? initial.datetime.slice(0, 10) : todayISO());
  const [time, setTime] = useState(initial ? initial.datetime.slice(11, 16) : "09:00");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [error, setError] = useState("");
  const { claim, release } = useSingleSubmit();

  // Різні клієнт і проєкт — підозра, а не заборона: попереджаємо й записуємо.
  const mismatch = reminderLinkMismatch(clients, projects, { clientId, projectId });

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!claim()) return;
        if (!title.trim()) {
          release();
          setError("Вкажіть, що треба зробити.");
          return;
        }
        setError("");
        try {
          onSubmit({ title: title.trim(), datetime: `${date}T${time}`, clientId: clientId || null, projectId: projectId || null });
        } catch (caught) {
          release();
          setError(caught instanceof Error ? caught.message : "Не вдалося зберегти справу.");
        }
      }}
    >
      <label className="field">
        Що зробити
        <input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Наприклад, написати клієнту" />
      </label>
      <div className="form-row">
        <label className="field">
          Дата
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="field">
          Час
          <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <ClientField
        clients={clients}
        value={clientId}
        label="Клієнт (необов’язково)"
        title="Клієнт справи"
        onCreateClient={onCreateClient}
        onChange={setClientId}
      />
      <ListPicker
        label="Проєкт (необов’язково)"
        title="Проєкт справи"
        options={projectPickerOptions(projects, clients)}
        value={projectId}
        placeholder="Без проєкту"
        onChange={setProjectId}
      />
      {mismatch && <WarnNote text={mismatch} />}
      {error && <WarnNote text={error} />}
      <button type="submit" className="button-primary">
        {initial ? "Зберегти зміни" : "Додати справу"}
      </button>
      <p className="form-hint">
        Час — локальний для вашого пристрою. Нагадування в чаті бота з’являться після підключення сервера.
      </p>
    </form>
  );
}
