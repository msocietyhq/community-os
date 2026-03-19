import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { authClient } from "../lib/auth-client";
import { PublicHeader } from "../components/public-header";

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, isLoading, refreshSession } = useAuth();
  const navigate = useNavigate();
  const telegramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [user, isLoading, navigate]);

  const telegramLogin = useMutation({
    mutationFn: async (authData: TelegramAuthData) => {
      const result = await authClient.signInWithTelegram(authData);
      if (result.error) {
        const msg =
          result.error.status === 403
            ? "You must register via @msocietybot first. Send /register to the bot."
            : (result.error.message ?? "Telegram sign in failed");
        throw new Error(msg);
      }
      return result.data;
    },
    onSuccess: async () => {
      await refreshSession();
      navigate({ to: "/dashboard" });
    },
  });

  const handleTelegramAuth = useCallback(
    (authData: TelegramAuthData) => {
      telegramLogin.mutate(authData);
    },
    [telegramLogin.mutate],
  );

  useEffect(() => {
    const container = telegramRef.current;
    if (!container) return;

    const win = window as unknown as Record<string, unknown>;
    win.onTelegramAuth = handleTelegramAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", "msocietybot");
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      delete win.onTelegramAuth;
      container.innerHTML = "";
    };
  }, [handleTelegramAuth]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <PublicHeader />

      {/* Login */}
      <div className="flex-1 flex items-center justify-center px-4 pt-16">
        <div className="w-full max-w-md">
          <div className="bg-white/5 border border-white/10 rounded-xl p-8 backdrop-blur-sm">
            <h2 className="text-xl font-semibold text-center mb-2">
              Sign in to MSOCIETY
            </h2>
            <p className="text-gray-400 text-sm text-center mb-8">
              Use your Telegram account to sign in.
            </p>

            {/* Telegram Login Widget */}
            <div
              ref={telegramRef}
              className="flex justify-center mb-6 min-h-[40px]"
            />

            {telegramLogin.isPending && (
              <p className="text-gray-400 text-sm text-center mb-4">
                Signing in...
              </p>
            )}

            {telegramLogin.error && (
              <p className="text-red-400 text-sm text-center mb-4">
                {telegramLogin.error.message}
              </p>
            )}

            <p className="text-gray-500 text-xs text-center">
              New here? Send /register to{" "}
              <a
                href="https://t.me/msocietybot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                @msocietybot
              </a>{" "}
              to set up your profile.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
