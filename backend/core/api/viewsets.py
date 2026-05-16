from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from core.domain.models import (
    AntenaRFID,
    AuditoriaJob,
    AuditoriaLeitorStatus,
    ItemPatrimonial,
    Local,
    NotificacaoInconsistencia,
    TimelineEvento,
)
from core.domain.services import AuditoriaManager, SyncManager
from core.middleware.rfid_handler import RFIDEventProcessor


class MovimentacaoSerializer(serializers.Serializer):
    tag_id = serializers.CharField(max_length=64)
    local_id = serializers.IntegerField(required=False, min_value=1)
    antenna_id = serializers.IntegerField(required=False, allow_null=True)
    payload = serializers.JSONField(required=False)

    def validate(self, attrs):
        if not attrs.get("antenna_id") and not attrs.get("local_id"):
            raise serializers.ValidationError("Informe antenna_id ou local_id.")
        return attrs


class BroadcastSerializer(serializers.Serializer):
    duracao_segundos = serializers.IntegerField(required=False, min_value=1, default=5)
    antenna_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )


class BaixaManualSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=255, default="baixa patrimonial")


class ResolucaoInconsistenciaSerializer(serializers.Serializer):
    motivo = serializers.CharField(max_length=255, default="resolucao manual")


class CadastroTagDesconhecidaSerializer(serializers.Serializer):
    nome = serializers.CharField(max_length=160)
    local_logico_id = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    local_fisico_id = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    motivo = serializers.CharField(max_length=255, default="tag cadastrada a partir de inconsistencia")


class AssociacaoTagDesconhecidaSerializer(serializers.Serializer):
    item_id = serializers.IntegerField(min_value=1)
    motivo = serializers.CharField(max_length=255, default="tag associada a item existente")


class AcionamentoAntenaSerializer(serializers.Serializer):
    duracao_segundos = serializers.IntegerField(required=False, min_value=1, default=5)


class RFIDEventSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=["ping", "motion_detected", "tags_read"])
    antenna_id = serializers.IntegerField(min_value=1)
    tags = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
        allow_empty=True,
    )
    payload = serializers.JSONField(required=False)

    def validate(self, attrs):
        payload = attrs.get("payload") or {}
        is_audit = bool(payload.get("audit") or payload.get("auditoria_job_id"))
        if attrs["event_type"] == "tags_read" and not attrs.get("tags") and not is_audit:
            raise serializers.ValidationError("tags sao obrigatorias para tags_read.")
        return attrs


class TimelineListSerializer(serializers.ModelSerializer):
    item_nome = serializers.CharField(source="item.nome", read_only=True)
    item_tag = serializers.CharField(source="item.tag_id", read_only=True)
    usuario_nome = serializers.CharField(source="usuario.get_username", read_only=True)

    class Meta:
        model = TimelineEvento
        fields = [
            "id",
            "item_id",
            "item_nome",
            "item_tag",
            "tipo",
            "mensagem",
            "metadados",
            "criado_em",
            "usuario_id",
            "usuario_nome",
        ]


class LocalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Local
        fields = ["id", "nome", "codigo"]


