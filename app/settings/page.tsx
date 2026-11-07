"use client";

import { useState, type FormEvent } from "react";
import { ResetNote } from "@/components/ResetNote";
import { ListPicker, type PickerOption } from "@/components/ListPicker";
import { Toast, useToast } from "@/components/ui";
import { appDisplayName, appVersion } from "@/lib/appInfo";
import { initials, timeZoneChoices } from "@/lib/settings";
import { useSettings } from "@/lib/settingsStore";
import { hasLocalData, readLocalState, useCrm } from "@/lib/store";
import { haptic } from "@/lib/telegram";
import { pluralClients, pluralPayments, pluralProjects, pluralReminders } from "@/lib/text";
import { CURRENCIES } from "@/lib/types";

const timeZoneOptions: (current: string) => PickerOption<string>[] = (current) =>
  timeZoneChoices(current).map((zone) => ({ value: zone, label: zone }));

// Локальні дані в режимі акаунта: переносити їх у базу й видаляти можна
// лише явно — нічого не відбувається автоматично.
function LocalDataCard() {
  const { serverUser, importLocalData, clearLocalData, refreshFromServer } = useCrm();
  const { toast, notify } = useToast();
  const [phase, setPhase] = useState<"idle" | "confirm-import" | "confirm-clear">("idle");
  const [busy, setBusy] = useState(false);
  const [local] = useState(() => readLocalState());

  if (!local) return null;
  const imported = serverUser?.demoImported ?? false;

  const counts = [
    `${local.clients.length} ${pluralClients(local.clients.length)}`,
    `${local.projects.length} ${pluralProjects(local.projects.length)}`,
    `${local.payments.length} ${pluralPayments(local.payments.length)}`,
    `${local.reminders.length} ${pluralReminders(local.reminders.length)}`,
  ].join(", ");

  const finish = () => setPhase("idle");

  const runImport = async () => {
    setBusy(true);
    try {
      const result = await importLocalData(local);
      haptic("success");
      notify(
        `Перенесено: ${result.clients} ${pluralClients(result.clients)}, ${result.projects} ${pluralProjects(
          result.projects
        )}, ${result.payments} ${pluralPayments(result.payments)}, ${result.reminders} ${pluralReminders(
          result.reminders
        )}`
      );
      await refreshFromServer();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося перенести дані.");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  };

  const runClear = () => {
    clearLocalData();
    haptic("warning");
    notify("Локальні дані видалено з цього пристрою");
    finish();
  };

  return (
    <section className="card reset-card">
      <div className="card-head">
        <h2>Локальні дані цього пристрою</h2>
      </div>
      <p className="reset-text">
        У сховищі браузера залишилися записи поза акаунтом: {counts}. Вони не додані в базу автоматично.
      </p>
      {phase === "confirm-import" ? (
        <>
          <p className="reset-text warn">
            Записи буде додано в акаунт як нові. Локальні дані при цьому залишаться на пристрої — видалити їх можна
            окремо.
          </p>
          <div className="reset-actions">
            <button type="button" className="button-primary" disabled={busy} onClick={runImport}>
              Так, перенести
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={finish}>
              Скасувати
            </button>
          </div>
        </>
      ) : phase === "confirm-clear" ? (
        <>
          <p className="reset-text warn">Зі сховища цього браузера буде видалено: {counts}. Дані в акаунті не зміняться.</p>
          <div className="reset-actions">
            <button type="button" className="button-danger" onClick={runClear}>
              Так, видалити локальні дані
            </button>
            <button type="button" className="button-secondary" onClick={finish}>
              Скасувати
            </button>
          </div>
        </>
      ) : (
        <div className="reset-actions">
          <button
            type="button"
            className="button-primary"
            disabled={imported}
            onClick={() => {
              haptic("light");
              setPhase("confirm-import");
            }}
          >
            {imported ? "Вже перенесено в акаунт" : "Перенести в акаунт"}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              haptic("light");
              setPhase("confirm-clear");
            }}
          >
            Видалити локальні дані
          </button>
        </div>
      )}
      <Toast toast={toast} />
    </section>
  );
}

