"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BottomNav } from "./BottomNav";
import { ResetNote } from "./ResetNote";
import { SplashOverlay } from "./SplashOverlay";
import { markPageRevealed } from "@/lib/pageReveal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Меню — disclosure: Esc і клік поза ним закривають, фокус повертається до кнопки.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.body.dataset.sheetOpen) return;
      event.preventDefault();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="QuickStride — на головну">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">QuickStride</span>
        </Link>
        <div className="topbar-actions">
          <button
            ref={triggerRef}
            type="button"
            className="icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Ще"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <Settings size={19} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="more-menu" ref={menuRef}>
          <ResetNote onDone={() => setMenuOpen(false)} />
        </div>
      )}

      {/* key за шляхом: новий розділ з'являється м'яким зсувом, а не миттєвою заміною */}
      <main className="page" key={pathname}>{children}</main>

      <BottomNav onNavigate={() => setMenuOpen(false)} />

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
