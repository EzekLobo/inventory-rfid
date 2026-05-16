import type {
  AcionamentoResponse,
  Antena,
  AuditoriaJob,
  AuditoriaProcessada,
  BroadcastAuditoriaResponse,
  CurrentUser,
  Inconsistencia,
  ItemPatrimonial,
  Local,
  OperacionalResumo,
  PaginatedResponse,
  PaginationParams,
  TagsReadResponse,
  TimelineEvento,
  Usuario,
  UserPermissions
} from "@/lib/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";
const RFID_TOKEN = process.env.NEXT_PUBLIC_RFID_INGEST_TOKEN || "dev-rfid-token";
const AUTH_KEY = "inventory-rfid-auth";
const USER_KEY = "inventory-rfid-user";
const CACHE_TTL_MS = 30_000;

type RequestOptions = RequestInit & {
  auth?: boolean;
  rfid?: boolean;
  useCache?: boolean;
};

type CacheEntry<T> = {
  expiresAt: number;
  data?: T;
  promise?: Promise<T>;
};

type TimelineFilters = PaginationParams & {
  item_id?: number;
  tipo?: string;
  search?: string;
  data_inicio?: string;
  data_fim?: string;
  usuario_id?: number;
  local_id?: number;
  antenna_id?: number;
  me?: boolean;
};

const cache = new Map<string, CacheEntry<unknown>>();

