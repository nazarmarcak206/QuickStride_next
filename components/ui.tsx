"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Стек відкритих шіток: Esc закриває лише верхню, а блокування скролу
 * знімається тільки коли закрито останню (лишток може відкритися поверх).
 */
const sheetStack: (() => void)[] = [];
let lockedSheets = 0;

function lockScroll() {
  lockedSheets += 1;
  if (lockedSheets === 1) {
    document.body.dataset.sheetOpen = "true";
  }
}

function unlockScroll() {
  lockedSheets = Math.max(0, lockedSheets - 1);
  if (lockedSheets === 0) {
    delete document.body.dataset.sheetOpen;
  }
}

export type ToastHandle = { id: number; message: string };

export function useToast(): {
  toast: ToastHandle;
  notify: (message: string) => void;
} {
  const [toast, setToast] = useState<ToastHandle>({ id: 0, message: "" });
  // id зростає на кожен виклик, тож однакові повідомлення поспіль
  // перечитуються заново, а не ігноруються старим таймером.
  const notify = useCallback((message: string) => {
    setToast((current) => ({ id: current.id + 1, message }));
  }, []);
  return { toast, notify };
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  // Фокус-повернення ловимо під час першого рендера: ефекти дітей (автофокус
  // на опції) працюють раніше за ефект шітки, тож у useEffect там уже опція.
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null && typeof document !== "undefined") {
    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }
  // Стабільний dismiss: інакше ефект перереєструється на кожен ререндер
  // батька (onClose — це inline-стрілка) і захопить хибний «opener».
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const dismiss = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    sheetStack.push(dismiss);
    lockScroll();
    const opener = openerRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sheetStack[sheetStack.length - 1] === dismiss) {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab" || sheetStack[sheetStack.length - 1] !== dismiss) return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!sheet.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      const index = sheetStack.indexOf(dismiss);
      if (index >= 0) sheetStack.splice(index, 1);
      unlockScroll();
      window.removeEventListener("keydown", onKeyDown);
      // Повертаємо фокус на наступному тіку і лише коли його ніхто не
      // перехопив: відразу після видалення DOM браузер ще тримає фокус на
      // відрізаній кнопці, а відкрита наступна шітка встигає сфокусуватись сама.
      setTimeout(() => {
        const active = document.activeElement;
        const stranded =
          active === null ||
          active === document.body ||
          active === document.documentElement ||
          active.isConnected === false;
        if (stranded && opener && opener.isConnected && typeof opener.focus === "function") {
          opener.focus({ preventScroll: true });
        }
      }, 0);
    };
  }, [dismiss]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
    >
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={dismiss}
            aria-label="Закрити"
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{hint}</p>
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const key: Record<string, string> = {
    Новий: "pill-new",
    Обговорення: "pill-talk",
    "У роботі": "pill-active",
    "Очікує клієнта": "pill-waiting",
    Завершений: "pill-done",
    Скасований: "pill-cancelled",
  };
  return (
    <span className={`status-pill ${key[status] ?? "pill-new"}`}>{status}</span>
  );
}

const TOAST_LEAVE_MS = 2200;
const TOAST_HIDE_MS = 2440;

export function Toast({ toast }: { toast: ToastHandle }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!toast.message) return;
    setVisible(true);
    setLeaving(false);
    const leave = setTimeout(() => setLeaving(true), TOAST_LEAVE_MS);
    const hide = setTimeout(() => setVisible(false), TOAST_HIDE_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(hide);
    };
  }, [toast.id, toast.message]);

  // Живий регіон завжди в DOM — нове повідомлення озвучується без перемонтування.
  return (
    <div aria-live="polite" role="status">
      {visible && (
        <div className={`toast ${leaving ? "is-leaving" : ""}`}>{toast.message}</div>
      )}
    </div>
  );
}
