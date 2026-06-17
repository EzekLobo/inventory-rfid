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
    TecnicoPermissoes,
    TimelineEvento,
)
from core.infrastructure.rfid_handler import RFIDEventProcessor




class FakeHttpResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False




class PipelineAndApiTestBase(TestCase):
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

    def _results(self, response):
        return response.data.get("results", response.data)

