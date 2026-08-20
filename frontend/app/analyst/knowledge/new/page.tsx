"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Department } from "@/lib/types";

export default function NewArticlePage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Department[]>("/departments").then(setDepartments);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/knowledge/articles", {
        title,
        content,
        department_id: departmentId || null,
        tags: tags ? tags.split(",").map((t) => t.trim()) : null,
      });
      router.push("/analyst");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card mx-auto max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Criar artigo de conhecimento</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Fila relacionada (opcional)</label>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Geral (todas as filas)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Conteúdo</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Tags (separadas por vírgula)</label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Salvando..." : "Publicar artigo"}
        </button>
      </form>
    </div>
  );
}
