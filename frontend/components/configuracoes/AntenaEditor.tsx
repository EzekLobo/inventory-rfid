"use client";

import { FormEvent } from "react";
import type { Antena, Local } from "@/lib/types";
import { EditorHeader, FormActions, RecordList, SelectField, TextField } from "@/components/configuracoes/EditorParts";

type AntenaForm = Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & {
  command_token?: string;
};

export function AntenaEditor(props: {
  antenas: Antena[];
  busy: boolean;
  canManage: boolean;
  editingId: number | null;
  form: AntenaForm;
  locais: Local[];
  localNameById: Map<number, string>;
  setForm: (form: AntenaForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onEdit: (antena: Antena) => void;
  onDelete: (id: number) => void;
}) {
  if (!props.canManage) {
    return (
      <>
        <EditorHeader title="Leitores" editing={false} />
        <div className="state-box">Seu perfil permite consultar leitores, mas não alterar cadastros.</div>
        <RecordList
          readOnly
          empty="Nenhum leitor cadastrado."
          items={props.antenas.map((antena) => ({
            id: antena.id,
            title: antena.nome,
            meta: `${antena.hardware_id} - ${props.localNameById.get(antena.local_id) || antena.local_nome} - ${antena.modo_comando_display}`,
            badge: antena.command_token_configurado ? `${antena.tipo_display} / token` : antena.tipo_display,
            onEdit: () => props.onEdit(antena),
            onDelete: () => props.onDelete(antena.id)
          }))}
        />
      </>
    );
  }

  return (
    <>
      <EditorHeader title="Leitores" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Nome" value={props.form.nome} onChange={(nome) => props.setForm({ ...props.form, nome })} />
        <TextField label="Hardware ID" value={props.form.hardware_id} onChange={(hardware_id) => props.setForm({ ...props.form, hardware_id })} />
        <SelectField
          label="Local"
          value={props.form.local_id}
          onChange={(local_id) => props.setForm({ ...props.form, local_id })}
          options={props.locais.map((local) => ({ value: local.id, label: local.nome }))}
        />
        <SelectField
          label="Tipo"
          value={props.form.tipo}
          onChange={(tipo) => props.setForm({ ...props.form, tipo })}
          options={[
            { value: 1, label: "Destino" },
            { value: 2, label: "Fluxo" }
          ]}
        />
        <label className="field">
          <span>Modo de comando</span>
          <select
            className="select"
            value={props.form.modo_comando}
            onChange={(event) => props.setForm({ ...props.form, modo_comando: event.target.value as Antena["modo_comando"] })}
          >
            <option value="polling">Polling</option>
            <option value="http">HTTP direto</option>
          </select>
        </label>
        <TextField
          label="URL de comando"
          required={props.form.modo_comando === "http"}
          value={props.form.command_url}
          onChange={(command_url) => props.setForm({ ...props.form, command_url })}
        />
        <TextField
          label="Token de comando"
          required={false}
          value={props.form.command_token || ""}
          onChange={(command_token) => props.setForm({ ...props.form, command_token })}
        />
        <label className="field">
          <span>Duração padrão (s)</span>
          <input
            className="input"
            min={1}
            required
            type="number"
            value={props.form.duracao_padrao_segundos}
            onChange={(event) => props.setForm({ ...props.form, duracao_padrao_segundos: Number(event.target.value) || 1 })}
          />
        </label>
        <FormActions busy={props.busy || !props.form.local_id} editing={Boolean(props.editingId)} onCancel={props.onCancel} />
      </form>
      <RecordList
        readOnly={!props.canManage}
        empty="Nenhum leitor cadastrado."
        items={props.antenas.map((antena) => ({
          id: antena.id,
          title: antena.nome,
          meta: `${antena.hardware_id} · ${props.localNameById.get(antena.local_id) || antena.local_nome} · ${antena.modo_comando_display}`,
          badge: antena.command_token_configurado ? `${antena.tipo_display} / token` : antena.tipo_display,
          onEdit: () => props.onEdit(antena),
          onDelete: () => props.onDelete(antena.id)
        }))}
      />
    </>
  );
}
