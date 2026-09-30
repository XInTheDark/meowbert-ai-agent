import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Laptop,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2
} from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import {
  DEFAULT_DESKTOP_PROFILE_ID,
  DEFAULT_DESKTOP_PROFILE_LABEL,
  DEFAULT_DESKTOP_SERVER_URL,
  type ServerProfile,
  type ServerProfilesState,
  isLoopbackUrl,
  resolveActiveServerProfile
} from "../../desktop/platform";

const DEFAULT_LOCAL_SERVER_URL = DEFAULT_DESKTOP_SERVER_URL;
const REMOTE_SERVER_URL_PLACEHOLDER = "https://meowbert.example.com";

function normalizeServerUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must use http or https.");
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function nextStateWithProfile(
  current: ServerProfilesState,
  profile: ServerProfile,
  makeActive = true
): ServerProfilesState {
  const exists = current.profiles.some((entry) => entry.id === profile.id);
  const profiles = exists
    ? current.profiles.map((entry) => (entry.id === profile.id ? profile : entry))
    : [...current.profiles, profile];

  return {
    profiles,
    activeProfileId: makeActive ? profile.id : current.activeProfileId
  };
}

function buildDefaultLocalProfile(): ServerProfile {
  return {
    id: DEFAULT_DESKTOP_PROFILE_ID,
    label: DEFAULT_DESKTOP_PROFILE_LABEL,
    baseUrl: DEFAULT_LOCAL_SERVER_URL,
    mode: "local"
  };
}

function displayModeLabel(mode: ServerProfile["mode"]): string {
  return mode === "local" ? "Local" : "Hosted";
}

