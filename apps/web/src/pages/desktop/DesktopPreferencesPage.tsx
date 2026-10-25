import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Keyboard, Laptop, Monitor } from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { DesktopComputerPreferences } from "./DesktopComputerPreferences";
import { DesktopShortcutsPreferences } from "./DesktopShortcutsPreferences";
import { LocalExecutionPreferences } from "./LocalExecutionPreferences";
import "./desktop-preferences.css";

type PreferencesSection = "shortcuts" | "computerUse" | "localExecution";

const sections = [
  { id: "localExecution", label: "Local execution", icon: Laptop },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "computerUse", label: "Computer use", icon: Monitor }
] as const;

export function DesktopPreferencesPage() {
  const { capabilities, activeContext } = useAppRuntime();
  const [activeSection, setActiveSection] = useState<PreferencesSection>("shortcuts");
  const backTarget = activeContext.workspaceId
    ? (activeContext.environmentId
      ? "/app/" + activeContext.workspaceId + "/projects/" + activeContext.environmentId
      : "/app/" + activeContext.workspaceId + "/projects")
    : "/app";

  if (!capabilities.isDesktop) {
    return (
      <main className="desktop-preferences-unavailable">
        <h1>Desktop preferences unavailable</h1>
        <p className="muted-text">Open Meowbert Desktop to manage this computer’s preferences.</p>
        <Link className="btn primary" to="/">Back to Meowbert</Link>
      </main>
    );
  }

  return (
    <main className="desktop-preferences-shell">
      <aside className="desktop-preferences-sidebar">
        <Link className="desktop-preferences-back" to={backTarget}>
          <ArrowLeft size={16} />
          Back to Meowbert
        </Link>
        <h1>Desktop preferences</h1>
        <nav aria-label="Desktop preferences">
          {sections.filter((section) => section.id !== "computerUse" || capabilities.supportsComputerUse).map((section) => (
            <button
              key={section.id}
              className={"desktop-preferences-nav-btn " + (activeSection === section.id ? "active" : "")}
              type="button"
              aria-current={activeSection === section.id ? "page" : undefined}
              onClick={() => setActiveSection(section.id)}
            >
              <section.icon size={17} />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="desktop-preferences-content">
        <div className="desktop-preferences-panel">
          {activeSection === "localExecution" ? <LocalExecutionPreferences /> : null}
          {activeSection === "shortcuts" ? <DesktopShortcutsPreferences /> : null}
          {activeSection === "computerUse" ? <DesktopComputerPreferences /> : null}
        </div>
      </div>
    </main>
  );
}
