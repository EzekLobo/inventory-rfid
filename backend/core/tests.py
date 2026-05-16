from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient
from unittest.mock import patch

from core.domain.models import (
    AntenaRFID,
    AuditoriaJob,
    ItemPatrimonial,
    Local,
    NotificacaoInconsistencia,
    TimelineEvento,
)
from core.middleware.rfid_handler import RFIDEventProcessor, SensorVirtual


class FakeHttpResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class SensorVirtualTests(TestCase):
    def test_motion_activates_antenna_for_default_timeout(self):
        local = Local.objects.create(nome="Lab 4A", codigo="LAB4A")
        antenna = AntenaRFID.objects.create(
            nome="Antenna 1",
            hardware_id="ESP-001",
            local=local,
            tipo=AntenaRFID.TipoAntena.DESTINO,
        )
        sensor = SensorVirtual(hardware_id="IR-1")
        sensor.receive_ping()

        command = sensor.on_motion_detected(antenna=antenna)

        antenna.refresh_from_db()
        self.assertTrue(sensor.is_online)
        self.assertTrue(antenna.ativa)
        self.assertEqual(command.active_for_seconds, 5)


class PipelineAndApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="prof",
            email="prof@example.com",
            password="secret123",
        )
        self.admin = get_user_model().objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="secret123",
        )
        self.lab4 = Local.objects.create(nome="Lab 4A", codigo="LAB4A")
        self.lab1 = Local.objects.create(nome="Lab 1", codigo="LAB1")
        self.destino_antenna = AntenaRFID.objects.create(
            nome="Destino 4A",
            hardware_id="ESP-DEST-001",
            local=self.lab4,
            tipo=AntenaRFID.TipoAntena.DESTINO,
        )
        self.item = ItemPatrimonial.objects.create(
            tag_id="TAG-OSC-001",
            nome="Osciloscopio",
            local_logico=self.lab1,
            responsavel=self.user,
        )

    def _rfid_headers(self):
        return {"HTTP_X_RFID_TOKEN": settings.RFID_INGEST_TOKEN}

    def test_event_pipeline_motion_then_tags_read_updates_item_and_timeline(self):
        response_motion = self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )
        self.assertEqual(response_motion.status_code, 201)

        response_tags = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [self.item.tag_id],
            },
            format="json",
            **self._rfid_headers(),
        )
        self.assertEqual(response_tags.status_code, 201)

        self.item.refresh_from_db()
        self.assertEqual(self.item.local_fisico_id, self.lab4.id)
        self.assertTrue(
            TimelineEvento.objects.filter(
                item=self.item,
                tipo=TimelineEvento.TipoEvento.MOVIMENTACAO,
            ).exists()
        )
        self.assertTrue(NotificacaoInconsistencia.objects.filter(item=self.item, resolvida=False).exists())

    def test_audit_reading_marks_expected_items_not_found(self):
        expected_item = ItemPatrimonial.objects.create(
            tag_id="TAG-PROJ-001",
            nome="Projetor Epson",
            local_logico=self.lab4,
            responsavel=self.user,
        )
        self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [],
                "payload": {"audit": True, "auditoria_job_id": 123},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["audit"]["nao_encontrados"], 1)
        self.assertTrue(
            NotificacaoInconsistencia.objects.filter(
                item=expected_item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                resolvida=False,
            ).exists()
        )
        self.assertTrue(
            TimelineEvento.objects.filter(
                item=expected_item,
                tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
                metadados__tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
            ).exists()
        )

    def test_audit_reading_resolves_not_found_when_item_is_read_again(self):
        expected_item = ItemPatrimonial.objects.create(
            tag_id="TAG-PROJ-001",
            nome="Projetor Epson",
            local_logico=self.lab4,
            responsavel=self.user,
        )
        NotificacaoInconsistencia.objects.create(
            item=expected_item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
            tag_id=expected_item.tag_id,
            local_logico=self.lab4,
            resolvida=False,
        )
        self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [expected_item.tag_id],
                "payload": {"audit": True},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["audit"]["encontrados"], 1)
        self.assertFalse(
            NotificacaoInconsistencia.objects.filter(
                item=expected_item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                resolvida=False,
            ).exists()
        )
        self.assertTrue(
            NotificacaoInconsistencia.objects.filter(
                item=expected_item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                resolvida=True,
            ).exists()
        )

    def test_audit_reading_records_correct_location_in_item_timeline(self):
        expected_item = ItemPatrimonial.objects.create(
            tag_id="TAG-PROJ-OK",
            nome="Projetor correto",
            local_logico=self.lab4,
            responsavel=self.user,
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [expected_item.tag_id],
                "payload": {"audit": True, "auditoria_job_id": 321},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["audit"]["encontrados"], 1)
        self.assertEqual(response.data["audit"]["nao_encontrados"], 0)
        self.assertEqual(response.data["audit"]["tags_fora_do_local"], 0)
        self.assertEqual(response.data["audit"]["tags_desconhecidas"], 0)
        self.assertTrue(
            TimelineEvento.objects.filter(
                item=expected_item,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="item_lido_local_correto",
                metadados__tag_id=expected_item.tag_id,
                metadados__antenna_id=self.destino_antenna.id,
                metadados__local_id=self.lab4.id,
                metadados__auditoria_job_id=321,
            ).exists()
        )

    def test_audit_reading_records_unknown_tags(self):
        self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": ["TAG-DESCONHECIDA"],
                "payload": {"audit": True},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["audit"]["tags_desconhecidas"], 1)
        self.assertIn("TAG-DESCONHECIDA", response.data["ignored_tags"])
        self.assertTrue(
            NotificacaoInconsistencia.objects.filter(
                item__isnull=True,
                tag_id="TAG-DESCONHECIDA",
                tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
                resolvida=False,
            ).exists()
        )

    def test_audit_reading_records_detailed_metadata(self):
        expected_item = ItemPatrimonial.objects.create(
            tag_id="TAG-PROJ-003",
            nome="Projetor LG",
            local_logico=self.lab4,
            responsavel=self.user,
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [expected_item.tag_id, self.item.tag_id, "TAG-SEM-CADASTRO"],
                "payload": {"audit": True},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["audit"]["esperados"], 1)
        self.assertEqual(response.data["audit"]["encontrados"], 1)
        self.assertEqual(response.data["audit"]["tags_fora_do_local"], 1)
        self.assertEqual(response.data["audit"]["tags_desconhecidas"], 1)
        self.assertEqual(response.data["audit"]["total_lidos"], 3)

        evento = TimelineEvento.objects.filter(
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            metadados__evento="auditoria_processada",
        ).latest("criado_em")
        self.assertEqual(evento.metadados["total_lidos"], 3)
        self.assertEqual(evento.metadados["itens_esperados"][0]["tag_id"], expected_item.tag_id)
        self.assertEqual(evento.metadados["itens_encontrados"][0]["tag_id"], expected_item.tag_id)
        self.assertEqual(evento.metadados["itens_divergentes"][0]["tag_id"], self.item.tag_id)
        self.assertEqual(evento.metadados["tags_desconhecidas_lista"], ["TAG-SEM-CADASTRO"])

    def test_manual_audit_payload_processes_even_without_open_reader_window(self):
        expected_item = ItemPatrimonial.objects.create(
            tag_id="TAG-PROJ-002",
            nome="Projetor Benq",
            local_logico=self.lab4,
            responsavel=self.user,
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [],
                "payload": {"audit": True, "source": "frontend_manual"},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["audit"]["nao_encontrados"], 1)
        self.assertTrue(
            NotificacaoInconsistencia.objects.filter(
                item=expected_item,
                tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
                resolvida=False,
            ).exists()
        )
        self.assertTrue(
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="auditoria_processada",
            ).exists()
        )

    def test_rfid_command_endpoint_reports_idle_or_start_reading(self):
        idle = self.client.get(
            f"/api/eventos/rfid/comando/?antenna_id={self.destino_antenna.id}",
            **self._rfid_headers(),
        )
        self.assertEqual(idle.status_code, 200)
        self.assertEqual(idle.data["command"], "idle")
        self.assertEqual(idle.data["payload"], {})

        self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        active = self.client.get(
            f"/api/eventos/rfid/comando/?antenna_id={self.destino_antenna.id}",
            **self._rfid_headers(),
        )
        self.assertEqual(active.status_code, 200)
        self.assertEqual(active.data["command"], "start_reading")
        self.assertTrue(active.data["active"])
        self.assertGreaterEqual(active.data["active_for_seconds"], 0)
        self.assertEqual(active.data["payload"], {})

    def test_rfid_command_endpoint_includes_single_antenna_audit_payload(self):
        self.client.force_authenticate(user=self.user)
        RFIDEventProcessor().process_ping(antenna=self.destino_antenna)
        audit_response = self.client.post(
            f"/api/antenas/{self.destino_antenna.id}/auditar/",
            {"duracao_segundos": 7},
            format="json",
        )
        self.assertEqual(audit_response.status_code, 200)

        command_response = self.client.get(
            f"/api/eventos/rfid/comando/?antenna_id={self.destino_antenna.id}",
            **self._rfid_headers(),
        )
        self.assertEqual(command_response.status_code, 200)
        self.assertEqual(command_response.data["command"], "start_reading")
        self.assertEqual(command_response.data["payload"], {"audit": True})

        tags_response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [self.item.tag_id],
                "payload": command_response.data["payload"],
            },
            format="json",
            **self._rfid_headers(),
        )
        self.assertEqual(tags_response.status_code, 201)
        self.assertTrue(
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="auditoria_processada",
            ).exists()
        )

    def test_rfid_command_endpoint_includes_broadcast_audit_payload(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/auditoria/broadcast/", {"duracao_segundos": 8}, format="json")
        self.assertEqual(response.status_code, 200)

        command_response = self.client.get(
            f"/api/eventos/rfid/comando/?antenna_id={self.destino_antenna.id}",
            **self._rfid_headers(),
        )
        self.assertEqual(command_response.status_code, 200)
        self.assertEqual(command_response.data["command"], "start_reading")
        self.assertEqual(
            command_response.data["payload"],
            {"audit": True, "auditoria_job_id": response.data["auditoria_job_id"]},
        )

    def test_manual_deactivation_marks_item_inactive_and_registers_timeline(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            f"/api/itens/{self.item.id}/inativar/",
            {"motivo": "baixa patrimonial"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        self.item.refresh_from_db()
        self.assertFalse(self.item.ativo)
        self.assertTrue(
            TimelineEvento.objects.filter(
                item=self.item,
                tipo=TimelineEvento.TipoEvento.BAIXA,
                usuario=self.user,
                metadados__motivo="baixa patrimonial",
            ).exists()
        )

    def test_antenas_endpoint_lists_and_activates_reader(self):
        self.client.force_authenticate(user=self.user)
        RFIDEventProcessor().process_ping(antenna=self.destino_antenna)
        list_response = self.client.get("/api/antenas/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data[0]["id"], self.destino_antenna.id)
        self.assertEqual(list_response.data[0]["modo_comando"], AntenaRFID.ModoComando.POLLING)

        activate_response = self.client.post(
            f"/api/antenas/{self.destino_antenna.id}/ativar/",
            {"duracao_segundos": 7},
            format="json",
        )
        self.assertEqual(activate_response.status_code, 200)
        self.assertEqual(activate_response.data["status"], "sincronizacao_iniciada")
        self.destino_antenna.refresh_from_db()
        self.assertTrue(self.destino_antenna.ativa)

    def test_antenas_endpoint_accepts_http_command_configuration(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/antenas/",
            {
                "nome": "Porta Lab",
                "hardware_id": "HTTP-001",
                "local_id": self.lab4.id,
                "tipo": AntenaRFID.TipoAntena.DESTINO,
                "modo_comando": AntenaRFID.ModoComando.HTTP,
                "command_url": "http://192.168.0.50/read",
                "command_token": "secret-token",
                "duracao_padrao_segundos": 9,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["modo_comando"], AntenaRFID.ModoComando.HTTP)
        self.assertEqual(response.data["command_url"], "http://192.168.0.50/read")
        self.assertTrue(response.data["command_token_configurado"])
        self.assertNotIn("command_token", response.data)

        antenna = AntenaRFID.objects.get(hardware_id="HTTP-001")
        self.assertEqual(antenna.command_token, "secret-token")

    def test_http_command_mode_requires_command_url(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/antenas/",
            {
                "nome": "Sem URL",
                "hardware_id": "HTTP-SEM-URL",
                "local_id": self.lab4.id,
                "tipo": AntenaRFID.TipoAntena.DESTINO,
                "modo_comando": AntenaRFID.ModoComando.HTTP,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("command_url", response.data)

    @patch("core.middleware.rfid_handler.request.urlopen")
    def test_motion_detected_sends_direct_http_command_for_http_antenna(self, urlopen):
        urlopen.return_value = FakeHttpResponse()
        self.destino_antenna.modo_comando = AntenaRFID.ModoComando.HTTP
        self.destino_antenna.command_url = "http://192.168.0.50/read"
        self.destino_antenna.command_token = "antenna-secret"
        self.destino_antenna.duracao_padrao_segundos = 8
        self.destino_antenna.save(
            update_fields=["modo_comando", "command_url", "command_token", "duracao_padrao_segundos"]
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["command_delivery"], "sent")
        self.assertEqual(response.data["command_status_code"], 200)
        self.assertEqual(response.data["command"]["active_for_seconds"], 8)
        http_request = urlopen.call_args.args[0]
        self.assertEqual(http_request.full_url, "http://192.168.0.50/read")
        self.assertEqual(http_request.headers["X-antenna-command-token"], "antenna-secret")
        self.assertIn(b'"command": "start_reading"', http_request.data)
        self.destino_antenna.refresh_from_db()
        self.assertTrue(self.destino_antenna.ativa)

    @patch("core.middleware.rfid_handler.request.urlopen")
    def test_motion_detected_reports_direct_http_command_failure_and_keeps_window(self, urlopen):
        urlopen.side_effect = OSError("connection refused")
        self.destino_antenna.modo_comando = AntenaRFID.ModoComando.HTTP
        self.destino_antenna.command_url = "http://192.168.0.50/read"
        self.destino_antenna.save(update_fields=["modo_comando", "command_url"])

        response = self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["command_delivery"], "failed")
        self.destino_antenna.refresh_from_db()
        self.assertTrue(self.destino_antenna.ativa)
        self.assertTrue(
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="command_delivery_failed",
                metadados__antenna_id=self.destino_antenna.id,
            ).exists()
        )

    def test_antenas_endpoint_marks_stale_reader_offline_and_blocks_actions(self):
        self.destino_antenna.online = True
        self.destino_antenna.ultimo_ping = timezone.now() - timedelta(seconds=settings.RFID_ONLINE_TIMEOUT_SECONDS + 1)
        self.destino_antenna.save(update_fields=["online", "ultimo_ping"])

        self.client.force_authenticate(user=self.user)
        list_response = self.client.get("/api/antenas/")
        self.assertEqual(list_response.status_code, 200)
        self.assertFalse(list_response.data[0]["online"])

        activate_response = self.client.post(
            f"/api/antenas/{self.destino_antenna.id}/ativar/",
            {"duracao_segundos": 7},
            format="json",
        )
        self.assertEqual(activate_response.status_code, 409)
        self.assertEqual(activate_response.data["status"], "offline")

    def test_itens_endpoint_lists_registered_assets(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/itens/?search=OSC")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["tag_id"], self.item.tag_id)

    def test_inconsistency_is_deduplicated_and_resolved_after_reconciliation(self):
        processor = RFIDEventProcessor()
        processor.process_motion_detected(antenna=self.destino_antenna)
        processor.process_tags_read(antenna=self.destino_antenna, tags=[self.item.tag_id])
        processor.process_tags_read(antenna=self.destino_antenna, tags=[self.item.tag_id])
        self.assertEqual(NotificacaoInconsistencia.objects.filter(item=self.item, resolvida=False).count(), 1)

        self.destino_antenna.local = self.lab1
        self.destino_antenna.save(update_fields=["local"])
        processor.process_motion_detected(antenna=self.destino_antenna)
        processor.process_tags_read(antenna=self.destino_antenna, tags=[self.item.tag_id])

        self.assertEqual(NotificacaoInconsistencia.objects.filter(item=self.item, resolvida=False).count(), 0)
        self.assertTrue(NotificacaoInconsistencia.objects.filter(item=self.item, resolvida=True).exists())

    def test_timeline_endpoint_filters_me(self):
        self.client.force_authenticate(user=self.user)
        TimelineEvento.objects.create(
            item=self.item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem="Teste",
            usuario=self.user,
        )
        response = self.client.get("/api/timeline/?me=true")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data), 1)

    def test_timeline_endpoint_filters_operational_log(self):
        other_item = ItemPatrimonial.objects.create(
            tag_id="TAG-LOG-002",
            nome="Multimetro",
            local_logico=self.lab4,
            responsavel=self.user,
        )
        TimelineEvento.objects.create(
            item=self.item,
            tipo=TimelineEvento.TipoEvento.MOVIMENTACAO,
            mensagem="Osciloscopio movido para o laboratorio",
            usuario=self.user,
            metadados={
                "tag_id": self.item.tag_id,
                "local_id": self.lab4.id,
                "antenna_id": self.destino_antenna.id,
                "evento": "tags_read",
            },
        )
        TimelineEvento.objects.create(
            item=other_item,
            tipo=TimelineEvento.TipoEvento.SISTEMA,
            mensagem="Evento de outro item",
            usuario=self.admin,
            metadados={"local_id": self.lab1.id},
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get(
            f"/api/timeline/?tipo=movimentacao&search=OSC&local_id={self.lab4.id}&antenna_id={self.destino_antenna.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["item_nome"], self.item.nome)
        self.assertEqual(response.data[0]["item_tag"], self.item.tag_id)

    def test_inconsistencias_endpoint_requires_auth_and_filters(self):
        NotificacaoInconsistencia.objects.create(
            item=self.item,
            local_logico=self.lab1,
            local_fisico=self.lab4,
            resolvida=False,
        )
        response_no_auth = self.client.get("/api/inconsistencias/")
        self.assertEqual(response_no_auth.status_code, 403)

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/inconsistencias/?resolvida=false")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_confirmar_local_updates_logical_location_and_timeline(self):
        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=self.item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
            tag_id=self.item.tag_id,
            local_logico=self.lab1,
            local_fisico=self.lab4,
            resolvida=False,
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            f"/api/inconsistencias/{inconsistencia.id}/confirmar-local/",
            {"motivo": "transferencia confirmada"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.item.refresh_from_db()
        inconsistencia.refresh_from_db()
        self.assertEqual(self.item.local_logico_id, self.lab4.id)
        self.assertTrue(inconsistencia.resolvida)
        self.assertTrue(
            TimelineEvento.objects.filter(
                item=self.item,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="local_logico_confirmado",
            ).exists()
        )

    def test_unknown_tag_can_be_registered_as_item(self):
        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=None,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
            tag_id="TAG-NOVA-001",
            local_fisico=self.lab4,
            resolvida=False,
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            f"/api/inconsistencias/{inconsistencia.id}/cadastrar-tag/",
            {"nome": "Notebook Dell", "motivo": "item identificado na bancada"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        item = ItemPatrimonial.objects.get(tag_id="TAG-NOVA-001")
        inconsistencia.refresh_from_db()
        self.assertEqual(item.local_logico_id, self.lab4.id)
        self.assertEqual(item.local_fisico_id, self.lab4.id)
        self.assertEqual(item.responsavel_id, self.user.id)
        self.assertTrue(inconsistencia.resolvida)
        self.assertEqual(inconsistencia.item_id, item.id)

    def test_unknown_tag_can_be_associated_to_existing_item(self):
        item_sem_tag = ItemPatrimonial.objects.create(
            tag_id="TEMP-SEM-TAG",
            nome="Fonte ajustavel",
            local_logico=self.lab4,
            responsavel=self.user,
        )
        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=None,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
            tag_id="TAG-FONTE-001",
            local_fisico=self.lab4,
            resolvida=False,
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            f"/api/inconsistencias/{inconsistencia.id}/associar-tag/",
            {"item_id": item_sem_tag.id, "motivo": "etiqueta conferida manualmente"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        item_sem_tag.refresh_from_db()
        inconsistencia.refresh_from_db()
        self.assertEqual(item_sem_tag.tag_id, "TAG-FONTE-001")
        self.assertEqual(item_sem_tag.local_fisico_id, self.lab4.id)
        self.assertTrue(inconsistencia.resolvida)
        self.assertEqual(inconsistencia.item_id, item_sem_tag.id)

    def test_broadcast_requires_admin(self):
        self.client.force_authenticate(user=self.user)
        forbidden = self.client.post("/api/auditoria/broadcast/", {"duracao_segundos": 8}, format="json")
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(user=self.admin)
        success = self.client.post("/api/auditoria/broadcast/", {"duracao_segundos": 8}, format="json")
        self.assertEqual(success.status_code, 200)
        self.assertTrue(AuditoriaJob.objects.filter(id=success.data["auditoria_job_id"]).exists())

    def test_broadcast_can_target_selected_antennas(self):
        second_antenna = AntenaRFID.objects.create(
            nome="Destino 1",
            hardware_id="ESP-DEST-002",
            local=self.lab1,
            tipo=AntenaRFID.TipoAntena.DESTINO,
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/auditoria/broadcast/",
            {"duracao_segundos": 8, "antenna_ids": [second_antenna.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_antenas"], 1)
        self.destino_antenna.refresh_from_db()
        second_antenna.refresh_from_db()
        self.assertFalse(self.destino_antenna.ativa)
        self.assertTrue(second_antenna.ativa)

    def test_movimentacao_alias_uses_topology_pipeline(self):
        self.client.force_authenticate(user=self.user)
        self.destino_antenna.ativa = True
        self.destino_antenna.save(update_fields=["ativa"])
        response = self.client.post(
            "/api/movimentacao/",
            {"TagID": self.item.tag_id, "AntennaID": self.destino_antenna.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["event"], "tags_read")

    def test_audit_reading_does_not_create_movement_or_update_location(self):
        self.client.post(
            "/api/eventos/rfid/",
            {"event_type": "motion_detected", "antenna_id": self.destino_antenna.id},
            format="json",
            **self._rfid_headers(),
        )

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [self.item.tag_id],
                "payload": {"audit": True},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.item.refresh_from_db()
        self.assertIsNone(self.item.local_fisico_id)
        self.assertFalse(
            TimelineEvento.objects.filter(
                item=self.item,
                tipo=TimelineEvento.TipoEvento.MOVIMENTACAO,
            ).exists()
        )
        self.assertTrue(
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="auditoria_processada",
            ).exists()
        )

    def test_tags_read_without_payload_is_audit_when_antenna_audit_window_is_active(self):
        self.client.force_authenticate(user=self.user)
        RFIDEventProcessor().process_ping(antenna=self.destino_antenna)
        audit_response = self.client.post(
            f"/api/antenas/{self.destino_antenna.id}/auditar/",
            {"duracao_segundos": 7},
            format="json",
        )
        self.assertEqual(audit_response.status_code, 200)

        response = self.client.post(
            "/api/eventos/rfid/",
            {
                "event_type": "tags_read",
                "antenna_id": self.destino_antenna.id,
                "tags": [self.item.tag_id],
                "payload": {"source": "comunicador_intermediario"},
            },
            format="json",
            **self._rfid_headers(),
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["audit"]["audit"])
        self.assertEqual(response.data["processed"]["destino"], 1)
        self.item.refresh_from_db()
        self.assertIsNone(self.item.local_fisico_id)
        self.assertTrue(
            TimelineEvento.objects.filter(
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                metadados__evento="auditoria_processada",
                metadados__source="comunicador_intermediario",
            ).exists()
        )
