"use client";

import { FormEvent } from "react";
import { Pencil, Plus, Save, Settings, Trash2, X } from "lucide-react";

export function EditorHeader({ title, editing }: { title: string; editing: boolean }) {
  return (
    <div className="settings-detail-head">
      <h2>
        <Settings size={21} /> {title}
      </h2>
      <span className="badge">{editing ? "Editando" : "Novo cadastro"}</span>
    </div>
  );
}

export function TextField({
  label,
  required = true,
  type = "text",
  value,
  onChange
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function SelectField({
  allowEmpty = false,
  label,
  value,
  options,
  onChange
}: {
  allowEmpty?: boolean;
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" required={!allowEmpty} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {allowEmpty ? <option value={0}>Sem local</option> : <option value={0} disabled>Selecione</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FormActions({ busy, editing, onCancel }: { busy: boolean; editing: boolean; onCancel: () => void }) {
  return (
    <div className="settings-actions">
      <button className="button" disabled={busy} type="submit">
        {editing ? <Save size={17} /> : <Plus size={17} />}
        {editing ? "Salvar" : "Adicionar"}
      </button>
      {editing ? (
        <button className="button ghost" type="button" onClick={onCancel}>
          <X size={17} />
          Cancelar
        </button>
      ) : null}
    </div>
  );
}

export function RecordList({
  empty,
  items,
  readOnly = false
}: {
  empty: string;
  readOnly?: boolean;
  items: { id: number; title: string; meta: string; badge?: string; onEdit: () => void; onDelete: () => void }[];
}) {
  if (items.length === 0) {
    return <div className="state-box">{empty}</div>;
  }

  return (
    <div className="record-list">
      {items.map((item) => (
        <div className="record-row" key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <span>{item.meta}</span>
          </div>
          {item.badge ? <span className="badge">{item.badge}</span> : null}
          {!readOnly ? (
            <div className="record-actions">
              <button className="icon-action" type="button" onClick={item.onEdit} title="Editar">
                <Pencil size={16} />
              </button>
              <button className="icon-action" type="button" onClick={item.onDelete} title="Excluir">
                <Trash2 size={16} />
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