export default function SettingsPage() {
  const { isDemo, serverUser } = useCrm();
  const { settings, telegramName, telegramPhotoUrl, setDisplayName, setBaseCurrency, setTimeZone } = useSettings();
  const { toast, notify } = useToast();
  const [name, setName] = useState(settings.displayName);
  const nameChanged = name.trim() !== settings.displayName;

  const submitName = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameChanged) return;
    try {
      await setDisplayName(name);
      setName(name.trim().slice(0, 60));
      haptic("success");
      notify(isDemo ? "Ім’я збережено в цьому браузері" : "Ім’я збережено в акаунті");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося зберегти ім’я.");
    }
  };

  const changeCurrency = async (currency: (typeof CURRENCIES)[number]) => {
    if (settings.baseCurrency === currency) return;
    try {
      await setBaseCurrency(currency);
      haptic("light");
      notify(`Нова валюта для проєктів: ${currency}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося зберегти валюту.");
    }
  };

  const changeZone = async (zone: string) => {
    try {
      await setTimeZone(zone);
      haptic("light");
      notify("Пояс збережено");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не вдалося зберегти пояс.");
    }
  };

  return (
    <div className="page-stack">
      <header className="page-head">
        <h1>Налаштування</h1>
      </header>

      <section className="card profile-card">
        <div className="profile-head">
          {telegramPhotoUrl ? (
            // Звичайний <img>, а не next/image: посилання видає клієнт Telegram,
            // і його хости невідомі заздалегідь, тому domain-конфіг не виставити.
            <img className="avatar avatar-photo" src={telegramPhotoUrl} alt="" />
          ) : (
            <span className="avatar avatar-lg" aria-hidden="true">
              {initials(settings.displayName)}
            </span>
          )}
          <form className="profile-name" onSubmit={submitName}>
            <label className="field">
              Ім’я
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ваше ім’я"
                maxLength={60}
                autoComplete="name"
              />
            </label>
            <button type="submit" className="button-primary" disabled={!nameChanged}>
              Зберегти
            </button>
          </form>
        </div>
        <p className="form-hint">
          {isDemo
            ? telegramName || telegramPhotoUrl
              ? "Підказано клієнтом Telegram; зберігається локально в цьому браузері."
              : "Зберігається локально в цьому браузері."
            : "Акаунт підтверджено сервером через Telegram. Дані збережено в базі."}
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Робочі налаштування</h2>
        </div>
        <div className="settings-block">
          <span className="settings-label">Основна валюта</span>
          <div className="chip-row" role="group" aria-label="Основна валюта">
            {CURRENCIES.map((currency) => (
              <button
                type="button"
                key={currency}
                className={`chip ${settings.baseCurrency === currency ? "active" : ""}`}
                aria-pressed={settings.baseCurrency === currency}
                onClick={() => changeCurrency(currency)}
              >
                {currency}
              </button>
            ))}
          </div>
          <p className="form-hint">Підставляється у новий проєкт і змінюється у самій формі. Створені проєкти та оплати лишаються у своїй валюті.</p>
        </div>
        <div className="settings-block">
          <ListPicker
            label="Часовий пояс"
            title="Часовий пояс"
            options={timeZoneOptions(settings.timeZone)}
            value={settings.timeZone}
            onChange={changeZone}
          />
          <p className="form-hint">Впливає лише на показ часу тут. Бот і серверні нагадування ще не підключені, тож доставка від них не залежить.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Про застосунок</h2>
          <span className="app-badge">{isDemo ? "Демо" : "Акаунт"}</span>
        </div>
        <div className="stat-rows">
          <div className="stat-row">
            <span className="stat-currency">Назва</span>
            <strong>{appDisplayName}</strong>
          </div>
          <div className="stat-row">
            <span className="stat-currency">Версія</span>
            <strong>{appVersion}</strong>
          </div>
          <div className="stat-row">
            <span className="stat-currency">Сховище</span>
            <strong>{isDemo ? "localStorage цього браузера" : "База даних QuickStride"}</strong>
          </div>
          {!isDemo && (
            <div className="stat-row">
              <span className="stat-currency">Акаунт</span>
              <strong>{settings.displayName || serverUser?.telegramName || "—"}</strong>
            </div>
          )}
        </div>
      </section>

      {!isDemo && hasLocalData() && <LocalDataCard />}

      {isDemo && <ResetNote />}

      <Toast toast={toast} />
    </div>
  );
}
