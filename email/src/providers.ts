export type Provider = "google" | "outlook" | "imap";
export type AuthMethod = "password" | "oauth2";

/** The secret part of an account: an (app) password, or an OAuth2 refresh token and its client. */
export type AccountSecret =
  | { method: "password"; password: string }
  | { method: "oauth2"; clientId: string; clientSecret?: string; refreshToken: string; tenant?: string };

export const PRESETS: Record<Exclude<Provider, "imap">, { host: string; port: number; secure: boolean }> = {
  google: { host: "imap.gmail.com", port: 993, secure: true },
  outlook: { host: "outlook.office365.com", port: 993, secure: true },
};

const TOKEN_URLS: Record<Exclude<Provider, "imap">, (tenant?: string) => string> = {
  google: () => "https://oauth2.googleapis.com/token",
  outlook: (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || "common")}/oauth2/v2.0/token`,
};

const SCOPES: Record<Exclude<Provider, "imap">, string> = {
  google: "https://mail.google.com/",
  outlook: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
};

/** A fresh access token for XOAUTH2; Microsoft may rotate the refresh token, which the caller must keep. */
export async function refreshAccessToken(
  provider: Provider,
  secret: Extract<AccountSecret, { method: "oauth2" }>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> {
  if (provider === "imap") throw new Error("OAuth2 is only available for Google and Outlook accounts");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
    client_id: secret.clientId,
    ...(secret.clientSecret ? { client_secret: secret.clientSecret } : {}),
    ...(provider === "outlook" ? { scope: SCOPES.outlook } : {}),
  });
  const response = await fetchImpl(TOKEN_URLS[provider](secret.tenant), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string; error_description?: string; error?: string };
  if (!response.ok || !data.access_token) throw new Error(`OAuth2 refresh failed: ${data.error_description ?? data.error ?? response.status}`);
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    ...(data.refresh_token && data.refresh_token !== secret.refreshToken ? { refreshToken: data.refresh_token } : {}),
  };
}
