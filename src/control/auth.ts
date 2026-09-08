import { RetellAuth } from "../types";

// orgId / orgUserId: dashboard session only; not in the public types.
export interface AnyAuth extends RetellAuth {
  orgId?: string;
  orgUserId?: string;
}

export function authHeaders(auth: AnyAuth): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${auth.key}` };
  if (auth.orgId) h["orgId"] = auth.orgId;
  if (auth.orgUserId) h["orgUserId"] = auth.orgUserId;
  return h;
}

// Browsers can't set headers on a WS handshake, so the credential rides in
// the subprotocol list. "bearer" goes first: the server echoes only the first
// entry, and that must never be the secret.
export function authSubprotocols(auth: AnyAuth): string[] {
  const protocols = ["bearer", auth.key];
  if (auth.orgId) protocols.push(auth.orgId);
  return protocols;
}
