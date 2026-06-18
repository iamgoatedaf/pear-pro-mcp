import type { PearConfig } from "./config.js";

export class PearApiError extends Error {
  constructor(
    public status: number,
    public endpoint: string,
    public body: unknown,
  ) {
    super(`Pear API ${status} on ${endpoint}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "PearApiError";
  }
}

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token should be considered stale. */
  expiresAt: number;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Thin, typed-ish HTTP client for the Pear Protocol Trading API.
 *
 * Handles the documented auth flow:
 *   1. POST /auth/authenticate  (method: "api_key")  -> access + refresh JWT
 *   2. Authorization: Bearer <access_token> on every call
 *   3. POST /auth/refresh on expiry (no wallet signature needed)
 *
 * EIP-712 signing is intentionally out of scope here: agents/bots should use a
 * long-lived API key (created once via POST /api-keys after a wallet login).
 */
export class PearClient {
  private tokens: AuthTokens | null = null;

  constructor(private cfg: PearConfig) {
    if (cfg.accessToken) {
      // Trust a pre-supplied token; assume ~10 min of life and refresh on 401.
      this.tokens = { accessToken: cfg.accessToken, expiresAt: Date.now() + 10 * 60_000 };
    }
  }

  private get authHeader(): Record<string, string> {
    return this.tokens ? { Authorization: `Bearer ${this.tokens.accessToken}` } : {};
  }

  private async ensureAuth(): Promise<void> {
    if (this.tokens && Date.now() < this.tokens.expiresAt) return;
    if (this.tokens?.refreshToken) {
      try {
        await this.refresh();
        return;
      } catch {
        // fall through to a fresh login
      }
    }
    await this.login();
  }

  private async rawRequest(
    method: string,
    endpoint: string,
    opts: { query?: Query; body?: unknown; auth?: boolean } = {},
  ): Promise<unknown> {
    const url = new URL(this.cfg.baseUrl + endpoint);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth !== false) Object.assign(headers, this.authHeader);

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
    }
    if (!res.ok) throw new PearApiError(res.status, endpoint, parsed);
    return parsed;
  }

  private async login(): Promise<void> {
    if (!this.cfg.apiKey) {
      throw new Error(
        "No PEAR_API_KEY or PEAR_ACCESS_TOKEN configured. Create an API key via POST /api-keys after a wallet login, then set PEAR_API_KEY.",
      );
    }
    const resp = (await this.rawRequest("POST", "/auth/authenticate", {
      auth: false,
      body: {
        method: "api_key",
        address: this.cfg.address,
        clientId: this.cfg.clientId,
        details: { apiKey: this.cfg.apiKey },
      },
    })) as { accessToken?: string; refreshToken?: string; access_token?: string; refresh_token?: string };

    const accessToken = resp.accessToken ?? resp.access_token;
    const refreshToken = resp.refreshToken ?? resp.refresh_token;
    if (!accessToken) throw new Error("Authentication succeeded but no access token was returned.");
    this.tokens = { accessToken, refreshToken, expiresAt: Date.now() + 14 * 60_000 };
  }

  private async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new Error("No refresh token available.");
    const resp = (await this.rawRequest("POST", "/auth/refresh", {
      auth: false,
      body: { refreshToken: this.tokens.refreshToken },
    })) as { accessToken?: string; access_token?: string };
    const accessToken = resp.accessToken ?? resp.access_token;
    if (!accessToken) throw new Error("Refresh succeeded but no access token was returned.");
    this.tokens = { ...this.tokens, accessToken, expiresAt: Date.now() + 14 * 60_000 };
  }

  /** Authenticated request with one automatic retry after refresh on 401. */
  async request(method: string, endpoint: string, opts: { query?: Query; body?: unknown } = {}): Promise<unknown> {
    await this.ensureAuth();
    try {
      return await this.rawRequest(method, endpoint, opts);
    } catch (err) {
      if (err instanceof PearApiError && err.status === 401) {
        this.tokens = null;
        await this.ensureAuth();
        return await this.rawRequest(method, endpoint, opts);
      }
      throw err;
    }
  }

  /** Unauthenticated GET (health, markets, public stats). */
  get(endpoint: string, query?: Query): Promise<unknown> {
    return this.rawRequest("GET", endpoint, { query, auth: false });
  }
}
