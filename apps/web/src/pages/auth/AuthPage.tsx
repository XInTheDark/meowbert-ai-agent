import { useState, useMemo, FormEvent, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Monitor, Plug, MessageSquare } from "lucide-react";
import { createApiClient } from "../../lib/api";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { FlashMessage } from "../../lib/types";
import { BrandMark } from "../../lib/brand";
import { InstanceNoticeModal } from "../../components/modals/InstanceNoticeModal";
import { SOURCE_CODE_URL } from "../../lib/sourceCode";

interface RegistrationStatus {
  enabled: boolean;
  allowUserSignup: boolean;
  requireAdminSignupApproval: boolean;
  requireEmailVerificationOnSignup: boolean;
  forgotPasswordEnabled: boolean;
  hasUsers: boolean;
}

type AuthScreen = "login" | "register" | "verify" | "forgot" | "reset" | "unsubscribe";

interface AuthSuccessResponse {
  token?: string;
  pendingApproval?: boolean;
  pendingEmailVerification?: boolean;
  message?: string;
}

function resolveScreenFromQuery(search: string): {
  screen: AuthScreen | null;
  token: string | null;
} {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  const token = params.get("token");
  if (mode === "reset-password" && token) {
    return { screen: "reset", token };
  }
  if (mode === "unsubscribe" && token) {
    return { screen: "unsubscribe", token };
  }
  return { screen: null, token: null };
}

