import { cableTypeInputSchema, STANDARD_COLORS, totalFibers, type FiberColor } from "@vols/shared";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useCableType, useColorSchemes, useSaveCableType, type ColorSchemeRow } from "../../api/catalog.js";
import { ApiError } from "../../api/client.js";
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from "../../components/ui/index.js";
import { CrossSection } from "./CrossSection.js";
import {
  describeConstruction,
  draftFromInput,
  draftToInput,
  MAX_MODULES,
  newDraft,
  reducer,
  type Draft,
} from "./editor-state.js";
import { FiberTable } from "./FiberTable.js";
import { CONSTRUCTION_LABELS, FIBER_STANDARDS } from "./labels.js";
import { ModuleCard } from "./ModuleCard.js";
import { TemplateDialog } from "./TemplateDialog.js";

/** Страница создания, редактирования и копирования типа кабеля. */
export function CableTypeEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const copyFrom = id ? null : search.get("copy");
  const sourceId = id ?? copyFrom ?? undefined;

  const source = useCableType(sourceId);
  const schemes = useColorSchemes();

  if ((sourceId && source.isPending) || schemes.isPending) {
    return <PageFrame title="Загрузка…" />;
  }
  if (source.isError || schemes.isError) {
    return (
      <PageFrame title="Тип кабеля">
        <Alert>{(source.error ?? schemes.error)?.message ?? "Не удалось загрузить данные"}</Alert>
      </PageFrame>
    );
  }

  const schemeList = schemes.data ?? [];
  const defaultScheme = schemeList.find((s) => s.name.startsWith("Отечественная")) ?? schemeList[0];
  const fallback = Object.values(STANDARD_COLORS);

  let initial: Draft;
  if (source.data) {
    initial = draftFromInput(source.data);
    if (copyFrom) initial.name = `${source.data.name} (копия)`;
  } else {
    initial = newDraft(defaultScheme?.colors ?? fallback);
  }

  return (
    <Editor
      key={sourceId ?? "new"}
      id={id}
      initial={initial}
      locked={!!id && !!source.data?.inUse}
      schemes={schemeList}
      defaultSchemeId={defaultScheme?.id ?? ""}
    />
  );
}

