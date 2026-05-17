"use client";

import { FormEvent } from "react";
import type { Local } from "@/lib/types";
import { EditorHeader, FormActions, RecordList, TextField } from "@/components/configuracoes/EditorParts";

type LocalForm = Omit<Local, "id">;

export function LocalEditor(props: {
  busy: boolean;
  canManage: boolean;
  editingId: number | null;
  form: LocalForm;
  locais: Local[];
  setForm: (form: LocalForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onEdit: (local: Local) => void;
  onDelete: (id: number) => void;
}) {
  if (!props.canManage) {
    return (
      <>
        <EditorHeader title="Locais" editing={false} />
        <div className="state-box">Seu perfil permite consultar locais, mas não alterar cadastros.</div>
        <RecordList
          readOnly
          empty="Nenhum local cadastrado."
          items={props.locais.map((local) => ({
            id: local.id,
            title: local.nome,
            meta: local.codigo,
            onEdit: () => props.onEdit(local),
            onDelete: () => props.onDelete(local.id)
          }))}
        />
      </>
    );
  }

  return (
    <>
      <EditorHeader title="Locais" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Nome" value={props.form.nome} onChange={(nome) => props.setForm({ ...props.form, nome })} />
        <TextField label="Código" value={props.form.codigo} onChange={(codigo) => props.setForm({ ...props.form, codigo })} />
        <FormActions busy={props.busy} editing={Boolean(props.editingId)} onCancel={props.onCancel} />
      </form>
      <RecordList
        readOnly={!props.canManage}
        empty="Nenhum local cadastrado."
        items={props.locais.map((local) => ({
          id: local.id,
          title: local.nome,
          meta: local.codigo,
          onEdit: () => props.onEdit(local),
          onDelete: () => props.onDelete(local.id)
        }))}
      />
    </>
  );
}
