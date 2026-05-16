"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, History, MapPin, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { ItemPatrimonial, TimelineEvento } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/DataState";

type LocalGroup = {
  id: string;
  title: string;
  items: ItemPatrimonial[];
  divergentes: number;
  inativos: number;
};

export default function ItensPage() {
  const [itens, setItens] = useState<ItemPatrimonial[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedLocalIds, setExpandedLocalIds] = useState<Record<string, boolean>>({});
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [timelineByItem, setTimelineByItem] = useState<Record<number, TimelineEvento[]>>({});
  const [timelineLoadingId, setTimelineLoadingId] = useState<number | null>(null);
  const [timelineError, setTimelineError] = useState("");
  const [error, setError] = useState("");

  async function load(term = search) {
    setLoading(true);
    setError("");
    try {
      setItens(await api.listItens(term));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nao foi possivel carregar itens.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleTimeline(item: ItemPatrimonial) {
    const nextId = expandedItemId === item.id ? null : item.id;
    setExpandedItemId(nextId);
    setTimelineError("");
    if (!nextId || timelineByItem[item.id]) return;

    setTimelineLoadingId(item.id);
    try {
      const timeline = await api.listTimeline(item.id);
      setTimelineByItem((current) => ({ ...current, [item.id]: timeline }));
    } catch (err) {
      setTimelineError(err instanceof Error ? err.message : "Nao foi possivel carregar historico do item.");
    } finally {
      setTimelineLoadingId(null);
    }
  }

  function toggleLocal(id: string) {
    setExpandedLocalIds((current) => ({ ...current, [id]: !current[id] }));
  }

  useEffect(() => {
    load("");
  }, []);

  const groups = useMemo(() => groupByLogicalLocation(itens), [itens]);

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Patrimonio</h1>
          <p>Itens organizados por local logico para facilitar a busca e a conferencia.</p>
        </div>
      </div>

      <article className="panel">
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            load(search);
          }}
        >
          <div className="field">
            <label htmlFor="search">Busca</label>
            <input
              className="input"
              id="search"
              placeholder="Nome ou tag"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="button" type="submit">
            <Search size={17} />
            Buscar
          </button>
        </form>

        {loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && !error && itens.length === 0 ? <EmptyState label="Nenhum item encontrado." /> : null}

        {!loading && !error && groups.length > 0 ? (
          <div className="grouped-list">
            {groups.map((group) => {
              const expanded = Boolean(expandedLocalIds[group.id]);
              return (
                <section className="group-block" key={group.id}>
                  <button className="group-header" type="button" onClick={() => toggleLocal(group.id)}>
                    <span className="group-title">
                      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      <MapPin size={18} />
                      <strong>{group.title}</strong>
                    </span>
                    <span className="group-summary">
                      <span className="badge">{group.items.length} item(ns)</span>
                      {group.divergentes ? <span className="badge red">{group.divergentes} divergente(s)</span> : null}
                      {group.inativos ? <span className="badge">{group.inativos} inativo(s)</span> : null}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="compact-list">
                      {group.items.map((item) => (
                        <article className={hasLocationDivergence(item) ? "compact-row warning" : "compact-row"} key={item.id}>
                          <button className="compact-main" type="button" onClick={() => toggleTimeline(item)}>
                            <span className="compact-title">
                              {expandedItemId === item.id ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                              <strong>{item.nome}</strong>
                            </span>
                            <span>Tag {item.tag_id}</span>
                            <span>Fisico: {item.local_fisico_nome || "-"}</span>
                          </button>
                          <div className="compact-badges">
                            {hasLocationDivergence(item) ? (
                              <span className="badge red">
                                <AlertTriangle size={13} /> Divergente
                              </span>
                            ) : null}
                            <span className={item.ativo ? "badge green" : "badge red"}>{item.ativo ? "Ativo" : "Inativo"}</span>
                          </div>
                          {expandedItemId === item.id ? (
                            <div className="compact-detail">
                              <ItemTimeline
                                error={timelineError}
                                events={timelineByItem[item.id] || []}
                                item={item}
                                loading={timelineLoadingId === item.id}
                              />
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}
      </article>
    </section>
  );
}

function groupByLogicalLocation(items: ItemPatrimonial[]): LocalGroup[] {
  const groups = new Map<string, LocalGroup>();
  items.forEach((item) => {
    const id = item.local_logico_id ? String(item.local_logico_id) : "sem-local-logico";
    const title = item.local_logico_nome || "Sem local logico";
    const group = groups.get(id) || { id, title, items: [], divergentes: 0, inativos: 0 };
    group.items.push(item);
    if (hasLocationDivergence(item)) group.divergentes += 1;
    if (!item.ativo) group.inativos += 1;
    groups.set(id, group);
  });

  return Array.from(groups.values())
    .map((group) => ({ ...group, items: group.items.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) }))
    .sort((a, b) => {
      if (a.id === "sem-local-logico") return 1;
      if (b.id === "sem-local-logico") return -1;
      return a.title.localeCompare(b.title, "pt-BR");
    });
}

function hasLocationDivergence(item: ItemPatrimonial) {
  return Boolean(item.local_logico_id && item.local_fisico_id && item.local_logico_id !== item.local_fisico_id);
}

function ItemTimeline({
  error,
  events,
  item,
  loading
}: {
  error: string;
  events: TimelineEvento[];
  item: ItemPatrimonial;
  loading: boolean;
}) {
  return (
    <div className="item-timeline">
      <div className="item-timeline-head">
        <div>
          <strong>
            <History size={17} /> Historico de {item.nome}
          </strong>
          <span>
            Tag {item.tag_id} | logico: {item.local_logico_nome || "-"} | fisico: {item.local_fisico_nome || "-"}
          </span>
        </div>
      </div>

      {loading ? <LoadingState label="Carregando historico do item" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && events.length === 0 ? <EmptyState label="Nenhum evento registrado para este item." /> : null}

      {!loading && !error && events.length > 0 ? (
        <div className="item-timeline-list">
          {events.map((event) => (
            <div className="item-timeline-event" key={event.id}>
              <span className="badge">{event.tipo}</span>
              <div>
                <strong>{event.mensagem}</strong>
                <span>{new Date(event.criado_em).toLocaleString("pt-BR")}</span>
                <small>{metadataSummary(event.metadados) || "Sem metadados relevantes."}</small>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function metadataSummary(metadata: Record<string, unknown>) {
  const labels: Record<string, string> = {
    evento: "evento",
    tag_id: "tag",
    local_id: "local",
    antenna_id: "leitor",
    motivo: "motivo",
    tipo: "tipo",
    inconsistencia_id: "inconsistencia"
  };
  return Object.keys(labels)
    .map((key) => {
      const value = metadata[key];
      if (value === undefined || value === null || value === "") return null;
      return `${labels[key]}: ${String(value)}`;
    })
    .filter(Boolean)
    .join(" | ");
}
