"use client";

import { FormEvent } from "react";
import { compactRfidTag } from "@/lib/display";
import type { ItemPatrimonial, Local } from "@/lib/types";
import { EditorHeader, FormActions, RecordList, SelectField, TextField } from "@/components/configuracoes/EditorParts";

type ItemForm = Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">;

export function ItemEditor(props: {
  busy: boolean;
  canManage: boolean;
  editingId: number | null;
  form: ItemForm;
  itens: ItemPatrimonial[];
  locais: Local[];
  setForm: (form: ItemForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onEdit: (item: ItemPatrimonial) => void;
  onDelete: (id: number) => void;
}) {
  const localOptions = props.locais.map((local) => ({ value: local.id, label: local.nome }));

  if (!props.canManage) {
    return (
      <>
        <EditorHeader title="Itens" editing={false} />
        <div className="state-box">Seu perfil permite consultar itens, mas não alterar cadastros.</div>
        <RecordList
          readOnly
          empty="Nenhum item cadastrado."
          items={props.itens.map((item) => ({
            id: item.id,
            title: item.nome,
            meta: `${compactRfidTag(item.tag_id)} - lógico: ${item.local_logico_nome || "-"} - físico: ${item.local_fisico_nome || "-"}`,
            badge: item.ativo ? "Ativo" : "Inativo",
            onEdit: () => props.onEdit(item),
            onDelete: () => props.onDelete(item.id)
          }))}
        />
      </>
    );
  }

  return (
    <>
      <EditorHeader title="Itens" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Nome" value={props.form.nome} onChange={(nome) => props.setForm({ ...props.form, nome })} />
        <TextField label="Tag RFID" value={props.form.tag_id} onChange={(tag_id) => props.setForm({ ...props.form, tag_id })} />
        <SelectField
          allowEmpty
          label="Local lógico"
          value={props.form.local_logico_id || 0}
          onChange={(local_logico_id) => props.setForm({ ...props.form, local_logico_id: local_logico_id || null })}
          options={localOptions}
        />
        <SelectField
          allowEmpty
          label="Local físico"
          value={props.form.local_fisico_id || 0}
          onChange={(local_fisico_id) => props.setForm({ ...props.form, local_fisico_id: local_fisico_id || null })}
          options={localOptions}
        />
        <label className="check-field">
          <input
            checked={props.form.ativo}
            type="checkbox"
            onChange={(event) => props.setForm({ ...props.form, ativo: event.target.checked })}
          />
          <span>Item ativo</span>
        </label>
        <FormActions busy={props.busy} editing={Boolean(props.editingId)} onCancel={props.onCancel} />
      </form>
      <RecordList
        readOnly={!props.canManage}
        empty="Nenhum item cadastrado."
        items={props.itens.map((item) => ({
          id: item.id,
          title: item.nome,
          meta: `${compactRfidTag(item.tag_id)} · lógico: ${item.local_logico_nome || "-"} · físico: ${item.local_fisico_nome || "-"}`,
          badge: item.ativo ? "Ativo" : "Inativo",
          onEdit: () => props.onEdit(item),
          onDelete: () => props.onDelete(item.id)
        }))}
      />
    </>
  );
}