function authHeader() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_KEY);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth, rfid, useCache: shouldUseCache, ...fetchOptions } = options;
  const method = fetchOptions.method || "GET";
  const cacheKey = `${method}:${path}`;
  const useCache = shouldUseCache === true && method === "GET";
  if (useCache) {
    const entry = cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (entry && entry.data !== undefined && entry.expiresAt > Date.now()) return entry.data;
    if (entry?.promise) return entry.promise;
  }

  const headers = new Headers(fetchOptions.headers);
  if (fetchOptions.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (rfid) {
    headers.set("X-RFID-Token", RFID_TOKEN);
  }
  if (auth !== false) {
    const authorization = authHeader();
    if (authorization) {
      headers.set("Authorization", authorization);
    }
  }

  const promise = fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers
  })
    .then(async (response) => {
      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) {
        if (response.status === 401 && typeof window !== "undefined") {
          window.localStorage.removeItem(AUTH_KEY);
          window.localStorage.removeItem(USER_KEY);
        }
        const detail = typeof data === "object" && data !== null
          ? (data as any).detail || (data as any).non_field_errors?.[0]
          : String(data || "Falha na comunicacao com a API.");
        throw new Error(String(detail));
      }
      return data as T;
    })
    .then((data) => {
      if (useCache) cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .catch((error) => {
      if (useCache) cache.delete(cacheKey);
      throw error;
    });

  if (useCache) cache.set(cacheKey, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

function paginationParams(params: PaginationParams = {}) {
  return {
    page: params.page,
    page_size: params.page_size
  };
}

function clearCache() {
  cache.clear();
}

function storeUser(user: CurrentUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_KEY);
}

export const api = {
  isAuthenticated() {
    return Boolean(authHeader());
  },

  currentUser() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CurrentUser;
    } catch {
      return null;
    }
  },

  async login(username: string, password: string) {
    const authorization = `Basic ${window.btoa(`${username}:${password}`)}`;
    window.localStorage.setItem(AUTH_KEY, authorization);
    try {
      const user = await this.me();
      storeUser(user);
    } catch (error) {
      window.localStorage.removeItem(AUTH_KEY);
      clearUser();
      clearCache();
      throw error;
    }
  },

  logout() {
    window.localStorage.removeItem(AUTH_KEY);
    clearUser();
    clearCache();
  },

  me() {
    return request<CurrentUser>("/auth/me/", { useCache: false });
  },

  async trocarSenha(payload: { senha_atual: string; nova_senha: string }, username: string) {
    const response = await request<{ status: string }>("/auth/trocar-senha/", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const authorization = `Basic ${window.btoa(`${username}:${payload.nova_senha}`)}`;
    window.localStorage.setItem(AUTH_KEY, authorization);
    clearCache();
    const user = await this.me();
    storeUser(user);
    return response;
  },

  listUsuarios(params: PaginationParams = {}) {
    return request<PaginatedResponse<Usuario>>(`/usuarios/${query(paginationParams(params))}`, { useCache: true });
  },

  createUsuario(payload: Partial<Usuario> & { username: string; password: string }) {
    clearCache();
    return request<Usuario>("/usuarios/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateUsuario(id: number, payload: Partial<Usuario> & { password?: string }) {
    clearCache();
    return request<Usuario>(`/usuarios/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
  },

  deleteUsuario(id: number) {
    clearCache();
    return request<void>(`/usuarios/${id}/`, { method: "DELETE" });
  },

  listPermissoesTecnico() {
    return request<UserPermissions>("/permissoes/tecnico/", { useCache: true });
  },

  updatePermissoesTecnico(payload: Partial<UserPermissions>) {
    clearCache();
    return request<UserPermissions>("/permissoes/tecnico/", { method: "POST", body: JSON.stringify(payload) });
  },

  resumo() {
    return request<OperacionalResumo>("/resumo/", { useCache: true });
  },

  listLocais(params: PaginationParams = {}) {
    return request<PaginatedResponse<Local>>(`/locais/${query(paginationParams(params))}`, { useCache: true });
  },

  createLocal(payload: Omit<Local, "id">) {
    clearCache();
    return request<Local>("/locais/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateLocal(id: number, payload: Omit<Local, "id">) {
    clearCache();
    return request<Local>(`/locais/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteLocal(id: number) {
    clearCache();
    return request<void>(`/locais/${id}/`, { method: "DELETE" });
  },

  listAntenas(params: PaginationParams = {}) {
    return request<PaginatedResponse<Antena>>(`/antenas/${query(paginationParams(params))}`, { useCache: true });
  },

  createAntena(payload: Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & { command_token?: string }) {
    clearCache();
    return request<Antena>("/antenas/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateAntena(id: number, payload: Pick<Antena, "nome" | "hardware_id" | "local_id" | "tipo" | "modo_comando" | "command_url" | "duracao_padrao_segundos"> & { command_token?: string }) {
    clearCache();
    return request<Antena>(`/antenas/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteAntena(id: number) {
    clearCache();
    return request<void>(`/antenas/${id}/`, { method: "DELETE" });
  },

  ativarAntena(id: number, duracao_segundos: number) {
    clearCache();
    return request<AcionamentoResponse>(`/antenas/${id}/ativar/`, {
      method: "POST",
      body: JSON.stringify({ duracao_segundos })
    });
  },

  auditarAntena(id: number, duracao_segundos: number) {
    clearCache();
    return request<AcionamentoResponse>(`/antenas/${id}/auditar/`, {
      method: "POST",
      body: JSON.stringify({ duracao_segundos })
    });
  },

  auditarLeitores(duracao_segundos: number, antenna_ids?: number[]) {
    clearCache();
    return request<BroadcastAuditoriaResponse>("/auditoria/broadcast/", {
      method: "POST",
      body: JSON.stringify({
        duracao_segundos,
        ...(antenna_ids && antenna_ids.length > 0 ? { antenna_ids } : {})
      })
    });
  },

  listItens(params: PaginationParams & { search?: string; ativo?: boolean | string } = {}) {
    return request<PaginatedResponse<ItemPatrimonial>>(`/itens/${query(params)}`, { useCache: true });
  },

  createItem(payload: Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">) {
    clearCache();
    return request<ItemPatrimonial>("/itens/", { method: "POST", body: JSON.stringify(payload) });
  },

  updateItem(id: number, payload: Pick<ItemPatrimonial, "nome" | "tag_id" | "local_logico_id" | "local_fisico_id" | "ativo">) {
    clearCache();
    return request<ItemPatrimonial>(`/itens/${id}/`, { method: "PUT", body: JSON.stringify(payload) });
  },

  deleteItem(id: number) {
    clearCache();
    return request<void>(`/itens/${id}/`, { method: "DELETE" });
  },

  listInconsistencias(params: PaginationParams & { resolvida?: string; tipo?: string } = {}) {
    return request<PaginatedResponse<Inconsistencia>>(`/inconsistencias/${query(params)}`, { useCache: true });
  },

  resolverInconsistencia(id: number, motivo: string) {
    clearCache();
    return request<{ status: string; inconsistencia: Inconsistencia }>(`/inconsistencias/${id}/resolver/`, {
      method: "POST",
      body: JSON.stringify({ motivo })
    });
  },

  confirmarLocalInconsistencia(id: number, motivo: string) {
    clearCache();
    return request<{ status: string; inconsistencia: Inconsistencia }>(`/inconsistencias/${id}/confirmar-local/`, {
      method: "POST",
      body: JSON.stringify({ motivo })
    });
  },

  cadastrarTagDesconhecida(
    id: number,
    payload: { nome: string; local_logico_id?: number | null; local_fisico_id?: number | null; motivo: string }
  ) {
    clearCache();
    return request<{ status: string; item: ItemPatrimonial; inconsistencia: Inconsistencia }>(
      `/inconsistencias/${id}/cadastrar-tag/`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  associarTagDesconhecida(id: number, payload: { item_id: number; motivo: string }) {
    clearCache();
    return request<{ status: string; item: ItemPatrimonial; inconsistencia: Inconsistencia }>(
      `/inconsistencias/${id}/associar-tag/`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  listTimeline(filters: number | TimelineFilters = {}) {
    const params = typeof filters === "number" ? { item_id: filters } : filters;
    return request<PaginatedResponse<TimelineEvento>>(`/timeline/${query(params)}`, { useCache: true });
  },

  listAuditorias(params: PaginationParams = {}) {
    return request<PaginatedResponse<AuditoriaJob>>(`/auditoria/${query(paginationParams(params))}`, { useCache: true });
  },

  listAuditoriasProcessadas(params: PaginationParams = {}) {
    return request<PaginatedResponse<AuditoriaProcessada>>(`/auditoria/processadas/${query(paginationParams(params))}`, { useCache: true });
  },

  enviarTags(antenna_id: number, tags: string[], audit = false) {
    clearCache();
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
