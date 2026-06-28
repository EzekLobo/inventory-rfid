export const inconsistenciaTipoLabels: Record<string, string> = {
  local_divergente: "Local divergente",
  nao_encontrado: "Não encontrado",
  tag_desconhecida: "Tag desconhecida"
};

export const timelineTipoLabels: Record<string, string> = {
  movimentacao: "Movimentação",
  inconsistencia: "Inconsistência",
  rastro: "Rastro",
  baixa: "Baixa patrimonial",
  sistema: "Sistema"
};

export const eventNameLabels: Record<string, string> = {
  auditoria_concluida: "Auditoria concluída",
  auditoria_iniciada: "Auditoria iniciada",
  auditoria_processada: "Auditoria processada",
  baixa_manual: "Baixa manual",
  cadastro_item: "Cadastro de item",
  command_delivery_failed: "Falha no comando do leitor",
  flow_trace: "Rastro RFID",
  inconsistencia_resolvida: "Inconsistência resolvida",
  item_fora_do_local_auditado: "Item fora do local auditado",
  item_lido_local_correto: "Item conferido",
  item_nao_encontrado: "Item não encontrado",
  item_reencontrado: "Item reencontrado",
  local_divergente: "Local divergente",
  local_logico_confirmado: "Local lógico confirmado",
  reconciliacao: "Reconciliação",
  seed_tcc: "Base de demonstração",
  tag_desconhecida: "Tag desconhecida",
  tag_desconhecida_associada: "Tag associada",
  tag_desconhecida_cadastrada: "Tag cadastrada",
  tags_read: "Leitura RFID"
};

export const metadataLabels: Record<string, string> = {
  audit: "auditoria",
  auditoria_execucao_id: "execução",
  auditoria_job_id: "auditoria",
  command_delivery: "entrega do comando",
  command_url: "URL do comando",
  duracao_segundos: "duração",
  evento: "evento",
  encontrados: "encontrados",
  esperados: "esperados",
  finaliza_em: "finaliza em",
  hardware_id: "hardware",
  inconsistencia_id: "inconsistência",
  inconsistencia_ids: "inconsistências",
  item_nome: "item",
  item_tag: "tag",
  itens_divergentes: "itens divergentes",
  itens_encontrados: "itens encontrados",
  itens_esperados: "itens esperados",
  itens_nao_encontrados: "itens não encontrados",
  ja_estava_inativo: "já estava inativo",
  local_anterior_id: "local anterior",
  local_fisico_nome: "local físico",
  local_id: "local",
  local_logico_nome: "local lógico",
  local_nome: "local",
  motivo: "motivo",
  nao_encontrados: "não encontrados",
  nome: "nome",
  source: "origem",
  tag_id: "tag",
  tags: "tags",
  tags_desconhecidas: "tags desconhecidas",
  tags_desconhecidas_lista: "tags desconhecidas",
  tags_fora_do_local: "fora do local",
  tags_lidas: "tags lidas",
  tipo: "tipo",
  total_antenas: "quantidade de leitores",
  total_lidos: "total lido",
  antenna_id: "ID do leitor",
  antenna_ids: "IDs dos leitores",
  antenna_nome: "leitor"
};

export function labelInconsistenciaTipo(value: string | null | undefined) {
  return labelFromMap(value, inconsistenciaTipoLabels);
}

export function labelTimelineTipo(value: string | null | undefined) {
  return labelFromMap(value, timelineTipoLabels);
}

export function labelEventName(value: string | null | undefined) {
  return labelFromMap(value, eventNameLabels);
}

export function labelMetadataKey(value: string) {
  return metadataLabels[value] || humanizeKey(value);
}

export function compactRfidTag(value: string | number | null | undefined, start = 8, end = 6) {
  if (value === null || value === undefined || value === "") return "-";
  const tag = String(value);
  if (tag.length <= start + end + 3) return tag;
  return `${tag.slice(0, start)}...${tag.slice(-end)}`;
}

export function fullRfidTag(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function humanizeKey(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelFromMap(value: string | null | undefined, labels: Record<string, string>) {
  if (!value) return "-";
  return labels[value] || humanizeKey(value);
}
