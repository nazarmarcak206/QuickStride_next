"use client";

import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, AtSign, Briefcase, ChevronRight, Mail, Phone, Search, UserRound, Users } from "lucide-react";
import { EmptyState, Sheet, StatusPill, Toast, useToast } from "@/components/ui";
import { ClientForm } from "@/components/forms";
import { clientPaidByCurrency, clientProjects, clientSearchText, findDuplicateClient } from "@/lib/clients";
import { formatMoney } from "@/lib/money";
import { projectReceivedMinor, useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import type { Client } from "@/lib/types";

function ClientDetailSheet({ client, onClose }: { client: Client; onClose: () => void }) {
  const { state, updateClient } = useCrm();
  const { toast, notify } = useToast();
  const [editing, setEditing] = useState(false);
  const projects = clientProjects(state, client.id);
  const paid = clientPaidByCurrency(state, client.id);
  const paymentsCount = state.payments.filter((payment) => projects.some((project) => project.id === payment.projectId)).length;

  const archive = () => {
    updateClient(client.id, { archived: !client.archived });
    haptic(client.archived ? "success" : "warning");
    notify(
      client.archived
        ? "Клієнта повернено з архіву"
        : "Клієнта архівовано — проєкти й оплати залишилися",
    );
    onClose();
  };

  return (
    <>
      <Sheet title={client.name} onClose={onClose}>
        {editing ? (
          <ClientForm
            initial={client}
            onSubmit={(input) => {
              const duplicate = findDuplicateClient(state.clients, input.name, client.id);
              if (duplicate && !window.confirm(`Клієнт зі схожим ім'ям уже є: «${duplicate.name}». Все одно зберегти?`)) return;
              updateClient(client.id, input);
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
                <p className="form-hint">Отримано за всіма проєктами клієнта · {paymentsCount} {paymentsCount === 1 ? "оплата" : "оплат"}</p>
              </div>
            ) : (
              <p className="card-empty">Оплат від цього клієнта ще не було.</p>
            )}

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
              <p className="card-empty">Проєктів із цим клієнтом поки немає — створіть їх у розділі «Проєкти».</p>
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
            {!client.archived && <p className="form-hint">Архівування сховає клієнта зі списку активних, але його проєкти й оплати залишаться.</p>}
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

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return state.clients
      .filter((client) => (showArchived ? client.archived : !client.archived))
      .filter((client) => !value || clientSearchText(client).includes(value))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [state.clients, query, showArchived]);

  const archivedCount = state.clients.filter((client) => client.archived).length;
  const openClient = openId ? state.clients.find((client) => client.id === openId) : null;

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Клієнти</h1>
        <p className="page-sub">Контакти, проєкти й оплата — усе поруч.</p>
      </header>

      <label className="search-box">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ім’я, компанія, телефон, email…" />
      </label>

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
                    <small>{projects.length > 0 ? `${projects.length} ${projects.length === 1 ? "проєкт" : projects.length < 5 ? "проєкти" : "проєктів"}` : "Новий"}</small>
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
          title={query ? "Нікого не знайдено" : showArchived ? "Архів порожний" : "Клієнтів поки немає"}
          hint={
            query
              ? "Спробуйте інший запит — пошук працює за ім'ям, компанією, телефоном і email."
              : showArchived
                ? "Заархівовані клієнти з'являться тут. Їхні проєкти й оплати зберігаються."
                : "Додайте першого клієнта — проєкти й оплати будуть прив'язуватися до нього."
          }
          action={
            !query && !showArchived ? (
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
        <Sheet title="Новий клієнт" onClose={() => setCreating(false)}>
          <ClientForm
            onSubmit={(input) => {
              const duplicate = findDuplicateClient(state.clients, input.name);
              if (duplicate && !window.confirm(`Схоже, «${duplicate.name}» уже є в базі. Дублікати не об'єднуються автоматично. Все одно додати?`)) return;
              addClient(input);
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
