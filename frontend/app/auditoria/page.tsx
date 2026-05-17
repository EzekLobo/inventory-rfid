"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Play, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { isLatestRequest, useDelayedLoading } from "@/lib/requestState";
import { useAuth } from "@/context/AuthContext";
import type {
  Antena,
  AuditoriaItemResumo,
  AuditoriaJob,
  AuditoriaMetadados,
  AuditoriaProcessada,
  ItemPatrimonial,
  TagsReadResponse
} from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { StatCard } from "@/components/ui/StatCard";

type AuditHistoryRow = {
  id: string;
  data: string;
  local: string;
  leitor: string;
  status: "Aguardando leitura" | "Processada" | "Encerrada sem leitura";
  esperados: number | null;
  encontrados: number | null;
  naoEncontrados: number | null;
  divergentes: number | null;
  desconhecidas: number | null;
  total: number | null;
  detalhesDisponiveis: boolean;
  itensNaoEncontrados: AuditoriaItemResumo[];
  itensDivergentes: AuditoriaItemResumo[];
  tagsDesconhecidas: string[];
};

type ActiveProcess = {
  label: string;
  detail: string;
  startedAt: number;
  expiresAt: number;
};

function parseTags(value: string) {
  return value
    .split(/[\n,; ]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function numericValue(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function countLabel(value: number | null, fallback = "-") {
  return value === null ? fallback : String(value);
}

function totalFromMetadata(metadata: AuditoriaMetadados) {
  const total = numericValue(metadata.total_lidos);
  if (total !== null) return total;

  const encontrados = numericValue(metadata.encontrados);
  const divergentes = numericValue(metadata.tags_fora_do_local);
  const desconhecidas = numericValue(metadata.tags_desconhecidas);
  if (encontrados === null && divergentes === null && desconhecidas === null) return null;
  return (encontrados ?? 0) + (divergentes ?? 0) + (desconhecidas ?? 0);
}

function statusFromAudit(waiting: boolean, finalizaEm: unknown, now: number): AuditHistoryRow["status"] {
  if (!waiting) return "Processada";
  if (typeof finalizaEm === "string" && Number.isFinite(new Date(finalizaEm).getTime()) && new Date(finalizaEm).getTime() <= now) {
    return "Encerrada sem leitura";
  }
  return "Aguardando leitura";
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text}>
      <HelpCircle size={14} />
    </span>
  );
}

export default function AuditoriaPage() {
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const { user: currentUser } = useAuth();
  const [selectedAntennaIds, setSelectedAntennaIds] = useState<number[]>([]);
  const [auditAll, setAuditAll] = useState(true);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [antennaSearch, setAntennaSearch] = useState("");
  const [simulationAntennaId, setSimulationAntennaId] = useState<number | "">("");
  const [duracao, setDuracao] = useState(5);
  const [tagsText, setTagsText] = useState("");
  const [result, setResult] = useState<TagsReadResponse | null>(null);
  const [jobs, setJobs] = useState<AuditoriaJob[]>([]);
  const [processedAudits, setProcessedAudits] = useState<AuditoriaProcessada[]>([]);
  const [itens, setItens] = useState<ItemPatrimonial[]>([]);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeProcess, setActiveProcess] = useState<ActiveProcess | null>(null);
  const [finishedMessage, setFinishedMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const loadRequestId = useRef(0);
  const showLoading = useDelayedLoading(loading);

  async function load() {
    const requestId = ++loadRequestId.current;
    setError("");
    try {
      const [antenasData, jobsData, processedData, itensData] = await Promise.all([
        api.listAntenas({ page_size: 100 }),
        api.listAuditorias({ page_size: 25 }),
        api.listAuditoriasProcessadas({ page_size: 25 }),
        api.listItens({ page_size: 100 })
      ]);
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setAntenas(antenasData.results);
      setSimulationAntennaId((current) => current || antenasData.results[0]?.id || "");
      setSelectedAntennaIds((current) => {
        const availableIds = new Set(antenasData.results.map((antena) => antena.id));
        return current.filter((id) => availableIds.has(id));
      });
      setJobs(jobsData.results);
      setProcessedAudits(processedData.results);
      setItens(itensData.results);
    } catch (err) {
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar auditorias.");
    } finally {
      if (isLatestRequest(requestId, loadRequestId)) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedAntennas = useMemo(
    () => antenas.filter((antena) => selectedAntennaIds.includes(antena.id)),
    [antenas, selectedAntennaIds]
  );

  const expectedItems = useMemo(() => {
    const localIds = new Set(selectedAntennas.map((antena) => antena.local_id));
    return itens.filter((item) => item.ativo && item.local_logico_id !== null && localIds.has(item.local_logico_id));
  }, [itens, selectedAntennas]);

  const filteredAntennas = useMemo(
    () =>
      antenas.filter((antena) => {
        const search = antennaSearch.trim().toLowerCase();
        if (!search) return true;
        return `${antena.nome} ${antena.local_nome} ${antena.hardware_id}`.toLowerCase().includes(search);
      }),
    [antennaSearch, antenas]
  );

  const selectionLabel = useMemo(
    () => {
      if (auditAll) return "Todos os leitores";
      if (selectedAntennas.length === 0) return "Selecione leitores";
      if (selectedAntennas.length === 1) {
        return `${selectedAntennas[0].nome} - ${selectedAntennas[0].local_nome}`;
      }
      return `${selectedAntennas.length} leitores selecionados`;
    },
    [auditAll, selectedAntennas]
  );

  const auditRows = useMemo<AuditHistoryRow[]>(() => {
    const processedJobIds = new Set(
      processedAudits
        .map((audit) => Number(audit.metadados.auditoria_job_id))
        .filter((id) => Number.isFinite(id))
    );
    const processedRows = processedAudits.map((audit) => {
      const metadata = audit.metadados;
      const waiting = metadata.evento === "auditoria_iniciada";
      const localId = Number(metadata.local_id);
      const expectedInLocal = itens.filter((item) => item.ativo && item.local_logico_id === localId).length;
      const esperados = numericValue(metadata.esperados) ?? (waiting && Number.isFinite(localId) ? expectedInLocal : null);
      return {
        id: `processed-${audit.id}`,
        data: audit.criado_em,
        local: String(metadata.local_nome || "-"),
        leitor: String(metadata.antenna_nome || "-"),
        status: statusFromAudit(waiting, metadata.finaliza_em, now),
        esperados,
        encontrados: waiting ? null : numericValue(metadata.encontrados),
        naoEncontrados: waiting ? null : numericValue(metadata.nao_encontrados),
        divergentes: waiting ? null : numericValue(metadata.tags_fora_do_local),
        desconhecidas: waiting ? null : numericValue(metadata.tags_desconhecidas),
        total: waiting ? null : totalFromMetadata(metadata),
        detalhesDisponiveis: !waiting,
        itensNaoEncontrados: metadata.itens_nao_encontrados || [],
        itensDivergentes: metadata.itens_divergentes || [],
        tagsDesconhecidas: metadata.tags_desconhecidas_lista || []
      };
    });
    const jobRows = jobs
      .filter((job) => !processedJobIds.has(job.id))
      .map((job) => ({
        id: `job-${job.id}`,
        data: job.iniciado_em,
        local: uniqueValues(job.leitores.map((leitor) => leitor.local_nome)).join(", ") || "-",
        leitor: `${job.leitores.length} leitor(es)`,
        status: statusFromAudit(true, job.finaliza_em, now),
        esperados: null,
        encontrados: null,
        naoEncontrados: null,
        divergentes: null,
        desconhecidas: null,
        total: null,
        detalhesDisponiveis: false,
        itensNaoEncontrados: [],
        itensDivergentes: [],
        tagsDesconhecidas: []
      }));
    return [...processedRows, ...jobRows].sort(
      (left, right) => new Date(right.data).getTime() - new Date(left.data).getTime()
    );
  }, [itens, jobs, now, processedAudits]);

  function toggleAntenna(id: number) {
    setAuditAll(false);
    setSelectedAntennaIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function selectAllAntennas() {
    setAuditAll(true);
    setSelectedAntennaIds([]);
    setSelectorOpen(false);
  }

  async function startAudit() {
    const antennaIds = auditAll ? undefined : selectedAntennaIds;
    if (!auditAll && selectedAntennaIds.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await api.auditarLeitores(duracao, antennaIds);
      setFinishedMessage("");
      setActiveProcess({
        label: auditAll ? "Auditoria geral em andamento" : "Auditoria selecionada em andamento",
        detail: `${response.total_antenas} leitor(es) coletando tags para conferência dos locais auditados.`,
        startedAt: Date.now(),
        expiresAt: new Date(response.finaliza_em).getTime()
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível iniciar auditoria.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendAuditResult() {
    if (!simulationAntennaId) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await api.enviarTags(Number(simulationAntennaId), parseTags(tagsText), true);
      setResult(response);
      setFinishedMessage("Simulação processada. Resultado atualizado na lista de auditorias.");
      if (response.status !== "ok") {
        setError("A leitura foi ignorada pelo sistema. Verifique se o leitor e a auditoria estão ativos.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar resultado da auditoria.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeProcess || now < activeProcess.expiresAt) return;

    setActiveProcess(null);
    setFinishedMessage("Auditoria RFID concluída. Dados atualizados.");
    load();
  }, [activeProcess, now]);

  const processProgress = activeProcess
    ? Math.min(100, Math.max(0, ((now - activeProcess.startedAt) / (activeProcess.expiresAt - activeProcess.startedAt)) * 100))
    : 0;
  const remainingSeconds = activeProcess ? Math.max(0, Math.ceil((activeProcess.expiresAt - now) / 1000)) : 0;
  const canAudit = Boolean(currentUser?.permissions.executar_auditoria);

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Auditoria RFID</h1>
          <p>Escolha vários leitores ou acione todos para auditar os locais em uma única janela operacional.</p>
        </div>
        <button className="button ghost" type="button" onClick={load}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>

      {showLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}

      {activeProcess ? (
        <div className="process-feedback">
          <div>
            <strong>{activeProcess.label}</strong>
            <span>
              {activeProcess.detail} Termina em {remainingSeconds}s.
            </span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${processProgress}%` }} />
          </div>
        </div>
      ) : null}

      {!activeProcess && finishedMessage ? <div className="process-feedback done">{finishedMessage}</div> : null}

      {!loading ? (
        <div className="grid two">
          <article className="panel">
            <h2>
              <ShieldAlert size={21} /> Auditoria em lote
            </h2>
            <div className="form-row">
              <div className="field">
                <label htmlFor="duracao">Duração</label>
                <input
                  className="input"
                  id="duracao"
                  min={1}
                  type="number"
                  value={duracao}
                  onChange={(event) => setDuracao(Number(event.target.value))}
                />
              </div>
              <div className="field audit-select-field">
                <span>Leitores</span>
                <button className="select audit-picker-trigger" type="button" onClick={() => setSelectorOpen((value) => !value)}>
                  {selectionLabel}
                  <ChevronDown size={16} />
                </button>
                {selectorOpen ? (
                  <div className="audit-picker">
                    <input
                      className="input audit-picker-search"
                      placeholder="Pesquisar leitor ou local"
                      value={antennaSearch}
                      onChange={(event) => setAntennaSearch(event.target.value)}
                    />
                    <button className={auditAll ? "audit-picker-option active" : "audit-picker-option"} type="button" onClick={selectAllAntennas}>
                      <CheckCircle2 size={17} />
                      <span>
                        <strong>Todos os leitores</strong>
                        <small>{antenas.length} leitor(es) cadastrados</small>
                      </span>
                    </button>
                    {filteredAntennas.map((antena) => (
                      <button
                        className={selectedAntennaIds.includes(antena.id) && !auditAll ? "audit-picker-option active" : "audit-picker-option"}
                        key={antena.id}
                        type="button"
                        onClick={() => toggleAntenna(antena.id)}
                      >
                        <input checked={selectedAntennaIds.includes(antena.id) && !auditAll} readOnly type="checkbox" />
                        <span>
                          <strong>{antena.nome}</strong>
                          <small>
                            {antena.local_nome} - {antena.tipo_display} - {antena.online ? "online" : "offline"}
                          </small>
                        </span>
                      </button>
                    ))}
                    {filteredAntennas.length === 0 ? <div className="audit-picker-empty">Nenhum leitor encontrado.</div> : null}
                  </div>
                ) : null}
              </div>
              <button
                className="button yellow"
                disabled={!canAudit || submitting || antenas.length === 0 || (!auditAll && selectedAntennaIds.length === 0)}
                type="button"
                onClick={startAudit}
              >
                <Play size={17} />
                Iniciar auditoria
              </button>
            </div>

            <p>
              Os leitores selecionados ficam ativos pela duração definida. Locais selecionados:{" "}
              <strong>{auditAll ? "todos" : uniqueValues(selectedAntennas.map((antena) => antena.local_nome)).join(", ") || "-"}</strong>.
              Itens esperados nesses locais: <strong>{auditAll ? itens.filter((item) => item.ativo).length : expectedItems.length}</strong>.
            </p>
          </article>

          <article className="panel">
            <h2>
              <Send size={21} /> Simular leitura RFID
            </h2>
            <div className="field">
              <label htmlFor="simulation-antenna">Leitor da simulação</label>
              <select
                className="select"
                id="simulation-antenna"
                value={simulationAntennaId}
                onChange={(event) => setSimulationAntennaId(Number(event.target.value))}
              >
                {antenas.map((antena) => (
                  <option key={antena.id} value={antena.id}>
                    {antena.nome} - {antena.local_nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tags">Tags simuladas</label>
              <textarea
                className="textarea"
                id="tags"
                placeholder="Cole tags de teste, uma por linha ou separadas por vírgula"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
              />
            </div>
            <p>
              Use este campo para testar a auditoria manualmente. As tags informadas serão tratadas como se tivessem
              sido lidas pelo RFID. Se deixar vazio, a simulação considera que nenhuma tag foi encontrada.
            </p>
            <button
              disabled={!canAudit || submitting || !simulationAntennaId}
              className="button mt-3"
              type="button"
              onClick={sendAuditResult}
            >
              <CheckCircle2 size={17} />
              Processar simulação
            </button>
          </article>
        </div>
      ) : null}

      {result ? (
        <div className="grid stats mt-6">
          <StatCard label="Esperados" value={result.audit.esperados ?? "-"} />
          <StatCard label="Encontrados" value={result.audit.encontrados} tone="green" />
          <StatCard label="Não encontrados" value={result.audit.nao_encontrados} tone="red" />
          <StatCard label="Divergentes" value={result.audit.tags_fora_do_local ?? 0} tone="yellow" />
          <StatCard label="Desconhecidas" value={result.audit.tags_desconhecidas} tone="yellow" />
          <StatCard label="Total" value={result.audit.total_lidos ?? totalFromMetadata(result.audit) ?? "-"} />
        </div>
      ) : null}

      <article className="panel mt-6">
        <h2>Auditorias</h2>
        <div className="table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Local</th>
                <th>Leitor</th>
                <th>Status</th>
                <th>Esperados</th>
                <th>Lidos</th>
                <th>Ausentes</th>
                <th>Diverg.</th>
                <th>Desconh.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((audit) => (
                <Fragment key={audit.id}>
                  <tr
                    className="audit-row"
                    onClick={() => setExpandedAuditId((current) => (current === audit.id ? null : audit.id))}
                  >
                    <td>
                      <span className="audit-row-title">
                        {expandedAuditId === audit.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        {new Date(audit.data).toLocaleString("pt-BR")}
                      </span>
                    </td>
                    <td>{audit.local}</td>
                    <td>{audit.leitor}</td>
                    <td>
                      <span className={audit.status === "Processada" ? "badge green" : audit.status === "Encerrada sem leitura" ? "badge red" : "badge"}>
                        {audit.status}
                      </span>
                    </td>
                    <td>{countLabel(audit.esperados)}</td>
                    <td>{countLabel(audit.encontrados, audit.status === "Aguardando leitura" ? "Aguardando" : "-")}</td>
                    <td>{countLabel(audit.naoEncontrados, audit.status === "Aguardando leitura" ? "Aguardando" : "-")}</td>
                    <td>{countLabel(audit.divergentes, audit.status === "Aguardando leitura" ? "Aguardando" : "-")}</td>
                    <td>{countLabel(audit.desconhecidas, audit.status === "Aguardando leitura" ? "Aguardando" : "-")}</td>
                    <td>{countLabel(audit.total, audit.status === "Aguardando leitura" ? "Aguardando" : "-")}</td>
                  </tr>
                  {expandedAuditId === audit.id ? (
                    <tr className="audit-detail-row">
                      <td colSpan={10}>
                        <AuditDetail audit={audit} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {auditRows.length === 0 ? (
                <tr>
                  <td colSpan={10}>Nenhuma auditoria registrada.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function AuditDetail({ audit }: { audit: AuditHistoryRow }) {
  const waiting = audit.status === "Aguardando leitura";

  return (
    <div className="audit-detail">
      {!audit.detalhesDisponiveis ? (
        <div className="state-box">
          {waiting
            ? "A auditoria ainda está aguardando uma leitura do RFID."
            : "A janela foi encerrada sem leitura processada para detalhar."}
        </div>
      ) : (
        <>
          <div className="audit-summary-grid">
            <AuditSummaryCard label="Quantidade esperada" value={audit.esperados} help="Itens ativos cujo local lógico é o local auditado." />
            <AuditSummaryCard label="Quantidade encontrada" value={audit.encontrados} help="Itens esperados no local que foram lidos." />
            <AuditSummaryCard label="Não encontrados" value={audit.naoEncontrados} help="Itens esperados no local que não apareceram na leitura." />
            <AuditSummaryCard label="Divergentes" value={audit.divergentes} help="Itens conhecidos lidos aqui, mas cadastrados logicamente em outro local." />
            <AuditSummaryCard label="Desconhecidos" value={audit.desconhecidas} help="Tags lidas que não existem cadastradas no inventário." />
            <AuditSummaryCard label="Quantidade total" value={audit.total} help="Total de leituras: encontrados, divergentes e desconhecidos." />
          </div>

          <div className="audit-detail-lists">
            <AuditItemList title="Não encontrados" items={audit.itensNaoEncontrados} empty="Nenhum item esperado ficou sem leitura." />
            <AuditItemList title="Divergentes" items={audit.itensDivergentes} empty="Nenhum item de outro local foi lido nesta auditoria." />
            <UnknownTagsList tags={audit.tagsDesconhecidas} />
          </div>
        </>
      )}
    </div>
  );
}

function AuditSummaryCard({ label, value, help }: { label: string; value: number | null; help: string }) {
  return (
    <div className="audit-summary-card">
      <span>
        {label}
        <HelpTip text={help} />
      </span>
      <strong>{countLabel(value)}</strong>
    </div>
  );
}

function AuditItemList({ title, items, empty }: { title: string; items: AuditoriaItemResumo[]; empty: string }) {
  return (
    <div className="audit-list">
      <h3>{title}</h3>
      {items.length === 0 ? <p>{empty}</p> : null}
      {items.map((item) => (
        <div className="audit-list-item" key={`${title}-${item.id}-${item.tag_id}`}>
          <strong>{item.nome}</strong>
          <span>Tag: {item.tag_id}</span>
          <span>Local lógico: {item.local_logico_nome || "-"}</span>
          <span>Local físico: {item.local_fisico_nome || "-"}</span>
        </div>
      ))}
    </div>
  );
}

function UnknownTagsList({ tags }: { tags: string[] }) {
  return (
    <div className="audit-list">
      <h3>Desconhecidos</h3>
      {tags.length === 0 ? <p>Nenhuma tag desconhecida foi lida.</p> : null}
      {tags.map((tag) => (
        <div className="audit-list-item" key={tag}>
          <strong>Tag sem cadastro</strong>
          <span>{tag}</span>
        </div>
      ))}
    </div>
  );
}
