"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/lib/auth-context";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/tickets", label: "Meus chamados" },
  { href: "/analyst", label: "Fila do analista", roles: ["analyst", "department_lead", "admin"] },
  { href: "/dashboard", label: "Dashboard", roles: ["department_lead", "admin"] },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand-700">
          <span className="rounded-md bg-brand-500 px-2 py-1 text-sm text-white">BEEP</span>
          AI Service Desk
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.filter((link) => !link.roles || (user && link.roles.includes(user.role))).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "rounded-md px-3 py-2 text-sm font-medium",
                pathname === link.href ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          {user ? (
            <>
              <span>{user.name}</span>
              <button onClick={logout} className="btn-secondary">
                Sair
              </button>
            </>
          ) : (
            <Link href="/login" className="btn-primary">
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
