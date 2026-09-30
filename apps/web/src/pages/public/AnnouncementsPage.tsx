import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeSwitch } from "../../components/theme/ThemeSwitch";
import { BrandMark } from "../../lib/brand";
import { ThemeMode } from "../../lib/types";
import { apiBaseUrl } from "../../lib/runtime";

const TOKEN_KEY = "meowbert_token";

interface Announcement {
  id: string;
  title: string;
  body: string;
  notify: boolean;
  created_at: string;
}

interface AnnouncementsPageProps {
  themeMode: ThemeMode;
  setThemeMode: (theme: ThemeMode) => void;
}

export function AnnouncementsPage(props: AnnouncementsPageProps) {
  const isLoggedIn = Boolean(localStorage.getItem(TOKEN_KEY));
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${apiBaseUrl()}/api/announcements`)
      .then((r) => r.json())
      .then((data: { announcements: Announcement[] }) => setAnnouncements(data.announcements))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="brand">
          <BrandMark className="brand-mark" title="Meowbert" themeAware />
          <strong>Meowbert AI</strong>
        </div>
        <div className="landing-nav-actions">
          <ThemeSwitch themeMode={props.themeMode} setThemeMode={props.setThemeMode} />
          <Link className="btn ghost" to="/changelog">
            What&apos;s new
          </Link>
          <Link className="btn ghost" to="/">
            {isLoggedIn ? "Back to app" : "Home"}
          </Link>
          {!isLoggedIn && (
            <Link className="btn primary" to="/auth">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <section style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
        <h1 style={{ marginBottom: "2rem" }}>Announcements</h1>
        {isLoading ? (
          <p className="muted-text">Loading...</p>
        ) : announcements.length === 0 ? (
          <p className="muted-text">No announcements yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {announcements.map((a) => (
              <article
                key={a.id}
                style={{
                  padding: "1.25rem 1.5rem",
                  borderRadius: "8px",
                  border: "1px solid var(--border-color, #e2e8f0)",
                  background: "var(--surface-muted, #f8fafc)"
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: 0 }}>{a.title}</h3>
                  <span className="muted-text" style={{ fontSize: "0.8rem" }}>
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
