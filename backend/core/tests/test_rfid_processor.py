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
from core.infrastructure.rfid_handler import RFIDEventProcessor, SensorVirtual
from core.tests.base import FakeHttpResponse, PipelineAndApiTestBase




class FakeCommandService:
    def __init__(self):
        self.calls = []

    def send_start_reading(self, *, antenna, command):
        self.calls.append((antenna.id, command.active_for_seconds))
        return {"command_delivery": "fake"}




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

    def test_processor_accepts_injected_command_service(self):
        local = Local.objects.create(nome="Lab DI", codigo="LABDI")
        antenna = AntenaRFID.objects.create(
            nome="Antenna DI",
            hardware_id="ESP-DI-001",
            local=local,
            tipo=AntenaRFID.TipoAntena.DESTINO,
            duracao_padrao_segundos=9,
        )
        command_service = FakeCommandService()
        processor = RFIDEventProcessor(command_service=command_service)

        response = processor.process_motion_detected(antenna=antenna)

        self.assertEqual(response["command_delivery"], "fake")
        self.assertEqual(command_service.calls, [(antenna.id, 9)])




class RFIDApiTests(PipelineAndApiTestBase):
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

    def test_antenas_endpoint_accepts_http_command_configuration(self):
        self.client.force_authenticate(user=self.admin)
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
        self.client.force_authenticate(user=self.admin)
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

    @patch("core.infrastructure.rfid_handler.request.urlopen")
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

    @patch("core.infrastructure.rfid_handler.request.urlopen")
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
