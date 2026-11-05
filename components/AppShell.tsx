"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BottomNav } from "./BottomNav";
import { SplashOverlay } from "./SplashOverlay";
import { markPageRevealed } from "@/lib/pageReveal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [splashDone, setSplashDone] = useState(false);
  const onSettings = pathname === "/settings";

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="QuickStride — на головну">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">QuickStride</span>
        </Link>
        <div className="topbar-actions">
          <Link
            href="/settings"
            className={`icon-button ${onSettings ? "is-active" : ""}`}
            aria-label="Налаштування"
            aria-current={onSettings ? "page" : undefined}
          >
            <Settings size={19} />
          </Link>
        </div>
      </header>

      {/* key за шляхом: новий розділ з'являється м'яким зсувом, а не миттєвою заміною */}
      <main className="page" key={pathname}>{children}</main>

      <BottomNav />

      {/* Splash із появою логотипа: тільки при повному завантаженні сторінки.
          Без JS оверлей ховається стилем нижче — застосунок залишається доступним.
          Воронка появи спрацьовує на початку зникнення скла, тому лічба показників
          стартує, коли сторінку вже видно, а не коли оверлей остаточно пішов. */}
      {!splashDone && (
        <SplashOverlay onFadeStart={markPageRevealed} onFinished={() => setSplashDone(true)} />
      )}
      <noscript>
        <style>{".qs-splash{display:none!important}"}</style>
      </noscript>
    </div>
  );
}
