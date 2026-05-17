"use client";

import { FormEvent } from "react";
import { KeyRound, Save } from "lucide-react";
import { EditorHeader, FormActions, TextField } from "@/components/configuracoes/EditorParts";

type PasswordForm = { senha_atual: string; nova_senha: string };

export function PasswordEditor(props: {
  busy: boolean;
  form: PasswordForm;
  setForm: (form: PasswordForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <>
      <EditorHeader title="Trocar senha" editing={false} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Senha atual" type="password" value={props.form.senha_atual} onChange={(senha_atual) => props.setForm({ ...props.form, senha_atual })} />
        <TextField label="Nova senha" type="password" value={props.form.nova_senha} onChange={(nova_senha) => props.setForm({ ...props.form, nova_senha })} />
        <div className="settings-actions">
          <button className="button" disabled={props.busy} type="submit">
            <Save size={17} />
            Alterar senha
          </button>
        </div>
      </form>
    </>
  );
}
