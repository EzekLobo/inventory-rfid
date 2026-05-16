from core.tests.base import *  # noqa: F403


class AuditoriaApiTests(PipelineAndApiTestBase):
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

    def test_inconsistencias_endpoint_exposes_audit_group_context_from_job(self):
        NotificacaoInconsistencia.objects.create(
            item=self.item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO,
            tag_id=self.item.tag_id,
            local_logico=self.lab4,
            local_fisico=self.lab4,
            resolvida=False,
            metadados={
                "audit": True,
                "auditoria_job_id": 42,
                "auditoria_criada_em": "2026-05-16T10:30:00+00:00",
                "local_nome": "Lab 4A",
                "antenna_id": self.destino_antenna.id,
                "antenna_nome": self.destino_antenna.nome,
                "evento": "item_nao_encontrado",
            },
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/inconsistencias/?resolvida=false")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["auditoria_id"], "job-42")
        self.assertIn("Auditoria #42", response.data[0]["auditoria_label"])
        self.assertEqual(response.data[0]["auditoria_local_nome"], "Lab 4A")
        self.assertEqual(response.data[0]["auditoria_antenna_id"], self.destino_antenna.id)
        self.assertEqual(response.data[0]["auditoria_criada_em"], "2026-05-16T10:30:00+00:00")

    def test_inconsistencias_endpoint_groups_manual_audit_without_job(self):
        NotificacaoInconsistencia.objects.create(
            item=None,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA,
            tag_id="TAG-AUDIT-MANUAL",
            local_fisico=self.lab4,
            resolvida=False,
            metadados={
                "audit": True,
                "auditoria_execucao_id": "manual-1-20260516103000000000",
                "local_nome": "Lab 4A",
                "antenna_id": self.destino_antenna.id,
                "evento": "tag_desconhecida",
            },
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/inconsistencias/?resolvida=false")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["auditoria_id"], "manual-1-20260516103000000000")
        self.assertIn("Auditoria manual", response.data[0]["auditoria_label"])
        self.assertEqual(response.data[0]["auditoria_local_nome"], "Lab 4A")

    def test_inconsistencias_endpoint_marks_operational_inconsistency_without_audit(self):
        NotificacaoInconsistencia.objects.create(
            item=self.item,
            tipo=NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE,
            tag_id=self.item.tag_id,
            local_logico=self.lab1,
            local_fisico=self.lab4,
            resolvida=False,
            metadados={"evento": "local_divergente"},
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/inconsistencias/?resolvida=false")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data[0]["auditoria_id"])
        self.assertEqual(response.data[0]["auditoria_label"], "Sem auditoria / fluxo operacional")

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
