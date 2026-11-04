import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api/client.js";
import { DownloadButton } from "../../components/DownloadButton.js";
import { Alert, Input, Select } from "../../components/ui/index.js";
import { EQUIPMENT_KIND_LABELS, STATUS_LABELS } from "../map/style.js";

interface Container {
  id: string;
  kind: string;
  name: string | null;
  status: string;
  modelName: string;
  siteId: string;
  siteName: string | null;
  splices: number;
}

export function DocumentsPage() {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const list = useQuery({
    queryKey: ["equipment", "containers"],
    queryFn: () => api<Container[]>("/equipment?kinds=closure,terminal_box,odf"),
  });
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? []).filter((e) => !q || `${e.name ?? ""} ${e.siteName ?? ""} ${e.modelName}`.toLowerCase().includes(q));
  }, [list.data, query]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">Документы</h1>
        <p className="text-sm text-slate-500">Печатные формы в PDF: кабельный журнал и паспорта муфт, ящиков и кроссов.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">Кабельный журнал</h2>
        <p className="mt-1 mb-3 text-sm text-slate-500">
          Все кабели: начало и конец (место и оборудование), длина по трассе и с запасами, занятые волокна, итоги по маркам.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Статус</span>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48!">
              <option value="">Все</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <DownloadButton variant="primary" path={`/reports/cable-journal.pdf${status ? `?status=${status}` : ""}`} filename="Кабельный журнал.pdf">
            Скачать PDF
          </DownloadButton>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold">Паспорта</h2>
            <p className="text-sm text-slate-500">Сведения о корпусе, заведённые кабели, сплиттеры, сварки по кассетам, транзит, свободные волокна, подписи.</p>
          </div>
          <Input type="search" placeholder="Поиск по названию или месту" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" aria-label="Поиск" />
        </div>
        {list.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
        {list.isError && <Alert>{list.error.message}</Alert>}
        {list.data && rows.length === 0 && <p className="text-sm text-slate-500">{list.data.length ? "Ничего не найдено." : "Муфт, ящиков и кроссов пока нет."}</p>}
        {rows.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.name || EQUIPMENT_KIND_LABELS[e.kind]}</div>
                  <div className="truncate text-xs text-slate-500">
                    {EQUIPMENT_KIND_LABELS[e.kind]} · {e.modelName} · {e.siteName ?? "—"} · сварок {e.splices} · {STATUS_LABELS[e.status as keyof typeof STATUS_LABELS]}
                  </div>
                </div>
                <Link to={`/equipment/${e.id}/splicing`} className="text-sm text-brand-700 hover:underline">
                  Разварка
                </Link>
                <DownloadButton size="sm" path={`/equipment/${e.id}/passport.pdf`} filename="Паспорт.pdf">
                  Паспорт PDF
                </DownloadButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
