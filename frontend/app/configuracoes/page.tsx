"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Antenna, Box, Building2, Pencil, Plus, RefreshCw, Save, Settings, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Antena, ItemPatrimonial, Local } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/DataState";

type Section = "locais" | "leitores" | "itens";
type LocalForm = Omit<Local, "id">;
type AntenaForm = Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & {
  command_token?: string;
};
type ItemForm = Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">;

const emptyLocal: LocalForm = { nome: "", codigo: "" };
const emptyAntena: AntenaForm = {
  nome: "",
  hardware_id: "",
  local_id: 0,
  tipo: 1,
  modo_comando: "polling",
  command_url: "",
  command_token: "",
  duracao_padrao_segundos: 5
};
const emptyItem: ItemForm = { nome: "", tag_id: "", local_logico_id: null, local_fisico_id: null, ativo: true };

const sections = [
  { id: "locais" as const, label: "Locais", icon: Building2 },
  { id: "leitores" as const, label: "Leitores", icon: Antenna },
  { id: "itens" as const, label: "Itens", icon: Box }
];

export default function ConfiguracoesPage() {
  const [section, setSection] = useState<Section>("locais");
  const [locais, setLocais] = useState<Local[]>([]);
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const [itens, setItens] = useState<ItemPatrimonial[]>([]);
  const [localForm, setLocalForm] = useState<LocalForm>(emptyLocal);
  const [antenaForm, setAntenaForm] = useState<AntenaForm>(emptyAntena);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem);
  const [editingLocalId, setEditingLocalId] = useState<number | null>(null);
  const [editingAntenaId, setEditingAntenaId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [locaisData, antenasData, itensData] = await Promise.all([
        api.listLocais(),
        api.listAntenas(),
        api.listItens()
      ]);
      setLocais(locaisData);
      setAntenas(antenasData);
      setItens(itensData);
      setAntenaForm((current) => ({ ...current, local_id: current.local_id || locaisData[0]?.id || 0 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar configurações.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const localNameById = useMemo(() => new Map(locais.map((local) => [local.id, local.nome])), [locais]);

  async function saveLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist(async () => {
      editingLocalId ? await api.updateLocal(editingLocalId, localForm) : await api.createLocal(localForm);
      cancelLocalEdit();
    }, "Não foi possível salvar local.");
  }

  async function saveAntena(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist(async () => {
      editingAntenaId ? await api.updateAntena(editingAntenaId, antenaForm) : await api.createAntena(antenaForm);
      cancelAntenaEdit();
    }, "Não foi possível salvar leitor.");
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist(async () => {
      editingItemId ? await api.updateItem(editingItemId, itemForm) : await api.createItem(itemForm);
      cancelItemEdit();
    }, "Não foi possível salvar item.");
  }

  async function persist(action: () => Promise<void>, failureMessage: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusy(false);
    }
  }

  async function removeLocal(id: number) {
    if (!window.confirm("Excluir este local?")) return;
    await persist(async () => api.deleteLocal(id), "Não foi possível excluir local.");
  }

  async function removeAntena(id: number) {
    if (!window.confirm("Excluir este leitor?")) return;
    await persist(async () => api.deleteAntena(id), "Não foi possível excluir leitor.");
  }

  async function removeItem(id: number) {
    if (!window.confirm("Excluir este item?")) return;
    await persist(async () => api.deleteItem(id), "Não foi possível excluir item.");
  }

  function editLocal(local: Local) {
    setSection("locais");
    setEditingLocalId(local.id);
    setLocalForm({ nome: local.nome, codigo: local.codigo });
  }

  function editAntena(antena: Antena) {
    setSection("leitores");
    setEditingAntenaId(antena.id);
    setAntenaForm({
      nome: antena.nome,
      hardware_id: antena.hardware_id,
      local_id: antena.local_id,
      tipo: antena.tipo,
      modo_comando: antena.modo_comando,
      command_url: antena.command_url,
      command_token: "",
      duracao_padrao_segundos: antena.duracao_padrao_segundos
    });
  }

  function editItem(item: ItemPatrimonial) {
    setSection("itens");
    setEditingItemId(item.id);
    setItemForm({
      nome: item.nome,
      tag_id: item.tag_id,
      local_logico_id: item.local_logico_id,
      local_fisico_id: item.local_fisico_id,
      ativo: item.ativo
    });
  }

  function cancelLocalEdit() {
    setEditingLocalId(null);
    setLocalForm(emptyLocal);
  }

  function cancelAntenaEdit() {
    setEditingAntenaId(null);
    setAntenaForm({ ...emptyAntena, local_id: locais[0]?.id || 0 });
  }

  function cancelItemEdit() {
    setEditingItemId(null);
    setItemForm(emptyItem);
  }

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Configurações</h1>
          <p>Organize locais, leitores e itens usados pela sincronização e auditoria RFID.</p>
        </div>
        <button className="button ghost" type="button" onClick={load}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading ? (
        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label="Áreas de configuração">
            {sections.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  className={active ? "settings-tab active" : "settings-tab"}
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <strong>{item.id === "locais" ? locais.length : item.id === "leitores" ? antenas.length : itens.length}</strong>
                </button>
              );
            })}
          </aside>

          <article className="panel settings-detail">
            {section === "locais" ? (
              <LocalEditor
                busy={busy}
                editingId={editingLocalId}
                form={localForm}
                locais={locais}
                onCancel={cancelLocalEdit}
                onDelete={removeLocal}
                onEdit={editLocal}
                onSubmit={saveLocal}
                setForm={setLocalForm}
              />
            ) : null}

            {section === "leitores" ? (
              <AntenaEditor
                antenas={antenas}
                busy={busy}
                editingId={editingAntenaId}
                form={antenaForm}
                localNameById={localNameById}
                locais={locais}
                onCancel={cancelAntenaEdit}
                onDelete={removeAntena}
                onEdit={editAntena}
                onSubmit={saveAntena}
                setForm={setAntenaForm}
              />
            ) : null}

            {section === "itens" ? (
              <ItemEditor
                busy={busy}
                editingId={editingItemId}
                form={itemForm}
                itens={itens}
                locais={locais}
                onCancel={cancelItemEdit}
                onDelete={removeItem}
                onEdit={editItem}
                onSubmit={saveItem}
                setForm={setItemForm}
              />
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function LocalEditor(props: {
  busy: boolean;
  editingId: number | null;
  form: LocalForm;
  locais: Local[];
  setForm: (form: LocalForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onEdit: (local: Local) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <>
      <EditorHeader title="Locais" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Nome" value={props.form.nome} onChange={(nome) => props.setForm({ ...props.form, nome })} />
        <TextField label="Código" value={props.form.codigo} onChange={(codigo) => props.setForm({ ...props.form, codigo })} />
        <FormActions busy={props.busy} editing={Boolean(props.editingId)} onCancel={props.onCancel} />
      </form>
      <RecordList
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

function AntenaEditor(props: {
  antenas: Antena[];
  busy: boolean;
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
          <span>DuraÃ§Ã£o padrÃ£o (s)</span>
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

function ItemEditor(props: {
  busy: boolean;
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
        empty="Nenhum item cadastrado."
        items={props.itens.map((item) => ({
          id: item.id,
          title: item.nome,
          meta: `${item.tag_id} · lógico: ${item.local_logico_nome || "-"} · físico: ${item.local_fisico_nome || "-"}`,
          badge: item.ativo ? "Ativo" : "Inativo",
          onEdit: () => props.onEdit(item),
          onDelete: () => props.onDelete(item.id)
        }))}
      />
    </>
  );
}

function EditorHeader({ title, editing }: { title: string; editing: boolean }) {
  return (
    <div className="settings-detail-head">
      <h2>
        <Settings size={21} /> {title}
      </h2>
      <span className="badge">{editing ? "Editando" : "Novo cadastro"}</span>
    </div>
  );
}

function TextField({
  label,
  required = true,
  value,
  onChange
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" required={required} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
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

function FormActions({ busy, editing, onCancel }: { busy: boolean; editing: boolean; onCancel: () => void }) {
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

function RecordList({
  empty,
  items
}: {
  empty: string;
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
          <div className="record-actions">
            <button className="icon-action" type="button" onClick={item.onEdit} title="Editar">
              <Pencil size={16} />
            </button>
            <button className="icon-action" type="button" onClick={item.onDelete} title="Excluir">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
