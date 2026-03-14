import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "../lib/auth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-8">
              <Link
                to="/dashboard"
                className="text-xl font-bold text-gray-900"
              >
                MSOCIETY
              </Link>
              <div className="hidden sm:flex gap-1">
                <NavLink to="/dashboard">Dashboard</NavLink>
                <NavLink to="/events">Events</NavLink>
                <NavLink to="/projects">Projects</NavLink>
                <NavLink to="/infra">Infra</NavLink>
                <NavLink to="/funds">Funds</NavLink>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user.name}</span>
              <button
                type="button"
                onClick={() => {
                  logout().then(() => navigate({ to: "/" }));
                }}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
      activeProps={{ className: "text-gray-900 bg-gray-100 px-3 py-2 text-sm font-medium rounded-md" }}
    >
      {children}
    </Link>
  );
}