class InconsistenciaListSerializer(serializers.ModelSerializer):
    item_nome = serializers.CharField(source="item.nome", read_only=True)
    local_logico_nome = serializers.CharField(source="local_logico.nome", read_only=True)
    local_fisico_nome = serializers.CharField(source="local_fisico.nome", read_only=True)
    auditoria_id = serializers.SerializerMethodField()
    auditoria_label = serializers.SerializerMethodField()
    auditoria_local_nome = serializers.SerializerMethodField()
    auditoria_antenna_id = serializers.SerializerMethodField()
    auditoria_criada_em = serializers.SerializerMethodField()

    class Meta:
        model = NotificacaoInconsistencia
        fields = [
            "id",
            "item_id",
            "item_nome",
            "tipo",
            "tag_id",
            "local_logico_id",
            "local_logico_nome",
            "local_fisico_id",
            "local_fisico_nome",
            "resolvida",
            "metadados",
            "auditoria_id",
            "auditoria_label",
            "auditoria_local_nome",
            "auditoria_antenna_id",
            "auditoria_criada_em",
            "criado_em",
            "resolvida_em",
        ]

    def _audit_metadata(self, obj):
        metadados = obj.metadados or {}
        auditoria_job_id = metadados.get("auditoria_job_id")
        auditoria_execucao_id = metadados.get("auditoria_execucao_id")
        audit_eventos = {"item_nao_encontrado", "item_fora_do_local_auditado", "tag_desconhecida"}
        is_audit = bool(metadados.get("audit") or auditoria_job_id or auditoria_execucao_id or metadados.get("evento") in audit_eventos)
        if not is_audit:
            return None

        if auditoria_job_id:
            auditoria_id = f"job-{auditoria_job_id}"
            label = f"Auditoria #{auditoria_job_id}"
        elif auditoria_execucao_id:
            auditoria_id = str(auditoria_execucao_id)
            label = "Auditoria manual"
        else:
            antenna_id = metadados.get("antenna_id") or "sem-antena"
            created_key = obj.criado_em.strftime("%Y%m%d%H%M") if obj.criado_em else "sem-data"
            auditoria_id = f"manual-{antenna_id}-{created_key}"
            label = "Auditoria manual"

        local_nome = (
            metadados.get("local_nome")
            or (obj.local_fisico.nome if obj.local_fisico else None)
            or (obj.local_logico.nome if obj.local_logico else None)
        )
        antenna_nome = metadados.get("antenna_nome")
        if local_nome:
            label = f"{label} - {local_nome}"
        if antenna_nome:
            label = f"{label} / {antenna_nome}"

        return {
            "id": auditoria_id,
            "label": label,
            "local_nome": local_nome,
            "antenna_id": metadados.get("antenna_id"),
            "criada_em": metadados.get("auditoria_criada_em") or obj.criado_em.isoformat(),
        }

    def get_auditoria_id(self, obj):
        audit = self._audit_metadata(obj)
        return audit["id"] if audit else None

    def get_auditoria_label(self, obj):
        audit = self._audit_metadata(obj)
        return audit["label"] if audit else "Sem auditoria / fluxo operacional"

    def get_auditoria_local_nome(self, obj):
        audit = self._audit_metadata(obj)
        return audit["local_nome"] if audit else None

    def get_auditoria_antenna_id(self, obj):
        audit = self._audit_metadata(obj)
        return audit["antenna_id"] if audit else None

    def get_auditoria_criada_em(self, obj):
        audit = self._audit_metadata(obj)
        return audit["criada_em"] if audit else obj.criado_em.isoformat()


