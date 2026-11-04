"use client"

/*
 * Splash-екран QuickStride: знак «Q» проявляється крізь рідке скло при повному
 * завантаженні сторінки. Монтується один раз на рівні layout, тому при переходах
 * між розділами (клієнтська навігація) не відтворюється.
 *
 * Ефект — адаптація liquid-glass-logo-reveal; шейдер і пружинний таймлайн
 * портовані з zanwei/glass-icon-reveal (MIT, див. GlassLogoReveal.tsx).
 *
 * Гарантії завершення: оверлей завжди зникає — за таймаутами анімації або
 * статичного режиму, плюс жорсткий лімит 3 с; без JavaScript його ховає
 * <noscript>-стиль у AppShell. Оверлей має pointer-events: none, тому роботу
 * застосунку не блокує взагалі.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { GlassLogoReveal } from "./GlassLogoReveal";

const MARK_Q = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="47" cy="47" r="30" fill="none" stroke="currentColor" stroke-width="13"/><line x1="67" y1="67" x2="83" y2="83" stroke="currentColor" stroke-width="13" stroke-linecap="round"/></svg>`;

/** Тривалості в мс: скло відпускає знак на ~1.25 с, потім оверлей тане */
const PLAY_MS = 1650;
const STATIC_MS = 900;
const HARD_CAP_MS = 3000;
const FADE_MS = 450;

type Phase = "play" | "fade";

export function SplashOverlay({
  onFinished,
  onFadeStart,
}: {
  onFinished: () => void;
  /** Оверлей почав танути — сторінку видно, анімації показників можна запускати. */
  onFadeStart?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("play");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(false);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const fadeRef = useRef(onFadeStart);
  fadeRef.current = onFadeStart;

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    fadeRef.current?.();
    setPhase("fade");
    timers.current.push(setTimeout(() => finishedRef.current(), FADE_MS));
  }, []);

  const schedule = useCallback((ms: number) => {
    timers.current.push(setTimeout(finish, ms));
  }, [finish]);

  useEffect(() => {
    timers.current.push(setTimeout(finish, HARD_CAP_MS)); // жорсткий лімит на будь-який випадок
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [finish]);

  return (
    <div className="qs-splash" data-phase={phase} aria-hidden="true">
      <GlassLogoReveal
        style={{ position: "absolute", inset: 0 }}
        logo={MARK_Q}
        label="QuickStride"
        loop={false}
        speed={1}
        hold={0.3}
        tileSize={230}
        logoScale={0.55}
        finalScale={0.78}
        logoColor="#FF7A2F"
        // Кольори єдиної фірмової теми: теплий графітовий фон і світліша пластинка-підкладка
        look="dark"
        background="#211D1B"
        plateColor="#2C2622"
        tuning={{ glide: 1.0, present: 1.25, response: 0.4, lightTurn: 0.6 }}
        onPlayStart={() => schedule(PLAY_MS)}
        onStatic={() => schedule(STATIC_MS)}
      />
    </div>
  );
}
