from core.tests.base import *  # noqa: F403


class InconsistenciaApiTests(PipelineAndApiTestBase):
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
