from django.urls import include, path
from rest_framework.routers import DefaultRouter

from core.api.viewsets import (
    AntenaRFIDViewSet,
    AuthViewSet,
    AuditoriaViewSet,
    InconsistenciaViewSet,
    ItemPatrimonialViewSet,
    LocalViewSet,
    MovimentacaoViewSet,
    OperacionalResumoViewSet,
    TecnicoPermissoesViewSet,
    UsuarioViewSet,
    RFIDEventosViewSet,
    TimelineViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register("auth", AuthViewSet, basename="auth")
router.register("antenas", AntenaRFIDViewSet, basename="antenas")
router.register("locais", LocalViewSet, basename="locais")
router.register("usuarios", UsuarioViewSet, basename="usuarios")
router.register("permissoes/tecnico", TecnicoPermissoesViewSet, basename="permissoes-tecnico")
router.register("movimentacao", MovimentacaoViewSet, basename="movimentacao")
router.register("eventos/rfid", RFIDEventosViewSet, basename="eventos-rfid")
router.register("resumo", OperacionalResumoViewSet, basename="resumo")
router.register("itens", ItemPatrimonialViewSet, basename="itens")
router.register("timeline", TimelineViewSet, basename="timeline")
router.register("inconsistencias", InconsistenciaViewSet, basename="inconsistencias")
router.register("auditoria", AuditoriaViewSet, basename="auditoria")

urlpatterns = [
    path("", include(router.urls)),
]
