import { lazy, type ReactNode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Shell } from "@/components/shell";
import { SiteProvider, useSite } from "@/lib/site";
import { Dashboard } from "@/pages/dashboard";
import { LatencyPage } from "@/pages/latency";
import { LoginPage } from "@/pages/login";
import { ServerPage } from "@/pages/server";
import "@/styles/globals.css";

const Admin = lazy(() => import("@/pages/admin/index").then((m) => ({ default: m.AdminLayout })));

function RequireAdmin({ children }: { children: ReactNode }) {
  const { site } = useSite();
  if (!site) return null;
  if (!site.user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="servers/:id" element={<ServerPage />} />
          <Route path="latency" element={<LatencyPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route
            path="admin/*"
            element={
              <RequireAdmin>
                <Suspense fallback={null}>
                  <Admin />
                </Suspense>
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <SiteProvider>
      <App />
    </SiteProvider>,
  );
}
