from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, SAFE_METHODS

from core.domain.models import TecnicoPermissoes


PERMISSION_KEYS = [
    "gerenciar_cadastros",
    "acionar_leitores",
    "executar_auditoria",
    "resolver_inconsistencias",
    "ver_logs",
]


def is_admin_user(user):
    return bool(user and user.is_authenticated and (user.is_staff or user.is_superuser))


def tecnico_permissions_dict():
    permissions = TecnicoPermissoes.atual()
    return {key: getattr(permissions, key) for key in PERMISSION_KEYS} | {"gerenciar_usuarios": False}


def user_permissions(user):
    if is_admin_user(user):
        return {key: True for key in PERMISSION_KEYS} | {"gerenciar_usuarios": True}
    return tecnico_permissions_dict()


def user_profile(user):
    return "admin" if is_admin_user(user) else "tecnico"


def require_user_permission(user, permission_key):
    if not user_permissions(user).get(permission_key):
        raise PermissionDenied("Voce nao tem permissao para executar esta acao.")


class CadastroPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return user_permissions(request.user).get("gerenciar_cadastros", False)


class LogPermission(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and (request.method in SAFE_METHODS)
            and user_permissions(request.user).get("ver_logs", False)
        )