function PageFrame({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <Breadcrumbs />
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

function Breadcrumbs() {
  return (
    <nav className="mb-1 text-sm text-slate-500" aria-label="Навигация">
      <span>Справочники</span> <span aria-hidden>›</span>{" "}
      <Link to="/catalog/cables" className="hover:text-slate-800 hover:underline">
        Типы кабелей
      </Link>
    </nav>
  );
}

function Editor({
  id,
  initial,
  locked,
  schemes,
  defaultSchemeId,
}: {
  id?: string;
  initial: Draft;
  locked: boolean;
  schemes: ColorSchemeRow[];
  defaultSchemeId: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const save = useSaveCableType();
  const [draft, dispatch] = useReducer(reducer, initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [selected, setSelected] = useState<number | null>(null);
  const [moduleSchemeId, setModuleSchemeId] = useState(defaultSchemeId);
  const [fiberSchemeId, setFiberSchemeId] = useState(defaultSchemeId);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(() =>
    (location.state as { savedAt?: number } | null)?.savedAt ?? null,
  );

  const dirty = JSON.stringify(draft) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const fallback = useMemo(() => Object.values(STANDARD_COLORS), []);
  const schemeColors = (sid: string): FiberColor[] => schemes.find((s) => s.id === sid)?.colors ?? fallback;
  const moduleColors = schemeColors(moduleSchemeId);
  const fiberColors = schemeColors(fiberSchemeId);

  // Палитра: стандартные цвета и все цвета схем оператора без повторов.
  const palette = useMemo(() => {
    const seen = new Set<string>();
    return [...fallback, ...schemes.flatMap((s) => s.colors)].filter((c) => {
      const k = `${c.hex.toLowerCase()}|${c.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [schemes, fallback]);

  // Защита от потери несохранённых правок.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (dirty) setSavedAt(null);
  }, [dirty]);

  const total = totalFibers(draft.modules);
  let firstFiber = 1;
  const starts = draft.modules.map((m) => {
    const s = firstFiber;
    firstFiber += m.fibers.length;
    return s;
  });

  const onSave = () => {
    setNameError(undefined);
    setFormErrors([]);
    const parsed = cableTypeInputSchema.safeParse(draftToInput(draft));
    if (!parsed.success) {
      const other: string[] = [];
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "name") setNameError(draft.name.trim() ? issue.message : "Укажите название");
        else other.push(issue.message);
      }
      setFormErrors(other);
      return;
    }
    save.mutate(
      { id, input: parsed.data },
      {
        onSuccess: (saved) => {
          setBaseline(JSON.stringify(draft));
          dirtyRef.current = false;
          setSavedAt(Date.now());
          if (!id) navigate(`/catalog/cables/${saved.id}`, { replace: true, state: { savedAt: Date.now() } });
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) setNameError("Тип кабеля с таким названием уже есть");
          else setFormErrors([e.message]);
        },
      },
    );
  };

  const selectModule = (i: number) => {
    setSelected(i);
    document.getElementById(`module-${i}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const title = id ? draft.name || "Тип кабеля" : "Новый тип кабеля";

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Breadcrumbs />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{title}</h1>
          {savedAt && !dirty && <span className="text-sm text-emerald-700">Сохранено</span>}
          {dirty && <span className="text-sm text-slate-500">Есть несохранённые изменения</span>}
          <Button onClick={() => navigate("/catalog/cables")}>{dirty ? "Отмена" : "К списку"}</Button>
          <Button variant="primary" onClick={onSave} disabled={save.isPending || (!!id && !dirty)}>
            {save.isPending ? "Сохранение…" : id ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {locked && (
          <Alert tone="warning">
            По этому типу уже проложены кабели. Состав модулей и число волокон менять нельзя — можно менять названия,
            параметры и цвета. Для другой конструкции создайте копию типа.
          </Alert>
        )}
        {formErrors.length > 0 && (
          <Alert>
            {formErrors.length === 1 ? (
              formErrors[0]
            ) : (
              <ul className="list-disc pl-4">
                {formErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-base font-semibold">Основное</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Название (марка)" error={nameError} className="sm:col-span-2">
                <Input
                  value={draft.name}
                  onChange={(e) => dispatch({ type: "field", key: "name", value: e.target.value })}
                  placeholder="Например, ОКСН-0,22-8 (1×8)"
                  autoFocus={!id}
                  aria-invalid={!!nameError}
                />
              </Field>
              <Field label="Назначение">
                <Select
                  value={draft.construction}
                  onChange={(e) => dispatch({ type: "field", key: "construction", value: e.target.value as Draft["construction"] })}
                >
                  {Object.entries(CONSTRUCTION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Тип волокна">
                <Input
                  list="fiber-standards"
                  value={draft.fiberStandard}
                  onChange={(e) => dispatch({ type: "field", key: "fiberStandard", value: e.target.value })}
                  placeholder="G.652D"
                />
                <datalist id="fiber-standards">
                  {FIBER_STANDARDS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Затухание 1310 нм, дБ/км">
                <NumberInput
                  value={draft.attenuation1310DbKm}
                  step={0.01}
                  onChange={(v) => dispatch({ type: "field", key: "attenuation1310DbKm", value: v ?? 0 })}
                />
              </Field>
              <Field label="Затухание 1550 нм, дБ/км">
                <NumberInput
                  value={draft.attenuation1550DbKm}
                  step={0.01}
                  onChange={(v) => dispatch({ type: "field", key: "attenuation1550DbKm", value: v ?? 0 })}
                />
              </Field>
              <Field label="Наружный диаметр, мм" hint="Необязательно">
                <NumberInput
                  value={draft.outerDiameterMm}
                  step={0.1}
                  onChange={(v) => dispatch({ type: "field", key: "outerDiameterMm", value: v })}
                />
              </Field>
              <Field label="Примечание" className="sm:col-span-2">
                <Textarea
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => dispatch({ type: "field", key: "notes", value: e.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-base font-semibold">Модули и волокна</h2>
              <Button size="sm" onClick={() => setTemplateOpen(true)} disabled={locked}>
                Заполнить по шаблону
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={locked || draft.modules.length >= MAX_MODULES}
                onClick={() => {
                  const last = draft.modules[draft.modules.length - 1];
                  dispatch({ type: "addModule", fibers: last?.fibers.length || 8, moduleColors, fiberColors });
                  setSelected(draft.modules.length);
                }}
              >
                + Модуль
              </Button>
            </div>

            <div className="mb-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
              <Field label="Цвета новых модулей" hint={<SchemeHint onApply={() => dispatch({ type: "recolorModules", moduleColors })}>Перекрасить все модули</SchemeHint>}>
                <SchemeSelect schemes={schemes} value={moduleSchemeId} onChange={setModuleSchemeId} />
              </Field>
              <Field label="Цвета новых волокон" hint="«По схеме» в модуле перекрашивает его волокна">
                <SchemeSelect schemes={schemes} value={fiberSchemeId} onChange={setFiberSchemeId} />
              </Field>
            </div>

            <div className="space-y-2">
              {draft.modules.map((m, i) => (
                <ModuleCard
                  key={i}
                  module={m}
                  index={i}
                  total={draft.modules.length}
                  firstFiber={starts[i]!}
                  palette={palette}
                  locked={locked}
                  selected={selected === i}
                  onSelect={() => setSelected(i)}
                  onColor={(color) => dispatch({ type: "moduleColor", index: i, color })}
                  onFiberColor={(fiber, color) => dispatch({ type: "fiberColor", module: i, fiber, color })}
                  onFiberCount={(count) => dispatch({ type: "fiberCount", index: i, count, fiberColors })}
                  onRecolorFibers={() => dispatch({ type: "recolorFibers", index: i, fiberColors })}
                  onMove={(delta) => {
                    dispatch({ type: "moveModule", index: i, delta });
                    setSelected(i + delta);
                  }}
                  onDuplicate={() => {
                    dispatch({ type: "duplicateModule", index: i });
                    setSelected(i + 1);
                  }}
                  onRemove={() => {
                    dispatch({ type: "removeModule", index: i });
                    setSelected(null);
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="order-first lg:order-none">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-28">
            <div className="flex justify-center">
              <CrossSection modules={draft.modules} selected={selected} onSelect={selectModule} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-center">
              <Stat label="Модулей" value={draft.modules.length} />
              <Stat label="Волокон" value={total} />
              <div className="col-span-2 rounded-lg bg-slate-50 px-2 py-2">
                <dt className="text-xs text-slate-500">Конструкция</dt>
                <dd className="mt-0.5 text-sm font-semibold">{describeConstruction(draft.modules)}</dd>
              </div>
            </dl>
            <div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
                {showTable ? "Скрыть таблицу волокон" : "Таблица волокон"}
              </Button>
              {showTable && (
                <div className="mt-2">
                  <FiberTable modules={draft.modules} />
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <TemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        schemes={schemes}
        defaultSchemeId={moduleSchemeId}
        onApply={(v) => {
          dispatch({ type: "template", ...v });
          setSelected(null);
        }}
      />

      <Dialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Уйти без сохранения?"
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>Остаться</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Уйти
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Изменения в типе кабеля не сохранены и будут потеряны.</p>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SchemeSelect({ schemes, value, onChange }: { schemes: ColorSchemeRow[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {schemes.length === 0 && <option value="">Стандартная палитра</option>}
      {schemes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

function SchemeHint({ onApply, children }: { onApply: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="text-brand-600 hover:underline" onClick={(e) => (e.preventDefault(), onApply())}>
      {children}
    </button>
  );
}

/** Числовое поле, которое не мешает вводить «0,» и пустое значение. */
function NumberInput({ value, onChange, step }: { value: number | null; onChange: (v: number | null) => void; step?: number }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
    if (parsed !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      step={step}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") return onChange(null);
        const n = Number(t.replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
