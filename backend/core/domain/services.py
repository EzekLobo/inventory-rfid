from __future__ import annotations

from datetime import timedelta
import logging
from time import perf_counter

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.domain.models import (
    AntenaRFID,
    AuditoriaJob,
    AuditoriaLeitorStatus,
    ItemPatrimonial,
    LeituraRFID,
    NotificacaoInconsistencia,
    TimelineEvento,
)


logger = logging.getLogger(__name__)


def log_debug_timing(label: str, started_at: float, **details) -> None:
    if not settings.DEBUG:
        return
    elapsed_ms = (perf_counter() - started_at) * 1000
    logger.debug("%s executado em %.2fms %s", label, elapsed_ms, details)


class SyncManager:
    duplicate_window_seconds = 3

    @transaction.atomic
    def sync_item_location(
        self,
        *,
        tag_id: str,
        local_id: int,
        antena: AntenaRFID | None = None,
        payload: dict | None = None,
    ) -> dict:
        item = ItemPatrimonial.objects.select_for_update().get(tag_id=tag_id)
        previous_local = item.local_fisico
        duplicate = self._recent_duplicate_exists(
            tag_id=tag_id,
            local_id=local_id,
            classificacao=LeituraRFID.ClassificacaoLeitura.DESTINO,
        )
        if duplicate:
            return {
                "item": item,
                "leitura": duplicate,
                "timeline": None,
                "inconsistencia": NotificacaoInconsistencia.objects.filter(
                    item=item,
                    tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
                    resolvida=False,
                ).first(),
                "mudou_local": False,
                "duplicada": True,
            }

        item.local_fisico_id = local_id
        item.save(update_fields=["local_fisico", "atualizado_em"])
        mudou_local = previous_local_id(previous_local) != local_id

        leitura = LeituraRFID.objects.create(
            item=item,
            tag_id=tag_id,
            local_id=local_id,
            antena=antena,
            classificacao=LeituraRFID.ClassificacaoLeitura.DESTINO,
            payload=payload or {},
        )

        timeline = None
        if mudou_local:
            mensagem = (
                f"Seu {item.nome} acaba de chegar ao "
                f"{item.local_fisico.nome if item.local_fisico else 'local desconhecido'}."
            )
            timeline = TimelineEvento.objects.create(
                item=item,
                tipo=TimelineEvento.TipoEvento.MOVIMENTACAO,
                mensagem=mensagem,
                usuario=item.responsavel,
                metadados={
                    "tag_id": tag_id,
                    "local_id": local_id,
                    "local_anterior_id": previous_local_id(previous_local),
                    "antenna_id": antena.id if antena else None,
                    "evento": "tags_read",
                },
            )

        inconsistencia = NotificacaoInconsistencia.objects.filter(
            item=item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
            resolvida=False,
        ).first()
        if item.local_logico_id and item.local_logico_id != local_id:
            if inconsistencia is None:
                inconsistencia = NotificacaoInconsistencia.objects.create(
                    item=item,
                    tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
                    tag_id=tag_id,
                    local_logico=item.local_logico,
                    local_fisico=item.local_fisico,
                    metadados={
                        "tag_id": tag_id,
                        "local_id": local_id,
                        "antenna_id": antena.id if antena else None,
                        "evento": "local_divergente",
                    },
                )
                TimelineEvento.objects.create(
                    item=item,
                    tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
                    mensagem=(
                        "Inconsistencia detectada: "
                        f"local logico={item.local_logico.nome} "
                        f"vs local fisico={item.local_fisico.nome if item.local_fisico else 'desconhecido'}."
                    ),
                    usuario=item.responsavel,
                    metadados={
                        "inconsistencia_id": inconsistencia.id,
                        "tipo": inconsistencia.tipo,
                    },
                )
            else:
                inconsistencia.local_logico = item.local_logico
                inconsistencia.local_fisico = item.local_fisico
                inconsistencia.tag_id = tag_id
                inconsistencia.metadados = {
                    **(inconsistencia.metadados or {}),
                    "tag_id": tag_id,
                    "local_id": local_id,
                    "antenna_id": antena.id if antena else None,
                    "evento": "local_divergente",
                }
                inconsistencia.save(update_fields=["local_logico", "local_fisico", "tag_id", "metadados"])
        elif inconsistencia is not None:
            NotificacaoInconsistencia.objects.filter(
                item=item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
                resolvida=False,
            ).update(
                resolvida=True,
                resolvida_em=timezone.now(),
            )
            TimelineEvento.objects.create(
                item=item,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                mensagem="Inconsistencia resolvida automaticamente por reconciliacao fisica/logica.",
                usuario=item.responsavel,
                metadados={"evento": "reconciliacao", "tipo": inconsistencia.tipo},
            )
            inconsistencia = None

        return {
            "item": item,
            "leitura": leitura,
            "timeline": timeline,
            "inconsistencia": inconsistencia,
            "mudou_local": mudou_local,
            "duplicada": False,
        }

    def register_flow_trace(
        self,
        *,
        tag_id: str,
        local_id: int,
        antena: AntenaRFID | None = None,
        payload: dict | None = None,
    ) -> LeituraRFID:
        item = ItemPatrimonial.objects.filter(tag_id=tag_id).first()
        duplicate = self._recent_duplicate_exists(
            tag_id=tag_id,
            local_id=local_id,
            classificacao=LeituraRFID.ClassificacaoLeitura.FLUXO,
        )
        if duplicate:
            return duplicate

        leitura = LeituraRFID.objects.create(
            item=item,
            tag_id=tag_id,
            local_id=local_id,
            antena=antena,
            classificacao=LeituraRFID.ClassificacaoLeitura.FLUXO,
            payload=payload or {},
        )
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.RASTRO,
            mensagem=f"Rastro detectado para tag {tag_id} no local {leitura.local.nome if leitura.local else local_id}.",
            usuario=item.responsavel if item else None,
            metadados={
                "tag_id": tag_id,
                "local_id": local_id,
                "antenna_id": antena.id if antena else None,
                "evento": "flow_trace",
            },
        )
        return leitura

    @transaction.atomic
    def deactivate_item_manually(
        self,
        *,
        item_id: int,
        motivo: str,
        usuario=None,
    ) -> ItemPatrimonial:
        item = ItemPatrimonial.objects.select_for_update().get(id=item_id)
        was_active = item.ativo
        if item.ativo:
            item.ativo = False
            item.save(update_fields=["ativo", "atualizado_em"])

        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.BAIXA,
            mensagem=f"Item marcado como inativo por usuario {usuario_label(usuario)}. Motivo: {motivo}",
            usuario=usuario,
            metadados={
                "item_id": item.id,
                "tag_id": item.tag_id,
                "motivo": motivo,
                "evento": "baixa_manual",
                "ja_estava_inativo": not was_active,
            },
        )
        return item

    @transaction.atomic
    def resolve_inconsistency_manually(
        self,
        *,
        inconsistencia_id: int,
        usuario=None,
        motivo: str = "resolucao manual",
    ) -> NotificacaoInconsistencia:
        inconsistencia = NotificacaoInconsistencia.objects.select_for_update().select_related("item").get(
            id=inconsistencia_id,
        )
        if inconsistencia.resolvida:
            return inconsistencia

        inconsistencia.resolvida = True
        inconsistencia.resolvida_em = timezone.now()
        metadados = {
            **(inconsistencia.metadados or {}),
            "resolvida_por": usuario_label(usuario),
            "resolucao": "manual",
            "motivo_resolucao": motivo,
        }
        inconsistencia.metadados = metadados
        inconsistencia.save(update_fields=["resolvida", "resolvida_em", "metadados"])
        TimelineEvento.objects.create(
            item=inconsistencia.item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=f"Divergencia {inconsistencia.id} resolvida manualmente por {usuario_label(usuario)}.",
            usuario=usuario,
            metadados={
                "evento": "inconsistencia_resolvida",
                "inconsistencia_id": inconsistencia.id,
                "tipo": inconsistencia.tipo,
                "motivo": motivo,
            },
        )
        return inconsistencia

    @transaction.atomic
    def confirm_logical_location_from_inconsistency(
        self,
        *,
        inconsistencia_id: int,
        usuario=None,
        motivo: str = "local confirmado pela divergencia",
    ) -> NotificacaoInconsistencia:
        inconsistencia = NotificacaoInconsistencia.objects.select_for_update().select_related(
            "item",
            "local_logico",
            "local_fisico",
        ).get(id=inconsistencia_id)
        if inconsistencia.resolvida:
            return inconsistencia
        if inconsistencia.tipo != NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE:
            raise ValueError("Apenas divergencias de local podem atualizar o local logico.")
        if not inconsistencia.item:
            raise ValueError("Divergencia sem item patrimonial vinculado.")
        if not inconsistencia.local_fisico:
            raise ValueError("Divergencia sem local fisico para confirmar.")

        item = ItemPatrimonial.objects.select_for_update().select_related("local_logico").get(id=inconsistencia.item_id)
        local_anterior = item.local_logico
        item.local_logico = inconsistencia.local_fisico
        item.save(update_fields=["local_logico", "atualizado_em"])

        inconsistencia.local_logico = item.local_logico
        inconsistencia.resolvida = True
        inconsistencia.resolvida_em = timezone.now()
        inconsistencia.metadados = {
            **(inconsistencia.metadados or {}),
            "resolvida_por": usuario_label(usuario),
            "resolucao": "confirmar_local_logico",
            "motivo_resolucao": motivo,
            "local_logico_anterior_id": previous_local_id(local_anterior),
            "local_logico_novo_id": item.local_logico_id,
        }
        inconsistencia.save(update_fields=["local_logico", "resolvida", "resolvida_em", "metadados"])

        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=(
                f"Local logico de {item.nome} atualizado de "
                f"{local_anterior.nome if local_anterior else 'sem local'} para "
                f"{item.local_logico.nome if item.local_logico else 'sem local'} "
                f"por {usuario_label(usuario)}."
            ),
            usuario=usuario,
            metadados={
                "evento": "local_logico_confirmado",
                "inconsistencia_id": inconsistencia.id,
                "tag_id": item.tag_id,
                "local_logico_anterior_id": previous_local_id(local_anterior),
                "local_logico_novo_id": item.local_logico_id,
                "motivo": motivo,
            },
        )
        return inconsistencia

    @transaction.atomic
    def register_unknown_tag_as_item(
        self,
        *,
        inconsistencia_id: int,
        nome: str,
        local_logico_id: int | None = None,
        local_fisico_id: int | None = None,
        responsavel=None,
        usuario=None,
        motivo: str = "tag cadastrada a partir de divergencia",
    ) -> tuple[NotificacaoInconsistencia, ItemPatrimonial]:
        inconsistencia = NotificacaoInconsistencia.objects.select_for_update().select_related("local_fisico").get(
            id=inconsistencia_id,
        )
        if inconsistencia.resolvida:
            raise ValueError("Divergencia ja resolvida.")
        if inconsistencia.tipo != NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA:
            raise ValueError("Apenas tags desconhecidas podem ser cadastradas por esta acao.")
        if not inconsistencia.tag_id:
            raise ValueError("Divergencia sem tag para cadastrar.")

        item = ItemPatrimonial.objects.create(
            tag_id=inconsistencia.tag_id,
            nome=nome,
            local_logico_id=local_logico_id or previous_local_id(inconsistencia.local_fisico),
            local_fisico_id=local_fisico_id or previous_local_id(inconsistencia.local_fisico),
            responsavel=responsavel,
            ativo=True,
        )
        inconsistencia.item = item
        inconsistencia.local_logico = item.local_logico
        inconsistencia.local_fisico = item.local_fisico
        inconsistencia.resolvida = True
        inconsistencia.resolvida_em = timezone.now()
        inconsistencia.metadados = {
            **(inconsistencia.metadados or {}),
            "resolvida_por": usuario_label(usuario),
            "resolucao": "tag_cadastrada",
            "motivo_resolucao": motivo,
            "item_id": item.id,
        }
        inconsistencia.save(
            update_fields=["item", "local_logico", "local_fisico", "resolvida", "resolvida_em", "metadados"]
        )
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=f"Tag desconhecida {item.tag_id} cadastrada como item {item.nome} por {usuario_label(usuario)}.",
            usuario=usuario,
            metadados={
                "evento": "tag_desconhecida_cadastrada",
                "inconsistencia_id": inconsistencia.id,
                "item_id": item.id,
                "tag_id": item.tag_id,
                "motivo": motivo,
            },
        )
        return inconsistencia, item

    @transaction.atomic
    def associate_unknown_tag_to_item(
        self,
        *,
        inconsistencia_id: int,
        item_id: int,
        usuario=None,
        motivo: str = "tag associada a item existente",
    ) -> tuple[NotificacaoInconsistencia, ItemPatrimonial]:
        inconsistencia = NotificacaoInconsistencia.objects.select_for_update().select_related("local_fisico").get(
            id=inconsistencia_id,
        )
        if inconsistencia.resolvida:
            raise ValueError("Divergencia ja resolvida.")
        if inconsistencia.tipo != NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA:
            raise ValueError("Apenas tags desconhecidas podem ser associadas por esta acao.")
        if not inconsistencia.tag_id:
            raise ValueError("Divergencia sem tag para associar.")

        item = ItemPatrimonial.objects.select_for_update().get(id=item_id)
        tag_anterior = item.tag_id
        item.tag_id = inconsistencia.tag_id
        if inconsistencia.local_fisico and not item.local_fisico_id:
            item.local_fisico = inconsistencia.local_fisico
        item.save(update_fields=["tag_id", "local_fisico", "atualizado_em"])

        inconsistencia.item = item
        inconsistencia.local_logico = item.local_logico
        inconsistencia.local_fisico = item.local_fisico or inconsistencia.local_fisico
        inconsistencia.resolvida = True
        inconsistencia.resolvida_em = timezone.now()
        inconsistencia.metadados = {
            **(inconsistencia.metadados or {}),
            "resolvida_por": usuario_label(usuario),
            "resolucao": "tag_associada",
            "motivo_resolucao": motivo,
            "item_id": item.id,
            "tag_anterior": tag_anterior,
        }
        inconsistencia.save(
            update_fields=["item", "local_logico", "local_fisico", "resolvida", "resolvida_em", "metadados"]
        )
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=(
                f"Tag {inconsistencia.tag_id} associada ao item {item.nome} "
                f"por {usuario_label(usuario)}."
            ),
            usuario=usuario,
            metadados={
                "evento": "tag_desconhecida_associada",
                "inconsistencia_id": inconsistencia.id,
                "item_id": item.id,
                "tag_anterior": tag_anterior,
                "tag_id": item.tag_id,
                "motivo": motivo,
            },
        )
        return inconsistencia, item

    def _recent_duplicate_exists(self, *, tag_id: str, local_id: int | None, classificacao: str):
        window_start = timezone.now() - timedelta(seconds=self.duplicate_window_seconds)
        return (
            LeituraRFID.objects.filter(
                tag_id=tag_id,
                local_id=local_id,
                classificacao=classificacao,
                criado_em__gte=window_start,
            )
            .order_by("-criado_em")
            .first()
        )


