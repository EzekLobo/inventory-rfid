import type {
  AcionamentoResponse,
  Antena,
  AuditoriaJob,
  AuditoriaProcessada,
  BroadcastAuditoriaResponse,
  Inconsistencia,
  ItemPatrimonial,
  Local,
  TagsReadResponse,
  TimelineEvento
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";
const RFID_TOKEN = process.env.NEXT_PUBLIC_RFID_INGEST_TOKEN || "dev-rfid-token";
const AUTH_KEY = "inventory-rfid-auth";

type RequestOptions = RequestInit & {
  auth?: boolean;
  rfid?: boolean;
};

function authHeader() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.rfid) {
    headers.set("X-RFID-Token", RFID_TOKEN);
  }
  if (options.auth !== false) {
    const authorization = authHeader();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.detail || data?.non_field_errors?.[0] || "Falha na comunicação com a API.";
    throw new Error(String(detail));
  }
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const api = {
  isAuthenticated() {
    return Boolean(authHeader());
  },

  async login(username: string, password: string) {
    const authorization = `Basic ${window.btoa(`${username}:${password}`)}`;
    window.localStorage.setItem(AUTH_KEY, authorization);
    try {
      await this.listItens();
    } catch (error) {
      window.localStorage.removeItem(AUTH_KEY);
      throw error;
    }
  },

  logout() {
    window.localStorage.removeItem(AUTH_KEY);
  },

  listLocais() {
    return request<Local[]>("/locais/");
  },

  createLocal(payload: Omit<Local, "id">) {
    return request<Local>("/locais/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateLocal(id: number, payload: Omit<Local, "id">) {
    return request<Local>(`/locais/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteLocal(id: number) {
    return request<void>(`/locais/${id}/`, { method: "DELETE" });
  },

  listAntenas() {
    return request<Antena[]>("/antenas/");
  },

  createAntena(payload: Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & { command_token?: string }) {
    return request<Antena>("/antenas/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateAntena(id: number, payload: Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & { command_token?: string }) {
    return request<Antena>(`/antenas/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteAntena(id: number) {
    return request<void>(`/antenas/${id}/`, { method: "DELETE" });
  },

  ativarAntena(id: number, duracao_segundos: number) {
    return request<AcionamentoResponse>(`/antenas/${id}/ativar/`, {
      method: "POST",
      body: JSON.stringify({ duracao_segundos })
    });
  },

  auditarAntena(id: number, duracao_segundos: number) {
    return request<AcionamentoResponse>(`/antenas/${id}/auditar/`, {
      method: "POST",
      body: JSON.stringify({ duracao_segundos })
    });
  },

  auditarLeitores(duracao_segundos: number, antenna_ids?: number[]) {
    return request<BroadcastAuditoriaResponse>("/auditoria/broadcast/", {
      method: "POST",
      body: JSON.stringify({
        duracao_segundos,
        ...(antenna_ids && antenna_ids.length > 0 ? { antenna_ids } : {})
      })
    });
  },

  listItens(search = "") {
    return request<ItemPatrimonial[]>(`/itens/${query({ search })}`);
  },

  createItem(payload: Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">) {
    return request<ItemPatrimonial>("/itens/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateItem(id: number, payload: Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">) {
    return request<ItemPatrimonial>(`/itens/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteItem(id: number) {
    return request<void>(`/itens/${id}/`, { method: "DELETE" });
  },

  listInconsistencias(resolvida = "false", tipo = "") {
    return request<Inconsistencia[]>(`/inconsistencias/${query({ resolvida, tipo })}`);
  },

  resolverInconsistencia(id: number, motivo: string) {
    return request<{ status: string; inconsistencia: Inconsistencia }>(`/inconsistencias/${id}/resolver/`, {
      method: "POST",
      body: JSON.stringify({ motivo })
    });
  },

  confirmarLocalInconsistencia(id: number, motivo: string) {
    return request<{ status: string; inconsistencia: Inconsistencia }>(`/inconsistencias/${id}/confirmar-local/`, {
      method: "POST",
      body: JSON.stringify({ motivo })
    });
  },

  cadastrarTagDesconhecida(
    id: number,
    payload: { nome: string; local_logico_id?: number | null; local_fisico_id?: number | null; motivo: string }
  ) {
    return request<{ status: string; item: ItemPatrimonial; inconsistencia: Inconsistencia }>(
      `/inconsistencias/${id}/cadastrar-tag/`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  associarTagDesconhecida(id: number, payload: { item_id: number; motivo: string }) {
    return request<{ status: string; item: ItemPatrimonial; inconsistencia: Inconsistencia }>(
      `/inconsistencias/${id}/associar-tag/`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  listTimeline(filters: number | {
    item_id?: number;
    tipo?: string;
    search?: string;
    data_inicio?: string;
    data_fim?: string;
    usuario_id?: number;
    local_id?: number;
    antenna_id?: number;
    me?: boolean;
  } = {}) {
    const params = typeof filters === "number" ? { item_id: filters } : filters;
    return request<TimelineEvento[]>(`/timeline/${query(params)}`);
  },

  listAuditorias() {
    return request<AuditoriaJob[]>("/auditoria/");
  },

  listAuditoriasProcessadas() {
    return request<AuditoriaProcessada[]>("/auditoria/processadas/");
  },

  enviarTags(antenna_id: number, tags: string[], audit = false) {
    return request<TagsReadResponse>("/eventos/rfid/", {
      auth: false,
      rfid: true,
      method: "POST",
      body: JSON.stringify({
        event_type: "tags_read",
        antenna_id,
        tags,
        payload: audit ? { audit: true, source: "frontend_manual" } : {}
      })
    });
  }
};
