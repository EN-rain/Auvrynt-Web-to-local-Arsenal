import { timingSafeEqual, randomBytes, randomUUID, createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { AccessDeniedError, InvalidGrantError, InvalidRequestError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";

export interface OAuthConfig {
  ownerToken: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  scopes: string[];
  allowedRedirectHosts: string[];
}

interface AuthorizationCodeRecord {
  clientId: string;
  params: AuthorizationParams;
  expiresAtMs: number;
}

interface AccessTokenRecord {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

interface RefreshTokenRecord {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

const CODE_TTL_MS = 5 * 60 * 1000;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formHtml(params: {
  error?: string;
  clientName: string;
  scopes: string[];
  resource?: URL;
  fields: Record<string, string | undefined>;
}): string {
  const scopeDescriptions: Record<string, string> = {
    "auvrynt:read": "Inspect files, search, and perform read-only project analysis",
    "auvrynt:write": "Edit and create files",
    "auvrynt:process": "Start and stop approved workspace processes",
    "auvrynt:web": "Use browser and web-development tools",
    "auvrynt:software": "Use software and .NET tools",
    "auvrynt:godot": "Use Godot project tools",
    "auvrynt:blender": "Use Blender 3D tools",
    "auvrynt:serena": "Use local Serena semantic code tools",
  };
  const scopeItems = params.scopes.length > 0
    ? params.scopes.map((s) => {
        const desc = scopeDescriptions[s];
        return `<li><strong>${htmlEscape(s)}</strong>${desc ? ` <span>${htmlEscape(desc)}</span>` : ""}</li>`;
      }).join("\n          ")
    : "<li><strong>auvrynt</strong><span>General access</span></li>";
  const resourceText = params.resource?.href ?? "Auvrynt Webkit Arsenal endpoint";
  const error = params.error
    ? `<output role="alert" class="error">${htmlEscape(params.error)}</output>`
    : "";
  const hiddenFields = Object.entries(params.fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `        <input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auvrynt: Webkit Arsenal</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; background: #080b10; color: #f4f7fb; display: grid; place-items: center; padding: 24px; }
      main { width: min(100%, 960px); display: grid; grid-template-columns: .82fr 1.18fr; overflow: hidden; background: #10151d; border: 1px solid #273241; border-radius: 18px; box-shadow: 0 28px 90px rgba(0,0,0,.42); }
      .identity { padding: 44px 38px; background: #0c1118; border-right: 1px solid #273241; display: flex; flex-direction: column; justify-content: space-between; min-height: 620px; }
      .mark { display: inline-flex; align-items: center; gap: 10px; color: #a9b8c9; font-size: 12px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
      .mark-icon { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid #64748b; color: #b8f36b; border-radius: 7px; font-size: 13px; }
      .identity h1 { max-width: 310px; margin: 56px 0 16px; font-size: clamp(34px, 4vw, 52px); line-height: .98; letter-spacing: -.055em; font-weight: 760; }
      .identity h1 span { color: #b8f36b; }
      .identity-copy { max-width: 310px; margin: 0; color: #8e9bad; font-size: 15px; line-height: 1.65; }
      .connection-meta { display: grid; gap: 14px; margin-top: 36px; }
      .meta-row { display: flex; justify-content: space-between; gap: 16px; padding-top: 12px; border-top: 1px solid #273241; color: #778598; font-size: 12px; }
      .meta-row strong { color: #d7e0eb; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
      .status { display: inline-flex; align-items: center; gap: 7px; color: #b8f36b; font-weight: 650; }
      .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #b8f36b; box-shadow: 0 0 0 3px rgba(184,243,107,.12); }
      .identity-footer { color: #617084; font-size: 11px; line-height: 1.5; }
      .form-panel { padding: 44px 48px; }
      .eyebrow { margin: 0 0 12px; color: #b8f36b; font-size: 11px; font-weight: 750; letter-spacing: .14em; text-transform: uppercase; }
      .form-panel h2 { margin: 0 0 10px; font-size: 28px; line-height: 1.1; letter-spacing: -.035em; }
      .intro { max-width: 520px; margin: 0 0 28px; color: #9ba8b8; font-size: 15px; line-height: 1.6; }
      .client-badge { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 24px; padding: 8px 11px; border: 1px solid #344153; border-radius: 8px; color: #dce6f1; background: #171e28; font-size: 13px; }
      .client-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #b8f36b; }
      .section-label { margin: 0 0 10px; color: #718095; font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      .scope-list { list-style: none; padding: 0; margin: 0 0 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .scope-list li { min-height: 68px; padding: 12px 13px; border: 1px solid #2b3747; border-radius: 10px; background: #141b24; color: #8e9bad; font-size: 12px; line-height: 1.45; }
      .scope-list li strong { display: block; margin-bottom: 4px; color: #f1f5f9; font-size: 13px; font-weight: 650; }
      .token-group { margin-bottom: 22px; }
      .token-group label { display: block; margin-bottom: 8px; color: #dce6f1; font-size: 13px; font-weight: 650; }
      .input-wrapper { position: relative; }
      .input-wrapper input { width: 100%; padding: 13px 58px 13px 14px; border: 1px solid #3a485a; border-radius: 9px; background: #0c1118; color: #f4f7fb; font: inherit; font-size: 15px; outline: none; transition: border-color .18s, box-shadow .18s; }
      .input-wrapper input:focus { border-color: #b8f36b; box-shadow: 0 0 0 3px rgba(184,243,107,.14); }
      .input-wrapper input::placeholder { color: #657388; }
      .toggle-vis { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); border: 0; border-radius: 6px; padding: 7px 9px; background: transparent; color: #9ba8b8; cursor: pointer; font-size: 12px; font-weight: 650; }
      .toggle-vis:hover { color: #b8f36b; background: #1b2632; }
      .button-group { display: flex; gap: 10px; }
      .button-group button { flex: 1; min-height: 46px; border-radius: 9px; padding: 12px 14px; font: inherit; font-size: 14px; font-weight: 750; cursor: pointer; transition: transform .18s, background .18s, border-color .18s; }
      .button-group button:hover { transform: translateY(-1px); }
      .button-group button:focus-visible, .toggle-vis:focus-visible { outline: 2px solid #b8f36b; outline-offset: 3px; }
      .btn-approve { border: 1px solid #b8f36b; color: #10150c; background: #b8f36b; }
      .btn-approve:hover { background: #c8fa89; }
      .btn-deny { border: 1px solid #3a485a; color: #dce6f1; background: transparent; }
      .btn-deny:hover { border-color: #718095; background: #171e28; }
      .error { display: block; margin: 0 0 20px; padding: 12px 14px; border: 1px solid #b45555; border-radius: 9px; color: #ffd1d1; background: #321a1e; font-size: 13px; line-height: 1.45; }
      .security-note { display: flex; gap: 8px; margin: 22px 0 0; color: #718095; font-size: 12px; line-height: 1.5; }
      .security-note::before { content: "✓"; color: #b8f36b; font-weight: 800; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } .button-group button:hover { transform: none; } }
      @media (max-width: 720px) { body { padding: 12px; place-items: start center; } main { grid-template-columns: 1fr; } .identity { min-height: auto; padding: 28px 24px; border-right: 0; border-bottom: 1px solid #273241; } .identity h1 { margin: 34px 0 12px; font-size: 40px; } .identity-copy { max-width: 520px; } .connection-meta { margin-top: 24px; } .identity-footer { display: none; } .form-panel { padding: 28px 24px 32px; } }
      @media (max-width: 480px) { .scope-list { grid-template-columns: 1fr; } .button-group { flex-direction: column-reverse; } }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    </style>
  </head>
  <body>
    <main role="main">
      <section class="identity" aria-label="Auvrynt connection details">
        <div>
          <div class="mark"><span class="mark-icon" aria-hidden="true">A</span> Auvrynt</div>
          <h1>Local power.<br /><span>Explicit access.</span></h1>
          <p class="identity-copy">Auvrynt keeps your development workspace local while giving your web agent a controlled MCP connection.</p>
          <div class="connection-meta" aria-label="Connection summary">
            <div class="meta-row"><span>Requesting agent</span><strong>${htmlEscape(params.clientName)}</strong></div>
            <div class="meta-row"><span>Connection state</span><strong class="status">Awaiting approval</strong></div>
            <div class="meta-row"><span>Permissions</span><strong>${params.scopes.length} requested</strong></div>
          </div>
        </div>
        <p class="identity-footer">Review every permission before continuing. You can deny this request without changing your workspace.</p>
      </section>
      <section class="form-panel" aria-labelledby="authorize-title">
        <p class="eyebrow">Secure handshake</p>
        <h2 id="authorize-title">Approve this connection</h2>
        <p class="intro">Review what the web agent can do in your workspace, then confirm with your local owner token.</p>
        ${error}
        <div class="client-badge">${htmlEscape(params.clientName)}</div>
        <p class="section-label">Requested permissions</p>
        <ul class="scope-list" aria-label="Requested permissions">
          ${scopeItems}
        </ul>
        <form method="post" aria-describedby="token-desc">
          <div class="token-group">
            <label for="owner_token">Local owner token</label>
            <p id="token-desc" class="sr-only">Enter your Auvrynt owner token to authorize this connection. This token stays on this page and is never shared with the web agent.</p>
            <div class="input-wrapper">
              <input id="owner_token" name="owner_token" type="password" placeholder="Enter your owner token" autocomplete="off" autofocus required aria-required="true" />
              <button type="button" class="toggle-vis" aria-label="Show owner token" data-target="owner_token">Show</button>
            </div>
          </div>
${hiddenFields}
          <div class="button-group">
            <button type="submit" name="denied" value="true" class="btn-deny" formnovalidate>Deny request</button>
            <button type="submit" class="btn-approve">Approve connection</button>
          </div>
        </form>
        <p class="security-note">Your owner token is validated locally. It is never sent to the web agent, stored in cookies, or written to logs.</p>
      </section>
    </main>
    <script nonce="${randomUUID()}">
      (function() {
        var btn = document.querySelector('.toggle-vis');
        var input = document.getElementById('owner_token');
        if (btn && input) {
          btn.addEventListener('click', function() {
            var isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.textContent = isPassword ? 'Hide' : 'Show';
            btn.setAttribute('aria-label', isPassword ? 'Hide owner token' : 'Show owner token');
            input.setAttribute('aria-live', 'polite');
          });
        }
        var form = document.querySelector('form');
        var denyBtn = document.querySelector('button[name="denied"]');
        if (form && denyBtn) {
          denyBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var redirect = new URL(window.location.href);
            redirect.searchParams.set('error', 'access_denied');
            window.location.href = redirect.href;
          });
        }
      })();
    </script>
  </body>
</html>`;
}

function requestedScopesAllowed(requested: string[], supported: string[]): boolean {
  return requested.every((scope) => supported.includes(scope));
}

function redirectHostAllowed(redirectUri: string, allowedHosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return true;
  return allowedHosts.includes(parsed.hostname);
}

export class InMemoryOAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  constructor(private readonly allowedRedirectHosts: string[]) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    if (!client.redirect_uris.every((uri) => redirectHostAllowed(uri, this.allowedRedirectHosts))) {
      throw new InvalidRequestError("Client redirect_uri is not allowed for this Auvrynt server");
    }

    const now = Math.floor(Date.now() / 1000);
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: `auvrynt-${randomUUID()}`,
      client_id_issued_at: now,
      token_endpoint_auth_method: client.token_endpoint_auth_method ?? "none",
      grant_types: client.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: client.response_types ?? ["code"],
    };
    this.clients.set(registered.client_id, registered);
    return registered;
  }
}

export class SingleUserOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly resourceServerUrl: URL;

  constructor(
    private readonly config: OAuthConfig,
    resourceServerUrl: URL,
  ) {
    this.resourceServerUrl = resourceUrlFromServerUrl(resourceServerUrl);
    this.clientsStore = new InMemoryOAuthClientsStore(config.allowedRedirectHosts);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!params.resource || !checkResourceAllowed({ requestedResource: params.resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidRequestError("Invalid or missing OAuth resource");
    }
    if (!requestedScopesAllowed(params.scopes ?? [], this.config.scopes)) {
      throw new InvalidRequestError("Requested scope is not supported");
    }

    const req = res.req as Request;
    const queryError = req.query?.error as string | undefined;

    if (queryError === "access_denied") {
      throw new AccessDeniedError("Authorization denied by user");
    }

    if (req.method !== "POST") {
      res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        formHtml({
          clientName: client.client_name ?? client.client_id,
          scopes: params.scopes ?? this.config.scopes,
          resource: params.resource,
          fields: authorizationFormFields(client, params),
        }),
      );
      return;
    }

    if (req.body?.denied === "true") {
      throw new AccessDeniedError("Authorization denied by user");
    }

    const providedToken = String(req.body?.owner_token ?? "");
    if (!safeEquals(providedToken, this.config.ownerToken)) {
      res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(
        formHtml({
          error: "The owner password was not accepted.",
          clientName: client.client_name ?? client.client_id,
          scopes: params.scopes ?? this.config.scopes,
          resource: params.resource,
          fields: authorizationFormFields(client, params),
        }),
      );
      return;
    }

    const code = `code-${randomUUID()}`;
    this.codes.set(code, {
      clientId: client.client_id,
      params,
      expiresAtMs: Date.now() + CODE_TTL_MS,
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state !== undefined) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const record = this.validCodeRecord(client, authorizationCode);
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.validCodeRecord(client, authorizationCode);
    if (redirectUri && redirectUri !== record.params.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, record.params.scopes ?? this.config.scopes, record.params.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = this.refreshTokens.get(hashToken(refreshToken));
    if (!record || record.clientId !== client.client_id || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (resource && !checkResourceAllowed({ requestedResource: resource, configuredResource: this.resourceServerUrl })) {
      throw new InvalidGrantError("Invalid resource");
    }

    const requestedScopes = scopes ?? record.scopes;
    if (!requestedScopes.every((scope) => record.scopes.includes(scope))) {
      throw new AccessDeniedError("Refresh token cannot grant requested scopes");
    }

    this.refreshTokens.delete(hashToken(refreshToken));
    return this.issueTokens(client.client_id, requestedScopes, resource ?? record.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.accessTokens.get(hashToken(token));
    if (!record || record.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidTokenError("Invalid or expired access token");
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
      resource: record.resource,
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hashed = hashToken(request.token);
    this.accessTokens.delete(hashed);
    this.refreshTokens.delete(hashed);
  }

  private validCodeRecord(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): AuthorizationCodeRecord {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAtMs < Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return record;
  }

  private issueTokens(clientId: string, scopes: string[], resource?: URL): OAuthTokens {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessExpiresAt = now + this.config.accessTokenTtlSeconds;
    const refreshExpiresAt = now + this.config.refreshTokenTtlSeconds;

    this.accessTokens.set(hashToken(accessToken), {
      token: accessToken,
      clientId,
      scopes,
      expiresAt: accessExpiresAt,
      resource,
    });
    this.refreshTokens.set(hashToken(refreshToken), {
      token: refreshToken,
      clientId,
      scopes,
      expiresAt: refreshExpiresAt,
      resource,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }
}

function authorizationFormFields(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
): Record<string, string | undefined> {
  return {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: params.scopes?.join(" "),
    state: params.state,
    resource: params.resource?.href,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
