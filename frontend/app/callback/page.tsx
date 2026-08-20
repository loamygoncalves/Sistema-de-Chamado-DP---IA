"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const { loginWithToken } = useAuth();

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return;

    api
      .get<{ access_token: string; refresh_token: string }>(
        `/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
      )
      .then(async ({ access_token, refresh_token }) => {
        await loginWithToken(access_token, refresh_token);
        router.replace("/");
      });
  }, [params, router, loginWithToken]);

  return <p className="mt-16 text-center text-slate-500">Concluindo login...</p>;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<p className="mt-16 text-center text-slate-500">Concluindo login...</p>}>
      <CallbackHandler />
    </Suspense>
  );
}