class AuditoriaReconciliacaoManager:
    def is_audit_payload(self, payload: dict | None) -> bool:
        payload = payload or {}
        return bool(payload.get("audit") or payload.get("auditoria_job_id"))

    @transaction.atomic
    def reconcile_destination_reading(
        self,
        *,
        antenna: AntenaRFID,
        raw_tags: list[str],
        valid_tags: list[str],
        payload: dict | None = None,
    ) -> dict:
        if antenna.tipo != AntenaRFID.TipoAntena.DESTINO or not self.is_audit_payload(payload):
            return {
                "audit": False,
                "encontrados": len(valid_tags),
                "nao_encontrados": 0,
                "tags_desconhecidas": 0,
            }

        audit_started_at = timezone.now()
        payload = {
            "audit": True,
            "auditoria_execucao_id": (payload or {}).get("auditoria_execucao_id")
            or (f"job-{(payload or {}).get('auditoria_job_id')}" if (payload or {}).get("auditoria_job_id") else f"manual-{antenna.id}-{audit_started_at.strftime('%Y%m%d%H%M%S%f')}"),
            "auditoria_criada_em": (payload or {}).get("auditoria_criada_em") or audit_started_at.isoformat(),
            "local_nome": antenna.local.nome,
            "antenna_nome": antenna.nome,
            **(payload or {}),
        }
        raw_tag_set = set(raw_tags)
        valid_tag_set = set(valid_tags)
        unknown_tags = sorted(raw_tag_set - valid_tag_set)

        expected_items = list(
            ItemPatrimonial.objects.filter(
                ativo=True,
                local_logico_id=antenna.local_id,
            ).select_related("local_logico", "local_fisico", "responsavel")
        )
        expected_by_tag = {item.tag_id: item for item in expected_items}
        missing_items = [item for item in expected_items if item.tag_id not in valid_tag_set]
        found_expected_items = [item for tag, item in expected_by_tag.items() if tag in valid_tag_set]
        extra_items = list(
            ItemPatrimonial.objects.filter(
                ativo=True,
                tag_id__in=valid_tag_set - set(expected_by_tag.keys()),
            ).select_related("local_logico", "local_fisico", "responsavel")
        )
        total_lidos = len(found_expected_items) + len(extra_items) + len(unknown_tags)

        for item in missing_items:
            self._mark_missing(item=item, antenna=antenna, payload=payload)

        for item in found_expected_items:
            self._mark_correctly_read(item=item, antenna=antenna, payload=payload)
            self._resolve_missing(item=item, antenna=antenna, payload=payload)

        for item in extra_items:
            self._mark_unexpected_item(item=item, antenna=antenna, payload=payload)

        for tag_id in unknown_tags:
            self._mark_unknown_tag(tag_id=tag_id, antenna=antenna, payload=payload)

        auditoria = {
            "audit": True,
            "esperados": len(expected_items),
            "encontrados": len(found_expected_items),
            "nao_encontrados": len(missing_items),
            "tags_desconhecidas": len(unknown_tags),
            "tags_fora_do_local": len(extra_items),
            "total_lidos": total_lidos,
            "itens_esperados": [self._serialize_audit_item(item) for item in expected_items],
            "itens_encontrados": [self._serialize_audit_item(item) for item in found_expected_items],
            "itens_nao_encontrados": [self._serialize_audit_item(item) for item in missing_items],
            "itens_divergentes": [self._serialize_audit_item(item) for item in extra_items],
            "tags_desconhecidas_lista": unknown_tags,
        }
        TimelineEvento.objects.create(
            item=None,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=f"Auditoria realizada em {antenna.local.nome} pela antena {antenna.nome}.",
            usuario=None,
            metadados={
                "evento": "auditoria_processada",
                "antenna_id": antenna.id,
                "antenna_nome": antenna.nome,
                "local_id": antenna.local_id,
                "local_nome": antenna.local.nome,
                "tags_lidas": len(raw_tag_set),
                **auditoria,
                **payload,
            },
        )
        return {
            **auditoria,
        }

    def _serialize_audit_item(self, item: ItemPatrimonial) -> dict:
        return {
            "id": item.id,
            "nome": item.nome,
            "tag_id": item.tag_id,
            "local_logico_nome": item.local_logico.nome if item.local_logico else None,
            "local_fisico_nome": item.local_fisico.nome if item.local_fisico else None,
        }

    def _mark_missing(self, *, item: ItemPatrimonial, antenna: AntenaRFID, payload: dict) -> None:
        inconsistencia = NotificacaoInconsistencia.objects.filter(
            item=item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
            resolvida=False,
        ).first()
        metadados = {
            "tag_id": item.tag_id,
            "local_id": antenna.local_id,
            "antenna_id": antenna.id,
            "evento": "item_nao_encontrado",
            **payload,
        }
        if inconsistencia:
            inconsistencia.local_logico = item.local_logico
            inconsistencia.local_fisico = item.local_fisico
            inconsistencia.tag_id = item.tag_id
            inconsistencia.metadados = metadados
            inconsistencia.save(update_fields=["local_logico", "local_fisico", "tag_id", "metadados"])
            return

        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
            tag_id=item.tag_id,
            local_logico=item.local_logico,
            local_fisico=item.local_fisico,
            metadados=metadados,
        )
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
            mensagem=(
                f"Item esperado em {antenna.local.nome} nao foi encontrado "
                f"na leitura da antena {antenna.nome}."
            ),
            usuario=item.responsavel,
            metadados={
                "inconsistencia_id": inconsistencia.id,
                "tipo": inconsistencia.tipo,
                **metadados,
            },
        )

    def _resolve_missing(self, *, item: ItemPatrimonial, antenna: AntenaRFID, payload: dict) -> None:
        inconsistencias = list(
            NotificacaoInconsistencia.objects.filter(
                item=item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                resolvida=False,
            )
        )
        if not inconsistencias:
            return

        now = timezone.now()
        ids = [inconsistencia.id for inconsistencia in inconsistencias]
        NotificacaoInconsistencia.objects.filter(id__in=ids).update(resolvida=True, resolvida_em=now)
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=f"Item {item.nome} encontrado novamente em auditoria da antena {antenna.nome}.",
            usuario=item.responsavel,
            metadados={
                "evento": "item_reencontrado",
                "tipo": NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                "inconsistencia_ids": ids,
                "antenna_id": antenna.id,
                "local_id": antenna.local_id,
                **payload,
            },
        )

    def _mark_correctly_read(self, *, item: ItemPatrimonial, antenna: AntenaRFID, payload: dict) -> None:
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=(
                f"Item {item.nome} lido corretamente em auditoria de {antenna.local.nome} "
                f"pela antena {antenna.nome}."
            ),
            usuario=item.responsavel,
            metadados={
                "evento": "item_lido_local_correto",
                "tag_id": item.tag_id,
                "antenna_id": antenna.id,
                "local_id": antenna.local_id,
                **payload,
            },
        )

    def _mark_unexpected_item(self, *, item: ItemPatrimonial, antenna: AntenaRFID, payload: dict) -> None:
        inconsistencia = NotificacaoInconsistencia.objects.filter(
            item=item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
            resolvida=False,
        ).first()
        metadados = {
            "tag_id": item.tag_id,
            "local_id": antenna.local_id,
            "antenna_id": antenna.id,
            "evento": "item_fora_do_local_auditado",
            **payload,
        }
        if inconsistencia:
            inconsistencia.local_logico = item.local_logico
            inconsistencia.local_fisico = antenna.local
            inconsistencia.tag_id = item.tag_id
            inconsistencia.metadados = metadados
            inconsistencia.save(update_fields=["local_logico", "local_fisico", "tag_id", "metadados"])
            return

        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
            tag_id=item.tag_id,
            local_logico=item.local_logico,
            local_fisico=antenna.local,
            metadados=metadados,
        )
        TimelineEvento.objects.create(
            item=item,
            tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
            mensagem=(
                f"Item {item.nome} foi lido em auditoria de {antenna.local.nome}, "
                "mas nao era esperado nesse local."
            ),
            usuario=item.responsavel,
            metadados={
                "inconsistencia_id": inconsistencia.id,
                "tipo": inconsistencia.tipo,
                **metadados,
            },
        )

    def _mark_unknown_tag(self, *, tag_id: str, antenna: AntenaRFID, payload: dict) -> None:
        inconsistencia = NotificacaoInconsistencia.objects.filter(
            tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
            tag_id=tag_id,
            local_fisico=antenna.local,
            resolvida=False,
        ).first()
        metadados = {
            "tag_id": tag_id,
            "local_id": antenna.local_id,
            "antenna_id": antenna.id,
            "evento": "tag_desconhecida",
            **payload,
        }
        if inconsistencia:
            inconsistencia.metadados = metadados
            inconsistencia.save(update_fields=["metadados"])
            return

        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=None,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
            tag_id=tag_id,
            local_logico=None,
            local_fisico=antenna.local,
            metadados=metadados,
        )
        TimelineEvento.objects.create(
            item=None,
            tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
            mensagem=f"Tag RFID desconhecida {tag_id} lida na antena {antenna.nome}.",
            usuario=None,
            metadados={
                "inconsistencia_id": inconsistencia.id,
                "tipo": inconsistencia.tipo,
                **metadados,
            },
        )


