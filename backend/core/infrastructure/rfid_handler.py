from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import json
import logging
from time import perf_counter
from urllib import error, request

from django.utils import timezone
from django.conf import settings

from core.domain.models import AntenaRFID, AuditoriaJob, AuditoriaLeitorStatus, ItemPatrimonial, LeituraRFID, TimelineEvento
from core.domain.services import AuditoriaManager, AuditoriaReconciliacaoManager, SyncManager


logger = logging.getLogger(__name__)


def log_debug_timing(label: str, started_at: float, **details) -> None:
    if not settings.DEBUG:
        return
    elapsed_ms = (perf_counter() - started_at) * 1000
    logger.debug("%s executado em %.2fms %s", label, elapsed_ms, details)


@dataclass
class ActivationCommand:
    hardware_id: str
    active_for_seconds: int
    expires_at: str


class AntennaCommandService:
    def send_start_reading(self, *, antenna: AntenaRFID, command: ActivationCommand) -> dict:
        if antenna.modo_comando != AntenaRFID.ModoComando.HTTP:
            return {"command_delivery": "available_for_polling"}

        payload = {
            "command": "start_reading",
            "antenna_id": antenna.id,
            "hardware_id": command.hardware_id,
            "active_for_seconds": command.active_for_seconds,
            "expires_at": command.expires_at,
        }
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if antenna.command_token:
            headers["X-Antenna-Command-Token"] = antenna.command_token

        timeout = getattr(settings, "RFID_COMMAND_TIMEOUT_SECONDS", 3)
        try:
            http_request = request.Request(
                antenna.command_url,
                data=body,
                headers=headers,
                method="POST",
            )
            with request.urlopen(http_request, timeout=timeout) as response:
                return {
                    "command_delivery": "sent",
                    "command_status_code": response.status,
                }
        except error.HTTPError as exc:
            return {
                "command_delivery": "failed",
                "command_status_code": exc.code,
                "command_error": str(exc.reason),
            }
        except (error.URLError, TimeoutError, OSError) as exc:
            return {
                "command_delivery": "failed",
                "command_error": str(exc),
            }


class SensorVirtual:
    """
    Encapsula o sensor físico e mantém estado operacional via pings/interrupções.
    """

    def __init__(self, *, hardware_id: str, antenna_timeout_seconds: int = 5):
        self.hardware_id = hardware_id
        self.antenna_timeout_seconds = antenna_timeout_seconds
        self.is_online = False
        self.last_ping_at = None

    def receive_ping(self) -> None:
        self.last_ping_at = timezone.now()
        self.is_online = True

    def mark_offline_if_stale(self, *, stale_after_seconds: int = 15) -> bool:
        if not self.last_ping_at:
            self.is_online = False
            return self.is_online
        self.is_online = timezone.now() - self.last_ping_at <= timedelta(seconds=stale_after_seconds)
        return self.is_online

    def on_motion_detected(self, *, antenna: AntenaRFID) -> ActivationCommand:
        now = timezone.now()
        antenna.ativa = True
        antenna.ultimo_acionamento = now
        antenna.save(update_fields=["ativa", "ultimo_acionamento"])
        return ActivationCommand(
            hardware_id=antenna.hardware_id,
            active_for_seconds=self.antenna_timeout_seconds,
            expires_at=(now + timedelta(seconds=self.antenna_timeout_seconds)).isoformat(),
        )


