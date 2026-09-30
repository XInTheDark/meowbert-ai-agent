import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import {
  getTaskAssistantMessageDisplayPreferencesForUser,
  getTaskUiPreferencesForUser
} from "../../task/taskPagePreferences";

type PreferencesTab = "ui";

export function UserPreferencesPage() {
  const {
    api,
    user,
    activeWorkspaceId,
    refreshWorkspaces,
    setFlash
  } = useWorkspaceApp();
  const navigate = useNavigate();
  const taskUiPreferences = useMemo(() => getTaskUiPreferencesForUser(user), [user?.task_page_preferences]);
  const taskAssistantMessageDisplayPreferences = useMemo(
    () => getTaskAssistantMessageDisplayPreferencesForUser(user),
    [user?.task_page_preferences]
  );
  const [activeTab, setActiveTab] = useState<PreferencesTab>("ui");
  const [enableThreadsPopup, setEnableThreadsPopup] = useState(taskUiPreferences.enableThreadsPopup);
  const [sendWithShiftEnter, setSendWithShiftEnter] = useState(taskUiPreferences.sendWithShiftEnter);
  const [collapseLongMessages, setCollapseLongMessages] = useState(
    taskAssistantMessageDisplayPreferences.collapseLongMessages
  );
  const [showThoughts, setShowThoughts] = useState(taskAssistantMessageDisplayPreferences.showThoughts);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnableThreadsPopup(taskUiPreferences.enableThreadsPopup);
    setSendWithShiftEnter(taskUiPreferences.sendWithShiftEnter);
    setCollapseLongMessages(taskAssistantMessageDisplayPreferences.collapseLongMessages);
    setShowThoughts(taskAssistantMessageDisplayPreferences.showThoughts);
  }, [
    taskAssistantMessageDisplayPreferences.collapseLongMessages,
    taskAssistantMessageDisplayPreferences.showThoughts,
    taskUiPreferences.enableThreadsPopup,
    taskUiPreferences.sendWithShiftEnter
  ]);

  if (!activeWorkspaceId) {
    return (
      <section className="page-content settings-page">
        <article className="section-card empty-card">
          <h3>Preferences unavailable</h3>
          <p>Select a workspace before editing preferences.</p>
        </article>
      </section>
    );
  }

  async function savePreferences(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await api.patch("/api/auth/preferences", {
        taskPagePreferences: {
          assistantMessageDisplay: {
            collapseLongMessages,
            showThoughts
          },
          ui: {
            enableThreadsPopup,
            sendWithShiftEnter
          }
        }
      });
      await refreshWorkspaces();
      setFlash({ tone: "success", text: "Preferences saved." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-content settings-page">
      <article className="section-card">
        <div className="section-head">
          <div>
            <h3>Preferences</h3>
            <p className="muted-text">Personal UI settings for how Meowbert behaves in your task views.</p>
          </div>
          <button className="btn ghost" onClick={() => navigate(`/app/${activeWorkspaceId}/projects`)}>
            Back to Workspace
          </button>
        </div>

        <div className="tab-row" style={{ marginTop: "1rem" }}>
          <button
            className={`tab-btn ${activeTab === "ui" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("ui")}
          >
            UI
          </button>
        </div>

        <form className="stack-form" onSubmit={savePreferences} style={{ marginTop: "1rem" }}>
          {activeTab === "ui" ? (
            <div className="stack-form">
              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={enableThreadsPopup}
                  onChange={(event) => setEnableThreadsPopup(event.target.checked)}
                  disabled={isSaving}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Enable selection actions</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Shows quote and thread actions when you select text inside an assistant reply.
                  </p>
                </div>
              </label>

              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={sendWithShiftEnter}
                  onChange={(event) => setSendWithShiftEnter(event.target.checked)}
                  disabled={isSaving}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Require Cmd/Ctrl+Enter to send</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Plain <kbd>Enter</kbd> inserts a newline. Use <kbd>Cmd</kbd> + <kbd>Enter</kbd> on macOS or <kbd>Ctrl</kbd> + <kbd>Enter</kbd> on Windows/Linux to send.
                  </p>
                </div>
              </label>

              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={collapseLongMessages}
                  onChange={(event) => setCollapseLongMessages(event.target.checked)}
                  disabled={isSaving}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Collapse long messages</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Long user and assistant messages start shortened, with a <em>Read more</em> control to expand them.
                  </p>
                </div>
              </label>

              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={showThoughts}
                  onChange={(event) => setShowThoughts(event.target.checked)}
                  disabled={isSaving}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Show thoughts</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Displays reasoning summaries returned by the Responses API, plus the live thinking indicator while a task is running.
                  </p>
                </div>
              </label>
            </div>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}

          <div className="row-actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
