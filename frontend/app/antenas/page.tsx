"use client";

import { useEffect, useState } from "react";
import { Play, Radar, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
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
  const action = command.status === "auditoria_iniciada" ? "Auditoria iniciada" : "Sincronização iniciada";
  return `${action} até ${new Date(command.expires_at).toLocaleTimeString("pt-BR")}`;
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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await api.listAntenas({ page_size: 100 });
      setAntenas(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar leitores.");
    } finally {
      setLoading(false);
    }
  }

  async function acionar(id: number, audit = false) {
    setBusyId(id);
    setError("");
    try {
      const response = audit ? await api.auditarAntena(id, duracao) : await api.ativarAntena(id, duracao);
      setLastCommand(response);
      setFinishedMessage("");
      setActiveProcess({
        label: audit ? "Auditoria em andamento" : "Sincronização em andamento",
        detail: audit
          ? "O leitor está coletando tags para conferir o local."
          : "O leitor está coletando tags para atualizar a localização física.",
        startedAt: Date.now(),
        expiresAt: new Date(response.expires_at).getTime()
      });
      await load();
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
    load();
  }, [activeProcess, now]);

  const processProgress = activeProcess
    ? Math.min(100, Math.max(0, ((now - activeProcess.startedAt) / (activeProcess.expiresAt - activeProcess.startedAt)) * 100))
    : 0;
  const remainingSeconds = activeProcess ? Math.max(0, Math.ceil((activeProcess.expiresAt - now) / 1000)) : 0;
  const canSync = Boolean(currentUser?.permissions.acionar_leitores);
  const canAudit = Boolean(currentUser?.permissions.executar_auditoria);

  return (
    <section className="content-band">
      <div className="section-head">
        <div>
          <h1>Leitores RFID</h1>
          <p>Acione janelas de sincronização e acompanhe o status das antenas cadastradas.</p>
        </div>
        <button className="button ghost" type="button" onClick={load}>
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

        {loading ? <LoadingState /> : null}
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
                    <td>{antena.tipo_display}</td>
                    <td>
                      <span className={antena.online ? "badge green" : "badge red"}>
                        {antena.online ? "Online" : "Offline"}
                      </span>{" "}
                      {antena.ativa ? <span className="badge">Ativa</span> : null}
                    </td>
                    <td>{antena.ultimo_ping ? new Date(antena.ultimo_ping).toLocaleString("pt-BR") : "-"}</td>
                    <td className="actions-cell">
                      <div className="action-buttons">
                        {!canSync && !canAudit ? <span className="muted-text">Sem permissões</span> : null}
                        {canSync ? (
                        <button
                          className="button action-button"
                          disabled={!antena.online || busyId === antena.id}
                          title={antena.online ? "Abrir janela de sincronização" : "Leitor offline"}
                          type="button"
                          onClick={() => acionar(antena.id)}
                        >
                          <Play size={17} />
                          Sincronizar
                        </button>
                        ) : null}
                        {canAudit ? (
                        <button
                          className="button yellow action-button"
                          disabled={!antena.online || busyId === antena.id}
                          title={antena.online ? "Abrir auditoria do local" : "Leitor offline"}
                          type="button"
                          onClick={() => acionar(antena.id, true)}
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