class AntenaRFIDListSerializer(serializers.ModelSerializer):
    local_id = serializers.PrimaryKeyRelatedField(source="local", queryset=Local.objects.all())
    local_nome = serializers.CharField(source="local.nome", read_only=True)
    local_codigo = serializers.CharField(source="local.codigo", read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    modo_comando_display = serializers.CharField(source="get_modo_comando_display", read_only=True)
    command_token = serializers.CharField(required=False, allow_blank=True, write_only=True)
    command_token_configurado = serializers.SerializerMethodField()

    class Meta:
        model = AntenaRFID
        fields = [
            "id",
            "nome",
            "hardware_id",
            "local_id",
            "local_nome",
            "local_codigo",
            "tipo",
            "tipo_display",
            "modo_comando",
            "modo_comando_display",
            "command_url",
            "command_token",
            "command_token_configurado",
            "duracao_padrao_segundos",
            "ativa",
            "ativacao_expira_em",
            "ultimo_acionamento",
            "ultimo_ping",
            "online",
        ]

    def get_command_token_configurado(self, obj):
        return bool(obj.command_token)

    def validate(self, attrs):
        modo_comando = attrs.get("modo_comando", getattr(self.instance, "modo_comando", AntenaRFID.ModoComando.POLLING))
        command_url = attrs.get("command_url", getattr(self.instance, "command_url", ""))
        if modo_comando == AntenaRFID.ModoComando.HTTP and not command_url:
            raise serializers.ValidationError({"command_url": "Informe a URL de comando para antenas em modo HTTP."})
        return attrs

    def update(self, instance, validated_data):
        command_token = validated_data.pop("command_token", None)
        instance = super().update(instance, validated_data)
        if command_token:
            instance.command_token = command_token
            instance.save(update_fields=["command_token"])
        return instance


class AuditoriaLeitorStatusSerializer(serializers.ModelSerializer):
    antena_nome = serializers.CharField(source="antena.nome", read_only=True)
    hardware_id = serializers.CharField(source="antena.hardware_id", read_only=True)
    local_nome = serializers.CharField(source="antena.local.nome", read_only=True)

    class Meta:
        model = AuditoriaLeitorStatus
        fields = ["id", "antena_id", "antena_nome", "hardware_id", "local_nome", "status", "atualizado_em"]


class AuditoriaJobSerializer(serializers.ModelSerializer):
    leitores = AuditoriaLeitorStatusSerializer(many=True, read_only=True)
    solicitado_por_nome = serializers.CharField(source="solicitado_por.get_username", read_only=True)

    class Meta:
        model = AuditoriaJob
        fields = [
            "id",
            "status",
            "duracao_segundos",
            "iniciado_em",
            "finaliza_em",
            "concluido_em",
            "solicitado_por_id",
            "solicitado_por_nome",
            "leitores",
        ]


class AuditoriaTimelineSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimelineEvento
        fields = ["id", "mensagem", "metadados", "criado_em"]


class ItemPatrimonialListSerializer(serializers.ModelSerializer):
    local_logico_id = serializers.PrimaryKeyRelatedField(
        source="local_logico",
        queryset=Local.objects.all(),
        allow_null=True,
        required=False,
    )
    local_fisico_id = serializers.PrimaryKeyRelatedField(
        source="local_fisico",
        queryset=Local.objects.all(),
        allow_null=True,
        required=False,
    )
    local_logico_nome = serializers.CharField(source="local_logico.nome", read_only=True)
    local_fisico_nome = serializers.CharField(source="local_fisico.nome", read_only=True)
    responsavel_nome = serializers.CharField(source="responsavel.get_username", read_only=True)

    class Meta:
        model = ItemPatrimonial
        fields = [
            "id",
            "tag_id",
            "nome",
            "local_logico_id",
            "local_logico_nome",
            "local_fisico_id",
            "local_fisico_nome",
            "responsavel_id",
            "responsavel_nome",
            "ativo",
            "atualizado_em",
        ]


class LocalViewSet(viewsets.ModelViewSet):
    serializer_class = LocalSerializer
    permission_classes = [IsAuthenticated]
    queryset = Local.objects.order_by("nome")


class AntenaRFIDViewSet(viewsets.ModelViewSet):
    serializer_class = AntenaRFIDListSerializer
    permission_classes = [IsAuthenticated]
    event_processor = RFIDEventProcessor()

    def get_queryset(self):
        self.event_processor.deactivate_expired_antennas()
        self.event_processor.mark_stale_antennas_offline()
        queryset = AntenaRFID.objects.select_related("local").order_by("id")
        tipo = self.request.query_params.get("tipo")
        if tipo:
            queryset = queryset.filter(tipo=tipo)
        online = self.request.query_params.get("online")
        if online in {"true", "True", "1"}:
            queryset = queryset.filter(online=True)
        elif online in {"false", "False", "0"}:
            queryset = queryset.filter(online=False)
        return queryset

    @action(detail=True, methods=["post"], url_path="ativar")
    def ativar(self, request, pk=None):
        return self._acionar(request=request, pk=pk, audit=False)

    @action(detail=True, methods=["post"], url_path="auditar")
    def auditar(self, request, pk=None):
        return self._acionar(request=request, pk=pk, audit=True)

    def _acionar(self, *, request, pk=None, audit: bool):
        serializer = AcionamentoAntenaSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        antenna = self.get_queryset().filter(id=pk).first()
        if antenna is None:
            return Response(
                {"status": "erro", "detail": "Antena nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        duracao = serializer.validated_data["duracao_segundos"]
        self.event_processor.mark_stale_antennas_offline()
        antenna.refresh_from_db(fields=["online", "ativa", "ultimo_ping"])
        if not antenna.online:
            return Response(
                {
                    "status": "offline",
                    "detail": "Leitor offline. Aguarde o proximo ping do hardware antes de acionar.",
                },
                status=status.HTTP_409_CONFLICT,
            )

        now = timezone.now()
        antenna.ativa = True
        antenna.ultimo_acionamento = now
        antenna.ativacao_expira_em = now + timedelta(seconds=duracao)
        antenna.save(update_fields=["ativa", "ultimo_acionamento", "ativacao_expira_em"])
        if audit:
            TimelineEvento.objects.create(
                item=None,
                tipo=TimelineEvento.TipoEvento.SISTEMA,
                mensagem=f"Auditoria iniciada em {antenna.local.nome} pela antena {antenna.nome}.",
                usuario=request.user,
                metadados={
                    "evento": "auditoria_iniciada",
                    "antenna_id": antenna.id,
                    "antenna_nome": antenna.nome,
                    "local_id": antenna.local_id,
                    "local_nome": antenna.local.nome,
                    "duracao_segundos": duracao,
                    "finaliza_em": antenna.ativacao_expira_em.isoformat(),
                },
            )
        return Response(
            {
                "status": "auditoria_iniciada" if audit else "sincronizacao_iniciada",
                "antenna_id": antenna.id,
                "hardware_id": antenna.hardware_id,
                "active_for_seconds": duracao,
                "expires_at": antenna.ativacao_expira_em,
                "payload": {"audit": True} if audit else {},
            },
            status=status.HTTP_200_OK,
        )


class ItemPatrimonialViewSet(viewsets.ModelViewSet):
    serializer_class = ItemPatrimonialListSerializer
    permission_classes = [IsAuthenticated]
    sync_manager = SyncManager()

    def get_queryset(self):
        queryset = ItemPatrimonial.objects.select_related(
            "local_logico",
            "local_fisico",
            "responsavel",
        ).order_by("nome")
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(nome__icontains=search) | queryset.filter(tag_id__icontains=search)
        ativo = self.request.query_params.get("ativo")
        if ativo in {"true", "True", "1"}:
            queryset = queryset.filter(ativo=True)
        elif ativo in {"false", "False", "0"}:
            queryset = queryset.filter(ativo=False)
        return queryset

    @action(detail=True, methods=["post"], url_path="inativar")
    def inativar(self, request, pk=None):
        serializer = BaixaManualSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        item = ItemPatrimonial.objects.filter(id=pk).first()
        if item is None:
            return Response(
                {"status": "erro", "detail": "Item patrimonial nao encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        item = self.sync_manager.deactivate_item_manually(
            item_id=item.id,
            motivo=serializer.validated_data["motivo"],
            usuario=request.user,
        )
        return Response(
            {
                "status": "inativado",
                "item_id": item.id,
                "tag_id": item.tag_id,
                "ativo": item.ativo,
                "motivo": serializer.validated_data["motivo"],
            },
            status=status.HTTP_200_OK,
        )


class MovimentacaoViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]
    event_processor = RFIDEventProcessor()

    def create(self, request):
        payload = dict(request.data)
        if "TagID" in payload and "tag_id" not in payload:
            payload["tag_id"] = payload["TagID"]
        if "LocalID" in payload and "local_id" not in payload:
            payload["local_id"] = payload["LocalID"]
        if "AntennaID" in payload and "antenna_id" not in payload:
            payload["antenna_id"] = payload["AntennaID"]

        serializer = MovimentacaoSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if not ItemPatrimonial.objects.filter(tag_id=data["tag_id"]).exists():
            return Response(
                {"status": "erro", "detail": "Tag RFID nao cadastrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        antenna = self._resolve_antenna(data=data)
        if antenna is None:
            return Response(
                {"status": "erro", "detail": "Nao foi possivel identificar uma antena para a movimentacao."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.event_processor.deactivate_expired_antennas()
        # Alias para fluxo de evento físico: tags_read
        if not antenna.ativa:
            antenna.ativa = True
            antenna.ultimo_acionamento = timezone.now()
            antenna.ativacao_expira_em = timezone.now() + timedelta(seconds=5)
            antenna.save(update_fields=["ativa", "ultimo_acionamento", "ativacao_expira_em"])
        result = self.event_processor.process_tags_read(
            antenna=antenna,
            tags=[data["tag_id"]],
            payload=data.get("payload"),
        )
        return Response(result, status=status.HTTP_201_CREATED)

    def _resolve_antenna(self, *, data: dict):
        antenna_id = data.get("antenna_id")
        if antenna_id:
            return AntenaRFID.objects.filter(id=antenna_id).first()
        local_id = data.get("local_id")
        if local_id:
            return (
                AntenaRFID.objects.filter(local_id=local_id, tipo=AntenaRFID.TipoAntena.DESTINO)
                .order_by("id")
                .first()
            )
        return None


class RFIDEventosViewSet(viewsets.ViewSet):
    permission_classes = [AllowAny]
    event_processor = RFIDEventProcessor()

    def _validate_ingest_token(self, request):
        expected_token = getattr(settings, "RFID_INGEST_TOKEN", "")
        provided_token = request.headers.get("X-RFID-Token", "")
        return expected_token and provided_token == expected_token

    def _active_command_payload(self, *, antenna: AntenaRFID, active: bool) -> dict:
        if not active or not antenna.ativacao_expira_em:
            return {}

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
            return {"audit": True, "auditoria_job_id": broadcast_reader.job_id}

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
            return {"audit": True}

        return {}

    def create(self, request):
        if not self._validate_ingest_token(request):
            return Response(
                {"status": "erro", "detail": "Token de ingestao invalido."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = RFIDEventSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        antenna = AntenaRFID.objects.filter(id=data["antenna_id"]).first()
        if antenna is None:
            return Response(
                {"status": "erro", "detail": "Antena nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        event_type = data["event_type"]
        if event_type == "ping":
            result = self.event_processor.process_ping(antenna=antenna)
        elif event_type == "motion_detected":
            result = self.event_processor.process_motion_detected(antenna=antenna)
        else:
            result = self.event_processor.process_tags_read(
                antenna=antenna,
                tags=data.get("tags", []),
                payload=data.get("payload"),
            )
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="comando")
    def comando(self, request):
        if not self._validate_ingest_token(request):
            return Response(
                {"status": "erro", "detail": "Token de ingestao invalido."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        antenna_id = request.query_params.get("antenna_id")
        if not antenna_id:
            return Response(
                {"status": "erro", "detail": "Informe antenna_id."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        antenna = AntenaRFID.objects.filter(id=antenna_id).first()
        if antenna is None:
            return Response(
                {"status": "erro", "detail": "Antena nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        self.event_processor.process_ping(antenna=antenna)
        self.event_processor.deactivate_expired_antennas()
        antenna.refresh_from_db(fields=["ativa", "ativacao_expira_em", "hardware_id"])
        now = timezone.now()
        active = bool(
            antenna.ativa
            and antenna.ativacao_expira_em
            and antenna.ativacao_expira_em > now
        )
        active_for_seconds = 0
        if active:
            active_for_seconds = max(0, int((antenna.ativacao_expira_em - now).total_seconds()))

        return Response(
            {
                "status": "ok",
                "antenna_id": antenna.id,
                "hardware_id": antenna.hardware_id,
                "command": "start_reading" if active else "idle",
                "active": active,
                "active_for_seconds": active_for_seconds,
                "expires_at": antenna.ativacao_expira_em if active else None,
                "payload": self._active_command_payload(antenna=antenna, active=active),
            },
            status=status.HTTP_200_OK,
        )


class TimelineViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TimelineListSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = TimelineEvento.objects.select_related("item", "usuario").order_by("-criado_em")
        item_id = self.request.query_params.get("item_id")
        if item_id:
            queryset = queryset.filter(item_id=item_id)
        tipo = self.request.query_params.get("tipo")
        if tipo:
            queryset = queryset.filter(tipo=tipo)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(mensagem__icontains=search)
                | Q(item__nome__icontains=search)
                | Q(item__tag_id__icontains=search)
                | Q(metadados__tag_id__icontains=search)
            )
        data_inicio = parse_date(self.request.query_params.get("data_inicio", ""))
        if data_inicio:
            queryset = queryset.filter(criado_em__date__gte=data_inicio)
        data_fim = parse_date(self.request.query_params.get("data_fim", ""))
        if data_fim:
            queryset = queryset.filter(criado_em__date__lte=data_fim)
        usuario_id = self.request.query_params.get("usuario_id")
        if usuario_id and usuario_id.isdigit():
            queryset = queryset.filter(usuario_id=usuario_id)
        local_id = self.request.query_params.get("local_id")
        if local_id and local_id.isdigit():
            queryset = queryset.filter(Q(metadados__local_id=int(local_id)) | Q(metadados__local_id=str(local_id)))
        antenna_id = self.request.query_params.get("antenna_id")
        if antenna_id and antenna_id.isdigit():
            queryset = queryset.filter(
                Q(metadados__antenna_id=int(antenna_id)) | Q(metadados__antenna_id=str(antenna_id))
            )
        only_mine = self.request.query_params.get("me")
        if only_mine in {"1", "true", "True"}:
            queryset = queryset.filter(usuario=self.request.user)
        return queryset


class InconsistenciaViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = InconsistenciaListSerializer
    permission_classes = [IsAuthenticated]
    sync_manager = SyncManager()

    def get_queryset(self):
        queryset = NotificacaoInconsistencia.objects.select_related(
            "item",
            "local_logico",
            "local_fisico",
        ).order_by("-criado_em")
        item_id = self.request.query_params.get("item_id")
        if item_id:
            queryset = queryset.filter(item_id=item_id)
        resolvida = self.request.query_params.get("resolvida")
        if resolvida in {"true", "True", "1"}:
            queryset = queryset.filter(resolvida=True)
        elif resolvida in {"false", "False", "0"}:
            queryset = queryset.filter(resolvida=False)
        tipo = self.request.query_params.get("tipo")
        if tipo:
            queryset = queryset.filter(tipo=tipo)
        return queryset

    @action(detail=True, methods=["post"], url_path="resolver")
    def resolver(self, request, pk=None):
        serializer = ResolucaoInconsistenciaSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        inconsistencia = self.get_queryset().filter(id=pk).first()
        if inconsistencia is None:
            return Response(
                {"status": "erro", "detail": "Inconsistencia nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        inconsistencia = self.sync_manager.resolve_inconsistency_manually(
            inconsistencia_id=inconsistencia.id,
            usuario=request.user,
            motivo=serializer.validated_data["motivo"],
        )
        return Response(
            {
                "status": "resolvida",
                "inconsistencia": InconsistenciaListSerializer(inconsistencia).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="confirmar-local")
    def confirmar_local(self, request, pk=None):
        serializer = ResolucaoInconsistenciaSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        inconsistencia = self.get_queryset().filter(id=pk).first()
        if inconsistencia is None:
            return Response(
                {"status": "erro", "detail": "Inconsistencia nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            inconsistencia = self.sync_manager.confirm_logical_location_from_inconsistency(
                inconsistencia_id=inconsistencia.id,
                usuario=request.user,
                motivo=serializer.validated_data["motivo"],
            )
        except ValueError as exc:
            return Response({"status": "erro", "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "status": "local_logico_atualizado",
                "inconsistencia": InconsistenciaListSerializer(inconsistencia).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="cadastrar-tag")
    def cadastrar_tag(self, request, pk=None):
        serializer = CadastroTagDesconhecidaSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        inconsistencia = self.get_queryset().filter(id=pk).first()
        if inconsistencia is None:
            return Response(
                {"status": "erro", "detail": "Inconsistencia nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = serializer.validated_data
        if inconsistencia.tag_id and ItemPatrimonial.objects.filter(tag_id=inconsistencia.tag_id).exists():
            return Response(
                {"status": "erro", "detail": "Ja existe item cadastrado com esta tag."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            inconsistencia, item = self.sync_manager.register_unknown_tag_as_item(
                inconsistencia_id=inconsistencia.id,
                nome=data["nome"],
                local_logico_id=data.get("local_logico_id"),
                local_fisico_id=data.get("local_fisico_id"),
                responsavel=request.user,
                usuario=request.user,
                motivo=data["motivo"],
            )
        except ValueError as exc:
            return Response({"status": "erro", "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "status": "tag_cadastrada",
                "item": ItemPatrimonialListSerializer(item).data,
                "inconsistencia": InconsistenciaListSerializer(inconsistencia).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="associar-tag")
    def associar_tag(self, request, pk=None):
        serializer = AssociacaoTagDesconhecidaSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        inconsistencia = self.get_queryset().filter(id=pk).first()
        if inconsistencia is None:
            return Response(
                {"status": "erro", "detail": "Inconsistencia nao encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if inconsistencia.tag_id and ItemPatrimonial.objects.filter(tag_id=inconsistencia.tag_id).exists():
            return Response(
                {"status": "erro", "detail": "Ja existe item cadastrado com esta tag."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = serializer.validated_data
        try:
            inconsistencia, item = self.sync_manager.associate_unknown_tag_to_item(
                inconsistencia_id=inconsistencia.id,
                item_id=data["item_id"],
                usuario=request.user,
                motivo=data["motivo"],
            )
        except ItemPatrimonial.DoesNotExist:
            return Response(
                {"status": "erro", "detail": "Item patrimonial nao encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ValueError as exc:
            return Response({"status": "erro", "detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "status": "tag_associada",
                "item": ItemPatrimonialListSerializer(item).data,
                "inconsistencia": InconsistenciaListSerializer(inconsistencia).data,
            },
            status=status.HTTP_200_OK,
        )


class AuditoriaViewSet(viewsets.ViewSet):
    auditoria_manager = AuditoriaManager()

    def get_permissions(self):
        if self.action == "broadcast":
            return [IsAdminUser()]
        return [IsAuthenticated()]

    def list(self, request):
        self.auditoria_manager.finalize_expired_jobs()
        jobs = AuditoriaJob.objects.select_related("solicitado_por").prefetch_related(
            "leitores__antena__local",
        ).order_by("-iniciado_em")[:100]
        return Response(AuditoriaJobSerializer(jobs, many=True).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="processadas")
    def processadas(self, request):
        eventos = TimelineEvento.objects.filter(
            Q(metadados__evento="auditoria_processada") | Q(metadados__evento="auditoria_iniciada"),
            tipo=TimelineEvento.TipoEvento.SISTEMA,
        ).order_by("-criado_em")[:100]
        return Response(AuditoriaTimelineSerializer(eventos, many=True).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="broadcast")
    def broadcast(self, request):
        serializer = BroadcastSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        duracao_segundos = serializer.validated_data["duracao_segundos"]
        antenna_ids = serializer.validated_data.get("antenna_ids")
        if antenna_ids:
            found_ids = set(AntenaRFID.objects.filter(id__in=antenna_ids).values_list("id", flat=True))
            missing_ids = sorted(set(antenna_ids) - found_ids)
            if missing_ids:
                return Response(
                    {"status": "erro", "detail": f"Leitor(es) nao encontrado(s): {missing_ids}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        self.auditoria_manager.finalize_expired_jobs()
        job = self.auditoria_manager.start_broadcast(
            duracao_segundos=duracao_segundos,
            requested_by=request.user,
            antenna_ids=antenna_ids,
        )
        leitores = list(
            job.leitores.select_related("antena").values(
                "antena_id",
                "antena__hardware_id",
                "antena__nome",
                "status",
            )
        )
        return Response(
            {
                "status": "broadcast_iniciado",
                "auditoria_job_id": job.id,
                "duracao_segundos": duracao_segundos,
                "iniciado_em": job.iniciado_em,
                "finaliza_em": job.finaliza_em,
                "total_antenas": len(leitores),
                "leitores": leitores,
            },
            status=status.HTTP_200_OK,
        )
