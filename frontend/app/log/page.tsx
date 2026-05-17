"use client";

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Filter, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { compactRfidTag, labelEventName, labelMetadataKey, labelTimelineTipo } from "@/lib/display";
import { isLatestRequest, useDelayedLoading } from "@/lib/requestState";
import type { Antena, Local, PaginatedResponse, TimelineEvento } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/DataState";
import { PaginationControls } from "@/components/ui/PaginationControls";

type LogFilters = {
  search: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  local_id: string;
  antenna_id: string;
  me: boolean;
};

type LogTab = "todos" | "itens" | "auditorias" | "inconsistencias" | "sistema";
type LogContext = "item" | "auditoria" | "inconsistencia" | "sistema";
type DetailItem = { key: string; label: string; value: string };
type DetailSection = { title: string; items: DetailItem[] };
type DetailPanelData = { sections: DetailSection[]; technicalItems: DetailItem[] };

const emptyFilters: LogFilters = {
  search: "",
  tipo: "",
  data_inicio: "",
  data_fim: "",
  local_id: "",
  antenna_id: "",
  me: false
};

const tipoOptions = [
  { value: "", label: "Todos" },
  { value: "movimentacao", label: "Movimentação" },
  { value: "inconsistencia", label: "Inconsistência" },
  { value: "rastro", label: "Rastro" },
  { value: "baixa", label: "Baixa" },
  { value: "sistema", label: "Sistema" }
];

const logTabs: { value: LogTab; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "itens", label: "Itens" },
  { value: "auditorias", label: "Auditorias" },
  { value: "inconsistencias", label: "Inconsistências" },
  { value: "sistema", label: "Sistema" }
];

const auditEvents = new Set([
  "auditoria_iniciada",
  "auditoria_processada",
  "auditoria_concluida",
  "item_lido_local_correto"
]);

const inconsistencyEvents = new Set([
  "local_divergente",
  "item_fora_do_local_auditado",
  "item_nao_encontrado",
  "tag_desconhecida",
  "item_reencontrado",
  "reconciliacao",
  "local_logico_confirmado",
  "tag_desconhecida_cadastrada",
  "tag_desconhecida_associada"
]);

const itemTypes = new Set(["movimentacao", "rastro", "baixa"]);

