import type { SignupPolicy } from "./saveAdminSetup";

const OPTIONS: Array<{ value: SignupPolicy; title: string; detail: string }> = [
  { value: "closed", title: "Only me for now", detail: "Nobody else can create an account. You can open sign-ups later." },
  { value: "approval", title: "Anyone with the link, after I approve", detail: "New accounts wait for your approval in the admin panel." },
  { value: "open", title: "Anyone with the link", detail: "Only choose this if the server isn't reachable by strangers." }
];

export function AdminSetupSignupStep(props: {
  policy: SignupPolicy;
  onChange: (policy: SignupPolicy) => void;
  isSaving: boolean;
  error: string | null;
  onFinish: () => void;
}) {
  return (
    <div className="stack-form">
      <p className="muted-text" style={{ margin: 0 }}>Who can create an account on this server?</p>
      {OPTIONS.map((option) => (
        <label key={option.value} className="admin-setup-choice">
          <input type="radio" name="signup-policy" checked={props.policy === option.value} onChange={() => props.onChange(option.value)} />
          <span><strong>{option.title}</strong><span className="hint-text">{option.detail}</span></span>
        </label>
      ))}
      {props.error ? <p className="error-text">{props.error}</p> : null}
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={props.isSaving} onClick={props.onFinish}>
          {props.isSaving ? "Saving…" : "Finish setup"}
        </button>
      </div>
    </div>
  );
}
