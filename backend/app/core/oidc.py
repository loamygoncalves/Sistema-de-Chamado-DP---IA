"""Cliente OIDC genérico — funciona tanto com Keycloak quanto com Azure AD.

O provedor é escolhido via `AUTH_PROVIDER` (`keycloak` | `azure_ad`). Ambos expõem o
fluxo Authorization Code + PKCE e um endpoint `/.well-known/openid-configuration`,
então o mesmo cliente serve para os dois — a única diferença prática é o `OIDC_ISSUER`.
"""

import httpx

from app.core.config import settings


class OIDCClient:
    def __init__(self) -> None:
        self.issuer = settings.OIDC_ISSUER.rstrip("/")
        self.client_id = settings.OIDC_CLIENT_ID
        self.client_secret = settings.OIDC_CLIENT_SECRET
        self.redirect_uri = settings.OIDC_REDIRECT_URI
        self._discovery: dict | None = None

    async def discovery(self) -> dict:
        if self._discovery is None:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.issuer}/.well-known/openid-configuration")
                resp.raise_for_status()
                self._discovery = resp.json()
        return self._discovery

    def build_authorize_url(self, state: str, code_challenge: str) -> str:
        base = (
            f"{self.issuer}/protocol/openid-connect/auth"
            if settings.AUTH_PROVIDER == "keycloak"
            else f"{self.issuer}/oauth2/v2.0/authorize"
        )
        params = (
            f"?response_type=code&client_id={self.client_id}"
            f"&redirect_uri={self.redirect_uri}&scope=openid%20profile%20email"
            f"&state={state}&code_challenge={code_challenge}&code_challenge_method=S256"
        )
        return base + params

    async def exchange_code(self, code: str, code_verifier: str) -> dict:
        discovery = await self.discovery()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                discovery["token_endpoint"],
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self.redirect_uri,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code_verifier": code_verifier,
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def userinfo(self, access_token: str) -> dict:
        discovery = await self.discovery()
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                discovery["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"}
            )
            resp.raise_for_status()
            return resp.json()


oidc_client = OIDCClient()
