import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AppShell } from "@/components/AppShell";
import { CrmProvider } from "@/lib/store";
import { SettingsProvider } from "@/lib/settingsStore";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuickStride CRM",
  description: "Особиста CRM для фрилансера у форматі Telegram Mini App.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#211D1B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // telegram-web-app.js додає до <html> власні style-змінні ще до гідратації,
    // тому React не має вважати ці атрибути розбіжністю.
    <html lang="uk" suppressHydrationWarning>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <CrmProvider>
          <SettingsProvider>
            <AppShell>{children}</AppShell>
          </SettingsProvider>
        </CrmProvider>
      </body>
    </html>
  );
}
