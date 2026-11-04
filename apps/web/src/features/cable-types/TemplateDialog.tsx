import { modulesFromTemplate, type FiberColor } from "@vols/shared";
import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Select } from "../../components/ui/index.js";
import { CrossSection } from "./CrossSection.js";
import { MAX_FIBERS_PER_MODULE, MAX_MODULES } from "./editor-state.js";

export interface SchemeOption {
  id: string;
  name: string;
  colors: FiberColor[];
}

export function TemplateDialog({
  open,
  onClose,
  schemes,
  defaultSchemeId,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  schemes: SchemeOption[];
  defaultSchemeId: string;
  onApply: (v: { modulesCount: number; fibersPerModule: number; moduleColors: FiberColor[]; fiberColors: FiberColor[] }) => void;
}) {
  const [modulesCount, setModules] = useState(4);
  const [fibersPerModule, setFibers] = useState(8);
  const [moduleScheme, setModuleScheme] = useState(defaultSchemeId);
  const [fiberScheme, setFiberScheme] = useState(defaultSchemeId);

  useEffect(() => {
    if (open) {
      setModuleScheme((s) => s || defaultSchemeId);
      setFiberScheme((s) => s || defaultSchemeId);
    }
  }, [open, defaultSchemeId]);

  const mc = schemes.find((s) => s.id === moduleScheme)?.colors ?? schemes[0]?.colors ?? [];
  const fc = schemes.find((s) => s.id === fiberScheme)?.colors ?? schemes[0]?.colors ?? [];
  const valid =
    modulesCount >= 1 && modulesCount <= MAX_MODULES && fibersPerModule >= 1 && fibersPerModule <= MAX_FIBERS_PER_MODULE && mc.length > 0;
  const preview = valid ? modulesFromTemplate({ modulesCount, fibersPerModule, moduleColors: mc, fiberColors: fc }) : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Заполнить по шаблону"
      wide
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onApply({ modulesCount, fibersPerModule, moduleColors: mc, fiberColors: fc });
              onClose();
            }}
          >
            Заменить конструкцию
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        Шаблон создаёт одинаковые модули и раскрашивает их по схемам. Текущая конструкция будет заменена, после этого
        любой модуль и волокно можно поправить вручную.
      </p>
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Модулей">
            <Input type="number" min={1} max={MAX_MODULES} value={modulesCount} onChange={(e) => setModules(Number(e.target.value))} />
          </Field>
          <Field label="Волокон в модуле">
            <Input
              type="number"
              min={1}
              max={MAX_FIBERS_PER_MODULE}
              value={fibersPerModule}
              onChange={(e) => setFibers(Number(e.target.value))}
            />
          </Field>
          <Field label="Цвета модулей" className="col-span-2 sm:col-span-1">
            <Select value={moduleScheme} onChange={(e) => setModuleScheme(e.target.value)}>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Цвета волокон" className="col-span-2 sm:col-span-1">
            <Select value={fiberScheme} onChange={(e) => setFiberScheme(e.target.value)}>
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2 text-sm text-slate-600">
            Итого волокон: <b className="tabular-nums">{valid ? modulesCount * fibersPerModule : "—"}</b>
          </div>
        </div>
        <div className="flex justify-center">{valid && <CrossSection modules={preview} />}</div>
      </div>
    </Dialog>
  );
}
