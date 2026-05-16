"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Antenna, Box, Building2, KeyRound, Pencil, Plus, RefreshCw, Save, Settings, ShieldCheck, Trash2, UserCog, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Antena, CurrentUser, ItemPatrimonial, Local, Usuario, UserPermissions } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/DataState";

type Section = "senha" | "locais" | "leitores" | "itens" | "usuarios" | "permissoes";
type LocalForm = Omit<Local, "id">;
type AntenaForm = Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & {
  command_token?: string;
};
type ItemForm = Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">;
type PasswordForm = { senha_atual: string; nova_senha: string };
type UserForm = Pick<Usuario, "username" | "first_name" | "last_name" | "email" | "is_active" | "is_staff"> & { password: string };

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
const emptyPassword: PasswordForm = { senha_atual: "", nova_senha: "" };
const emptyUser: UserForm = { username: "", password: "", first_name: "", last_name: "", email: "", is_active: true, is_staff: false };

const sections = [
  { id: "senha" as const, label: "Senha", icon: KeyRound },
  { id: "locais" as const, label: "Locais", icon: Building2 },
  { id: "leitores" as const, label: "Leitores", icon: Antenna },
  { id: "itens" as const, label: "Itens", icon: Box },
  { id: "usuarios" as const, label: "Usuarios", icon: UserCog, adminOnly: true },
  { id: "permissoes" as const, label: "Permissoes", icon: ShieldCheck, adminOnly: true }
];

