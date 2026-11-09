import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...rest}
    />
  );
});

const control =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm shadow-xs placeholder:text-slate-400 " +
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(control, "h-9", className)} {...rest} />;
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(control, "h-9 pr-8", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, "py-2", className)} {...rest} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" | "green" | "brand" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "slate" && "bg-slate-100 text-slate-700",
        tone === "amber" && "bg-amber-100 text-amber-800",
        tone === "green" && "bg-emerald-100 text-emerald-800",
        tone === "brand" && "bg-brand-100 text-brand-700",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "warning" | "info" | "success"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error" && "border-red-200 bg-red-50 text-red-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "info" && "border-brand-100 bg-brand-50 text-brand-700",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      {children}
    </div>
  );
}

/** Модальное окно на нативном <dialog>: фокус, Esc и фон — силами браузера. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
