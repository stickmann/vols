import { createBrowserRouter, Navigate } from "react-router";
import { CableTypeEditorPage } from "./features/cable-types/EditorPage.js";
import { CableTypesListPage } from "./features/cable-types/ListPage.js";
import { AppShell } from "./layout/AppShell.js";

export const router = createBrowserRouter([
  // Без входа: вход, приглашение, смена пароля по ссылке.
  { path: "login", lazy: async () => ({ Component: (await import("./features/auth/LoginPage.js")).LoginPage }) },
  { path: "signup", lazy: async () => ({ Component: (await import("./features/auth/SignupPage.js")).SignupPage }) },
  { path: "invite/:token", lazy: async () => ({ Component: (await import("./features/auth/TokenPages.js")).InvitePage }) },
  { path: "forgot", lazy: async () => ({ Component: (await import("./features/auth/TokenPages.js")).ForgotPage }) },
  { path: "verify/:token", lazy: async () => ({ Component: (await import("./features/auth/TokenPages.js")).VerifyPage }) },
  { path: "reset/:token", lazy: async () => ({ Component: (await import("./features/auth/TokenPages.js")).ResetPage }) },
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
      { path: "profile", lazy: async () => ({ Component: (await import("./features/auth/ProfilePage.js")).ProfilePage }) },
      { path: "settings/users", lazy: async () => ({ Component: (await import("./features/auth/UsersPage.js")).UsersPage }) },
      { path: "trash", lazy: async () => ({ Component: (await import("./features/trash/TrashPage.js")).TrashPage }) },
      { path: "catalog/cables", element: <CableTypesListPage /> },
      { path: "catalog/cables/new", element: <CableTypeEditorPage /> },
      { path: "catalog/cables/:id", element: <CableTypeEditorPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
