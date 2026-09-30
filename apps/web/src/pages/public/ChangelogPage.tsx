import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ThemeSwitch } from "../../components/theme/ThemeSwitch";
import { BrandMark } from "../../lib/brand";
import { ThemeMode } from "../../lib/types";
import { rawChangelog, markChangelogSeen } from "../../lib/changelog";
import { buildDocsUrl } from "../../lib/docs";

const TOKEN_KEY = "meowbert_token";

interface ChangelogPageProps {
  themeMode: ThemeMode;
  setThemeMode: (theme: ThemeMode) => void;
}

/** Minimal markdown → React elements renderer (headings, lists, bold, paragraphs). */
function renderMarkdown(md: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = md.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      nodes.push(<h2 key={key++}>{line.slice(3)}</h2>);
      i++;
    } else if (line.startsWith("### ")) {
      nodes.push(<h3 key={key++}>{line.slice(4)}</h3>);
      i++;
    } else if (line.startsWith("# ")) {
      nodes.push(<h1 key={key++}>{line.slice(2)}</h1>);
      i++;
    } else if (line.trimStart().startsWith("- ")) {
      // Collect consecutive list items into a <ul>
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("- ")) {
        items.push(<li key={i}>{inlineMarkdown(lines[i].trimStart().slice(2))}</li>);
        i++;
      }
      nodes.push(<ul key={key++}>{items}</ul>);
    } else if (line.trim() === "") {
      i++;
    } else {
      nodes.push(<p key={key++}>{inlineMarkdown(line)}</p>);
      i++;
    }
  }

  return nodes;
}

/** Renders **bold** inline spans. */
function inlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, idx) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={idx}>{part.slice(2, -2)}</strong>
        ) : (
          part
        )
      )}
    </>
  );
}

export function ChangelogPage({ themeMode, setThemeMode }: ChangelogPageProps) {
  const isLoggedIn = Boolean(localStorage.getItem(TOKEN_KEY));
  const docsUrl = buildDocsUrl("/");

  useEffect(() => {
    markChangelogSeen();
  }, []);

  return (
    <main className="landing">
      <header className="landing-nav">
        <div className="brand">
          <BrandMark className="brand-mark" title="Meowbert" themeAware />
          <strong>Meowbert AI</strong>
        </div>
        <div className="landing-nav-actions">
          <ThemeSwitch themeMode={themeMode} setThemeMode={setThemeMode} />
          <a className="btn ghost" href={docsUrl} target="_blank" rel="noreferrer">
            Docs
          </a>
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
        <div className="changelog-content">{renderMarkdown(rawChangelog)}</div>
      </section>
    </main>
  );
}
