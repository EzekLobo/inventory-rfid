"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Antenna, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { compactRfidTag, fullRfidTag, labelInconsistenciaTipo, labelTimelineTipo } from "@/lib/display";
import { isLatestRequest, useDelayedLoading } from "@/lib/requestState";
import type { Antena, Inconsistencia, OperacionalResumo, TimelineEvento } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/DataState";
import { StatCard } from "@/components/ui/StatCard";

export default function HomePage() {
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const [inconsistencias, setInconsistencias] = useState<Inconsistencia[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvento[]>([]);
  const [resumo, setResumo] = useState<OperacionalResumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRequestId = useRef(0);
  const showLoading = useDelayedLoading(loading);

  function applyData(
    antenasData: Awaited<ReturnType<typeof api.listAntenas>>,
    resumoData: Awaited<ReturnType<typeof api.resumo>>,
    inconsistenciasData: Awaited<ReturnType<typeof api.listInconsistencias>>,
    timelineData: Awaited<ReturnType<typeof api.listTimeline>>
  ) {
    setAntenas(antenasData.results);
    setResumo(resumoData);
    setInconsistencias(inconsistenciasData.results);
    setTimeline(timelineData.results);
  }

  async function load(force = false) {
    const requestId = ++loadRequestId.current;
    setError("");
    const antenasCached = api.listAntenasCached({ page_size: 5 }, { force });
    const resumoCached = api.resumoCached({ force });
    const inconsistenciasCached = api.listInconsistenciasCached({ resolvida: "false", page_size: 5 }, { force });
    const timelineCached = api.listTimelineCached({ page_size: 8 }, { force });
    if (antenasCached.data && resumoCached.data && inconsistenciasCached.data && timelineCached.data) {
      applyData(antenasCached.data, resumoCached.data, inconsistenciasCached.data, timelineCached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const [antenasResult, resumoResult, inconsistenciasResult, timelineResult] = await Promise.allSettled([
        antenasCached.promise,
        resumoCached.promise,
        inconsistenciasCached.promise,
        timelineCached.promise
      ]);
      if (!isLatestRequest(requestId, loadRequestId)) return;
      if (antenasResult.status === "rejected") throw antenasResult.reason;
      if (resumoResult.status === "rejected") throw resumoResult.reason;
      if (inconsistenciasResult.status === "rejected") throw inconsistenciasResult.reason;

      setAntenas(antenasResult.value.results);
      setResumo(resumoResult.value);
      setInconsistencias(inconsistenciasResult.value.results);
      if (timelineResult.status === "fulfilled") {
        setTimeline(timelineResult.value.results);
      } else {
        setTimeline([]);
        if (process.env.NODE_ENV === "development") {
          console.warn("[home] Falha ao carregar atividade recente", timelineResult.reason);
        }
      }
    } catch (err) {
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar o painel.");
    } finally {
      if (isLatestRequest(requestId, loadRequestId)) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(
    () => ({
      leitoresOnline: resumo?.leitores_online || 0,
      leitoresAtivos: resumo?.leitores_ativos || 0,
      itensAtivos: resumo?.itens_ativos || 0,
      inconsistencias: resumo?.inconsistencias_abertas || 0
    }),
    [resumo]
  );

  return (
    <>
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Controle patrimonial inteligente</span>
          <h1>
            Inventário <br />
            RFID COLCIC
          </h1>
          <p>
            Gerencie leitores, acione janelas de leitura, execute auditorias e acompanhe inconsistências entre
            inventário lógico e físico.
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <img className="hero-image" src="/assets/hero-inventario.png" alt="" />
        </div>
      </section>

      <section className="content-band">
        {showLoading ? <LoadingState label="Carregando painel operacional" /> : null}
        {error ? <ErrorState message={error} /> : null}

        {!loading && !error ? (
          <>
            <div className="grid stats">
              <StatCard label="Leitores online" value={stats.leitoresOnline} tone="green" />
              <StatCard label="Leitores ativos" value={stats.leitoresAtivos} />
              <StatCard label="Itens ativos" value={stats.itensAtivos} tone="yellow" />
              <StatCard label="Inconsistências abertas" value={stats.inconsistencias} tone="red" />
            </div>

            <div className="stack-section">
              <div className="section-head">
                <div>
                  <h2>Operação</h2>
                  <p>Atalhos e situação recente do sistema.</p>
                </div>
                <button className="button ghost" type="button" onClick={() => load(true)}>
                  <RefreshCw size={18} />
                  Atualizar
                </button>
              </div>

              <div className="grid two">
                <article className="panel">
                  <h3>
                    <Antenna size={20} /> Leitores
                  </h3>
                  <div className="table-wrap">
                    <table className="data-table dashboard-table">
                      <colgroup>
                        <col style={{ width: "34%" }} />
                        <col style={{ width: "46%" }} />
                        <col style={{ width: "20%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>Local</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {antenas.slice(0, 5).map((antena) => (
                          <tr key={antena.id}>
                            <td>{antena.nome}</td>
                            <td>{antena.local_nome}</td>
                            <td className="status-cell">
                              <span className={antena.online ? "badge green" : "badge red"}>
                                {antena.online ? "Online" : "Offline"}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {antenas.length === 0 ? (
                          <tr>
                            <td colSpan={3}>Nenhum leitor cadastrado.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="panel">
                  <h3>
                    <AlertTriangle size={20} /> Inconsistências recentes
                  </h3>
                  <div className="table-wrap">
                    <table className="data-table dashboard-table">
                      <colgroup>
                        <col style={{ width: "32%" }} />
                        <col style={{ width: "40%" }} />
                        <col style={{ width: "28%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Tag</th>
                          <th>Criada em</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inconsistencias.slice(0, 5).map((item) => {
                          const tag = fullRfidTag(item.tag_id || item.item_id);
                          return (
                            <tr key={item.id}>
                              <td className="type-cell">{labelInconsistenciaTipo(item.tipo)}</td>
                              <td className="rfid-tag-cell" title={tag}>{compactRfidTag(tag)}</td>
                              <td className="date-cell">{new Date(item.criado_em).toLocaleString("pt-BR")}</td>
                            </tr>
                          );
                        })}
                        {inconsistencias.length === 0 ? (
                          <tr>
                            <td colSpan={3}>Nenhuma inconsistência aberta.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>

              <article className="panel mt-4">
                <h3>
                  <Activity size={20} /> Atividade recente
                </h3>
                <div className="table-wrap">
                  <table className="data-table dashboard-table">
                    <colgroup>
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "58%" }} />
                      <col style={{ width: "24%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Evento</th>
                        <th>Mensagem</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.slice(0, 8).map((evento) => (
                        <tr key={evento.id}>
                          <td className="type-cell">
                            <span className="badge">{labelTimelineTipo(evento.tipo)}</span>
                          </td>
                          <td>{evento.mensagem}</td>
                          <td className="date-cell">{new Date(evento.criado_em).toLocaleString("pt-BR")}</td>
                        </tr>
                      ))}
                      {timeline.length === 0 ? (
                        <tr>
                          <td colSpan={3}>Nenhum evento recente encontrado.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
