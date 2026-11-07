"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, withReauth } from "./api";
import { detectTimeZone, readSettings, writeSettings, type Settings } from "./settings";
import { useCrm } from "./store";
import { telegramProfile } from "./telegram";
import type { Currency } from "./types";

type SettingsStore = {
  settings: Settings;
  // Підказка з підтвердженого акаунта (сервер) або з клієнта Telegram (демо).
  telegramName: string;
  telegramPhotoUrl: string;
  setDisplayName: (name: string) => Promise<void>;
  setBaseCurrency: (currency: Currency) => Promise<void>;
  setTimeZone: (timeZone: string) => Promise<void>;
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

// Окремо від CRM-стану: свій шар. У демо-режимі значення живуть у localStorage,
// у режимі акаунта — у базі, і приходять разом зі знімком стану.
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { mode, serverSettings, serverUser } = useCrm();
  const [start] = useState(seed);
  const [settings, setSettings] = useState<Settings>(start.settings);

  useEffect(() => {
    if (serverSettings) setSettings(serverSettings);
  }, [serverSettings]);

  useEffect(() => {
    if (mode !== "demo") return;
    writeSettings(settings);
  }, [mode, settings]);

  const setDisplayName = useCallback(
    async (name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (mode === "server") await withReauth(() => api.saveSettings({ displayName: trimmed }));
      setSettings((current) => ({ ...current, displayName: trimmed }));
    },
    [mode]
  );

  const setBaseCurrency = useCallback(
    async (currency: Currency) => {
      if (mode === "server") await withReauth(() => api.saveSettings({ baseCurrency: currency }));
      setSettings((current) => ({ ...current, baseCurrency: currency }));
    },
    [mode]
  );

  const setTimeZone = useCallback(
    async (timeZone: string) => {
      if (mode === "server") await withReauth(() => api.saveSettings({ timeZone }));
      setSettings((current) => ({ ...current, timeZone }));
    },
    [mode]
  );

  // У режимі акаунта підказка надходить із перевірених сервером даних.
  const telegramName = mode === "server" ? serverUser?.telegramName ?? "" : start.telegramName;
  const telegramPhotoUrl = mode === "server" ? serverUser?.telegramPhotoUrl ?? "" : start.telegramPhotoUrl;

  const value = useMemo<SettingsStore>(
    () => ({ settings, telegramName, telegramPhotoUrl: telegramPhotoUrl, setDisplayName, setBaseCurrency, setTimeZone }),
    [settings, telegramName, telegramPhotoUrl, setDisplayName, setBaseCurrency, setTimeZone]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsStore {
  const store = useContext(SettingsContext);
  if (!store) throw new Error("useSettings must be used within SettingsProvider");
  return store;
}