export function AuthPage(props: { onToken: (token: string) => void; setFlash: (flash: FlashMessage) => void }) {
  const api = useMemo(() => createApiClient(null), []);
  const navigate = useNavigate();
  const location = useLocation();
  const { capabilities, activeServerProfile } = useAppRuntime();
  const [showInstanceNotice, setShowInstanceNotice] = useState(false);

  const initialFromQuery = resolveScreenFromQuery(location.search);
  const [screen, setScreen] = useState<AuthScreen>(initialFromQuery.screen ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [queryToken, setQueryToken] = useState<string | null>(initialFromQuery.token);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string>("");
  const [unsubscribeMessage, setUnsubscribeMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRegister = registrationStatus?.enabled ?? true;
  const forgotPasswordEnabled = registrationStatus?.forgotPasswordEnabled ?? true;

  useEffect(() => {
    let cancelled = false;

    api
      .get<RegistrationStatus>("/api/auth/registration")
      .then((status) => {
        if (!cancelled) {
          setRegistrationStatus(status);
          if (!status.hasUsers && !initialFromQuery.screen) {
            setScreen("register");
          }
        }
      })
      .catch(() => {
        // If this request fails, keep registration and forgot-password enabled in UI
        // to avoid blocking access because of transient network issues.
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const fromQuery = resolveScreenFromQuery(location.search);
    if (fromQuery.screen) {
      setScreen(fromQuery.screen);
      setQueryToken(fromQuery.token);
    }
  }, [location.search]);

  useEffect(() => {
    if (!canRegister && screen === "register") {
      setScreen("login");
    }
  }, [canRegister, screen]);

  useEffect(() => {
    if (screen !== "unsubscribe" || !queryToken) {
      return;
    }

    let cancelled = false;
    setIsSubmitting(true);
    setError(null);
    setUnsubscribeMessage(null);

    api
      .post<{ ok: boolean; message: string }>("/api/auth/newsletter/unsubscribe", { token: queryToken })
      .then((result) => {
        if (!cancelled) {
          setUnsubscribeMessage(result.message ?? "You are unsubscribed.");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSubmitting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, queryToken, screen]);

  async function handleLoginOrRegisterSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (screen === "register" && !canRegister) {
      setError("New user sign ups are currently disabled.");
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = screen === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        screen === "login"
          ? { email, password }
          : { email, password, workspaceName: workspaceName.trim() || undefined };

      const result = await api.post<AuthSuccessResponse>(endpoint, payload);

      if (screen === "register" && result.pendingEmailVerification) {
        setPendingVerificationEmail(email.trim().toLowerCase());
        setVerificationCode("");
        setScreen("verify");
        props.setFlash({
          tone: "success",
          text: result.message ?? "Account created. Check your email for a verification code."
        });
        setPassword("");
        return;
      }

      if (screen === "register" && result.pendingApproval) {
        props.setFlash({
          tone: "success",
          text: result.message ?? "Signup submitted. Your account is pending admin approval."
        });
        setScreen("login");
        setPassword("");
        return;
      }

      if (!result.token) {
        throw new Error("Missing authentication token.");
      }

      props.onToken(result.token);
      props.setFlash({ tone: "success", text: screen === "login" ? "Welcome back." : "Account created successfully." });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifySubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await api.post<AuthSuccessResponse>("/api/auth/signup/verify-code", {
        email: pendingVerificationEmail || email,
        code: verificationCode
      });

      if (result.pendingApproval) {
        props.setFlash({
          tone: "success",
          text: result.message ?? "Email verified. Your account is pending admin approval."
        });
        setScreen("login");
        return;
      }

      if (!result.token) {
        throw new Error("Missing authentication token.");
      }

      props.onToken(result.token);
      props.setFlash({ tone: "success", text: "Email verified. Welcome to Meowbert." });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode(): Promise<void> {
    setError(null);
    setIsResendingCode(true);
    try {
      const result = await api.post<{ ok: boolean; message: string }>("/api/auth/signup/resend-code", {
        email: pendingVerificationEmail || email
      });
      props.setFlash({
        tone: "success",
        text: result.message ?? "A new verification code has been sent."
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsResendingCode(false);
    }
  }

  async function handleForgotPasswordSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await api.post<{ ok: boolean; message: string }>("/api/auth/password/forgot", { email });
      props.setFlash({
        tone: "success",
        text: result.message ?? "If your account exists, reset instructions were sent."
      });
      setScreen("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPasswordSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!queryToken) {
      setError("Reset token is missing.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.post<{ ok: boolean; message: string }>("/api/auth/password/reset", {
        token: queryToken,
        password: resetPassword
      });
      props.setFlash({
        tone: "success",
        text: result.message ?? "Password reset successfully. Please sign in."
      });
      setScreen("login");
      setResetPassword("");
      setResetConfirm("");
      setQueryToken(null);
      navigate("/auth", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function renderAuthForm(): JSX.Element {
    if (screen === "verify") {
      return (
        <form onSubmit={handleVerifySubmit} className="stack-form">
          <label>
            Email
            <input type="email" value={pendingVerificationEmail || email} onChange={(event) => setPendingVerificationEmail(event.target.value)} required />
          </label>
          <label>
            Verification code
            <input
              type="text"
              inputMode="numeric"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn primary full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Verifying..." : "Verify email"}
          </button>
          <button className="btn ghost full" type="button" onClick={() => void handleResendCode()} disabled={isResendingCode}>
            {isResendingCode ? "Sending..." : "Resend code"}
          </button>
          <button className="btn ghost full" type="button" onClick={() => setScreen("login")} disabled={isSubmitting || isResendingCode}>
            Back to sign in
          </button>
        </form>
      );
    }

    if (screen === "forgot") {
      return (
        <form onSubmit={handleForgotPasswordSubmit} className="stack-form">
          <label>
            Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn primary full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Sending..." : "Send reset link"}
          </button>
          <button className="btn ghost full" type="button" onClick={() => setScreen("login")} disabled={isSubmitting}>
            Back to sign in
          </button>
        </form>
      );
    }

    if (screen === "reset") {
      return (
        <form onSubmit={handleResetPasswordSubmit} className="stack-form">
          <label>
            New password
            <input type="password" required minLength={8} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
          </label>
          <label>
            Confirm password
            <input type="password" required minLength={8} value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn primary full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Resetting..." : "Reset password"}
          </button>
          <button className="btn ghost full" type="button" onClick={() => setScreen("login")} disabled={isSubmitting}>
            Back to sign in
          </button>
        </form>
      );
    }

    if (screen === "unsubscribe") {
      return (
        <div className="stack-form">
          {isSubmitting ? <p>Updating your subscription...</p> : null}
          {unsubscribeMessage ? <p>{unsubscribeMessage}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <button
            className="btn ghost full"
            type="button"
            onClick={() => {
              setScreen("login");
              navigate("/auth", { replace: true });
            }}
          >
            Continue to sign in
          </button>
        </div>
      );
    }

    const isRegister = screen === "register";
    return (
      <form onSubmit={handleLoginOrRegisterSubmit} className="stack-form">
        <label>
          Email
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {isRegister ? (
          <label>
            Workspace name <span className="field-hint">(optional)</span>
            <input
              type="text"
              placeholder="My Workspace"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
          </label>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        <button className="btn primary full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Please wait..." : isRegister ? "Create account" : "Sign in"}
        </button>
        <button
          className="btn ghost full"
          type="button"
          onClick={() => {
            if (screen === "login") {
              if (!canRegister) {
                setError("New user sign ups are currently disabled.");
                return;
              }
              setScreen("register");
              return;
            }
            setScreen("login");
          }}
          disabled={isSubmitting || (screen === "login" && !canRegister)}
        >
          {screen === "login"
            ? canRegister
              ? "Don't have an account? Sign up"
              : "New sign ups are disabled"
            : "Already have an account? Sign in"}
        </button>
        {screen === "login" && forgotPasswordEnabled ? (
          <button className="btn ghost full" type="button" onClick={() => setScreen("forgot")} disabled={isSubmitting}>
            Forgot password?
          </button>
        ) : null}
        {screen === "register" && registrationStatus?.requireAdminSignupApproval ? (
          <p className="muted-text">
            {registrationStatus.requireEmailVerificationOnSignup
              ? "New accounts require admin approval after email verification."
              : "New accounts need admin approval before they can sign in."}
          </p>
        ) : null}
        {!canRegister ? <p className="muted-text">Only existing users can sign in right now.</p> : null}
      </form>
    );
  }

  function titleText(): string {
    switch (screen) {
      case "register":
        return "Create your account";
      case "verify":
        return "Verify your email";
      case "forgot":
        return "Forgot your password?";
      case "reset":
        return "Reset your password";
      case "unsubscribe":
        return "Newsletter preferences";
      default:
        return "Welcome back";
    }
  }

  function subtitleText(): string {
    switch (screen) {
      case "register":
        return registrationStatus?.hasUsers === false
          ? "Create the first account. It becomes this server's admin."
          : "Get started — it only takes a moment.";
      case "verify":
        return "Enter the code sent to your inbox.";
      case "forgot":
        return "We'll send you a secure reset link.";
      case "reset":
        return "Set a new password for your account.";
      case "unsubscribe":
        return "Manage your email updates.";
      default:
        return "Sign in to your workspace.";
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-marketing">
        <Link to="/" className="auth-brand">
          <BrandMark className="brand-mark" title="Meowbert" themeAware />
          <strong>Meowbert AI</strong>
        </Link>
        <h1>Your AI agent.<br />Any task.</h1>
        <ul className="auth-features">
          <li><Monitor size={15} /><span>Its own computer — runs real shell commands and code</span></li>
          <li><Plug size={15} /><span>Connects to Telegram, Discord, and more</span></li>
          <li><MessageSquare size={15} /><span>Full visibility into every step it takes</span></li>
        </ul>
        <div className="auth-footer-links">
          <button type="button" className="landing-footer-link" onClick={() => setShowInstanceNotice(true)}>Your data</button>
          <a className="landing-footer-link" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">Source code</a>
        </div>
      </section>

      <section className="auth-card card">
        <h2>{titleText()}</h2>
        <p>{subtitleText()}</p>
        {capabilities.supportsServerProfiles ? (
          <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)", marginBottom: "1rem" }}>
            <strong>Server</strong>
            <p className="muted-text" style={{ margin: "0.35rem 0 0" }}>
              {activeServerProfile ? `${activeServerProfile.label} · ${activeServerProfile.baseUrl}` : "Choose a desktop server profile."}
            </p>
            <button className="btn ghost" type="button" style={{ marginTop: "0.75rem" }} onClick={() => navigate("/servers")}>
              Server Profiles
            </button>
          </div>
        ) : null}
        {renderAuthForm()}
      </section>
      {showInstanceNotice ? <InstanceNoticeModal onClose={() => setShowInstanceNotice(false)} /> : null}
    </main>
  );
}
