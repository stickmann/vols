import { createBrowserRouter, Navigate } from "react-router";
import { CableTypeEditorPage } from "./features/cable-types/EditorPage.js";
import { CableTypesListPage } from "./features/cable-types/ListPage.js";
import { AppShell } from "./layout/AppShell.js";
import { MapPlaceholder } from "./pages/MapPlaceholder.js";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/catalog/cables" replace /> },
      { path: "map", element: <MapPlaceholder /> },
      { path: "catalog/cables", element: <CableTypesListPage /> },
      { path: "catalog/cables/new", element: <CableTypeEditorPage /> },
      { path: "catalog/cables/:id", element: <CableTypeEditorPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
