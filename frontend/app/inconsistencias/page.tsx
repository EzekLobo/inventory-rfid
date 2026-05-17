"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Filter,
  Link2,
  MapPinCheck,
  RefreshCw,
  ShieldQuestion
} from "lucide-react";
import { api } from "@/lib/api";
import { compactRfidTag, fullRfidTag, labelInconsistenciaTipo } from "@/lib/display";
import { isLatestRequest, useDelayedLoading } from "@/lib/requestState";
import { useAuth } from "@/context/AuthContext";
import type { Inconsistencia, ItemPatrimonial, Local, PaginatedResponse } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/DataState";
import { PaginationControls } from "@/components/ui/PaginationControls";

type ActionMode = "confirmar-local" | "resolver" | "cadastrar-tag" | "associar-tag";

type ActionState = {
  id: number;
  mode: ActionMode | null;
};

type UnknownTagForm = {
  nome: string;
  local_id: number | "";
  motivo: string;
};

type AuditGroup = {
  id: string;
  title: string;
  local: string | null;
  antennaId: number | null;
  createdAt: string;
  items: Inconsistencia[];
  abertas: number;
  resolvidas: number;
  tipos: string[];
};

export default function InconsistenciasPage() {
  const [data, setData] = useState<Inconsistencia[]>([]);
  const { user: currentUser } = useAuth();
  const [pageData, setPageData] = useState<PaginatedResponse<Inconsistencia> | null>(null);
  const [locais, setLocais] = useState<Local[]>([]);
  const [itens, setItens] = useState<ItemPatrimonial[]>([]);
  const [tipo, setTipo] = useState("");
  const [resolvida, setResolvida] = useState("false");
  const [page, setPage] = useState(1);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncingGroupId, setSyncingGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [action, setAction] = useState<ActionState | null>(null);
  const [motivo, setMotivo] = useState("");
  const [unknownForm, setUnknownForm] = useState<UnknownTagForm>({
    nome: "",
    local_id: "",
    motivo: "tag cadastrada a partir de inconsistência"
  });
  const [associateItemId, setAssociateItemId] = useState<number | "">("");
  const loadRequestId = useRef(0);
  const showLoading = useDelayedLoading(loading);

  const pageSize = 25;

  async function load(nextPage = page) {
    const requestId = ++loadRequestId.current;
    if (data.length === 0) setLoading(true);
    setError("");
    try {
      const inconsistenciasData = await api.listInconsistencias({ resolvida, tipo, page: nextPage, page_size: pageSize });
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setData(inconsistenciasData.results);
      setPageData(inconsistenciasData);
      setPage(nextPage);
      setLoading(false);

      try {
        const [locaisData, itensData] = await Promise.all([api.listLocais({ page_size: 100 }), api.listItens({ page_size: 100 })]);
        if (!isLatestRequest(requestId, loadRequestId)) return;
        setLocais(locaisData.results);
        setItens(itensData.results);
      } catch (lookupError) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[inconsistencias] Falha ao carregar dados auxiliares", lookupError);
        }
      }
    } catch (err) {
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar inconsistências.");
    } finally {
      if (isLatestRequest(requestId, loadRequestId)) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load(1);
  }, [tipo, resolvida]);

  const groups = useMemo(() => groupByAudit(data), [data]);
  const activeInconsistencia = useMemo(
    () => data.find((item) => item.id === action?.id) || null,
    [action, data]
  );
  const selectedMode = action?.mode || null;
  const choosingResolution = Boolean(activeInconsistencia && selectedMode === null);
  const canResolve = Boolean(currentUser?.permissions.resolver_inconsistencias);

  function toggleAudit(id: string) {
    setExpandedAuditId((current) => (current === id ? null : id));
    setAction(null);
  }

  function startResolution(item: Inconsistencia) {
    if (action?.id === item.id) {
      setAction(null);
      return;
    }
    startAction(item, shouldChooseMode(item.tipo) ? null : defaultModeForType(item.tipo));
  }

  function startAction(item: Inconsistencia, mode: ActionMode | null) {
    setAction({ id: item.id, mode });
    setSuccess("");
    setError("");
    setMotivo("");
    setAssociateItemId("");
    setUnknownForm({
      nome: item.item_nome || "",
      local_id: item.local_fisico_id || "",
      motivo: "tag cadastrada a partir de inconsistência"
    });
  }

  function selectMode(mode: ActionMode) {
    if (!activeInconsistencia) return;
    setAction({ id: activeInconsistencia.id, mode });
    setMotivo("");
  }

  function returnToOptions() {
    if (!activeInconsistencia) return;
    setAction({ id: activeInconsistencia.id, mode: null });
    setMotivo("");
    setAssociateItemId("");
  }

  async function sincronizarLote(event: React.MouseEvent, group: AuditGroup) {
    event.stopPropagation();
    const divergentes = group.items.filter((item) => !item.resolvida && item.tipo === "local_divergente");
    if (divergentes.length === 0) return;

    setSyncingGroupId(group.id);
    setSuccess("");
    setError("");
    try {
      await Promise.all(
        divergentes.map((item) => api.confirmarLocalInconsistencia(item.id, "Sincronização em lote da auditoria"))
      );
      setSuccess(`${divergentes.length} locais sincronizados com sucesso.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar em lote.");
    } finally {
      setSyncingGroupId(null);
    }
  }

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMode || !activeInconsistencia) return;

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (selectedMode === "confirmar-local") {
        await api.confirmarLocalInconsistencia(activeInconsistencia.id, reasonOrDefault(motivo, selectedMode));
        setSuccess("Local lógico atualizado e inconsistência resolvida.");
      } else if (selectedMode === "resolver") {
        await api.resolverInconsistencia(activeInconsistencia.id, reasonOrDefault(motivo, selectedMode));
        setSuccess("Inconsistência resolvida com justificativa registrada.");
      } else if (selectedMode === "cadastrar-tag") {
        await api.cadastrarTagDesconhecida(activeInconsistencia.id, {
          nome: unknownForm.nome,
          local_logico_id: unknownForm.local_id || null,
          local_fisico_id: unknownForm.local_id || null,
          motivo: unknownForm.motivo
        });
        setSuccess("Tag cadastrada como item patrimonial e inconsistência resolvida.");
      } else if (selectedMode === "associar-tag") {
        if (!associateItemId) throw new Error("Selecione um item para associar.");
        await api.associarTagDesconhecida(activeInconsistencia.id, {
          item_id: associateItemId,
          motivo: defaultReason("associar-tag")
        });
        setSuccess("Tag associada ao item existente e inconsistência resolvida.");
      }
      setAction(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível resolver a inconsistência.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Inconsistências</h1>
          <p>Pendências agrupadas por auditoria para corrigir cada conferência com contexto.</p>
        </div>
      </div>

      <article className="panel">
        <div className="toolbar">
          <div className="form-row">
            <div className="field">
              <label htmlFor="tipo">
                <Filter size={14} /> Tipo
              </label>
              <select className="select" id="tipo" value={tipo} onChange={(event) => setTipo(event.target.value)}>
                <option value="">Todos</option>
                <option value="local_divergente">Local divergente</option>
                <option value="nao_encontrado">Não encontrado</option>
                <option value="tag_desconhecida">Tag desconhecida</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="resolvida">Situação</label>
              <select
                className="select"
                id="resolvida"
                value={resolvida}
                onChange={(event) => setResolvida(event.target.value)}
              >
                <option value="false">Abertas</option>
                <option value="true">Resolvidas</option>
                <option value="">Todas</option>
              </select>
            </div>
          </div>
          <button className="button ghost" type="button" onClick={() => load(page)}>
            <RefreshCw size={18} />
            Atualizar
          </button>
        </div>

        {success ? <div className="process-feedback done">{success}</div> : null}
        {showLoading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && !error && data.length === 0 ? <EmptyState label={resolvida === "false" ? "Nenhuma inconsistência aberta." : "Nenhuma inconsistência encontrada para os filtros atuais."} /> : null}

        {!loading && !error && groups.length > 0 ? (
          <div className="grouped-list">
            {groups.map((group) => {
              const expanded = expandedAuditId === group.id;
              const countDivergentes = group.items.filter((i) => !i.resolvida && i.tipo === "local_divergente").length;

              return (
                <section className="group-block" key={group.id}>
                  <div
                    className="group-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleAudit(group.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") toggleAudit(group.id);
                    }}
                  >
                    <span className="group-title">
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <strong>{group.title}</strong>
                    </span>
                    <span className="group-date">{new Date(group.createdAt).toLocaleString("pt-BR")}</span>
                    <span className="group-summary">
                      {countDivergentes > 0 && canResolve ? (
                        <button
                          className="button subtle small"
                          disabled={syncingGroupId === group.id}
                          title="Sincronizar todos os locais divergentes desta auditoria"
                          type="button"
                          onClick={(e) => sincronizarLote(e, group)}
                        >
                          <RefreshCw size={14} className={syncingGroupId === group.id ? "spinning" : ""} />
                          Sincronizar ({countDivergentes})
                        </button>
                      ) : null}
                      <span className="badge">{group.items.length} total</span>
                      {group.abertas ? <span className="badge red">{group.abertas} aberta(s)</span> : null}
                      {group.resolvidas ? <span className="badge green">{group.resolvidas} resolvida(s)</span> : null}
                    </span>
                  </div>

                  {expanded ? (
                    <>
                      <div className="group-meta">
                        {group.antennaId ? <span>Leitor {group.antennaId}</span> : null}
                        <span>{group.tipos.map((value) => labelInconsistenciaTipo(value)).join(" | ")}</span>
                      </div>
                      <div className="compact-list">
                        {group.items.map((item) => (
                          <article className="compact-row" key={item.id}>
                            <div className="compact-main">
                              <span className="compact-title">
                                <strong>{item.item_nome || item.item_id || (item.tag_id ? compactRfidTag(item.tag_id) : `#${item.id}`)}</strong>
                                <span className={item.resolvida ? "badge green" : "badge red"}>
                                  {item.resolvida ? "Resolvida" : "Aberta"}
                                </span>
                              </span>
                              <span className="compact-meta-line">
                                <span>{labelInconsistenciaTipo(item.tipo)}</span>
                                <span className="technical-line" title={fullRfidTag(item.tag_id)}>Tag {compactRfidTag(item.tag_id)}</span>
                                <span>Lógico: {item.local_logico_nome || item.local_logico_id || "-"}</span>
                                <span>Físico: {item.local_fisico_nome || item.local_fisico_id || "-"}</span>
                              </span>
                            </div>
                            <div className="compact-badges">
                              <ActionButtons active={action?.id === item.id} canResolve={canResolve} item={item} onStart={startResolution} />
                            </div>
                            {action?.id === item.id && activeInconsistencia ? (
                              <div className="compact-detail inline-resolution-panel">
                                <ResolutionHeader inconsistencia={activeInconsistencia} />
                                {choosingResolution ? (
                                  <ResolutionOptions inconsistencia={activeInconsistencia} onSelect={selectMode} />
                                ) : selectedMode ? (
                                  <form className="resolution-form" onSubmit={submitAction}>
                                    <div className="resolution-fields">
                                      <ResolutionFormFields
                                        associateItemId={associateItemId}
                                        itens={itens}
                                        locais={locais}
                                        mode={selectedMode}
                                        motivo={motivo}
                                        setAssociateItemId={setAssociateItemId}
                                        setMotivo={setMotivo}
                                        setUnknownForm={setUnknownForm}
                                        unknownForm={unknownForm}
                                      />
                                    </div>

                                    <div className="settings-actions">
                                      <button className="button" disabled={busy} type="submit">
                                        <Check size={17} />
                                        Confirmar
                                      </button>
                                      {shouldChooseMode(activeInconsistencia.tipo) ? (
                                        <button className="button subtle" disabled={busy} type="button" onClick={returnToOptions}>
                                          <ArrowLeft size={17} />
                                          Voltar
                                        </button>
                                      ) : null}
                                      <button className="button ghost" disabled={busy} type="button" onClick={() => setAction(null)}>
                                        Cancelar
                                      </button>
                                    </div>
                                  </form>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}
        {!loading && !error && pageData ? <PaginationControls data={pageData} page={page} pageSize={pageSize} onPageChange={load} /> : null}
      </article>
    </section>
  );
}

function groupByAudit(items: Inconsistencia[]): AuditGroup[] {
  const groups = new Map<string, AuditGroup>();
  items.forEach((item) => {
    const id = item.auditoria_id || "sem-auditoria";
    const group = groups.get(id) || {
      id,
      title: item.auditoria_label || "Sem auditoria / fluxo operacional",
      local: item.auditoria_local_nome,
      antennaId: item.auditoria_antenna_id,
      createdAt: item.auditoria_criada_em || item.criado_em,
      items: [],
      abertas: 0,
      resolvidas: 0,
      tipos: []
    };
    group.items.push(item);
    if (item.resolvida) group.resolvidas += 1;
    else group.abertas += 1;
    if (!group.tipos.includes(item.tipo)) group.tipos.push(item.tipo);
    groups.set(id, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime()),
      tipos: group.tipos.sort((a, b) => labelInconsistenciaTipo(a).localeCompare(labelInconsistenciaTipo(b), "pt-BR"))
    }))
    .sort((a, b) => {
      if (a.id === "sem-auditoria") return 1;
      if (b.id === "sem-auditoria") return -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function ActionButtons({ active, canResolve, item, onStart }: { active: boolean; canResolve: boolean; item: Inconsistencia; onStart: (item: Inconsistencia) => void }) {
  if (item.resolvida) {
    return <span className="muted-text">Sem ações</span>;
  }
  if (!canResolve) {
    return <span className="muted-text">Sem permissão</span>;
  }

  return (
    <button className="button action-button" type="button" onClick={() => onStart(item)}>
      <ChevronDown size={17} />
      {active ? "Recolher" : "Resolver"}
    </button>
  );
}

function ResolutionOptions({
  inconsistencia,
  onSelect
}: {
  inconsistencia: Inconsistencia;
  onSelect: (mode: ActionMode) => void;
}) {
  const options = modesForType(inconsistencia.tipo);

  return (
    <div className="resolution-options-grid" aria-label="Formas de resolver">
      {options.map((option) => (
        <button
          className="resolution-choice"
          key={option.mode}
          type="button"
          onClick={() => onSelect(option.mode)}
        >
          <span className="resolution-choice-icon">{option.icon}</span>
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function ResolutionHeader({ inconsistencia }: { inconsistencia: Inconsistencia }) {
  return (
    <div className="resolution-head">
      <div>
        <h2>Resolver inconsistência</h2>
        <p className="resolution-context">
          {labelInconsistenciaTipo(inconsistencia.tipo)} - {inconsistencia.item_nome || (inconsistencia.tag_id ? compactRfidTag(inconsistencia.tag_id) : `#${inconsistencia.id}`)}
          {inconsistencia.local_fisico_nome ? ` - ${inconsistencia.local_fisico_nome}` : ""}
        </p>
      </div>
    </div>
  );
}

function ResolutionFormFields({
  associateItemId,
  itens,
  locais,
  mode,
  motivo,
  setAssociateItemId,
  setMotivo,
  setUnknownForm,
  unknownForm
}: {
  associateItemId: number | "";
  itens: ItemPatrimonial[];
  locais: Local[];
  mode: ActionMode;
  motivo: string;
  setAssociateItemId: (itemId: number | "") => void;
  setMotivo: (motivo: string) => void;
  setUnknownForm: (form: UnknownTagForm) => void;
  unknownForm: UnknownTagForm;
}) {
  if (mode === "cadastrar-tag") {
    return <UnknownTagFields form={unknownForm} locais={locais} setForm={setUnknownForm} />;
  }

  if (mode === "associar-tag") {
    return (
      <label className="field">
        <span>Item existente</span>
        <select
          className="select"
          required
          value={associateItemId}
          onChange={(event) => setAssociateItemId(Number(event.target.value) || "")}
        >
          <option value="">Selecione</option>
          {itens.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome} - {compactRfidTag(item.tag_id)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      <span>Justificativa</span>
      <textarea
        className="textarea compact"
        placeholder={`Sugestão: ${defaultReason(mode)}`}
        value={motivo}
        onChange={(event) => setMotivo(event.target.value)}
      />
    </label>
  );
}

function UnknownTagFields({
  form,
  locais,
  setForm
}: {
  form: UnknownTagForm;
  locais: Local[];
  setForm: (form: UnknownTagForm) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Nome do item</span>
        <input className="input" required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
      </label>
      <label className="field">
        <span>Local do item</span>
        <select
          className="select"
          required
          value={form.local_id}
          onChange={(event) => setForm({ ...form, local_id: Number(event.target.value) || "" })}
        >
          <option value="">Selecione</option>
          {locais.map((local) => (
            <option key={local.id} value={local.id}>
              {local.nome}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function defaultReason(mode: ActionMode) {
  const reasons: Record<ActionMode, string> = {
    "confirmar-local": "local atual confirmado como novo local lógico",
    resolver: "resolucao manual com justificativa",
    "cadastrar-tag": "tag cadastrada a partir de inconsistência",
    "associar-tag": "tag associada a item existente"
  };
  return reasons[mode];
}

function reasonOrDefault(value: string, mode: ActionMode) {
  return value.trim() || defaultReason(mode);
}

function defaultModeForType(tipo: string): ActionMode {
  if (tipo === "local_divergente") return "confirmar-local";
  return "resolver";
}

function shouldChooseMode(tipo: string) {
  return tipo === "local_divergente" || tipo === "tag_desconhecida";
}

function modesForType(tipo: string) {
  if (tipo === "local_divergente") {
    return [
      {
        mode: "confirmar-local" as const,
        label: "Atualizar local lógico",
        description: "Confirma este local físico como o novo local esperado do item.",
        icon: <MapPinCheck size={18} />
      },
      {
        mode: "resolver" as const,
        label: "Resolver com justificativa",
        description: "Fecha a inconsistência sem alterar o cadastro do item.",
        icon: <Check size={18} />
      }
    ];
  }

  if (tipo === "tag_desconhecida") {
    return [
      {
        mode: "cadastrar-tag" as const,
        label: "Cadastrar novo item",
        description: "Cria um patrimônio com esta tag e resolve a leitura.",
        icon: <FilePlus2 size={18} />
      },
      {
        mode: "associar-tag" as const,
        label: "Associar a item existente",
        description: "Vincula esta tag a um item já cadastrado.",
        icon: <Link2 size={18} />
      },
      {
        mode: "resolver" as const,
        label: "Ignorar leitura",
        description: "Fecha a inconsistência registrando uma justificativa.",
        icon: <ShieldQuestion size={18} />
      }
    ];
  }

  return [
    {
      mode: "resolver" as const,
      label: "Resolver com justificativa",
      description: "Fecha a inconsistência com motivo registrado.",
      icon: <Check size={18} />
    }
  ];
}
