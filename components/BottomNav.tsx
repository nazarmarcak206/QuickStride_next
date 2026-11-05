"use client";

/*
 * Плаваюча нижня навігація QuickStride: скляна панель, у якій активний пункт
 * позначає пігулка-індикатор, що «пливе» між розділами на пружині з легкою
 * деформацією (ефект рідини).
 *
 * Походження коду: пружинний таймлайн (step-відгук демпфованої пружини,
 * response = період undamped пружини в секундах) портований з
 * zanwei/glass-icon-reveal, MIT License — https://github.com/zanwei/glass-icon-reveal
 * (ліцензія перевірена в репозиторії 2026-11-02). Візуал скла — власний CSS
 * (backdrop-filter, світлова грань, тінь) у брендовій графітово-оранжевій
 * палітрі; WebGL не використовується, тому окремий fallback не потрібен.
 * При prefers-reduced-motion пігулка переставляється без анімації.
 */

import { Bell, Briefcase, Home as HomeIcon, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Головна", icon: HomeIcon },
  { href: "/projects", label: "Проєкти", icon: Briefcase },
  { href: "/finance", label: "Фінанси", icon: Wallet },
  { href: "/clients", label: "Клієнти", icon: Users },
  { href: "/reminders", label: "Справи", icon: Bell },
] as const;

/** «/» активний тільки точно; решта — також для майбутніх вкладених роутів */
function activeIndexFor(pathname: string) {
  return NAV_ITEMS.findIndex(({ href }) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`),
  );
}

/** Параметри пружини, портовані з glass-icon-reveal (MIT) */
const SPRING_RESPONSE = 0.42; // період пружини, с
const SPRING_DAMPING = 0.62; // < 1 — м'який overshoot
const MAX_STRETCH = 0.22; // межа деформації пігулки від швидкості
const STRETCH_DIVISOR = 6000; // px/s, що дають повний MAX_STRETCH

export function BottomNav() {
  const pathname = usePathname();
  const activeIndex = activeIndexFor(pathname);

  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const spring = useRef({ x: 0, v: 0, target: 0, raf: 0, last: 0 });
  const reducedMotion = useRef(false);
  const activeIndexRef = useRef<number | null>(null);

  const apply = useCallback(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const { x, v } = spring.current;
    const stretch = Math.min((Math.abs(v) / STRETCH_DIVISOR) * MAX_STRETCH, MAX_STRETCH);
    pill.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scaleX(${(1 + stretch).toFixed(4)}) scaleY(${(1 - stretch * 0.55).toFixed(4)})`;
  }, []);

  const stop = useCallback(() => {
    if (spring.current.raf) {
      cancelAnimationFrame(spring.current.raf);
      spring.current.raf = 0;
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      const s = spring.current;
      const dt = Math.min(0.05, (now - s.last) / 1000) || 1 / 120;
      s.last = now;
      // Класична демпфована пружина (порто з glass-icon-reveal, MIT)
      const w0 = (2 * Math.PI) / SPRING_RESPONSE;
      const acc = -w0 * w0 * (s.x - s.target) - 2 * SPRING_DAMPING * w0 * s.v;
      s.v += acc * dt;
      s.x += s.v * dt;
      if (Math.abs(s.x - s.target) < 0.15 && Math.abs(s.v) < 4) {
        s.x = s.target;
        s.v = 0;
        apply();
        s.raf = 0;
        return;
      }
      apply();
      s.raf = requestAnimationFrame(tick);
    },
    [apply],
  );

  const moveTo = useCallback(
    (x: number, animate: boolean) => {
      const s = spring.current;
      s.target = x;
      if (!animate || reducedMotion.current) {
        stop();
        s.x = x;
        s.v = 0;
        apply();
        return;
      }
      if (!s.raf) {
        s.last = performance.now();
        s.raf = requestAnimationFrame(tick);
      }
    },
    [apply, stop, tick],
  );

  const place = useCallback(
    (index: number, animate: boolean) => {
      const nav = navRef.current;
      const pill = pillRef.current;
      if (!nav || !pill || index < 0) {
        if (nav) nav.classList.toggle("has-active", index >= 0);
        return;
      }
      const item = itemRefs.current[index];
      if (!item) return;
      // offsetParent елементів — сама .bottom-nav (position: fixed)
      pill.style.width = `${item.offsetWidth}px`;
      nav.classList.add("has-active");
      moveTo(item.offsetLeft, animate);
    },
    [moveTo],
  );

  // Монтаж: перше розміщення без анімації до першої фарби + спостерігачі.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeIndexRef.current = activeIndex;
    place(activeIndex, false);

    const remeasure = () => place(activeIndexRef.current ?? -1, true);
    const ro = new ResizeObserver(remeasure);
    ro.observe(nav);
    document.fonts?.ready.then(remeasure).catch(() => {});
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = (e: MediaQueryListEvent) => {
      reducedMotion.current = e.matches;
    };
    mq.addEventListener("change", onMq);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
    // Ефект тільки на монтуванні: активний індекс приходить через activeIndexRef
    // нижче, інакше це переставляло б пігулку миттєво на кожній навігації.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Зміна розділу — пігулка пливе на пружині.
  useEffect(() => {
    if (activeIndexRef.current === null) return; // ще не змонтовано
    if (activeIndexRef.current === activeIndex) return;
    activeIndexRef.current = activeIndex;
    place(activeIndex, true);
  }, [activeIndex, place]);

  useEffect(() => stop, [stop]);

  return (
    <nav ref={navRef} className="bottom-nav" aria-label="Основна навігація">
      <span ref={pillRef} className="bottom-nav-pill" aria-hidden="true" />
      {NAV_ITEMS.map(({ href, label, icon: Icon }, i) => {
        const isActive = i === activeIndex;
        return (
          <Link
            key={href}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            href={href}
            className={`bottom-nav-item ${isActive ? "active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={1.9} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
