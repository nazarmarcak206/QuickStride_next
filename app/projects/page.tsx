"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CirclePlus,
  Flag,
  Pencil,
  Plus,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { EmptyState, Sheet, StatusPill, Toast, useToast } from "@/components/ui";
import { StatusPicker } from "@/components/StatusPicker";
import { ListPicker } from "@/components/ListPicker";
import { PaymentForm, ProjectForm, paymentTypeOptions, type PaymentInput } from "@/components/forms";
import { formatDay, formatMoney } from "@/lib/money";
import { overpayMinor, overpayNotice, receivedAfterMinor } from "@/lib/payments";
import { createProjectWithPrepayment } from "@/lib/projectCreate";
import { projectOtherCurrencyReceived, projectReceivedMinor, useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import { PROJECT_STATUSES, type Payment, type Project } from "@/lib/types";

function ProjectDetail({ project, onClose }: { project: Project; onClose: () => void }) {
  const { state, addClient, updateProject, addPayment, updatePayment, deletePayment } = useCrm();
  const { toast, notify } = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<string | null>(null);

  const client = state.clients.find((item) => item.id === project.clientId);
  const payments = state.payments
    .filter((payment) => payment.projectId === project.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const otherCurrency = projectOtherCurrencyReceived(state, project);
  const received = projectReceivedMinor(state, project);
  const overpay = overpayMinor(project, received);
  const remaining = Math.max(0, project.amountMinor - received);
  const progress = project.amountMinor > 0 ? Math.min(100, Math.round((received / project.amountMinor) * 100)) : 0;

  const handleAddPayment = (input: PaymentInput) => {
    addPayment({ projectId: project.id, ...input });
    setPayOpen(false);
    haptic("success");
    notify("Оплату записано — фінанси оновлено");
  };

  return (
    <div className="detail-page">
      <header className="detail-head">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Назад">
          <ArrowLeft size={19} />
        </button>
        <h1>Проєкт</h1>
        <button type="button" className="icon-button" onClick={() => setEditOpen(true)} aria-label="Редагувати проєкт">
          <Pencil size={17} />
        </button>
      </header>

      <div className="page-stack">
        <section className="card">
          <div className="detail-title-row">
            <h2>{project.title}</h2>
          </div>
          {client && (
            <p className="detail-client">
              {client.name}
              {client.company ? ` · ${client.company}` : ""}
            </p>
          )}
          <button
            type="button"
            className="status-button"
            onClick={() => setStatusOpen(true)}
            aria-label={`Змінити статус, зараз: ${project.status}`}
          >
            <StatusPill status={project.status} />
            <span className="status-button-hint">
              змінити <ChevronDown size={12} />
            </span>
          </button>
          {project.description && <p className="detail-desc">{project.description}</p>}
          <div className="fact-rows">
            {project.deadline && (
              <div className="fact-row">
                <CalendarDays size={15} /> <span>Дедлайн</span> <strong>{formatDay(project.deadline)}</strong>
              </div>
            )}
            {project.nextAction && (
              <div className="fact-row">
                <Flag size={15} /> <span>Наступна дія</span> <strong>{project.nextAction}</strong>
              </div>
            )}
          </div>
        </section>

        <section className="card finance-summary">
          <div className="summary-grid">
            <div>
              <small>Погоджено</small>
              <strong>{formatMoney(project.amountMinor, project.currency)}</strong>
            </div>
            <div>
              <small>Отримано</small>
              <strong className="positive">{formatMoney(received, project.currency)}</strong>
            </div>
            <div>
              <small>Залишок</small>
              <strong className={remaining > 0 ? "accent" : ""}>{formatMoney(remaining, project.currency)}</strong>
            </div>
          </div>
          {otherCurrency.length > 0 && (
            <p className="foreign-currency">
              <CircleAlert size={13} />
              <span>
                Окремо, в іншій валюті: {otherCurrency.map((row) => formatMoney(row.minor, row.currency)).join(" · ")} — на залишок не впливають.
              </span>
            </p>
          )}
          {overpay > 0 && (
            <p className="overpay-note">
              <CircleAlert size={13} />
              <span>
                Переплата {formatMoney(overpay, project.currency)}: отримано {formatMoney(received, project.currency)} проти погоджених {formatMoney(project.amountMinor, project.currency)}.
              </span>
            </p>
          )}
          <div
            className="pay-progress"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Оплачено ${progress}% погодженої суми`}
          >
            <span className="pay-progress-track">
              <span className="pay-progress-fill" style={{ width: `${progress}%` }} />
            </span>
            <small className="pay-progress-label">{progress}% оплачено</small>
          </div>
          <button type="button" className="button-primary wide" onClick={() => setPayOpen(true)}>
            <Plus size={16} /> Додати оплату
          </button>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Оплати за проєктом</h2>
            <span className="count-bubble small">{payments.length}</span>
          </div>
          {payments.length > 0 ? (
            <div className="payment-list">
              {payments.map((payment) => (
                <div className="payment-row static" key={payment.id}>
                  {editingPayment === payment.id ? (
                    <PaymentInlineEdit
                      payment={payment}
                      project={project}
                      payments={payments}
                      onSave={(amountMinor, date, type) => {
                        updatePayment(payment.id, { amountMinor, date, type });
                        setEditingPayment(null);
                        notify("Оплату оновлено");
                      }}
                      onCancel={() => setEditingPayment(null)}
                      onDelete={() => {
                        if (window.confirm("Видалити цю оплату?")) {
                          deletePayment(payment.id);
                          setEditingPayment(null);
                          notify("Оплату видалено");
                        }
                      }}
                    />
                  ) : (
                    <>
                      <span className="payment-icon">
                        <Wallet size={15} />
                      </span>
                      <span className="payment-main">
                        <strong>
                          {formatMoney(payment.amountMinor, payment.currency)} · <span className="payment-type">{payment.type}</span>
                        </strong>
                        <small>
                          {formatDay(payment.date)}
                          {payment.note ? ` · ${payment.note}` : ""}
                        </small>
                        {payment.currency !== project.currency && (
                          <small className="foreign-currency">
                            оплата в {payment.currency} — не входить до сум у {project.currency}
                          </small>
                        )}
                      </span>
                      <button type="button" className="icon-button" onClick={() => setEditingPayment(payment.id)} aria-label={`Редагувати оплату ${formatMoney(payment.amountMinor, payment.currency)}`}>
                        <Pencil size={15} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-inline">
              <Wallet size={20} />
              <p>Оплат ще не було.</p>
            </div>
          )}
        </section>

        {project.note && (
          <section className="card">
            <h2 className="card-title">Нотатки</h2>
            <p className="detail-desc">{project.note}</p>
          </section>
        )}
      </div>

      {statusOpen && (
        <StatusPicker
          current={project.status}
          onClose={() => setStatusOpen(false)}
          onSelect={(status) => {
            updateProject(project.id, { status });
            haptic("success");
            notify(`Статус: ${status}`);
          }}
        />
      )}

      {payOpen && (
        <Sheet title="Додати оплату" variant="form" onClose={() => setPayOpen(false)}>
          <PaymentForm project={project} payments={payments} onSubmit={handleAddPayment} />
        </Sheet>
      )}

      {editOpen && (
        <Sheet title="Редагувати проєкт" variant="form" onClose={() => setEditOpen(false)}>
          <ProjectForm
            clients={state.clients}
            initial={project}
            payments={payments}
            onCreateClient={addClient}
            onSubmit={({ project: edited }) => {
              updateProject(project.id, edited);
              setEditOpen(false);
              haptic("success");
              notify("Проєкт оновлено");
            }}
          />
        </Sheet>
      )}

      <Toast toast={toast} />
    </div>
  );
}

function PaymentInlineEdit({
  payment,
  project,
  payments,
  onSave,
  onCancel,
  onDelete,
}: {
  payment: Payment;
  project: Project;
  payments: Payment[];
  onSave: (
    amountMinor: number,
    date: string,
    type: PaymentInput["type"]
  ) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [amount, setAmount] = useState(String(payment.amountMinor / 100));
  const [date, setDate] = useState(payment.date);
  const [type, setType] = useState(payment.type as PaymentInput["type"]);

  const enteredMinor = Math.round(
    (Number.parseFloat(amount.replace(",", ".")) || 0) * 100
  );
  // Запис в чужій валюті залишку не зменшує, тому й не через нього переплата.
  const overpay = enteredMinor > 0
    ? overpayNotice(
        project,
        receivedAfterMinor(project, payments, {
          amountMinor: enteredMinor,
          currency: payment.currency,
          replaceId: payment.id,
        })
      )
    : null;

  return (
    <form
      className="inline-edit"
      onSubmit={event => {
        event.preventDefault();
        const amountMinor = Math.round(
          (Number.parseFloat(amount.replace(",", ".")) || 0) * 100
        );
        if (amountMinor > 0) onSave(amountMinor, date, type);
      }}
    >
      <div className="form-row">
        <label className="field">
          Сума, {payment.currency}
          <input
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.target.value)}
          />
        </label>
        <label className="field">
          Дата
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
          />
        </label>
      </div>
      <ListPicker
        label="Тип"
        title="Тип оплати"
        options={paymentTypeOptions}
        value={type}
        onChange={setType}
      />
      {overpay && (
        <p className="form-warn">
          <CircleAlert size={13} />
          <span>{overpay}</span>
        </p>
      )}
      <div className="form-row">
        <button type="button" className="button-danger" onClick={onDelete}>
          <X size={14} /> Видалити
        </button>
        <button type="submit" className="button-primary">
          Зберегти
        </button>
      </div>
    </form>
  );
}

export default function Projects() {
  const { state, addClient, addProject, addPayment } = useCrm();
  const { toast, notify } = useToast();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("Усі");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const clientName = (clientId: string | null) => {
    const client = state.clients.find(item => item.id === clientId);
    return client?.name ?? "";
  };

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return state.projects
      .filter(project =>
        statusFilter === "Усі" ? true : project.status === statusFilter
      )
      .filter(project => {
        if (!value) return true;
        return `${project.title} ${clientName(project.clientId)}`
          .toLowerCase()
          .includes(value);
      })
      .sort((a, b) => {
        const active = (project: Project) =>
          project.status === "Завершений" || project.status === "Скасований"
            ? 1
            : 0;
        return active(a) - active(b) || a.deadline.localeCompare(b.deadline);
      });
  }, [state.projects, state.clients, query, statusFilter]);

  const openProject = openId
    ? state.projects.find(project => project.id === openId)
    : null;

  if (openProject) {
    return (
      <ProjectDetail project={openProject} onClose={() => setOpenId(null)} />
    );
  }

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Проєкти</h1>
      </header>

      <label className="search-box">
        <Search size={16} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Пошук за назвою або клієнтом"
        />
      </label>

      <div className="chip-row scroll-x" role="group" aria-label="Фільтр за статусом">
        {["Усі", ...PROJECT_STATUSES].map(status => (
          <button
            type="button"
            key={status}
            className={`chip ${statusFilter === status ? "active" : ""}`}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="project-list">
          {filtered.map(project => {
            const received = projectReceivedMinor(state, project);
            return (
              <button
                type="button"
                className="project-row"
                key={project.id}
                onClick={() => setOpenId(project.id)}
              >
                <span className="project-main">
                  <strong>{project.title}</strong>
                  <small>
                    {clientName(project.clientId) || "Без клієнта"}
                    {project.deadline
                      ? ` · до ${formatDay(project.deadline)}`
                      : ""}
                  </small>
                </span>
                <span className="project-side">
                  <StatusPill status={project.status} />
                  <small className="project-money">
                    {formatMoney(received, project.currency)} /{" "}
                    {formatMoney(project.amountMinor, project.currency)}
                  </small>
                </span>
                <ChevronRight size={16} className="row-chevron" />
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<CirclePlus size={26} />}
          title={
            query || statusFilter !== "Усі"
              ? "Нічого не знайдено"
              : "Проєктів поки немає"
          }
          hint={
            query || statusFilter !== "Усі"
              ? "Змініть пошук або фільтр."
              : "Створіть перший проєкт, щоб почати облік оплат."
          }
          action={
            !query && statusFilter === "Усі" ? (
              <button
                type="button"
                className="button-primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={15} /> Новий проєкт
              </button>
            ) : undefined
          }
        />
      )}

      <button
        type="button"
        className="fab"
        onClick={() => setCreating(true)}
        aria-label="Новий проєкт"
      >
        <Plus size={22} />
      </button>

      {creating && (
        <Sheet title="Новий проєкт" variant="form" onClose={() => setCreating(false)}>
          <ProjectForm
            clients={state.clients}
            onCreateClient={addClient}
            onSubmit={({ project: input, prepaymentMinor }) => {
              const { payment } = createProjectWithPrepayment({ addProject, addPayment }, input, prepaymentMinor);
              setCreating(false);
              haptic("success");
              notify(payment ? `Проєкт і передоплату ${formatMoney(payment.amountMinor, payment.currency)} записано` : "Проєкт створено");
            }}
          />
        </Sheet>
      )}

      <Toast toast={toast} />
    </div>
  );
}
