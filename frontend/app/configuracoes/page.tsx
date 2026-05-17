"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Antenna, Box, Building2, KeyRound, RefreshCw, Settings, ShieldCheck, UserCog } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { Antena, ItemPatrimonial, Local, Usuario, UserPermissions } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { AntenaEditor } from "@/components/configuracoes/AntenaEditor";
import { ItemEditor } from "@/components/configuracoes/ItemEditor";
import { LocalEditor } from "@/components/configuracoes/LocalEditor";
import { PasswordEditor } from "@/components/configuracoes/PasswordEditor";
import { PermissoesEditor } from "@/components/configuracoes/PermissoesEditor";
import { UsuarioEditor } from "@/components/configuracoes/UsuarioEditor";

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
  { id: "usuarios" as const, label: "Usuários", icon: UserCog, adminOnly: true },
  { id: "permissoes" as const, label: "Permissões", icon: ShieldCheck, adminOnly: true }
];

export default function ConfiguracoesPage() {
  const { user: currentUser } = useAuth();
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
    if (!currentUser) {
      setError("Usuário não autenticado.");
      setLoading(false);
      return;
    }
    try {
      const [locaisData, antenasData, itensData, usuariosData, permissoesData] = await Promise.all([
        api.listLocais({ page_size: 100 }),
        api.listAntenas({ page_size: 100 }),
        api.listItens({ page_size: 100 }),
        currentUser.is_admin ? api.listUsuarios({ page_size: 100 }) : Promise.resolve(null),
        currentUser.is_admin ? api.listPermissoesTecnico() : Promise.resolve(null)
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
    if (!currentUser) return;
    load();
  }, [currentUser]);

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
    }, "Não foi possível alterar a senha.");
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
    }, "Não foi possível salvar usuário.");
  }

  async function savePermissoes(next: UserPermissions) {
    await persist(async () => {
      const updated = await api.updatePermissoesTecnico(next);
      setPermissoes(updated);
      setSuccess("Permissões do técnico atualizadas.");
    }, "Não foi possível atualizar permissões.");
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
