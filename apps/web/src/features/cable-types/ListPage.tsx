import { useCan } from "../auth/api.js";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useCableTypes, useDeleteCableType, type CableTypeListItem } from "../../api/catalog.js";
import { ColorChip } from "../../components/ColorChip.js";
import { Alert, Badge, Button, Dialog, Input, Select } from "../../components/ui/index.js";
import { describeConstruction } from "./editor-state.js";
import { LibraryDialog } from "./LibraryDialog.js";
import { CONSTRUCTION_LABELS } from "./labels.js";

export function CableTypesListPage() {
  const canEdit = useCan("designer");
  const navigate = useNavigate();
  const list = useCableTypes();
  const del = useDeleteCableType();
  const [query, setQuery] = useState("");
  const [construction, setConstruction] = useState("");
  const [toDelete, setToDelete] = useState<CableTypeListItem | null>(null);
  const [library, setLibrary] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? []).filter(
      (t) =>
        (!construction || t.construction === construction) &&
        (!q || t.name.toLowerCase().includes(q) || (t.fiberStandard ?? "").toLowerCase().includes(q)),
    );
  }, [list.data, query, construction]);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-1 text-sm text-slate-500">Справочники</div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Типы кабелей</h1>
          <p className="text-sm text-slate-500">Марки кабелей с конструкцией: модули, волокна и их цвета.</p>
        </div>
        {canEdit && (
          <>
            <Button onClick={() => setLibrary(true)}>Из каталога производителей</Button>
            <Button variant="primary" onClick={() => navigate("/catalog/cables/new")}>
              + Новый тип
            </Button>
          </>
        )}
      </div>
      <LibraryDialog open={library} onClose={() => setLibrary(false)} />

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,20rem)_minmax(0,14rem)]">
        <Input
          type="search"
          placeholder="Поиск по названию или типу волокна"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск"
        />
        <Select value={construction} onChange={(e) => setConstruction(e.target.value)} aria-label="Назначение">
          <option value="">Любое назначение</option>
          {Object.entries(CONSTRUCTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {list.isPending && <div className="text-sm text-slate-500">Загрузка…</div>}
      {list.isError && <Alert>{list.error.message}</Alert>}
      {del.isError && (
        <div className="mb-3">
          <Alert>{del.error.message}</Alert>
        </div>
      )}

      {list.data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          {list.data.length === 0 ? "Справочник пуст. Создайте первый тип кабеля." : "Ничего не найдено."}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 hover:bg-slate-50 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 md:w-72">
                <Link to={`/catalog/cables/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                  {t.name}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>{CONSTRUCTION_LABELS[t.construction]}</span>
                  {t.fiberStandard && <span>· {t.fiberStandard}</span>}
                  {t.inUse && <Badge tone="brand">используется</Badge>}
                </div>
              </div>
              <div className="text-sm md:w-44">
                <span className="font-semibold tabular-nums">{t.fiberCount}</span>{" "}
                <span className="text-slate-500">вол. · {describeConstruction(t.modules)}</span>
              </div>
              <ModuleStrip modules={t.modules} />
              {canEdit && (
                <div className="flex gap-1 md:ml-auto">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/catalog/cables/new?copy=${t.id}`)}>
                    Копировать
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={t.inUse}
                    title={t.inUse ? "Тип используется в проложенных кабелях" : undefined}
                    onClick={() => setToDelete(t)}
                  >
                    Удалить
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Удалить тип кабеля?"
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Отмена</Button>
            <Button
              variant="danger"
              disabled={del.isPending}
              onClick={() => toDelete && del.mutate(toDelete.id, { onSettled: () => setToDelete(null) })}
            >
              Удалить
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          «{toDelete?.name}» будет удалён из справочника. Кабели этого типа не проложены, на сеть это не повлияет.
        </p>
      </Dialog>
    </div>
  );
}

function ModuleStrip({ modules }: { modules: CableTypeListItem["modules"] }) {
  const max = 12;
  return (
    <div className="flex items-center gap-0.5" aria-label="Цвета модулей">
      {modules.slice(0, max).map((m, i) => (
        <ColorChip key={i} color={m} size={16} title={`Модуль ${i + 1}: ${m.name}, волокон ${m.fiberCount}`} />
      ))}
      {modules.length > max && <span className="ml-1 text-xs text-slate-500">+{modules.length - max}</span>}
    </div>
  );
}
