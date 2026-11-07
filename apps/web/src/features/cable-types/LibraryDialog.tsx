import { cableLibrary, MANUFACTURERS, type CableLibraryItem } from "@vols/shared";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useCableTypes, useSaveCableType } from "../../api/catalog.js";
import { ColorChip } from "../../components/ColorChip.js";
import { Alert, Badge, Button, cx, Dialog, Input, Select } from "../../components/ui/index.js";
import { CrossSection } from "./CrossSection.js";
import { CONSTRUCTION_LABELS } from "./labels.js";

/** Выбор марки из библиотеки производителей и добавление в справочник оператора. */
export function LibraryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveCableType();
  const existing = useCableTypes();
  const [maker, setMaker] = useState("");
  const [query, setQuery] = useState("");
  const [fibers, setFibers] = useState("");
  const [picked, setPicked] = useState<CableLibraryItem | null>(null);

  const all = cableLibrary();
  const counts = useMemo(() => [...new Set(all.map((i) => i.fibers))].sort((a, b) => a - b), [all]);
  const makers = useMemo(() => [...new Map(all.map((i) => [i.manufacturerKey, i.manufacturer])).entries()], [all]);
  const have = useMemo(() => new Set((existing.data ?? []).map((t) => t.name)), [existing.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (i) =>
        (!maker || i.manufacturerKey === maker) &&
        (!fibers || i.fibers === Number(fibers)) &&
        (!q || `${i.name} ${i.manufacturer} ${i.mark} ${i.description}`.toLowerCase().includes(q)),
    );
  }, [all, maker, fibers, query]);

  const profile = picked ? MANUFACTURERS.find((m) => m.key === picked.manufacturerKey) : undefined;

  const add = () => {
    if (!picked) return;
    save.mutate(
      { input: picked.input },
      { onSuccess: (t) => navigate(`/catalog/cables/${t.id}`, { state: { savedAt: Date.now() } }) },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Каталог марок производителей"
      wide
      footer={
        <>
          <Button onClick={onClose}>Закрыть</Button>
          <Button variant="primary" disabled={!picked || save.isPending || (picked && have.has(picked.name))} onClick={add}>
            {picked && have.has(picked.name) ? "Уже в справочнике" : "Добавить в справочник"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Типовые конструкции по правилам окраски производителей из открытых источников. После добавления марку можно
        поправить. Перед разваркой сверьте цвета с паспортом барабана: производители меняют их по заказу.
      </p>
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_8rem]">
        <Input type="search" placeholder="Марка или производитель" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск марки" />
        <Select value={maker} onChange={(e) => setMaker(e.target.value)} aria-label="Производитель">
          <option value="">Все производители</option>
          {makers.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={fibers} onChange={(e) => setFibers(e.target.value)} aria-label="Волокон">
          <option value="">Любая ёмкость</option>
          {counts.map((n) => (
            <option key={n} value={n}>
              {n} вол.
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
        <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" aria-label="Марки">
          {rows.length === 0 && <li className="p-3 text-sm text-slate-500">Ничего не найдено</li>}
          {rows.map((i) => {
            const active = picked?.id === i.id;
            return (
              <li key={i.id}>
                <button
                  className={cx("w-full px-3 py-2 text-left hover:bg-slate-50", active && "bg-brand-50")}
                  onClick={() => setPicked(i)}
                  aria-pressed={active}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.name}</span>
                    {have.has(i.name) && <Badge tone="green">есть</Badge>}
                    <span className="flex shrink-0 gap-0.5" aria-hidden>
                      {i.input.modules.slice(0, 6).map((m, k) => (
                        <ColorChip key={k} color={m.color} size={12} />
                      ))}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {i.manufacturer} · {i.description} · {i.layout}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="space-y-3 text-sm">
          {!picked && <p className="text-slate-500">Выберите марку, чтобы увидеть конструкцию.</p>}
          {picked && profile && (
            <>
              <div>
                <div className="font-medium">{picked.name}</div>
                <div className="text-xs text-slate-500">
                  {CONSTRUCTION_LABELS[picked.input.construction]} · {picked.fibers} вол. · {picked.input.fiberStandard}
                </div>
              </div>
              <div className="flex justify-center">
                <CrossSection modules={picked.input.modules} />
              </div>
              {picked.confidence === "partial" && (
                <Alert tone="warning">Часть правил окраски не подтверждена первоисточником — обязательно сверьте с паспортом.</Alert>
              )}
              <dl className="space-y-1.5 text-xs text-slate-600">
                <div>
                  <dt className="font-medium text-slate-700">Модули</dt>
                  <dd>{profile.moduleRule}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-700">Волокна</dt>
                  <dd>{profile.fiberRule}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-700">Источники</dt>
                  <dd>
                    {profile.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block truncate text-brand-700 underline">
                        {s.title}
                      </a>
                    ))}
                  </dd>
                </div>
              </dl>
            </>
          )}
          {save.isError && <Alert>{save.error.message}</Alert>}
        </div>
      </div>
    </Dialog>
  );
}
