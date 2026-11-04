import { useEffect, useState } from "react";

/** Заглушка: карта и редакторы появятся на следующих этапах. */
export function App() {
  const [api, setApi] = useState<"…" | "ok" | "нет связи">("…");

  useEffect(() => {
    fetch("/health")
      .then((r) => setApi(r.ok ? "ok" : "нет связи"))
      .catch(() => setApi("нет связи"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>ВОЛС — документирование PON-сетей</h1>
      <p>API: {api}</p>
    </main>
  );
}