export default function ConfiguracoesPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [section, setSection] = useState<Section>("senha");
  const [locais, setLocais] = useState<Local[]>([]);
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const [itens, setItens] = useState<ItemPatrimonial[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [permissoes, setPermissoes] = useState<UserPermissions | null>(null);
  const [localForm, setLocalForm] = useState<LocalForm>(emptyLocal);
  const [antenaForm, setAntenaForm] = useState<AntenaForm>(emptyAntena);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(emptyPassword);
  const [userForm, setUserForm] = useState<UserForm>(emptyUser);
  const [editingLocalId, setEditingLocalId] = useState<number | null>(null);
  const [editingAntenaId, setEditingAntenaId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setError("");
    try {
      const user = await api.me();
      setCurrentUser(user);
      const [locaisData, antenasData, itensData, usuariosData, permissoesData] = await Promise.all([
        api.listLocais({ page_size: 100 }),
        api.listAntenas({ page_size: 100 }),
        api.listItens({ page_size: 100 }),
        user.is_admin ? api.listUsuarios({ page_size: 100 }) : Promise.resolve(null),
        user.is_admin ? api.listPermissoesTecnico() : Promise.resolve(null)
      ]);
      setLocais(locaisData.results);
      setAntenas(antenasData.results);
      setItens(itensData.results);
      setUsuarios(usuariosData?.results || []);
      setPermissoes(permissoesData);
      setAntenaForm((current) => ({ ...current, local_id: current.local_id || locaisData.results[0]?.id || 0 }));
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
  const visibleSections = sections.filter((item) => !item.adminOnly || currentUser?.is_admin);
  const canManageCadastros = Boolean(currentUser?.permissions.gerenciar_cadastros);

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
    setSuccess("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    await persist(async () => {
      await api.trocarSenha(passwordForm, currentUser.username);
      setPasswordForm(emptyPassword);
      setSuccess("Senha alterada com sucesso.");
    }, "Nao foi possivel alterar a senha.");
  }

  async function saveUsuario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persist(async () => {
      if (editingUserId) {
        const payload: Partial<Usuario> & { password?: string } = {
          username: userForm.username,
          first_name: userForm.first_name,
          last_name: userForm.last_name,
          email: userForm.email,
          is_active: userForm.is_active,
          is_staff: userForm.is_staff
        };
        if (userForm.password) {
          payload.password = userForm.password;
        }
        await api.updateUsuario(editingUserId, payload);
      } else {
        await api.createUsuario({ ...userForm, password: userForm.password || "12345678" });
      }
      cancelUserEdit();
    }, "Nao foi possivel salvar usuario.");
  }

  async function savePermissoes(next: UserPermissions) {
    await persist(async () => {
      const updated = await api.updatePermissoesTecnico(next);
      setPermissoes(updated);
      setSuccess("Permissoes do tecnico atualizadas.");
    }, "Nao foi possivel atualizar permissoes.");
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

  async function removeUsuario(id: number) {
    if (!window.confirm("Excluir este usuário?")) return;
    await persist(async () => api.deleteUsuario(id), "Não foi possível excluir usuário.");
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

  function editUsuario(usuario: Usuario) {
    setSection("usuarios");
    setEditingUserId(usuario.id);
    setUserForm({
      username: usuario.username,
      password: "",
      first_name: usuario.first_name || "",
      last_name: usuario.last_name || "",
      email: usuario.email || "",
      is_active: usuario.is_active,
      is_staff: usuario.is_staff
    });
  }

  function cancelUserEdit() {
    setEditingUserId(null);
    setUserForm(emptyUser);
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
      {success ? <div className="process-feedback done">{success}</div> : null}

      {!loading ? (
        <div className="settings-layout">
          <aside className="settings-sidebar" aria-label="Áreas de configuração">
            {visibleSections.map((item) => {
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
                  <strong>{sectionCount(item.id, { locais, antenas, itens, usuarios })}</strong>
                </button>
              );
            })}
          </aside>

          <article className="panel settings-detail">
            {section === "senha" ? (
              <PasswordEditor busy={busy} form={passwordForm} onSubmit={savePassword} setForm={setPasswordForm} />
            ) : null}

            {section === "locais" ? (
              <LocalEditor
                busy={busy}
                canManage={canManageCadastros}
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
                canManage={canManageCadastros}
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
                canManage={canManageCadastros}
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

            {section === "usuarios" && currentUser?.is_admin ? (
              <UsuarioEditor
                busy={busy}
                editingId={editingUserId}
                form={userForm}
                onCancel={cancelUserEdit}
                onDelete={removeUsuario}
                onEdit={editUsuario}
                onSubmit={saveUsuario}
                setForm={setUserForm}
                usuarios={usuarios}
              />
            ) : null}

            {section === "permissoes" && currentUser?.is_admin && permissoes ? (
              <PermissoesEditor busy={busy} permissoes={permissoes} onChange={savePermissoes} />
            ) : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}

function LocalEditor(props: {
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
        <div className="state-box">Seu perfil permite consultar locais, mas nao alterar cadastros.</div>
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

function AntenaEditor(props: {
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
        <div className="state-box">Seu perfil permite consultar leitores, mas nao alterar cadastros.</div>
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

function ItemEditor(props: {
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
        <div className="state-box">Seu perfil permite consultar itens, mas nao alterar cadastros.</div>
        <RecordList
          readOnly
          empty="Nenhum item cadastrado."
          items={props.itens.map((item) => ({
            id: item.id,
            title: item.nome,
            meta: `${item.tag_id} - logico: ${item.local_logico_nome || "-"} - fisico: ${item.local_fisico_nome || "-"}`,
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
          meta: `${item.tag_id} · lógico: ${item.local_logico_nome || "-"} · físico: ${item.local_fisico_nome || "-"}`,
          badge: item.ativo ? "Ativo" : "Inativo",
          onEdit: () => props.onEdit(item),
          onDelete: () => props.onDelete(item.id)
        }))}
      />
    </>
  );
}

function PasswordEditor(props: {
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

function UsuarioEditor(props: {
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
      <EditorHeader title="Usuarios" editing={Boolean(props.editingId)} />
      <form className="settings-form" onSubmit={props.onSubmit}>
        <TextField label="Usuario" value={props.form.username} onChange={(username) => props.setForm({ ...props.form, username })} />
        <TextField label={props.editingId ? "Nova senha (opcional)" : "Senha inicial"} required={!props.editingId} type="password" value={props.form.password} onChange={(password) => props.setForm({ ...props.form, password })} />
        <TextField label="Nome" required={false} value={props.form.first_name} onChange={(first_name) => props.setForm({ ...props.form, first_name })} />
        <TextField label="Sobrenome" required={false} value={props.form.last_name} onChange={(last_name) => props.setForm({ ...props.form, last_name })} />
        <TextField label="Email" required={false} value={props.form.email} onChange={(email) => props.setForm({ ...props.form, email })} />
        <label className="field">
          <span>Perfil</span>
          <select className="select" value={props.form.is_staff ? "admin" : "tecnico"} onChange={(event) => props.setForm({ ...props.form, is_staff: event.target.value === "admin" })}>
            <option value="tecnico">Tecnico</option>
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

function PermissoesEditor(props: { busy: boolean; permissoes: UserPermissions; onChange: (permissoes: UserPermissions) => void }) {
  const items: { key: keyof UserPermissions; label: string }[] = [
    { key: "gerenciar_cadastros", label: "Gerenciar cadastros" },
    { key: "acionar_leitores", label: "Acionar leitores" },
    { key: "executar_auditoria", label: "Executar auditoria" },
    { key: "resolver_inconsistencias", label: "Resolver inconsistencias" },
    { key: "ver_logs", label: "Ver log operacional" }
  ];
  return (
    <>
      <EditorHeader title="Permissoes do Tecnico" editing={false} />
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

function sectionCount(
  id: Section,
  data: { locais: Local[]; antenas: Antena[]; itens: ItemPatrimonial[]; usuarios: Usuario[] }
) {
  if (id === "locais") return data.locais.length;
  if (id === "leitores") return data.antenas.length;
  if (id === "itens") return data.itens.length;
  if (id === "usuarios") return data.usuarios.length;
  return "";
}
