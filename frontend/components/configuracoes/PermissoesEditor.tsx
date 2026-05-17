"use client";

import type { UserPermissions } from "@/lib/types";
import { EditorHeader } from "@/components/configuracoes/EditorParts";

export function PermissoesEditor(props: { busy: boolean; permissoes: UserPermissions; onChange: (permissoes: UserPermissions) => void }) {
  const items: { key: keyof UserPermissions; label: string }[] = [
    { key: "gerenciar_cadastros", label: "Gerenciar cadastros" },
    { key: "acionar_leitores", label: "Acionar leitores" },
    { key: "executar_auditoria", label: "Executar auditoria" },
    { key: "resolver_inconsistencias", label: "Resolver inconsistências" },
    { key: "ver_logs", label: "Ver log operacional" }
  ];

  return (
    <>
      <EditorHeader title="Permissões do Técnico" editing={false} />
      <div className="record-list">
        {items.map((item) => (
          <label className="record-row" key={item.key}>
            <div>
              <strong>{item.label}</strong>
              <span>{props.permissoes[item.key] ? "Liberado" : "Bloqueado"}</span>
            </div>
            <input
              checked={Boolean(props.permissoes[item.key])}
              disabled={props.busy}
              type="checkbox"
              onChange={(event) => props.onChange({ ...props.permissoes, [item.key]: event.target.checked })}
            />
          </label>
        ))}
      </div>
    </>
  );
}
