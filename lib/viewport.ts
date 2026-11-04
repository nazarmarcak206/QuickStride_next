import { useEffect, useState } from "react";

// Клавіатура на iOS (Safari й Telegram WebView) не зменшує layout viewport:
// `position: fixed` лишається приліпленим до екрана під клавіатурою, тому
// нижній лист і кнопка збереження стають недосяжними. Єдине надійне джерело
// справжньої видимої висоти — visualViewport. Android і desktop навпаки:
// там клавіатура зменшує саме layout viewport, тож offset виходить 0.
export type ViewportBox = { height: number; top: number; keyboard: number };

// Поле з 44px і підказками — менше вважаємо панорамою сторінки, а не клавіатурою.
const MIN_KEYBOARD_PX = 80;

export function readViewport(): ViewportBox {
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, top: 0, keyboard: 0 };
  const keyboard = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  return {
    height: Math.round(vv.height),
    top: Math.round(vv.offsetTop),
    keyboard: keyboard > MIN_KEYBOARD_PX ? keyboard : 0,
  };
}

// Один спостерігач на весь застосунок: листові та будь-які інші фіксовані
// панелі читають результат із CSS-змінних на <html>.
export function watchViewport(onChange: (box: ViewportBox) => void): () => void {
  const vv = window.visualViewport;
  const emit = () => onChange(readViewport());
  emit();
  if (!vv) {
    window.addEventListener("resize", emit);
    return () => window.removeEventListener("resize", emit);
  }
  vv.addEventListener("resize", emit);
  vv.addEventListener("scroll", emit);
  return () => {
    vv.removeEventListener("resize", emit);
    vv.removeEventListener("scroll", emit);
  };
}

export function applyViewportToDocument(box: ViewportBox): void {
  const root = document.documentElement;
  root.style.setProperty("--vv-h", `${box.height}px`);
  root.style.setProperty("--vv-top", `${box.top}px`);
  if (box.keyboard > 0) root.dataset.keyboardOpen = "true";
  else delete root.dataset.keyboardOpen;
}

export function clearViewportOverrides(): void {
  const root = document.documentElement;
  root.style.removeProperty("--vv-h");
  root.style.removeProperty("--vv-top");
  delete root.dataset.keyboardOpen;
}

/**
 * Активний, лише поки відкритий лист: підписка на visualViewport у спокійному
 * стані зайва, а при закритті змінні повертаються до CSS-значень за замовчуванням.
 */
export function useFollowViewport(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);

  useEffect(() => {
    if (!active) return;
    return watchViewport((next) => {
      applyViewportToDocument(next);
      setBox(next);
    });
  }, [active]);

  useEffect(() => {
    if (active) return;
    clearViewportOverrides();
  }, [active]);

  return box;
}
