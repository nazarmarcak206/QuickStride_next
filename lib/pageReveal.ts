"use client";

import { useEffect, useState } from "react";

/*
 * Splash ховає сторінку на ~1.7 с, тому анімації показників стартують не від
 * монтування, а від сигналу «сторінку показано». Без JavaScript застосунок
 * усе одно лишається на «Завантаження…», тож початково прихований стан
 * графіків нешкідливий.
 */

let revealed = false;
const listeners = new Set<() => void>();

/** Викликається рівнем layout, коли splash завершено (або його не було). */
export function markPageRevealed(): void {
  if (revealed) return;
  revealed = true;
  document.body.dataset.pageRevealed = "true";
  for (const listener of [...listeners]) listener();
  listeners.clear();
}

export function isPageRevealed(): boolean {
  return revealed;
}

/** true одразу, якщо сторінку вже показано; інакше — після завершення splash. */
export function usePageRevealed(): boolean {
  const [value, setValue] = useState(revealed);
  useEffect(() => {
    if (value) return;
    // Splash міг завершитися між рендером і цим ефектом.
    if (revealed) {
      setValue(true);
      return;
    }
    const listener = () => setValue(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [value]);
  return value;
}
