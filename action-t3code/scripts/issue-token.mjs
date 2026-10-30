#!/usr/bin/env node
// Gets a T3 MCP token through T3's own approval page, where you pick its access (for example full-access).
// `t3 auth session issue` cannot set that ceiling, so its tokens stay approval-required.
// Usage, on the Mac running T3: node scripts/issue-token.mjs [http://127.0.0.1:3773]
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const base = (process.argv[2] ?? "http://127.0.0.1:3773").replace(/\/$/, "");
const getJson = async (path, init) => {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

const { resource } = await getJson("/.well-known/oauth-protected-resource/mcp");
const metadata = await getJson("/.well-known/oauth-authorization-server");

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

const { client_id: clientId } = await getJson("/oauth/mcp/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "plaios", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
});

const verifier = randomBytes(32).toString("base64url");
const state = randomBytes(16).toString("base64url");
const authorize = new URL(metadata.authorization_endpoint);
authorize.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  state,
  resource,
}).toString();

const code = await new Promise((resolve, reject) => {
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") return response.writeHead(404).end();
    response.end("Done, you can close this tab.");
    if (url.searchParams.get("state") !== state) return reject(new Error("OAuth state mismatch"));
    const found = url.searchParams.get("code");
    found ? resolve(found) : reject(new Error(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "No code"));
  });
  console.error(`Approve in the browser and pick the access level:\n${authorize}`);
  execFile("open", [authorize.href], () => undefined);
});
server.close();

const token = await getJson("/oauth/mcp/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource }),
});
console.error(`Scope: ${token.scope}; expires in ${Math.round(token.expires_in / 86400)} days.`);
console.log(token.access_token);
