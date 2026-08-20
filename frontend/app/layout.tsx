import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "BEEP AI Service Desk",
  description: "Central de Atendimento Inteligente para colaboradores da BEEP Saúde.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <Navbar />
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
