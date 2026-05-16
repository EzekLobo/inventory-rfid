"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Filter, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
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

export default function LogPage() {
  const [data, setData] = useState<TimelineEvento[]>([]);
  const [pageData, setPageData] = useState<PaginatedResponse<TimelineEvento> | null>(null);
  const [locais, setLocais] = useState<Local[]>([]);
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const [filters, setFilters] = useState<LogFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const pageSize = 25;

  async function load(nextFilters = filters, nextPage = page) {
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
      const [timelineData, locaisData, antenasData] = await Promise.all([
        api.listTimeline({
          search: nextFilters.search,
          tipo: nextFilters.tipo,
          data_inicio: toApiDate(nextFilters.data_inicio),
          data_fim: toApiDate(nextFilters.data_fim),
          local_id: nextFilters.local_id ? Number(nextFilters.local_id) : undefined,
          antenna_id: nextFilters.antenna_id ? Number(nextFilters.antenna_id) : undefined,
          me: nextFilters.me || undefined,
          page: nextPage,
          page_size: pageSize
        }),
        api.listLocais({ page_size: 100 }),
        api.listAntenas({ page_size: 100 })
      ]);
      setData(timelineData.results);
      setPageData(timelineData);
      setLocais(locaisData.results);
      setAntenas(antenasData.results);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(emptyFilters, 1);
  }, []);

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
          <p>Consulte eventos do sistema por item, tipo, período, local, leitor e usuário.</p>
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
            <span>Início</span>
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

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && !error && data.length === 0 ? <EmptyState label="Nenhum evento encontrado." /> : null}

        {!loading && data.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table log-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Item</th>
                  <th>Mensagem</th>
                  <th>Detalhes</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {data.map((evento) => (
                  <tr key={evento.id}>
                    <td>{new Date(evento.criado_em).toLocaleString("pt-BR")}</td>
                    <td>
                      <span className="badge">{evento.tipo}</span>
                    </td>
                    <td>
                      <strong>{evento.item_nome || "-"}</strong>
                      {evento.item_tag ? <span className="log-subtext">{evento.item_tag}</span> : null}
                    </td>
                    <td>{evento.mensagem}</td>
                    <td>{metadataSummary(evento.metadados)}</td>
                    <td>{evento.usuario_nome || evento.usuario_id || "-"}</td>
                  </tr>
                ))}
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

function metadataSummary(metadata: Record<string, unknown>) {
  const keys = ["evento", "tag_id", "local_id", "antenna_id", "motivo", "tipo", "inconsistencia_id"];
  const parts = keys
    .map((key) => {
      const value = metadata[key];
      if (value === undefined || value === null || value === "") return null;
      return `${labelForMetadata(key)}: ${String(value)}`;
    })
    .filter(Boolean);
  return parts.length > 0 ? <span className="log-subtext">{parts.join(" | ")}</span> : "-";
}

function labelForMetadata(key: string) {
  const labels: Record<string, string> = {
    evento: "evento",
    tag_id: "tag",
    local_id: "local",
    antenna_id: "leitor",
    motivo: "motivo",
    tipo: "tipo",
    inconsistencia_id: "inconsistencia"
  };
  return labels[key] || key;
}
