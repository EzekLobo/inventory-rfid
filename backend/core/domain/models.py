from django.conf import settings
from django.db import models


class Local(models.Model):
    nome = models.CharField(max_length=120)
    codigo = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return f"{self.codigo} - {self.nome}"


class AntenaRFID(models.Model):
    class TipoAntena(models.IntegerChoices):
        DESTINO = 1, "Destino"
        FLUXO = 2, "Fluxo"

    class ModoComando(models.TextChoices):
        POLLING = "polling", "Polling"
        HTTP = "http", "HTTP direto"

    nome = models.CharField(max_length=120)
    hardware_id = models.CharField(max_length=100, unique=True)
    local = models.ForeignKey(Local, on_delete=models.PROTECT, related_name="antenas")
    tipo = models.IntegerField(choices=TipoAntena.choices)
    modo_comando = models.CharField(max_length=20, choices=ModoComando.choices, default=ModoComando.POLLING)
    command_url = models.URLField(max_length=500, blank=True)
    command_token = models.CharField(max_length=255, blank=True)
    duracao_padrao_segundos = models.PositiveIntegerField(default=5)
    ativa = models.BooleanField(default=False)
    ultimo_acionamento = models.DateTimeField(null=True, blank=True)
    ativacao_expira_em = models.DateTimeField(null=True, blank=True)
    ultimo_ping = models.DateTimeField(null=True, blank=True)
    online = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["online", "ativa"], name="antenna_online_active_idx"),
        ]

    def __str__(self):
        return f"{self.nome} ({self.hardware_id})"


class ItemPatrimonial(models.Model):
    tag_id = models.CharField(max_length=64, unique=True)
    nome = models.CharField(max_length=160)
    local_logico = models.ForeignKey(
        Local,
        on_delete=models.PROTECT,
        related_name="itens_logicos",
        null=True,
        blank=True,
    )
    local_fisico = models.ForeignKey(
        Local,
        on_delete=models.PROTECT,
        related_name="itens_fisicos",
        null=True,
        blank=True,
    )
    responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="itens_responsavel",
    )
    ativo = models.BooleanField(default=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.nome} ({self.tag_id})"


class LeituraRFID(models.Model):
    class ClassificacaoLeitura(models.TextChoices):
        DESTINO = "destino", "Destino"
        FLUXO = "fluxo", "Fluxo"

    item = models.ForeignKey(
        ItemPatrimonial,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leituras",
    )
    tag_id = models.CharField(max_length=64)
    local = models.ForeignKey(
        Local,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leituras",
    )
    antena = models.ForeignKey(
        AntenaRFID,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="leituras",
    )
    classificacao = models.CharField(max_length=20, choices=ClassificacaoLeitura.choices)
    payload = models.JSONField(default=dict, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["tag_id", "criado_em"], name="reading_tag_created_idx"),
            models.Index(fields=["classificacao", "criado_em"], name="reading_class_created_idx"),
        ]


class TimelineEvento(models.Model):
    class TipoEvento(models.TextChoices):
        MOVIMENTACAO = "movimentacao", "Movimentacao"
        INCONSISTENCIA = "inconsistencia", "Inconsistencia"
        RASTRO = "rastro", "Rastro"
        BAIXA = "baixa", "Baixa patrimonial"
        SISTEMA = "sistema", "Sistema"

    item = models.ForeignKey(
        ItemPatrimonial,
        on_delete=models.CASCADE,
        related_name="timeline",
        null=True,
        blank=True,
    )
    tipo = models.CharField(max_length=20, choices=TipoEvento.choices)
    mensagem = models.TextField()
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    metadados = models.JSONField(default=dict, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["criado_em", "tipo"], name="timeline_created_type_idx"),
        ]


class NotificacaoInconsistencia(models.Model):
    class TipoInconsistencia(models.TextChoices):
        LOCAL_DIVERGENTE = "local_divergente", "Local divergente"
        NAO_ENCONTRADO = "nao_encontrado", "Nao encontrado"
        TAG_DESCONHECIDA = "tag_desconhecida", "Tag desconhecida"

    item = models.ForeignKey(
        ItemPatrimonial,
        on_delete=models.CASCADE,
        related_name="inconsistencias",
        null=True,
        blank=True,
    )
    tipo = models.CharField(
        max_length=30,
        choices=TipoInconsistencia.choices,
        default=TipoInconsistencia.LOCAL_DIVERGENTE,
    )
    tag_id = models.CharField(max_length=64, null=True, blank=True)
    local_logico = models.ForeignKey(
        Local,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="inconsistencias_logicas",
    )
    local_fisico = models.ForeignKey(
        Local,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="inconsistencias_fisicas",
    )
    resolvida = models.BooleanField(default=False)
    resolvida_em = models.DateTimeField(null=True, blank=True)
    metadados = models.JSONField(default=dict, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["resolvida", "tipo"], name="incons_open_type_idx"),
            models.Index(fields=["tag_id", "resolvida"], name="incons_tag_open_idx"),
        ]


class AuditoriaJob(models.Model):
    class Status(models.TextChoices):
        INICIADO = "iniciado", "Iniciado"
        CONCLUIDO = "concluido", "Concluido"

    solicitado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    duracao_segundos = models.PositiveIntegerField(default=5)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.INICIADO)
    iniciado_em = models.DateTimeField(auto_now_add=True)
    finaliza_em = models.DateTimeField()
    concluido_em = models.DateTimeField(null=True, blank=True)


class AuditoriaLeitorStatus(models.Model):
    class Status(models.TextChoices):
        ENERGIZADO = "energizado", "Energizado"
        ENCERRADO = "encerrado", "Encerrado"

    job = models.ForeignKey(AuditoriaJob, on_delete=models.CASCADE, related_name="leitores")
    antena = models.ForeignKey(AntenaRFID, on_delete=models.CASCADE, related_name="auditorias")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ENERGIZADO)
    atualizado_em = models.DateTimeField(auto_now=True)


class TecnicoPermissoes(models.Model):
    gerenciar_cadastros = models.BooleanField(default=False)
    acionar_leitores = models.BooleanField(default=True)
    executar_auditoria = models.BooleanField(default=True)
    resolver_inconsistencias = models.BooleanField(default=True)
    ver_logs = models.BooleanField(default=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Permissoes do tecnico"
        verbose_name_plural = "Permissoes do tecnico"

    @classmethod
    def atual(cls):
        instance, _ = cls.objects.get_or_create(id=1)
        return instance
