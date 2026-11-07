"use client";

import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, AtSign, Briefcase, ChevronRight, Mail, Phone, Repeat, Search, UserRound, Users } from "lucide-react";
import { EmptyState, Sheet, StatusPill, Toast, useToast } from "@/components/ui";
import { ClientForm } from "@/components/forms";
import { clientPaidByCurrency, clientProjects, filterClients } from "@/lib/clients";
import { formatMoney } from "@/lib/money";
import { pluralPayments, pluralProjects } from "@/lib/text";
import { projectReceivedMinor, useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import { CLIENT_KINDS, type Client, type ClientKind } from "@/lib/types";

const kindStyle: Record<ClientKind, string> = {
  "Постійний": "is-regular",
  "Непостійний": "is-oneoff",
};

// Фільтр за типом: лише два справжні типи плюс «усі». Записи без ознаки
// (усі старі) лишаються у списку під «усі»; окремим пунктом «не вказано» вони
// не стають, і автоматичного перепризначення не робиться.
const KIND_FILTERS = ["усі", ...CLIENT_KINDS] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

function ClientDetailSheet({ client, onClose }: { client: Client; onClose: () => void }) {
  const { state, updateClient } = useCrm();
  const { toast, notify } = useToast();
  const [editing, setEditing] = useState(false);
  const projects = clientProjects(state, client.id);
  const paid = clientPaidByCurrency(state, client.id);
  const paymentsCount = state.payments.filter((payment) => projects.some((project) => project.id === payment.projectId)).length;

  const archive = () => {
    void updateClient(client.id, { archived: !client.archived })
      .then(() => {
        haptic(client.archived ? "success" : "warning");
        notify(
          client.archived
            ? "Клієнта повернено з архіву"
            : "Клієнта архівовано — проєкти й оплати залишилися",
        );
        onClose();
      })
      .catch((error) => notify(error instanceof Error ? error.message : "Не вдалося змінити клієнта."));
  };

  return (
    <>
      <Sheet title={editing ? "Редагувати клієнта" : client.name} variant={editing ? "form" : "compact"} onClose={onClose}>
        {editing ? (
          <ClientForm
            initial={client}
            existing={state.clients}
            onSubmit={async (input) => {
              await updateClient(client.id, input);
              setEditing(false);
              haptic("success");
              notify("Клієнта оновлено");
            }}
          />
        ) : (
          <div className="client-detail">
            {client.archived && (
              <p className="archived-badge">
                <Archive size={13} /> Клієнт в архіві — проєкти й оплати збережені
              </p>
            )}

            {paid.length > 0 ? (
              <div className="stat-rows paid-block">
                {paid.map((row) => (
                  <div className="stat-row" key={row.currency}>
                    <span className="stat-currency">{row.currency}</span>
                    <strong className="stat-value positive">{formatMoney(row.minor, row.currency)}</strong>
                  </div>
                ))}
                <p className="form-hint">
                  Разом отримано · {paymentsCount} {pluralPayments(paymentsCount)}
                </p>
              </div>
            ) : (
              <p className="card-empty">Оплат від цього клієнта ще не було.</p>
            )}

            <div className="kind-row">
              {client.kind ? (
                <span className={`kind-tag ${kindStyle[client.kind]}`}>
                  {client.kind === "Постійний" ? <Repeat size={12} /> : <UserRound size={12} />}
                  {client.kind}
                </span>
              ) : (
                <small>тип не задано · можна вказати через «Редагувати»</small>
              )}
            </div>

            <div className="fact-rows contacts">
              {client.company && (
                <div className="fact-row">
                  <Briefcase size={14} /> {client.company}
                </div>
              )}
              {client.phone && (
                <div className="fact-row">
                  <Phone size={14} /> {client.phone}
                </div>
              )}
              {client.telegram && (
                <div className="fact-row">
                  <AtSign size={14} /> {client.telegram}
                </div>
              )}
              {client.email && (
                <div className="fact-row">
                  <Mail size={14} /> {client.email}
                </div>
              )}
            </div>

            {client.note && (
              <>
                <h3 className="section-title">Нотатки</h3>
                <p className="detail-desc">{client.note}</p>
              </>
            )}

            <h3 className="section-title">Проєкти · {projects.length}</h3>
            {projects.length > 0 ? (
              <div className="mini-list">
                {projects.map((project) => (
                  <div className="mini-row" key={project.id}>
                    <span className="mini-title">
                      {project.title}
                      <small>
                        {formatMoney(projectReceivedMinor(state, project), project.currency)} з {formatMoney(project.amountMinor, project.currency)}
                      </small>
                    </span>
                    <StatusPill status={project.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="card-empty">Проєктів поки немає.</p>
            )}

            <div className="form-row">
              <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
                <UserRound size={15} /> Редагувати
              </button>
              <button type="button" className="button-secondary" onClick={archive}>
                {client.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                {client.archived ? "Повернути" : "В архів"}
              </button>
            </div>
            {!client.archived && <p className="form-hint">Архівування ховає клієнта зі списку; проєкти й оплати залишаються.</p>}
          </div>
        )}
      </Sheet>
      <Toast toast={toast} />
    </>
  );
}

export default function Clients() {
  const { state, addClient } = useCrm();
  const { toast, notify } = useToast();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("усі");

  const filtered = useMemo(
    () => filterClients(state.clients, { query, archived: showArchived, kind: kindFilter }),
    [state.clients, query, showArchived, kindFilter],
  );

  const archivedCount = state.clients.filter((client) => client.archived).length;
  const openClient = openId ? state.clients.find((client) => client.id === openId) : null;

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Клієнти</h1>
      </header>

      <label className="search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ім’я, компанія, телефон, email…" />
      </label>

      <div className="chip-row" role="group" aria-label="Фільтр за типом клієнта">
        {KIND_FILTERS.map((kind) => (
          <button
            type="button"
            key={kind}
            className={`chip ${kindFilter === kind ? "active" : ""}`}
            aria-pressed={kindFilter === kind}
            onClick={() => setKindFilter(kind)}
          >
            {kind === "усі" ? "Усі типи" : kind}
          </button>
        ))}
      </div>

      <div className="chip-row" role="group" aria-label="Показ клієнтів">
        <button type="button" className={`chip ${!showArchived ? "active" : ""}`} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
          Активні
        </button>
        <button type="button" className={`chip ${showArchived ? "active" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
          Архів{archivedCount > 0 ? ` · ${archivedCount}` : ""}
        </button>
      </div>

      {filtered.length > 0 ? (
        <section className="card">
          <div className="client-list">
            {filtered.map((client) => {
              const projects = clientProjects(state, client.id).filter((project) => project.status !== "Скасований");
              return (
                <button type="button" className="client-row" key={client.id} onClick={() => setOpenId(client.id)}>
                  <span className="avatar" aria-hidden="true">
                    {client.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0]?.toUpperCase() ?? "")
                      .join("")}
                  </span>
                  <span className="project-main">
                    <strong>{client.name}</strong>
                    <small>{client.company || client.email || client.phone || "Без деталей"}</small>
                  </span>
                  <span className="client-side">
                    <small>{projects.length > 0 ? `${projects.length} ${pluralProjects(projects.length)}` : "Без проєктів"}</small>
                    {client.kind && (
                      <span className={`kind-tag small ${kindStyle[client.kind]}`}>
                        {client.kind === "Постійний" ? <Repeat size={11} /> : <UserRound size={11} />}
                        {client.kind}
                      </span>
                    )}
                    {client.archived && (
                      <small className="archived-mark">
                        <Archive size={11} /> архів
                      </small>
                    )}
                  </span>
                  <ChevronRight size={16} className="row-chevron" />
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState
          icon={<Users size={26} />}
          title={query || kindFilter !== "усі" ? "Нікого не знайдено" : showArchived ? "Архів порожний" : "Клієнтів поки немає"}
          hint={
            query || kindFilter !== "усі"
              ? "Спробуйте інший запит або тип."
              : showArchived
                ? "Тут з'являться заархівовані клієнти."
                : "Додайте першого клієнта."
          }
          action={
            !query && !showArchived && kindFilter === "усі" ? (
              <button type="button" className="button-primary" onClick={() => setCreating(true)}>
                Новий клієнт
              </button>
            ) : undefined
          }
        />
      )}

      <button type="button" className="fab" onClick={() => setCreating(true)} aria-label="Новий клієнт">
        <Users size={22} />
      </button>

      {creating && (
        <Sheet title="Новий клієнт" variant="form" onClose={() => setCreating(false)}>
          <ClientForm
            existing={state.clients}
            onSubmit={async (input) => {
              await addClient(input);
              setCreating(false);
              haptic("success");
              notify("Клієнта додано");
            }}
          />
        </Sheet>
      )}

      {openClient && <ClientDetailSheet client={openClient} onClose={() => setOpenId(null)} />}

      <Toast toast={toast} />
    </div>
  );
}
