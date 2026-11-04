"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Sheet } from "./ui";
import { haptic } from "@/lib/telegram";

export type PickerOption<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
  swatch?: React.ReactNode;
};

export type PickerSearch = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

/**
 * Нижній лист вибору за зразком статусу проєкту: великі варіанти, aria-selected
 * для поточного, клавіатура — стрілки/Home/End і пошук за першою літерою, Esc — закриття.
 * `search` додає поле живого пошуку: тоді перший фокус лишається в ньому,
 * а стрілка вниз переводить його на варіанти.
 */
export function PickerSheet<T extends string>({
  title,
  options,
  value,
  empty,
  footer,
  search,
  onSelect,
  onClose,
}: {
  title: string;
  options: PickerOption<T>[];
  value?: T | "";
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  search?: PickerSearch;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const skipFirstOptionFocus = useRef(Boolean(search));
  const [active, setActive] = useState(() => {
    const index = options.findIndex((option) => option.value === value);
    return index >= 0 ? index : 0;
  });

  // Фокус на поточному варіанті: лист одразу читається з клавіатури.
  // Перший рендер із полем пошуку пропускаємо — інакше пошук втратить фокус.
  useEffect(() => {
    if (skipFirstOptionFocus.current) {
      skipFirstOptionFocus.current = false;
      return;
    }
    optionRefs.current[active]?.focus();
  }, [active]);

  const move = (next: number) => {
    if (options.length === 0) return;
    const clamped = (next + options.length) % options.length;
    setActive(clamped);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        move(active + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        move(active - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(options.length - 1);
        break;
      default: {
        // Пошук за першою літерою: варіант стає активним циклічно.
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
        const letter = event.key.toLowerCase();
        for (let offset = 1; offset <= options.length; offset += 1) {
          const candidate = (active + offset) % options.length;
          if (options[candidate].label.toLowerCase().startsWith(letter)) {
            event.preventDefault();
            setActive(candidate);
            return;
          }
        }
      }
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {search && (
        <label className="search-box sheet-search">
          <Search size={16} />
          <input
            autoFocus
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder ?? "Пошук…"}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              optionRefs.current[0]?.focus();
            }}
          />
        </label>
      )}
      {options.length === 0 ? (
        empty ?? <p className="card-empty">Немає чого обрати.</p>
      ) : (
        <div className="status-picker" role="listbox" aria-label={title} onKeyDown={onKeyDown}>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                type="button"
                role="option"
                key={option.value}
                aria-selected={selected}
                data-value={option.value}
                className={`status-option ${selected ? "selected" : ""}`}
                tabIndex={index === active ? 0 : -1}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                onFocus={() => setActive(index)}
                onClick={() => {
                  if (!selected) haptic("light");
                  if (!selected) onSelect(option.value);
                  onClose();
                }}
              >
                {option.swatch && (
                  <span className="picker-swatch" aria-hidden="true">
                    {option.swatch}
                  </span>
                )}
                <span className="status-option-main">
                  <strong>{option.label}</strong>
                  {option.hint && <small>{option.hint}</small>}
                </span>
                <span className="status-option-check" aria-hidden="true">
                  {selected && <Check size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {footer}
    </Sheet>
  );
}

/**
 * Поле вибору у формі: системний <select> замінено на фірмовий нижній лист.
 * Зовні виглядає як решта полів, всередині — PickerSheet.
 */
export function ListPicker<T extends string>({
  label,
  title,
  options,
  value,
  placeholder,
  onChange,
  empty,
  disabled,
}: {
  label: string;
  title?: string;
  options: PickerOption<T>[];
  value: T | "";
  placeholder?: string;
  onChange: (value: T) => void;
  empty?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  // Ім'я кнопки = підпис поля + поточне значення, щоб скринрідер озвучив
  // «Валюта: UAH», а не просто «UAH».
  const labelId = useId();
  const valueId = useId();

  return (
    <span className="field">
      <span className="field-label" id={labelId}>{label}</span>
      <button
        type="button"
        className={`picker-trigger ${disabled ? "is-disabled" : ""}`}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          haptic("light");
          setOpen(true);
        }}
      >
        <span className={`picker-value ${selected ? "" : "is-placeholder"}`} id={valueId}>
          {selected ? selected.label : (placeholder ?? "Оберіть…")}
        </span>
        {!disabled && <ChevronDown size={15} className="picker-chevron" aria-hidden="true" />}
      </button>

      {open && (
        <PickerSheet
          title={title ?? label}
          options={options}
          value={value}
          empty={empty}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}
