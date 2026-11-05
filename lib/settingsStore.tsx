"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { detectTimeZone, readSettings, writeSettings, type Settings } from "./settings";
import { telegramProfile } from "./telegram";
import type { Currency } from "./types";

type SettingsStore = {
  settings: Settings;
  // Підказка з клієнта Telegram: показуємо, доки людина не вказала своє ім'я.
  // Це не підтверджений вхід — серверна перевірка initData ще не підключена.
  telegramName: string;
  telegramPhotoUrl: string;
  setDisplayName: (name: string) => void;
  setBaseCurrency: (currency: Currency) => void;
  setTimeZone: (timeZone: string) => void;
};

const SettingsContext = createContext<SettingsStore | null>(null);

// Стартові значення: збережені налаштування, а замість тих, що людина ще
// не задавала, — те, що бачить пристрій і клієнт Telegram.
function seed(): { settings: Settings; telegramName: string; telegramPhotoUrl: string } {
  const profile = telegramProfile();
  const telegramName = profile?.name ?? "";
  const telegramPhotoUrl = profile?.photoUrl ?? "";
  return {
    settings: readSettings({ displayName: telegramName, baseCurrency: "UAH", timeZone: detectTimeZone() }),
    telegramName,
    telegramPhotoUrl,
  };
}

// Окремо від CRM-стану: свій ключ у localStorage, жодного впливу на проєкти,
// оплати та клієнтів. Скидання демоданих ці налаштування не чіпає.
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [start] = useState(seed);
  const [settings, setSettings] = useState<Settings>(start.settings);

  useEffect(() => {
    writeSettings(settings);
  }, [settings]);

  const setDisplayName = useCallback((name: string) => {
    setSettings((current) => ({ ...current, displayName: name.trim().slice(0, 60) }));
  }, []);

  const setBaseCurrency = useCallback((currency: Currency) => {
    setSettings((current) => ({ ...current, baseCurrency: currency }));
  }, []);

  const setTimeZone = useCallback((timeZone: string) => {
    setSettings((current) => ({ ...current, timeZone }));
  }, []);

  const value = useMemo<SettingsStore>(
    () => ({
      settings,
      telegramName: start.telegramName,
      telegramPhotoUrl: start.telegramPhotoUrl,
      setDisplayName,
      setBaseCurrency,
      setTimeZone,
    }),
    [settings, start.telegramName, start.telegramPhotoUrl, setDisplayName, setBaseCurrency, setTimeZone],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsStore {
  const store = useContext(SettingsContext);
  if (!store) throw new Error("useSettings must be used within SettingsProvider");
  return store;
}
