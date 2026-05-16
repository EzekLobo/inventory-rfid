export type Local = {
  id: number;
  nome: string;
  codigo: string;
};

export type Antena = {
  id: number;
  nome: string;
  hardware_id: string;
  local_id: number;
  local_nome: string;
  local_codigo: string;
  tipo: number;
  tipo_display: string;
  modo_comando: "polling" | "http";
  modo_comando_display: string;
  command_url: string;
  command_token_configurado: boolean;
  duracao_padrao_segundos: number;
  ativa: boolean;
  ativacao_expira_em: string | null;
  ultimo_acionamento: string | null;
  ultimo_ping: string | null;
  online: boolean;
};

export type ItemPatrimonial = {
  id: number;
  tag_id: string;
  nome: string;
  local_logico_id: number | null;
  local_logico_nome: string | null;
  local_fisico_id: number | null;
  local_fisico_nome: string | null;
  responsavel_id: number | null;
  responsavel_nome: string | null;
  ativo: boolean;
  atualizado_em: string;
};

export type InconsistenciaTipo = "local_divergente" | "nao_encontrado" | "tag_desconhecida";

export type Inconsistencia = {
  id: number;
  item_id: number | null;
  item_nome: string | null;
  tipo: InconsistenciaTipo;
  tag_id: string | null;
  local_logico_id: number | null;
  local_logico_nome: string | null;
  local_fisico_id: number | null;
  local_fisico_nome: string | null;
  resolvida: boolean;
  metadados: Record<string, unknown>;
  criado_em: string;
  resolvida_em: string | null;
};

export type TimelineEvento = {
  id: number;
  item_id: number | null;
  item_nome: string | null;
  item_tag: string | null;
  tipo: string;
  mensagem: string;
  metadados: Record<string, unknown>;
  criado_em: string;
  usuario_id: number | null;
  usuario_nome: string | null;
};

export type AcionamentoResponse = {
  status: "sincronizacao_iniciada" | "auditoria_iniciada" | string;
  antenna_id: number;
  hardware_id: string;
  active_for_seconds: number;
  expires_at: string;
  payload: Record<string, unknown>;
};

export type AuditoriaItemResumo = {
  id: number;
  nome: string;
  tag_id: string;
  local_logico_nome: string | null;
  local_fisico_nome: string | null;
};

export type AuditoriaMetadados = {
  evento?: string;
  antenna_id?: number;
  antenna_nome?: string;
  local_id?: number;
  local_nome?: string;
  auditoria_job_id?: number;
  finaliza_em?: string;
  esperados?: number;
  encontrados?: number;
  nao_encontrados?: number;
  tags_desconhecidas?: number;
  tags_fora_do_local?: number;
  total_lidos?: number;
  itens_esperados?: AuditoriaItemResumo[];
  itens_encontrados?: AuditoriaItemResumo[];
  itens_nao_encontrados?: AuditoriaItemResumo[];
  itens_divergentes?: AuditoriaItemResumo[];
  tags_desconhecidas_lista?: string[];
  [key: string]: unknown;
};

export type TagsReadResponse = {
  status: string;
  event: string;
  processed: {
    destino: number;
    fluxo: number;
  };
  audit: AuditoriaMetadados & {
    encontrados: number;
    nao_encontrados: number;
    tags_desconhecidas: number;
  };
  ignored_tags: string[];
};

export type AuditoriaLeitorStatus = {
  id: number;
  antena_id: number;
  antena_nome: string;
  hardware_id: string;
  local_nome: string;
  status: string;
  atualizado_em: string;
};

export type AuditoriaJob = {
  id: number;
  status: string;
  duracao_segundos: number;
  iniciado_em: string;
  finaliza_em: string;
  concluido_em: string | null;
  solicitado_por_id: number | null;
  solicitado_por_nome: string | null;
  leitores: AuditoriaLeitorStatus[];
};

export type AuditoriaProcessada = {
  id: number;
  mensagem: string;
  metadados: AuditoriaMetadados;
  criado_em: string;
};

export type BroadcastAuditoriaResponse = {
  status: string;
  auditoria_job_id: number;
  duracao_segundos: number;
  iniciado_em: string;
  finaliza_em: string;
  total_antenas: number;
  leitores: {
    antena_id: number;
    antena__hardware_id: string;
    antena__nome: string;
    status: string;
  }[];
};
