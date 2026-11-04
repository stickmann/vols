import { useState } from "react";
import { downloadFile } from "../api/client.js";
import { Button } from "./ui/index.js";

/** Кнопка скачивания документа: показывает загрузку и ошибку. */
export function DownloadButton({
  path,
  filename,
  children,
  variant = "secondary",
  size = "md",
}: {
  path: string;
  filename: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        variant={variant}
        size={size}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await downloadFile(path, filename);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Формируется…" : children}
      </Button>
      {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}