class AuditoriaManager:
    @transaction.atomic
    def start_broadcast(
        self,
        *,
        duracao_segundos: int,
        requested_by=None,
        antenna_ids: list[int] | None = None,
    ) -> AuditoriaJob:
        now = timezone.now()
        finaliza_em = now + timedelta(seconds=duracao_segundos)
        job = AuditoriaJob.objects.create(
            solicitado_por=requested_by,
            duracao_segundos=duracao_segundos,
            finaliza_em=finaliza_em,
            status=AuditoriaJob.Status.INICIADO,
        )

        antenas_queryset = AntenaRFID.objects.all()
        if antenna_ids is not None:
            antenas_queryset = antenas_queryset.filter(id__in=antenna_ids)
        antenas = list(antenas_queryset)
        for antena in antenas:
            antena.ativa = True
            antena.ultimo_acionamento = now
            antena.ativacao_expira_em = finaliza_em
            antena.save(update_fields=["ativa", "ultimo_acionamento", "ativacao_expira_em"])
            AuditoriaLeitorStatus.objects.create(
                job=job,
                antena=antena,
                status=AuditoriaLeitorStatus.Status.ENERGIZADO,
            )
        TimelineEvento.objects.create(
            item=None,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem=f"Broadcast de auditoria iniciado para {len(antenas)} leitor(es).",
            usuario=requested_by,
            metadados={
                "auditoria_job_id": job.id,
                "duracao_segundos": duracao_segundos,
                "antenna_ids": [antena.id for antena in antenas],
                "total_antenas": len(antenas),
            },
        )
        return job

    @transaction.atomic
    def finalize_expired_jobs(self) -> int:
        started_at = perf_counter()
        now = timezone.now()
        jobs = list(
            AuditoriaJob.objects.filter(
                status=AuditoriaJob.Status.INICIADO,
                finaliza_em__lte=now,
            )
        )
        if not jobs:
            log_debug_timing("finalize_expired_jobs", started_at, updated=0)
            return 0

        for job in jobs:
            leitor_statuses = list(job.leitores.select_related("antena"))
            for leitor in leitor_statuses:
                leitor.antena.ativa = False
                leitor.antena.save(update_fields=["ativa"])
                leitor.status = AuditoriaLeitorStatus.Status.ENCERRADO
                leitor.save(update_fields=["status", "atualizado_em"])
            job.status = AuditoriaJob.Status.CONCLUIDO
            job.concluido_em = now
            job.save(update_fields=["status", "concluido_em"])
            TimelineEvento.objects.create(
                item=None,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                mensagem=f"Broadcast de auditoria {job.id} concluido.",
                usuario=job.solicitado_por,
                metadados={"auditoria_job_id": job.id, "evento": "auditoria_concluida"},
            )
        log_debug_timing("finalize_expired_jobs", started_at, updated=len(jobs))
        return len(jobs)


def previous_local_id(local) -> int | None:
    if local is None:
        return None
    return local.id


def usuario_label(usuario) -> str:
    if not usuario:
        return "desconhecido"
    return getattr(usuario, "get_username", lambda: str(usuario))()