export function ServerProfilesPage() {
  const navigate = useNavigate();
  const {
    capabilities,
    serverProfilesState,
    saveServerProfilesState
  } = useAppRuntime();
  const activeProfile = useMemo(() => resolveActiveServerProfile(serverProfilesState), [serverProfilesState]);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [modeDraft, setModeDraft] = useState<"remote" | "local">("remote");
  const [isSaving, setIsSaving] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const shouldShowWelcome = serverProfilesState.profiles.length === 0 && !showAdvancedSettings;

  function resetEditor(): void {
    setEditingId(null);
    setLabelDraft("");
    setBaseUrlDraft("");
    setModeDraft("remote");
    setError(null);
  }

  function handleModeDraftChange(nextMode: "remote" | "local"): void {
    setModeDraft(nextMode);
    setBaseUrlDraft((current) => {
      const trimmed = current.trim();
      if (nextMode === "local") {
        return trimmed.length === 0 ? DEFAULT_LOCAL_SERVER_URL : current;
      }

      return trimmed === DEFAULT_LOCAL_SERVER_URL ? "" : current;
    });
  }

  if (!capabilities.supportsServerProfiles) {
    return (
      <main className="desktop-setup-shell">
        <section className="desktop-setup-card card" style={{ maxWidth: "560px" }}>
          <h2>Server settings unavailable</h2>
          <p className="muted-text">This desktop host uses the website’s configured backend directly.</p>
          <Link className="btn primary full" to="/auth">Back</Link>
        </section>
      </main>
    );
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const normalizedBaseUrl = normalizeServerUrl(baseUrlDraft);
      const nextProfile: ServerProfile = {
        id: editingId ?? crypto.randomUUID(),
        label: labelDraft.trim() || normalizedBaseUrl,
        baseUrl: normalizedBaseUrl,
        mode: modeDraft === "local" || isLoopbackUrl(normalizedBaseUrl) ? "local" : "remote"
      };

      await saveServerProfilesState(nextStateWithProfile(serverProfilesState, nextProfile));
      resetEditor();
      navigate("/auth", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function chooseDefaultConnection(): Promise<void> {
    setError(null);
    setIsSaving(true);

    try {
      await saveServerProfilesState(nextStateWithProfile(serverProfilesState, buildDefaultLocalProfile()));
      navigate("/auth", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function activateProfile(profileId: string): Promise<void> {
    if (serverProfilesState.activeProfileId === profileId) {
      navigate("/auth", { replace: true });
      return;
    }

    await saveServerProfilesState({
      ...serverProfilesState,
      activeProfileId: profileId
    });
    navigate("/auth", { replace: true });
  }

  async function deleteProfile(profileId: string): Promise<void> {
    const remainingProfiles = serverProfilesState.profiles.filter((profile) => profile.id !== profileId);
    const nextActiveProfileId = serverProfilesState.activeProfileId === profileId
      ? remainingProfiles[0]?.id ?? null
      : serverProfilesState.activeProfileId;

    await saveServerProfilesState({
      profiles: remainingProfiles,
      activeProfileId: nextActiveProfileId
    });
  }

  async function testProfile(profile: ServerProfile): Promise<void> {
    setTestingProfileId(profile.id);
    setStatusById((current) => ({
      ...current,
      [profile.id]: "Checking…"
    }));

    try {
      const response = await fetch(`${profile.baseUrl}/health`);
      setStatusById((current) => ({
        ...current,
        [profile.id]: response.ok ? "Healthy" : `HTTP ${response.status}`
      }));
    } catch (err) {
      setStatusById((current) => ({
        ...current,
        [profile.id]: err instanceof Error ? err.message : "Connection failed"
      }));
    } finally {
      setTestingProfileId(null);
    }
  }

  function beginEdit(profile: ServerProfile): void {
    setEditingId(profile.id);
    setLabelDraft(profile.label);
    setBaseUrlDraft(profile.baseUrl);
    setModeDraft(profile.mode);
    setError(null);
    setShowAdvancedSettings(true);
  }

  async function createLocalProfile(): Promise<void> {
    const nextProfile: ServerProfile = {
      id: crypto.randomUUID(),
      label: "Local Server",
      baseUrl: DEFAULT_LOCAL_SERVER_URL,
      mode: "local"
    };
    await saveServerProfilesState(nextStateWithProfile(serverProfilesState, nextProfile));
    navigate("/auth", { replace: true });
  }

  if (shouldShowWelcome) {
    return (
      <main className="desktop-setup-shell">
        <section className="desktop-setup-card desktop-setup-card-wide card">
          <div className="desktop-setup-hero">
            <span className="desktop-setup-badge">
              <Sparkles size={14} />
              Welcome
            </span>
            <h1>Welcome to Meowbert Desktop</h1>
            <p>
              Connect to Meowbert running on this computer, or to your own server elsewhere.
            </p>
          </div>

          <div className="desktop-choice-grid">
            <button
              type="button"
              className="desktop-choice-card desktop-choice-card-primary"
              onClick={() => {
                void chooseDefaultConnection();
              }}
              disabled={isSaving}
            >
              <div className="desktop-choice-head">
                <div>
                  <strong>This computer</strong>
                  <p>For the standard Docker Compose setup</p>
                </div>
                <span className="desktop-choice-pill">Recommended</span>
              </div>
              <ul className="desktop-choice-list">
                <li>No server details to enter</li>
                <li>Connects to {DEFAULT_LOCAL_SERVER_URL}</li>
              </ul>
              <span className="desktop-choice-cta">
                {isSaving ? "Connecting…" : "Use this computer"}
                <ArrowRight size={16} />
              </span>
            </button>

            <button
              type="button"
              className="desktop-choice-card"
              onClick={() => setShowAdvancedSettings(true)}
              disabled={isSaving}
            >
              <div className="desktop-choice-head">
                <div>
                  <strong>Advanced</strong>
                  <p>For custom setups</p>
                </div>
                <Server size={18} />
              </div>
              <ul className="desktop-choice-list">
                <li>Connect to Meowbert on another machine</li>
                <li>Use a custom local port</li>
                <li>Save multiple connections and switch later</li>
              </ul>
              <span className="desktop-choice-cta">
                Open Advanced Settings
                <ArrowRight size={16} />
              </span>
            </button>
          </div>

          {error ? <p className="error-text" style={{ marginTop: "1rem" }}>{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="desktop-setup-shell">
      <section className="desktop-setup-card desktop-setup-card-wide card">
        <div className="desktop-advanced-header">
          <div>
            <span className="desktop-setup-badge">
              <Server size={14} />
              Advanced
            </span>
            <h2 style={{ marginBottom: "0.35rem" }}>Connection settings</h2>
            <p className="muted-text" style={{ margin: 0 }}>
              Add, test, and switch between hosted and local Meowbert connections.
            </p>
          </div>
          <div className="row-actions">
            {serverProfilesState.profiles.length === 0 ? (
              <button className="btn ghost" type="button" onClick={() => setShowAdvancedSettings(false)}>
                <ArrowLeft size={16} />
                Back
              </button>
            ) : null}
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                void chooseDefaultConnection();
              }}
              disabled={isSaving}
            >
              Use this computer
            </button>
            {activeProfile ? (
              <button className="btn primary" type="button" onClick={() => navigate("/auth", { replace: true })}>
                Continue
              </button>
            ) : null}
          </div>
        </div>

        <div className="desktop-profile-summary">
          <strong>{activeProfile ? "Current connection" : "No connection selected"}</strong>
          <p className="muted-text" style={{ margin: "0.35rem 0 0" }}>
            {activeProfile
              ? `${activeProfile.label} · ${activeProfile.baseUrl}`
              : "Choose a saved connection below, or create one now."}
          </p>
        </div>

        {serverProfilesState.profiles.length === 0 ? (
          <div className="section-card desktop-empty-state" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
            <p style={{ marginTop: 0 }}>No saved connections yet.</p>
            <div className="row-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  void chooseDefaultConnection();
                }}
                disabled={isSaving}
              >
                <Laptop size={16} />
                Use this computer
              </button>
            </div>
          </div>
        ) : (
          <div className="table-list" style={{ marginTop: "1rem" }}>
            {serverProfilesState.profiles.map((profile) => {
              const isActive = profile.id === serverProfilesState.activeProfileId;
              const status = statusById[profile.id] ?? null;
              return (
                <div key={profile.id} className="table-row static" style={{ alignItems: "center" }}>
                  <div>
                    <strong>{profile.label}</strong>
                    <div className="muted-text" style={{ fontSize: "0.8rem" }}>{profile.baseUrl}</div>
                  </div>
                  <span className={`badge ${profile.mode === "local" ? "warning" : "muted"}`}>{displayModeLabel(profile.mode)}</span>
                  <span className={`badge ${isActive ? "good" : "muted"}`}>{isActive ? "selected" : "saved"}</span>
                  <span className="muted-text" style={{ fontSize: "0.8rem" }}>{status ?? "—"}</span>
                  <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                    <button className="btn ghost" type="button" onClick={() => void testProfile(profile)} disabled={testingProfileId === profile.id}>
                      <RefreshCw size={15} />
                      Test
                    </button>
                    <button className="btn ghost" type="button" onClick={() => beginEdit(profile)}>
                      <Pencil size={15} />
                      Edit
                    </button>
                    <button className="btn ghost" type="button" onClick={() => void activateProfile(profile.id)}>
                      <CheckCircle2 size={15} />
                      {isActive ? "Selected" : "Use"}
                    </button>
                    <button className="btn ghost danger-outline" type="button" onClick={() => void deleteProfile(profile.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form className="stack-form desktop-advanced-form" onSubmit={saveProfile}>
          <strong>{editingId ? "Edit connection" : "Add connection"}</strong>
          <label>
            Connection name
            <input value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} placeholder="Production" />
          </label>
          <label>
            Mode
            <select value={modeDraft} onChange={(event) => handleModeDraftChange(event.target.value as "remote" | "local") }>
              <option value="remote">Hosted server</option>
              <option value="local">Local server</option>
            </select>
          </label>
          <label>
            Server URL
            <input
              type="url"
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
              placeholder={modeDraft === "local" ? DEFAULT_LOCAL_SERVER_URL : REMOTE_SERVER_URL_PLACEHOLDER}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="row-actions">
            <button className="btn primary" type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : editingId ? "Save connection" : "Add connection"}
            </button>
            {editingId ? (
              <button className="btn ghost" type="button" onClick={resetEditor}>
                Cancel
              </button>
            ) : null}
            {!editingId ? (
              <button className="btn ghost" type="button" onClick={() => void createLocalProfile()}>
                <Plus size={16} />
                Quick add local
              </button>
            ) : null}
          </div>
        </form>

        <div className="desktop-advanced-notes">
          <div>
            <Server size={15} />
            Hosted servers connect to an existing Meowbert deployment.
          </div>
          <div>
            <Laptop size={15} />
            Local mode connects to a Meowbert API running on this computer.
          </div>
        </div>
      </section>
    </main>
  );
}
