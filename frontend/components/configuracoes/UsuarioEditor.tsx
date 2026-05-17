"use client";

import { FormEvent } from "react";
import type { Usuario } from "@/lib/types";
import { EditorHeader, FormActions, RecordList, TextField } from "@/components/configuracoes/EditorParts";

type UserForm = Pick<Usuario, "username" | "first_name" | "last_name" | "email" | "is_active" | "is_staff"> & { password: string };

export function UsuarioEditor(props: {
  busy: boolean;
  editingId: number | null;
  form: UserForm;
  usuarios: Usuario[];
  setForm: (form: UserForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onEdit: (usuario: Usuario) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <>
      <EditorHeader title="Usuários" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Usuario" value={props.form.username} onChange={(username) => props.setForm({ ...props.form, username })} />
        <TextField label={props.editingId ? "Nova senha (opcional)" : "Senha inicial"} required={!props.editingId} type="password" value={props.form.password} onChange={(password) => props.setForm({ ...props.form, password })} />
        <TextField label="Nome" required={false} value={props.form.first_name} onChange={(first_name) => props.setForm({ ...props.form, first_name })} />
        <TextField label="Sobrenome" required={false} value={props.form.last_name} onChange={(last_name) => props.setForm({ ...props.form, last_name })} />
        <TextField label="Email" required={false} value={props.form.email} onChange={(email) => props.setForm({ ...props.form, email })} />
        <label className="field">
          <span>Perfil</span>
          <select className="select" value={props.form.is_staff ? "admin" : "tecnico"} onChange={(event) => props.setForm({ ...props.form, is_staff: event.target.value === "admin" })}>
            <option value="tecnico">Técnico</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="check-field">
          <input checked={props.form.is_active} type="checkbox" onChange={(event) => props.setForm({ ...props.form, is_active: event.target.checked })} />
          <span>Usuario ativo</span>
        </label>
        <FormActions busy={props.busy} editing={Boolean(props.editingId)} onCancel={props.onCancel} />
      </form>
      <RecordList
        empty="Nenhum usuario cadastrado."
        items={props.usuarios.map((usuario) => ({
          id: usuario.id,
          title: usuario.username,
          meta: `${usuario.first_name || "-"} ${usuario.last_name || ""} - ${usuario.email || "sem email"}`,
          badge: `${usuario.perfil}${usuario.is_active ? "" : " / inativo"}`,
          onEdit: () => props.onEdit(usuario),
          onDelete: () => props.onDelete(usuario.id)
        }))}
      />
    </>
  );
}
