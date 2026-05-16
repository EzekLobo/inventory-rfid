from django.contrib import admin

from core.domain.models import (
    AntenaRFID,
    AuditoriaJob,
    AuditoriaLeitorStatus,
    ItemPatrimonial,
    LeituraRFID,
    Local,
    NotificacaoInconsistencia,
    TimelineEvento,
)


@admin.register(Local)
class LocalAdmin(admin.ModelAdmin):
    list_display = ("id", "codigo", "nome")
    search_fields = ("codigo", "nome")


@admin.register(AntenaRFID)
class AntenaRFIDAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "nome",
        "hardware_id",
        "local",
        "tipo",
        "modo_comando",
        "ativa",
        "online",
        "ultimo_ping",
        "ultimo_acionamento",
    )
    list_filter = ("tipo", "modo_comando", "ativa", "online", "local")
    search_fields = ("nome", "hardware_id", "local__nome", "local__codigo")


@admin.register(ItemPatrimonial)
class ItemPatrimonialAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "tag_id",
        "nome",
        "local_logico",
        "local_fisico",
        "responsavel",
        "ativo",
        "atualizado_em",
    )
    list_filter = ("ativo", "local_logico", "local_fisico")
    search_fields = ("tag_id", "nome", "responsavel__username", "responsavel__email")


@admin.register(LeituraRFID)
class LeituraRFIDAdmin(admin.ModelAdmin):
    list_display = ("id", "tag_id", "item", "classificacao", "local", "antena", "criado_em")
    list_filter = ("classificacao", "local", "antena")
    search_fields = ("tag_id", "item__nome", "item__tag_id", "antena__hardware_id")
    readonly_fields = ("criado_em",)


@admin.register(TimelineEvento)
class TimelineEventoAdmin(admin.ModelAdmin):
    list_display = ("id", "tipo", "item", "usuario", "criado_em")
    list_filter = ("tipo", "usuario")
    search_fields = ("mensagem", "item__nome", "item__tag_id", "usuario__username")
    readonly_fields = ("criado_em",)


@admin.register(NotificacaoInconsistencia)
class NotificacaoInconsistenciaAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "item",
        "local_logico",
        "local_fisico",
        "resolvida",
        "criado_em",
        "resolvida_em",
    )
    list_filter = ("resolvida", "local_logico", "local_fisico")
    search_fields = ("item__nome", "item__tag_id")
    readonly_fields = ("criado_em", "resolvida_em")


class AuditoriaLeitorStatusInline(admin.TabularInline):
    model = AuditoriaLeitorStatus
    extra = 0
    readonly_fields = ("antena", "status", "atualizado_em")


@admin.register(AuditoriaJob)
class AuditoriaJobAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "duracao_segundos", "solicitado_por", "iniciado_em", "finaliza_em")
    list_filter = ("status",)
    search_fields = ("id", "solicitado_por__username", "solicitado_por__email")
    readonly_fields = ("iniciado_em", "concluido_em")
    inlines = (AuditoriaLeitorStatusInline,)


@admin.register(AuditoriaLeitorStatus)
class AuditoriaLeitorStatusAdmin(admin.ModelAdmin):
    list_display = ("id", "job", "antena", "status", "atualizado_em")
    list_filter = ("status",)
    search_fields = ("job__id", "antena__nome", "antena__hardware_id")
    readonly_fields = ("atualizado_em",)
