from core.tests.base import *  # noqa: F403


class PipelineApiTests(PipelineAndApiTestBase):
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
