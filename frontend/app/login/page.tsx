"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { loginWithToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSsoLogin() {
    setLoading(true);
    setError(null);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>("/auth/login");
      window.location.href = authorize_url;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="card text-center">
        <h1 className="text-xl font-semibold">Entrar no BEEP AI Service Desk</h1>
        <p className="mt-2 text-sm text-slate-500">
          Use o SSO corporativo (Keycloak / Azure AD) para acessar com sua conta BEEP.
        </p>
        <button onClick={handleSsoLogin} disabled={loading} className="btn-primary mt-6 w-full">
          {loading ? "Redirecionando..." : "Entrar com SSO corporativo"}
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
