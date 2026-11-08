// Сборка API для продакшена: TypeScript (вместе с @vols/shared) → JavaScript в dist/.
// Запуск обычным node без компиляции на лету: меньше памяти и быстрее старт.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
// Внешние пакеты ставятся в node_modules; свой @vols/shared собирается внутрь.
const external = Object.keys(pkg.dependencies).filter((d) => d !== "@vols/shared");

await build({
  entryPoints: {
    server: "src/server.ts",
    migrate: "src/scripts/migrate.ts",
    seed: "src/scripts/seed.ts",
    "create-admin": "src/scripts/create-admin.ts",
    "set-plan": "src/scripts/set-plan.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // Отдельные файлы для модулей, загружаемых по требованию (генератор PDF).
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  external: [...external, ...external.map((d) => `${d}/*`)],
  logLevel: "info",
});
