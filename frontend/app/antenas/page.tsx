"use client";

import { useEffect, useRef, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { isLatestRequest, useDelayedLoading } from "@/lib/requestState";
import { useAuth } from "@/context/AuthContext";
import type { AcionamentoResponse, Antena } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/DataState";

type ActiveProcess = {
  label: string;
  detail: string;
  startedAt: number;
  expiresAt: number;
};

function commandLabel(command: AcionamentoResponse) {
  return `Auditoria iniciada até ${new Date(command.expires_at).toLocaleTimeString("pt-BR")}`;
}

export default function AntenasPage() {
  const [antenas, setAntenas] = useState<Antena[]>([]);
  const { user: currentUser } = useAuth();
  const [duracao, setDuracao] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [lastCommand, setLastCommand] = useState<AcionamentoResponse | null>(null);
  const [activeProcess, setActiveProcess] = useState<ActiveProcess | null>(null);
  const [finishedMessage, setFinishedMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const loadRequestId = useRef(0);
  const showLoading = useDelayedLoading(loading);

  async function load(force = false) {
    const requestId = ++loadRequestId.current;
    setError("");
    const responseCached = api.listAntenasCached({ page_size: 100 }, { force });
    if (responseCached.data) {
      setAntenas(responseCached.data.results);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const response = await responseCached.promise;
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setAntenas(response.results);
    } catch (err) {
      if (!isLatestRequest(requestId, loadRequestId)) return;
      setError(err instanceof Error ? err.message : "Não foi possível carregar leitores.");
    } finally {
      if (isLatestRequest(requestId, loadRequestId)) {
        setLoading(false);
      }
    }
  }

  async function acionar(id: number) {
    setBusyId(id);
    setError("");
    try {
      const response = await api.auditarAntena(id, duracao);
      setLastCommand(response);
      setFinishedMessage("");
      setActiveProcess({
        label: "Auditoria em andamento",
        detail: "O leitor está coletando tags para conferir o local.",
        startedAt: Date.now(),
        expiresAt: new Date(response.expires_at).getTime()
      });
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao acionar leitor.");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!activeProcess) return;
    const timer = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, [activeProcess]);

  useEffect(() => {
    if (!activeProcess || now < activeProcess.expiresAt) return;

    const label = activeProcess.label;
    setActiveProcess(null);
    setFinishedMessage(`${label.replace("em andamento", "concluída")}. Dados atualizados.`);
    load(true);
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
          <h1>Leitores RFID</h1>
          <p>Acione janelas de sincronização e acompanhe o status das antenas cadastradas.</p>
        </div>
        <button className="button ghost" type="button" onClick={() => load(true)}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </div>

      <div className="panel">
        <div className="toolbar">
          <div className="field">
            <label htmlFor="duracao">Duração da janela</label>
            <input
              className="input"
              id="duracao"
              min={1}
              type="number"
              value={duracao}
              onChange={(event) => setDuracao(Number(event.target.value))}
            />
          </div>
          {lastCommand ? <span className="badge green">{commandLabel(lastCommand)}</span> : null}
        </div>

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

        {showLoading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && !error && antenas.length === 0 ? <EmptyState label="Nenhum leitor cadastrado." /> : null}

        {!loading && antenas.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table readers-table">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Leitor</th>
                  <th>Local</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th>Último ping</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {antenas.map((antena) => (
                  <tr key={antena.id}>
                    <td>
                      <strong>{antena.nome}</strong>
                      <br />
                      <small>{antena.hardware_id}</small>
                    </td>
                    <td>{antena.local_nome}</td>
                    <td className="type-cell">{antena.tipo_display}</td>
                    <td className="status-cell">
                      <span className={antena.online ? "badge green" : "badge red"}>
                        {antena.online ? "Online" : "Offline"}
                      </span>{" "}
                      {antena.ativa ? <span className="badge">Ativa</span> : null}
                    </td>
                    <td className="date-cell">{antena.ultimo_ping ? new Date(antena.ultimo_ping).toLocaleString("pt-BR") : "-"}</td>
                    <td className="actions-cell">
                      <div className="action-buttons">
                        {!canAudit ? <span className="muted-text">Sem permissões</span> : null}
                        {canAudit ? (
                        <button
                          className="button yellow action-button"
                          disabled={!antena.online || busyId === antena.id}
                          title={antena.online ? "Abrir auditoria do local" : "Leitor offline"}
                          type="button"
                          onClick={() => acionar(antena.id)}
                        >
                          <Radar size={17} />
                          Auditar
                        </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
