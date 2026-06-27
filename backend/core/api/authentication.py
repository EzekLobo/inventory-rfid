import hashlib

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.authentication import BasicAuthentication, get_authorization_header


class CachedBasicAuthentication(BasicAuthentication):
    cache_timeout_seconds = 5 * 60

    def authenticate(self, request):
        header = get_authorization_header(request)
        if not header or not header.lower().startswith(b"basic "):
            return None

        cache_key = "basic-auth:" + hashlib.sha256(header).hexdigest()
        cached_user_id = cache.get(cache_key)
        if cached_user_id:
            user = get_user_model().objects.filter(id=cached_user_id, is_active=True).first()
            if user is not None:
                return (user, None)

        authenticated = super().authenticate(request)
        if authenticated is not None:
            user, _ = authenticated
            cache.set(cache_key, user.id, self.cache_timeout_seconds)
        return authenticated