export default function LogPage() {
  const [data, setData] = useState<TimelineEvento[]>([]);
  const [pageData, setPageData] = useState<PaginatedResponse<TimelineEvento> | null>(null);
  const [locais, setLocais] = useState<Local[]>([]);
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const [filters, setFilters] = useState<LogFilters>(emptyFilters);
  const [activeTab, setActiveTab] = useState<LogTab>("todos");
  const [page, setPage] = useState(1);
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRequestId = useRef(0);
  const showLoading = useDelayedLoading(loading);

  const pageSize = 25;

  async function load(nextFilters = filters, nextPage = page) {
    const requestId = ++loadRequestId.current;
    if (data.length === 0) setLoading(true);
    setError("");
    const validationError = validateDateFilters(nextFilters);
    if (validationError) {
      setData([]);
      setError(validationError);
      setLoading(false);
      return;
    }
    try {
      const timelineData = await api.listTimeline({
        search: nextFilters.search,
        tipo: nextFilters.tipo,
        data_inicio: toApiDate(nextFilters.data_inicio),
        data_fim: toApiDate(nextFilters.data_fim),
        local_id: nextFilters.local_id ? Number(nextFilters.local_id) : undefined,
        antenna_id: nextFilters.antenna_id ? Number(nextFilters.antenna_id) : undefined,
        me: nextFilters.me || undefined,
        page: nextPage,
        page_size: pageSize
      });
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setData(timelineData.results);
      setPageData(timelineData);
      setPage(nextPage);
      setExpandedEventId(null);
      setLoading(false);

      try {
        const [locaisData, antenasData] = await Promise.all([api.listLocais({ page_size: 100 }), api.listAntenas({ page_size: 100 })]);
        if (!isLatestRequest(requestId, loadRequestId)) return;
        setLocais(locaisData.results);
        setAntenas(antenasData.results);
      } catch (lookupError) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[log] Falha ao carregar filtros auxiliares", lookupError);
        }
      }
    } catch (err) {
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar o log.");
    } finally {
      if (isLatestRequest(requestId, loadRequestId)) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load(emptyFilters, 1);
  }, []);

  useEffect(() => {
    setExpandedEventId(null);
  }, [activeTab]);

  const visibleData = useMemo(() => data.filter((evento) => eventMatchesTab(evento, activeTab)), [activeTab, data]);

  const activeFilters = useMemo(
    () =>
      Object.entries(filters).filter(([, value]) => {
        if (typeof value === "boolean") return value;
        return Boolean(value);
      }).length,
    [filters]
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(filters, 1);
  }

  function resetFilters() {
    setFilters(emptyFilters);
    load(emptyFilters, 1);
  }

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Log operacional</h1>
          <p>Consulte eventos por contexto: itens, auditorias, inconsistências e sistema.</p>
        </div>
        <button className="button ghost" type="button" onClick={() => load(filters)}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>

      <article className="panel">
        <form className="log-filters" onSubmit={submit}>
          <label className="field">
            <span>Busca</span>
            <input
              className="input"
              placeholder="Mensagem, item ou tag"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </label>

          <label className="field">
            <span>Tipo</span>
            <select className="select" value={filters.tipo} onChange={(event) => setFilters({ ...filters, tipo: event.target.value })}>
              {tipoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Inicio</span>
            <DateField
              value={filters.data_inicio}
              onChange={(data_inicio) => setFilters({ ...filters, data_inicio })}
            />
          </label>

          <label className="field">
            <span>Fim</span>
            <DateField
              value={filters.data_fim}
              onChange={(data_fim) => setFilters({ ...filters, data_fim })}
            />
          </label>

          <label className="field">
            <span>Local</span>
            <select className="select" value={filters.local_id} onChange={(event) => setFilters({ ...filters, local_id: event.target.value })}>
              <option value="">Todos</option>
              {locais.map((local) => (
                <option key={local.id} value={local.id}>
                  {local.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Leitor</span>
            <select className="select" value={filters.antenna_id} onChange={(event) => setFilters({ ...filters, antenna_id: event.target.value })}>
              <option value="">Todos</option>
              {antenas.map((antena) => (
                <option key={antena.id} value={antena.id}>
                  {antena.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="check-field log-check">
            <input checked={filters.me} type="checkbox" onChange={(event) => setFilters({ ...filters, me: event.target.checked })} />
            <span>Somente meus eventos</span>
          </label>

          <div className="log-actions">
            <button className="button ghost log-action-button" type="button" onClick={resetFilters}>
              <Filter size={17} />
              Limpar
            </button>
            <button className="button log-action-button" type="submit">
              <Search size={17} />
              Filtros: {activeFilters}
            </button>
          </div>
        </form>

        <div className="log-tabs" role="tablist" aria-label="Contexto do log">
          {logTabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.value}
              className={activeTab === tab.value ? "log-tab active" : "log-tab"}
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {showLoading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && !error && data.length === 0 ? <EmptyState label="Nenhum evento encontrado para os filtros atuais." /> : null}
        {!loading && !error && data.length > 0 && visibleData.length === 0 ? <EmptyState label="Nenhum evento neste contexto." /> : null}

        {!loading && visibleData.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table log-table">
              <thead>
                <tr>
                  <th aria-label="Detalhes" />
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Resumo</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {visibleData.map((evento) => {
                  const expanded = expandedEventId === evento.id;
                  const context = getLogContext(evento);
                  return (
                    <Fragment key={evento.id}>
                      <tr
                        className={expanded ? "log-row active" : "log-row"}
                        onClick={() => setExpandedEventId((current) => (current === evento.id ? null : evento.id))}
                      >
                        <td>
                          <button
                            aria-label={expanded ? "Ocultar detalhes" : "Mostrar detalhes"}
                            className="icon-action log-expand-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedEventId((current) => (current === evento.id ? null : evento.id));
                            }}
                          >
                            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                          </button>
                        </td>
                        <td>{new Date(evento.criado_em).toLocaleString("pt-BR")}</td>
                        <td>
                          <span className={`badge log-context-badge ${context}`}>{displayType(evento)}</span>
                        </td>
                        <td>
                          <strong>{eventSummary(evento)}</strong>
                          {eventSubtext(evento) ? <span className="log-subtext">{eventSubtext(evento)}</span> : null}
                        </td>
                        <td>{evento.usuario_nome || evento.usuario_id || "-"}</td>
                      </tr>
                      {expanded ? (
                        <tr className="log-row-expanded" key={`${evento.id}-details`}>
                          <td colSpan={5}>
                            <LogEventDetails evento={evento} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && !error && pageData ? <PaginationControls data={pageData} page={page} pageSize={pageSize} onPageChange={(nextPage) => load(filters, nextPage)} /> : null}
      </article>
    </section>
  );
}

function DateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const pickerRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    } else {
      picker.click();
    }
  }

  return (
    <div className="date-field">
      <input
        className="input"
        inputMode="numeric"
        maxLength={10}
        placeholder="dd/mm/aaaa"
        value={value}
        onChange={(event) => onChange(formatDateInput(event.target.value))}
      />
      <button className="date-picker-button" type="button" onClick={openPicker} title="Escolher data">
        <CalendarDays size={18} />
      </button>
      <input
        ref={pickerRef}
        aria-hidden="true"
        className="native-date-picker"
        max="2100-12-31"
        min="1900-01-01"
        tabIndex={-1}
        type="date"
        value={toApiDate(value)}
        onChange={(event) => onChange(fromApiDate(event.target.value))}
      />
    </div>
  );
}

function validateDateFilters(filters: LogFilters) {
  const start = parseValidDate(filters.data_inicio);
  const end = parseValidDate(filters.data_fim);
  if (filters.data_inicio && !start) return "Informe uma data inicial válida.";
  if (filters.data_fim && !end) return "Informe uma data final válida.";
  if (start && end && start.getTime() > end.getTime()) {
    return "A data inicial não pode ser maior que a data final.";
  }
  return "";
}

function parseValidDate(value: string) {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || year > 2100) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  return [day, month, year].filter(Boolean).join("/");
}

function toApiDate(value: string) {
  const date = parseValidDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromApiDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function LogEventDetails({ evento }: { evento: TimelineEvento }) {
  const details = eventDetailSections(evento);

  return (
    <div className="log-detail-panel">
      <div className="log-message-box">
        <span>Mensagem</span>
        <p>{evento.mensagem || "Sem mensagem registrada."}</p>
      </div>

      {details.sections.length > 0 ? (
        <div className="log-detail-sections">
          {details.sections.map((section) => (
            <div className="log-detail-section" key={section.title}>
              <span className="log-detail-title">{section.title}</span>
              <dl className="log-detail-list">
                {section.items.map((item) => (
                  <div className="log-detail-line" key={item.key}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <span className="log-detail-title">Detalhes</span>
          <div className="log-empty-detail">Sem detalhes adicionais.</div>
        </div>
      )}

      {details.technicalItems.length > 0 ? (
        <details className="log-technical-details">
          <summary>Metadados técnicos</summary>
          <div className="log-detail-grid">
            {details.technicalItems.map((item) => (
              <div className="log-detail-item" key={item.key}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function eventMatchesTab(evento: TimelineEvento, tab: LogTab) {
  if (tab === "todos") return true;
  if (tab === "auditorias") return isAuditEvent(evento);
  if (tab === "inconsistencias") return isInconsistencyEvent(evento);
  if (tab === "itens") return isItemEvent(evento);
  return isSystemEvent(evento);
}

function getLogContext(evento: TimelineEvento): LogContext {
  if (isAuditEvent(evento)) return "auditoria";
  if (isInconsistencyEvent(evento)) return "inconsistencia";
  if (isItemEvent(evento)) return "item";
  return "sistema";
}

function isAuditEvent(evento: TimelineEvento) {
  const metadata = evento.metadados || {};
  const eventName = metadataValue(metadata, "evento");
  return Boolean(
    metadata.audit ||
      metadata.auditoria_job_id ||
      metadata.auditoria_execucao_id ||
      metadata.itens_esperados ||
      metadata.itens_encontrados ||
      metadata.itens_nao_encontrados ||
      metadata.itens_divergentes ||
      auditEvents.has(eventName)
  );
}

function isInconsistencyEvent(evento: TimelineEvento) {
  const eventName = metadataValue(evento.metadados || {}, "evento");
  return evento.tipo === "inconsistencia" || inconsistencyEvents.has(eventName);
}

function isItemEvent(evento: TimelineEvento) {
  return Boolean(evento.item_id || evento.item_nome || evento.item_tag || itemTypes.has(evento.tipo));
}

function isSystemEvent(evento: TimelineEvento) {
  return !isAuditEvent(evento) && !isInconsistencyEvent(evento) && !isItemEvent(evento);
}

function displayType(evento: TimelineEvento) {
  const eventName = metadataValue(evento.metadados || {}, "evento");
  if (eventName) return labelEventName(eventName);

  const context = getLogContext(evento);
  if (context === "auditoria") return "Auditoria";
  if (context === "inconsistencia") return "Inconsistência";
  if (context === "item") return eventTypeLabel(evento.tipo);
  return "Sistema";
}

function eventTypeLabel(type: string) {
  return labelTimelineTipo(type);
}

function eventSummary(evento: TimelineEvento) {
  const metadata = evento.metadados || {};
  const eventName = metadataValue(metadata, "evento");

  if (evento.item_nome) return evento.item_nome;
  if (metadataValue(metadata, "tag_id")) return `Tag ${compactRfidTag(metadataValue(metadata, "tag_id"))}`;
  if (eventName) return eventNameLabel(eventName);
  if (metadataValue(metadata, "auditoria_job_id")) return `Auditoria #${metadataValue(metadata, "auditoria_job_id")}`;
  return eventTypeLabel(evento.tipo);
}

function eventSubtext(evento: TimelineEvento) {
  const metadata = evento.metadados || {};
  const tag = evento.item_tag || metadataValue(metadata, "tag_id");
  const parts = [
    tag ? compactRfidTag(tag) : "",
    metadataValue(metadata, "local_nome") || idLabel("local", metadataValue(metadata, "local_id")),
    metadataValue(metadata, "antenna_nome") || idLabel("leitor", metadataValue(metadata, "antenna_id")),
    eventNameLabel(metadataValue(metadata, "evento"))
  ].filter(Boolean);
  return uniqueValues(parts).slice(0, 3).join(" | ");
}

function eventDetailSections(evento: TimelineEvento): DetailPanelData {
  const metadata = evento.metadados || {};
  const usedKeys = new Set<string>();
  const sections: DetailSection[] = [];
  const context = getLogContext(evento);

  if (context === "auditoria" || isAuditEvent(evento)) {
    addSection(sections, "Resumo da auditoria", detailsFromKeys(metadata, usedKeys, [
      "evento",
      "total_lidos",
      "esperados",
      "encontrados",
      "nao_encontrados",
      "tags_desconhecidas",
      "tags_fora_do_local",
      "duracao_segundos",
      "finaliza_em"
    ]));
    addSection(sections, "Resultado da auditoria", detailsFromKeys(metadata, usedKeys, [
      "itens_esperados",
      "itens_encontrados",
      "itens_nao_encontrados",
      "itens_divergentes",
      "tags_desconhecidas_lista"
    ]));
  }

  if (context === "item" || isItemEvent(evento)) {
    addSection(sections, "Item", [
      detailFromValue("item_nome", "Item", evento.item_nome),
      detailFromValue("item_tag", "Tag", evento.item_tag),
      ...detailsFromKeys(metadata, usedKeys, ["tag_id", "local_anterior_id", "local_id", "local_nome", "antenna_id", "antenna_nome", "motivo", "ja_estava_inativo"])
    ]);
  }

  if (context === "inconsistencia" || isInconsistencyEvent(evento)) {
    addSection(sections, "Inconsistência", detailsFromKeys(metadata, usedKeys, [
      "inconsistencia_id",
      "inconsistencia_ids",
      "tipo",
      "evento",
      "tag_id",
      "local_logico_nome",
      "local_fisico_nome",
      "local_id",
      "antenna_id",
      "motivo"
    ]));
  }

  if (context === "sistema") {
    addSection(sections, "Sistema", detailsFromKeys(metadata, usedKeys, [
      "evento",
      "command_delivery",
      "antenna_nome",
      "motivo"
    ]));
  }

  const technicalItems = formatMetadata(metadata, new Set<string>(), true);
  return {
    sections: sections.filter((section) => section.items.length > 0),
    technicalItems
  };
}

function addSection(sections: DetailSection[], title: string, items: Array<DetailItem | null>) {
  const validItems = items.filter(Boolean) as DetailItem[];
  if (validItems.length > 0) {
    sections.push({ title, items: validItems });
  }
}

function detailsFromKeys(metadata: Record<string, unknown>, usedKeys: Set<string>, keys: string[]) {
  return keys.map((key) => {
    if (usedKeys.has(key) || !(key in metadata)) return null;
    usedKeys.add(key);
    return detailFromValue(key, metadataLabel(key), metadata[key], false);
  });
}

function detailFromValue(key: string, label: string, value: unknown, technical = false): DetailItem | null {
  if (value === undefined || value === null || value === "") return null;
  return {
    key,
    label,
    value: key === "tag_id" || key === "item_tag" ? compactRfidTag(String(value)) : metadataValue(value, undefined, technical)
  };
}

function formatMetadata(metadata: Record<string, unknown>, usedKeys = new Set<string>(), technical = true) {
  return Object.entries(metadata || {})
    .filter(([key, value]) => !usedKeys.has(key) && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({
      key,
      label: metadataLabel(key),
      value: metadataValue(value, undefined, technical)
    }));
}

function metadataValue(value: unknown, key?: undefined, technical?: boolean): string;
function metadataValue(metadata: Record<string, unknown>, key: string, technical?: boolean): string;
function metadataValue(valueOrMetadata: unknown, key?: string, technical = true): string {
  if (key) {
    const metadata = valueOrMetadata as Record<string, unknown>;
    const value = metadata[key];
    return value === undefined || value === null || value === "" ? "" : metadataValue(value, undefined, technical);
  }

  const value = valueOrMetadata;
  if (Array.isArray(value)) {
    if (value.length === 0) return "Nenhum";
    return value.map((item) => metadataValue(item, undefined, technical)).join("\n");
  }

  if (typeof value === "object" && value !== null) {
    if (!technical && isAuditItem(value as Record<string, unknown>)) {
      return formatAuditItem(value as Record<string, unknown>);
    }

    return Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
      .filter(([entryKey]) => technical || !technicalMetadataKeys.has(entryKey))
      .map(([entryKey, entryValue]) => `${metadataLabel(entryKey)}: ${metadataValue(entryValue, undefined, technical)}`)
      .join("; ");
  }

  if (typeof value === "boolean") {
    return value ? "sim" : "não";
  }

  return String(value);
}

function metadataLabel(key: string) {
  return labelMetadataKey(key);
}

function eventNameLabel(value: string) {
  return labelEventName(value);
}

function idLabel(label: string, value: string) {
  return value ? `${label} ${value}` : "";
}

function uniqueValues(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

const technicalMetadataKeys = new Set([
  "audit",
  "source",
  "auditoria_job_id",
  "auditoria_execucao_id",
  "antenna_id",
  "antenna_ids",
  "local_id",
  "hardware_id",
  "command_url",
  "total_antenas"
]);

function isAuditItem(value: Record<string, unknown>) {
  return Boolean(value.nome || value.tag_id || value.local_logico_nome || value.local_fisico_nome);
}

function formatAuditItem(value: Record<string, unknown>) {
  const parts = [
    metadataValue(value, "nome"),
    metadataValue(value, "tag_id") ? `tag ${compactRfidTag(metadataValue(value, "tag_id"))}` : "",
    metadataValue(value, "local_logico_nome") ? `local ${metadataValue(value, "local_logico_nome")}` : "",
    metadataValue(value, "local_fisico_nome") ? `fisico ${metadataValue(value, "local_fisico_nome")}` : ""
  ].filter(Boolean);
  return parts.join(" - ") || "Item sem identificação";
}
