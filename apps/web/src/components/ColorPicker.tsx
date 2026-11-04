import type { Color } from "@vols/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { colorLabel } from "../lib/color.js";
import { ColorChip } from "./ColorChip.js";
import { Button, Input, cx } from "./ui/index.js";

/**
 * Выбор цвета: палитра (стандартные цвета + цвета схем оператора),
 * свой цвет (hex и название) и число меток.
 */
export function ColorPicker({
  value,
  palette,
  onChange,
  children,
  disabled,
  align = "left",
}: {
  value: Color;
  palette: { name: string; hex: string }[];
  onChange: (c: Color) => void;
  children: ReactNode;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ name: value.name, hex: value.hex });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCustom({ name: value.name, hex: value.hex });
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, value.name, value.hex]);

  const pick = (c: { name: string; hex: string }) => onChange({ ...c, marks: value.marks });
  const validHex = /^#[0-9a-fA-F]{6}$/.test(custom.hex);

  return (
    <div className="relative inline-block" ref={box}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-default"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={colorLabel(value)}
      >
        {children}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Выбор цвета"
          className={cx(
            "absolute z-30 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="mb-2 text-xs font-medium text-slate-500">Палитра</div>
          <div className="grid grid-cols-8 gap-1.5">
            {palette.map((c) => (
              <button
                type="button"
                key={c.hex + c.name}
                onClick={() => pick(c)}
                className="rounded-full focus-visible:outline-2 focus-visible:outline-brand-500"
                title={c.name}
              >
                <ColorChip color={{ ...c, marks: 0 }} size={24} selected={c.hex.toLowerCase() === value.hex.toLowerCase()} />
              </button>
            ))}
          </div>

          <div className="mt-3 mb-1 text-xs font-medium text-slate-500">Маркировка (кольца/штрихи)</div>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => onChange({ ...value, marks: m })}
                className={cx(
                  "flex h-8 flex-1 items-center justify-center rounded-md border text-sm",
                  value.marks === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                {m === 0 ? "нет" : m}
              </button>
            ))}
          </div>

          <div className="mt-3 mb-1 text-xs font-medium text-slate-500">Свой цвет</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={validHex ? custom.hex : "#000000"}
              onChange={(e) => setCustom((c) => ({ ...c, hex: e.target.value }))}
              className="h-9 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              aria-label="Цвет"
            />
            <Input
              value={custom.name}
              onChange={(e) => setCustom((c) => ({ ...c, name: e.target.value }))}
              placeholder="Название"
              aria-label="Название цвета"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            className="mt-2 w-full"
            disabled={!validHex || !custom.name.trim()}
            onClick={() => {
              onChange({ name: custom.name.trim(), hex: custom.hex, marks: value.marks });
              setOpen(false);
            }}
          >
            Применить свой цвет
          </Button>
        </div>
      )}
    </div>
  );
}
