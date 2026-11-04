"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, snapMinor } from "@/lib/money";
import { isPageRevealed, usePageRevealed } from "@/lib/pageReveal";
import type { Currency } from "@/lib/types";

/** Короткий і стриманий темп: 0,52 с на всю лічбу. */
export const FIGURE_MS = 520;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Початок лічби: до появи сторінки й для reduced-motion одразу фактичне значення. */
function openingValue(target: number): number {
  return isPageRevealed() && !prefersReducedMotion() ? 0 : target;
}

/**
 * Лічба лише для відображення: розрахунки й збережені дані не торкається.
 * Стартує, коли сторінку показано (splash почав танути), і триває від
 * попереднього значення, тож перемикання періоду чи валюти йдуть плавно.
 */
export function useAnimatedNumber(target: number, durationMs = FIGURE_MS): number {
  const revealed = usePageRevealed();
  // До показу сторінки — фактичне значення (серверний HTML не має нулів).
  // Елемент, що з'являється вже після показу, стартує з нуля: інакше кінцеве
  // число мелькнуло б один кадр перед лічбою.
  const [display, setDisplay] = useState(() => openingValue(target));
  const shown = useRef(display);
  const started = useRef(false);

  useEffect(() => {
    if (!revealed) return;
    const from = started.current ? shown.current : 0;
    started.current = true;
    const commit = (value: number) => {
      shown.current = value;
      setDisplay(value);
    };
    if (prefersReducedMotion() || from === target) {
      commit(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now: number) {
      // Таймстемп кадру може трохи передути performance.now() — без нижньої
      // межі перший кадр давав би від'ємне значення.
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - (1 - t) ** 3;
      commit(from + (target - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else commit(target);
    });
    commit(from);
    return () => cancelAnimationFrame(frame);
  }, [revealed, target, durationMs]);

  return display;
}

export function AnimatedMoney({
  minor,
  currency,
  duration,
}: {
  minor: number;
  currency: Currency;
  duration?: number;
}) {
  const value = useAnimatedNumber(minor, duration);
  return (
    <>
      <span aria-hidden="true">{formatMoney(snapMinor(value, minor), currency)}</span>
      <span className="sr-only">{formatMoney(minor, currency)}</span>
    </>
  );
}

export function AnimatedCount({ value, duration }: { value: number; duration?: number }) {
  const animated = useAnimatedNumber(value, duration);
  return (
    <>
      <span aria-hidden="true">{Math.round(animated)}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}
