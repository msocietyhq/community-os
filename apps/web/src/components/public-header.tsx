import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "../lib/auth";

export function PublicHeader({
  transparent = false,
}: {
  transparent?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isFloating = transparent && !scrolled;

  const initials = (user?.name ?? "")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        isFloating ? "bg-transparent" : "bg-gray-950/80 backdrop-blur-xl border-b border-white/5"
      }`}
    >
      <div
        className={`mx-auto h-16 flex items-center justify-between transition-all duration-500 ${
          isFloating
            ? "max-w-5xl mt-4 px-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md"
            : "max-w-7xl px-4 sm:px-6 lg:px-8"
        }`}
      >
        <Link to="/" className="font-semibold tracking-tight text-white">
          MSOCIETY
        </Link>

        <div className="flex items-center gap-6">
          <Link
            to="/events"
            className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors"
          >
            Events
          </Link>
          <Link
            to="/projects"
            className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors"
          >
            Projects
          </Link>
          {!isLoading && user && (
            <Link
              to="/dashboard"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 transition-all"
            >
              Dashboard
            </Link>
          )}
          {!isLoading && user?.telegramUsername && (
            <Link
              to="/member/$username"
              params={{ username: user.telegramUsername }}
              title="Your profile"
              aria-label="Your profile"
              className="shrink-0 rounded-full ring-1 ring-white/15 hover:ring-white/40 transition-all"
            >
              {user.image ? (
                <img
                  src={user.image}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/40 to-indigo-500/40 flex items-center justify-center">
                  <span className="text-xs font-semibold text-white/80">
                    {initials}
                  </span>
                </div>
              )}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
