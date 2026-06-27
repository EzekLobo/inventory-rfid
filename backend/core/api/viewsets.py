from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model, update_session_auth_hash
from django.db.models import Q
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from core.api.pagination import StandardResultsSetPagination
from core.api.permissions import CadastroPermission, LogPermission, is_admin_user, require_user_permission, user_permissions, user_profile
from core.api.serializers import (
    AcionamentoAntenaSerializer,
    AntenaRFIDListSerializer,
    AssociacaoTagDesconhecidaSerializer,
    AuditoriaJobSerializer,
    AuditoriaTimelineSerializer,
    BaixaManualSerializer,
    BroadcastSerializer,
    CadastroTagDesconhecidaSerializer,
    InconsistenciaListSerializer,
    ItemPatrimonialListSerializer,
    LocalSerializer,
    MovimentacaoSerializer,
    ResolucaoInconsistenciaSerializer,
    RFIDEventSerializer,
    TecnicoPermissoesSerializer,
    TimelineListSerializer,
    TrocaSenhaSerializer,
    UsuarioSerializer,
)
from core.domain.models import (
    AntenaRFID,
    AuditoriaJob,
    AuditoriaLeitorStatus,
    ItemPatrimonial,
    Local,
    NotificacaoInconsistencia,
    TecnicoPermissoes,
    TimelineEvento,
)
from core.domain.services import AuditoriaManager, SyncManager
from core.infrastructure.rfid_handler import RFIDEventProcessor


class OperacionalResumoViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(
            {
                "leitores_online": AntenaRFID.objects.filter(online=True).count(),
                "leitores_ativos": AntenaRFID.objects.filter(ativa=True).count(),
                "itens_ativos": ItemPatrimonial.objects.filter(ativo=True).count(),
                "inconsistencias_abertas": NotificacaoInconsistencia.objects.filter(resolvida=False).count(),
            },
            status=status.HTTP_200_OK,
        )


class AuthViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        user = request.user
        return Response(
            {
                "id": user.id,
                "username": user.get_username(),
                "first_name": user.first_name,
                "last_name": user.last_name,
                "email": user.email,
                "is_admin": is_admin_user(user),
                "perfil": user_profile(user),
                "permissions": user_permissions(user),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="trocar-senha")
    def trocar_senha(self, request):
        serializer = TrocaSenhaSerializer(data=request.data or {}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["senha_atual"]):
            return Response({"detail": "Senha atual incorreta."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.set_password(serializer.validated_data["nova_senha"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response({"status": "senha_alterada"}, status=status.HTTP_200_OK)


class UsuarioViewSet(viewsets.ModelViewSet):
    serializer_class = UsuarioSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        return get_user_model().objects.order_by("username")


class TecnicoPermissoesViewSet(viewsets.ViewSet):
    permission_classes = [IsAdminUser]

    def list(self, request):
        return Response(TecnicoPermissoesSerializer(TecnicoPermissoes.atual()).data, status=status.HTTP_200_OK)

    def create(self, request):
        instance = TecnicoPermissoes.atual()
        serializer = TecnicoPermissoesSerializer(instance, data=request.data or {}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(TecnicoPermissoesSerializer(instance).data, status=status.HTTP_200_OK)


class LocalViewSet(viewsets.ModelViewSet):
    serializer_class = LocalSerializer
    permission_classes = [CadastroPermission]
    queryset = Local.objects.order_by("nome")


class AntenaRFIDViewSet(viewsets.ModelViewSet):
    serializer_class = AntenaRFIDListSerializer
    permission_classes = [IsAuthenticated]
    event_processor = RFIDEventProcessor()

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [CadastroPermission()]
        return [IsAuthenticated()]

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
        require_user_permission(request.user, "acionar_leitores")
        return self._acionar(request=request, pk=pk, audit=False)

    @action(detail=True, methods=["post"], url_path="auditar")
    def auditar(self, request, pk=None):
        require_user_permission(request.user, "executar_auditoria")
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
        auditoria_execucao_id = f"manual-{antenna.id}-{now.strftime('%Y%m%d%H%M%S%f')}"
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
                    "auditoria_execucao_id": auditoria_execucao_id,
                    "auditoria_criada_em": now.isoformat(),
                },
            )
        return Response(
            {
                "status": "auditoria_iniciada" if audit else "sincronizacao_iniciada",
                "antenna_id": antenna.id,
                "hardware_id": antenna.hardware_id,
                "active_for_seconds": duracao,
                "expires_at": antenna.ativacao_expira_em,
                "payload": {
                    "audit": True,
                    "auditoria_execucao_id": auditoria_execucao_id,
                    "auditoria_criada_em": now.isoformat(),
                } if audit else {},
            },
            status=status.HTTP_200_OK,
        )


class ItemPatrimonialViewSet(viewsets.ModelViewSet):
    serializer_class = ItemPatrimonialListSerializer
    permission_classes = [CadastroPermission]
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
        require_user_permission(request.user, "gerenciar_cadastros")
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
            return {
                "audit": True,
                "auditoria_execucao_id": timeline.metadados.get("auditoria_execucao_id"),
                "auditoria_criada_em": timeline.metadados.get("auditoria_criada_em"),
            }

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
    permission_classes = [LogPermission]

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
        require_user_permission(request.user, "resolver_inconsistencias")
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
        require_user_permission(request.user, "resolver_inconsistencias")
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
        require_user_permission(request.user, "resolver_inconsistencias")
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
        require_user_permission(request.user, "resolver_inconsistencias")
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

    def _paginated_response(self, request, queryset, serializer_class):
        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request)
        serializer = serializer_class(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    def get_permissions(self):
        return [IsAuthenticated()]

    def list(self, request):
        self.auditoria_manager.finalize_expired_jobs()
        jobs = AuditoriaJob.objects.select_related("solicitado_por").prefetch_related(
            "leitores__antena__local",
        ).order_by("-iniciado_em")
        return self._paginated_response(request, jobs, AuditoriaJobSerializer)

    @action(detail=False, methods=["get"], url_path="processadas")
    def processadas(self, request):
        eventos = TimelineEvento.objects.filter(
            Q(metadados__evento="auditoria_processada") | Q(metadados__evento="auditoria_iniciada"),
            tipo=TimelineEvento.TipoEvento.SISTEMA,
        ).order_by("-criado_em")
        return self._paginated_response(request, eventos, AuditoriaTimelineSerializer)

    @action(detail=False, methods=["post"], url_path="broadcast")
    def broadcast(self, request):
        require_user_permission(request.user, "executar_auditoria")
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
