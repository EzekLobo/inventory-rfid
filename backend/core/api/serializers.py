from django.contrib.auth import get_user_model, password_validation
from rest_framework import serializers

from core.api.permissions import is_admin_user, user_profile
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


class TrocaSenhaSerializer(serializers.Serializer):
    senha_atual = serializers.CharField(write_only=True)
    nova_senha = serializers.CharField(write_only=True)

    def validate_nova_senha(self, value):
        password_validation.validate_password(value, self.context["request"].user)
        return value


class TecnicoPermissoesSerializer(serializers.ModelSerializer):
    gerenciar_usuarios = serializers.SerializerMethodField()

    class Meta:
        model = TecnicoPermissoes
        fields = [
            "gerenciar_cadastros",
            "acionar_leitores",
            "executar_auditoria",
            "resolver_inconsistencias",
            "ver_logs",
            "gerenciar_usuarios",
        ]
        read_only_fields = ["gerenciar_usuarios"]

    def get_gerenciar_usuarios(self, obj):
        return False


class UsuarioSerializer(serializers.ModelSerializer):
    perfil = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    password = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "first_name", "last_name", "email", "is_active", "is_staff", "is_admin", "perfil", "password"]
        read_only_fields = ["id", "is_admin", "perfil"]

    def get_is_admin(self, obj):
        return is_admin_user(obj)

    def get_perfil(self, obj):
        return user_profile(obj)

    def create(self, validated_data):
        password = validated_data.pop("password", "")
        user = get_user_model()(**validated_data)
        user.set_password(password or get_user_model().objects.make_random_password())
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", "")
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


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
