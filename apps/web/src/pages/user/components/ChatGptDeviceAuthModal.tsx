import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";

interface ChatGptDeviceAuthModalProps {
  api: ApiClient;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChatGptDeviceAuthModal(props: ChatGptDeviceAuthModalProps) {
  const [loading, setLoading] = useState(true);
  const [deviceAuthId, setDeviceAuthId] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(15 * 60);
  const [pollInterval, setPollInterval] = useState(5);
  const [verificationUri, setVerificationUri] = useState<string>("https://auth.openai.com/codex/device");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function startAuth() {
      try {
        setLoading(true);
        setError(null);
        const res = await props.api.post<{
          userCode: string;
          verificationUri: string;
          deviceAuthId: string;
          expiresIn: number;
          interval: number;
        }>("/api/subscription/byo/chatgpt/device/start", {});
        if (cancelled) return;
        setUserCode(res.userCode);
        setExpiresIn(res.expiresIn);
        setPollInterval(Math.max(res.interval, 1));
        setVerificationUri(res.verificationUri || "https://auth.openai.com/codex/device");
        setDeviceAuthId(res.deviceAuthId);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void startAuth();
    return () => { cancelled = true; };
  }, [props.api]);

  useEffect(() => {
    if (!deviceAuthId || !userCode) return;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let nextDelayMs = Math.max(pollInterval, 1) * 1000;
    const expiresAt = Date.now() + Math.max(expiresIn, 1) * 1000;

    function schedulePoll() {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        setError("Device authorization expired. Please try again.");
        return;
      }
      if (!cancelled) {
        pollTimer = setTimeout(() => { void checkStatus(); }, Math.min(nextDelayMs, remainingMs));
      }
    }

    async function checkStatus() {
      try {
        const pollRes = await props.api.post<{
          result: { status: string; error?: string };
        }>("/api/subscription/byo/chatgpt/device/poll", { deviceAuthId, userCode });
        if (cancelled) return;
        if (pollRes.result.status === "complete") {
          props.onSuccess();
        } else if (pollRes.result.status === "pending") {
          schedulePoll();
        } else if (pollRes.result.status === "slow_down") {
          nextDelayMs += 5000;
          schedulePoll();
        } else if (pollRes.result.status === "expired" || pollRes.result.status === "denied" || pollRes.result.status === "error") {
          setError(pollRes.result.error || "Authentication failed.");
        }
      } catch {
        // Continue polling on transient network glitches
        schedulePoll();
      }
    }

    void checkStatus();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [deviceAuthId, expiresIn, pollInterval, props.api, props.onSuccess, userCode]);

  async function copyUserCode() {
    if (!userCode) return;
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="legal-overlay" onClick={props.onClose}>
      <div className="legal-modal" style={{ maxWidth: "480px" }} role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <div>
            <h2>Sign in with ChatGPT</h2>
            <p className="muted-text">Connect your ChatGPT Plus, Pro, or Team subscription</p>
          </div>
          <button className="legal-close" type="button" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="legal-modal-body" style={{ display: "grid", gap: "1rem", textAlign: "center" }}>
          {loading ? (
            <div style={{ padding: "2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
              <Loader2 className="spin-icon" size={24} />
              <p className="muted-text">Requesting authorization code from OpenAI...</p>
            </div>
          ) : userCode ? (
            <>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>Enter this one-time code on the OpenAI activation page:</p>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
                <code style={{ fontSize: "1.6rem", letterSpacing: "2px", fontWeight: "bold", padding: "0.4rem 1rem", background: "var(--surface-muted)", borderRadius: "6px" }}>
                  {userCode}
                </code>
                <button className="btn ghost" type="button" onClick={() => void copyUserCode()} title="Copy code">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <a href={verificationUri} target="_blank" rel="noreferrer" className="btn primary" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
                <span>Open OpenAI Activation</span>
                <ExternalLink size={16} />
              </a>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                <Loader2 className="spin-icon" size={16} />
                <span className="muted-text" style={{ fontSize: "0.85rem" }}>Waiting for you to complete sign-in...</span>
              </div>
            </>
          ) : null}
          {error ? <p className="error-text" style={{ margin: 0 }}>{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