class TopologyClassifier:
    def __init__(self, sync_manager: SyncManager | None = None):
        self.sync_manager = sync_manager or SyncManager()

    def classify_readings(
        self,
        *,
        antenna: AntenaRFID,
        tags: list[str],
        payload: dict | None = None,
    ) -> dict:
        processados = {"destino": 0, "fluxo": 0}
        for tag_id in tags:
            if antenna.tipo == AntenaRFID.TipoAntena.DESTINO:
                self.sync_manager.sync_item_location(
                    tag_id=tag_id,
                    local_id=antenna.local_id,
                    antena=antenna,
                    payload=payload,
                )
                processados["destino"] += 1
            elif antenna.tipo == AntenaRFID.TipoAntena.FLUXO:
                self.sync_manager.register_flow_trace(
                    tag_id=tag_id,
                    local_id=antenna.local_id,
                    antena=antenna,
                    payload=payload,
                )
                processados["fluxo"] += 1
            else:
                LeituraRFID.objects.create(
                    tag_id=tag_id,
                    local_id=antenna.local_id,
                    antena=antenna,
                    classificacao=LeituraRFID.ClassificacaoLeitura.FLUXO,
                    payload={"warning": "tipo_antena_desconhecido", **(payload or {})},
                )
        return processados


class RFIDEventProcessor:
    def __init__(
        self,
        *,
        sync_manager: SyncManager | None = None,
        classifier: TopologyClassifier | None = None,
        auditoria_manager: AuditoriaManager | None = None,
        auditoria_reconciliacao_manager: AuditoriaReconciliacaoManager | None = None,
        command_service: AntennaCommandService | None = None,
    ):
        self.sync_manager = sync_manager or getattr(classifier, "sync_manager", None) or SyncManager()
        self.classifier = classifier or TopologyClassifier(sync_manager=self.sync_manager)
        self.auditoria_manager = auditoria_manager or AuditoriaManager()
        self.auditoria_reconciliacao_manager = auditoria_reconciliacao_manager or AuditoriaReconciliacaoManager()
        self.command_service = command_service or AntennaCommandService()

    def process_ping(self, *, antenna: AntenaRFID) -> dict:
        now = timezone.now()
        antenna.ultimo_ping = now
        antenna.online = True
        antenna.save(update_fields=["ultimo_ping", "online"])
        return {"status": "ok", "event": "ping", "antenna_id": antenna.id}

    def process_motion_detected(self, *, antenna: AntenaRFID) -> dict:
        sensor = SensorVirtual(
            hardware_id=antenna.hardware_id,
            antenna_timeout_seconds=antenna.duracao_padrao_segundos,
        )
        command = sensor.on_motion_detected(antenna=antenna)
        antenna.ativacao_expira_em = timezone.now() + timedelta(seconds=command.active_for_seconds)
        antenna.save(update_fields=["ativacao_expira_em"])
        delivery = self.command_service.send_start_reading(antenna=antenna, command=command)
        if delivery.get("command_delivery") == "failed":
            TimelineEvento.objects.create(
                item=None,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                mensagem=f"Falha ao enviar comando direto para antena {antenna.nome}.",
                usuario=None,
                metadados={
                    "evento": "command_delivery_failed",
                    "antenna_id": antenna.id,
                    "hardware_id": antenna.hardware_id,
                    "command_url": antenna.command_url,
                    **delivery,
                },
            )
        return {
            "status": "ok",
            "event": "motion_detected",
            "command": {
                "hardware_id": command.hardware_id,
                "active_for_seconds": command.active_for_seconds,
                "expires_at": command.expires_at,
            },
            **delivery,
        }

    def process_tags_read(self, *, antenna: AntenaRFID, tags: list[str], payload: dict | None = None) -> dict:
        self.deactivate_expired_antennas()
        antenna.refresh_from_db(fields=["ativa", "ativacao_expira_em"])
        payload = self._payload_with_active_audit_context(antenna=antenna, payload=payload)
        is_audit = self.auditoria_reconciliacao_manager.is_audit_payload(payload)
        window_closed = (not antenna.ativa) or (
            antenna.ativacao_expira_em and antenna.ativacao_expira_em <= timezone.now()
        )
        if window_closed and not is_audit:
            return {"status": "ignored", "reason": "antenna_window_closed", "event": "tags_read"}

        normalized_tags = normalize_tags(tags)
        valid_tags = list(
            ItemPatrimonial.objects.filter(tag_id__in=normalized_tags).values_list("tag_id", flat=True)
        )
        auditoria = self.auditoria_reconciliacao_manager.reconcile_destination_reading(
            antenna=antenna,
            raw_tags=normalized_tags,
            valid_tags=valid_tags,
            payload=payload,
        )
        if auditoria.get("audit"):
            result = self._register_audit_readings(antenna=antenna, tags=valid_tags, payload=payload)
        else:
            result = self.classifier.classify_readings(antenna=antenna, tags=valid_tags, payload=payload)
        return {
            "status": "ok",
            "event": "tags_read",
            "processed": result,
            "audit": auditoria,
            "ignored_tags": sorted(set(normalized_tags) - set(valid_tags)),
        }

    def _register_audit_readings(self, *, antenna: AntenaRFID, tags: list[str], payload: dict | None = None) -> dict:
        payload = {"audit_reading": True, **(payload or {})}
        for tag_id in tags:
            item = ItemPatrimonial.objects.filter(tag_id=tag_id).first()
            LeituraRFID.objects.create(
                item=item,
                tag_id=tag_id,
                local_id=antenna.local_id,
                antena=antenna,
                classificacao=(
                    LeituraRFID.ClassificacaoLeitura.DESTINO
                    if antenna.tipo == AntenaRFID.TipoAntena.DESTINO
                    else LeituraRFID.ClassificacaoLeitura.FLUXO
                ),
                payload=payload,
            )
        return {
            "destino": len(tags) if antenna.tipo == AntenaRFID.TipoAntena.DESTINO else 0,
            "fluxo": len(tags) if antenna.tipo == AntenaRFID.TipoAntena.FLUXO else 0,
        }

    def _payload_with_active_audit_context(self, *, antenna: AntenaRFID, payload: dict | None = None) -> dict:
        payload = payload or {}
        if self.auditoria_reconciliacao_manager.is_audit_payload(payload):
            return payload
        if not antenna.ativa or not antenna.ativacao_expira_em:
            return payload

        broadcast_reader = (
            AuditoriaLeitorStatus.objects.select_related("job")
            .filter(
                antena=antenna,
                status=AuditoriaLeitorStatus.Status.ENERGIZADO,
                job__status=AuditoriaJob.Status.INICIADO,
                job__finaliza_em=antenna.ativacao_expira_em,
            )
            .order_by("-job__iniciado_em")
            .first()
        )
        if broadcast_reader:
            return {**payload, "audit": True, "auditoria_job_id": broadcast_reader.job_id}

        timeline = (
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="auditoria_iniciada",
                metadados__antenna_id=antenna.id,
                metadados__finaliza_em=antenna.ativacao_expira_em.isoformat(),
            )
            .order_by("-criado_em")
            .first()
        )
        if timeline:
            return {**payload, "audit": True}

        return payload

    def deactivate_expired_antennas(self) -> int:
        started_at = perf_counter()
        now = timezone.now()
        expired = AntenaRFID.objects.filter(ativa=True, ativacao_expira_em__isnull=False, ativacao_expira_em__lte=now)
        updated = expired.update(ativa=False)
        self.auditoria_manager.finalize_expired_jobs()
        log_debug_timing("deactivate_expired_antennas", started_at, updated=updated)
        return updated

    def mark_stale_antennas_offline(self) -> int:
        started_at = perf_counter()
        timeout_seconds = getattr(settings, "RFID_ONLINE_TIMEOUT_SECONDS", 15)
        stale_limit = timezone.now() - timedelta(seconds=timeout_seconds)
        stale = AntenaRFID.objects.filter(online=True).filter(
            ultimo_ping__isnull=True
        ) | AntenaRFID.objects.filter(online=True, ultimo_ping__lt=stale_limit)
        updated = stale.update(online=False, ativa=False)
        log_debug_timing("mark_stale_antennas_offline", started_at, updated=updated)
        return updated


def normalize_tags(tags: list[str]) -> list[str]:
    normalized = []
    seen = set()
    for tag in tags:
        tag_id = str(tag).strip()
        if tag_id and tag_id not in seen:
            normalized.append(tag_id)
            seen.add(tag_id)
    return normalized
