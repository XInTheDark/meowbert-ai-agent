import { verifyRunLeaseToken, type RunLeaseClaims } from "@meowbert/shared/run-lease-token";
import { query } from "../../lib/db.js";

export class RunApiForwardingError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "RunApiForwardingError";
  }
}

export function verifyRunLease(authorization: string | undefined, runId: string, secret: string): RunLeaseClaims {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new RunApiForwardingError(401, "unauthorized", "Missing run lease token.");
  let claims: RunLeaseClaims;
  try {
    claims = verifyRunLeaseToken(token, secret);
  } catch {
    throw new RunApiForwardingError(401, "unauthorized", "Invalid run lease token.");
  }
  if (claims.runId !== runId) throw new RunApiForwardingError(401, "unauthorized", "The token is for another run.");
  return claims;
}

// The worker listener that holds the run's lease for this epoch.
export async function resolveRunLeaseHolderUrl(claims: RunLeaseClaims): Promise<string> {
  const result = await query<{ lease_api_url: string | null; lease_epoch: number }>(
    "SELECT lease_api_url, lease_epoch FROM task_run_dispatches WHERE run_id = $1",
    [claims.runId]
  );
  const row = result.rows[0];
  if (!row?.lease_api_url || row.lease_epoch !== claims.epoch) {
    throw new RunApiForwardingError(409, "lease_lost", "This run's lease is no longer current.");
  }
  return row.lease_api_url.replace(/\/+$/, "");
}

// Passes one Run API request to the worker holding the run. The worker checks the lease again
// and answers; its status and body go back unchanged.
export async function forwardRunApiRequest(input: {
  holderUrl: string;
  path: string;
  authorization: string;
  body: unknown;
  signal: AbortSignal;
}): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${input.holderUrl}${input.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: input.authorization },
      body: JSON.stringify(input.body),
      signal: input.signal
    });
  } catch {
    throw new RunApiForwardingError(503, "internal", "The worker holding this run is unreachable.");
  }
  const body = await response.json().catch(() => ({ error: { code: "internal", message: "The worker sent an unreadable response." } }));
  return { status: response.status, body };
}
