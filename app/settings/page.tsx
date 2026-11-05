"use client";

import { useState, type FormEvent } from "react";
import { ResetNote } from "@/components/ResetNote";
import { ListPicker, type PickerOption } from "@/components/ListPicker";
import { Toast, useToast } from "@/components/ui";
import { appDisplayName, appVersion } from "@/lib/appInfo";
import { initials, timeZoneChoices } from "@/lib/settings";
import { useSettings } from "@/lib/settingsStore";
import { haptic } from "@/lib/telegram";
import { CURRENCIES } from "@/lib/types";

const timeZoneOptions: (current: string) => PickerOption<string>[] = (current) =>
  timeZoneChoices(current).map((zone) => ({ value: zone, label: zone }));

export default function SettingsPage() {
  const { settings, telegramName, telegramPhotoUrl, setDisplayName, setBaseCurrency, setTimeZone } = useSettings();
  const { toast, notify } = useToast();
  const [name, setName] = useState(settings.displayName);
  const nameChanged = name.trim() !== settings.displayName;

  const submitName = (event: FormEvent) => {
    event.preventDefault();
    if (!nameChanged) return;
    setDisplayName(name);
    setName(name.trim().slice(0, 60));
    haptic("success");
    notify("Ім’я збережено в цьому браузері");
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
          {telegramName || telegramPhotoUrl
            ? "Підказано клієнтом Telegram. Серверна перевірка ще не підключена — це не підтверджений акаунт."
            : "Зберігається локально в цьому браузері."}
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
                onClick={() => {
                  if (settings.baseCurrency === currency) return;
                  setBaseCurrency(currency);
                  haptic("light");
                  notify(`Нова валюта для проєктів: ${currency}`);
                }}
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
            onChange={(zone) => {
              setTimeZone(zone);
              haptic("light");
              notify("Пояс збережено");
            }}
          />
          <p className="form-hint">Впливає лише на показ часу тут. Бот і серверні нагадування ще не підключені, тож доставка від них не залежить.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Про застосунок</h2>
          <span className="app-badge">Демо</span>
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
            <strong>localStorage цього браузера</strong>
          </div>
        </div>
      </section>

      <ResetNote />

      <Toast toast={toast} />
    </div>
  );
}
