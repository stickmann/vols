import { createBrowserRouter, Navigate } from "react-router";
import { CableTypeEditorPage } from "./features/cable-types/EditorPage.js";
import { CableTypesListPage } from "./features/cable-types/ListPage.js";
import { AppShell } from "./layout/AppShell.js";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      // Карта (MapLibre ~1 МБ) грузится отдельным чанком, только когда её открыли.
      { path: "map", lazy: async () => ({ Component: (await import("./features/map/MapPage.js")).MapPage }) },
      {
        path: "equipment/:id/splicing",
        lazy: async () => ({ Component: (await import("./features/splicing/SplicingPage.js")).SplicingPage }),
      },
      { path: "documents", lazy: async () => ({ Component: (await import("./features/documents/DocumentsPage.js")).DocumentsPage }) },
      { path: "catalog/cables", element: <CableTypesListPage /> },
      { path: "catalog/cables/new", element: <CableTypeEditorPage /> },
      { path: "catalog/cables/:id", element: <CableTypeEditorPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
