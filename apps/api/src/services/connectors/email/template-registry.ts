export type EmailTemplateKey = "signup_verification" | "password_reset" | "newsletter" | "task_result";

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  name: string;
  version: string;
  type: "tx";
  subject: string;
  body: string;
}

const TEMPLATE_VERSION = "2026-03-05-v1";
const NEWSLETTER_TEMPLATE_VERSION = "2026-03-19-v3";

export const EMAIL_TEMPLATE_DEFINITIONS: EmailTemplateDefinition[] = [
  {
    key: "signup_verification",
    name: "meowbert_signup_verification",
    version: TEMPLATE_VERSION,
    type: "tx",
    subject: "Verify your Meowbert account",
    body: `
<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
  <h2 style="margin: 0 0 12px;">Email verification</h2>
  <p style="margin: 0 0 12px;">Use this code to verify your account:</p>
  <p style="margin: 0 0 16px;"><strong style="font-size: 28px; letter-spacing: 4px;">{{ .Tx.Data.code }}</strong></p>
  <p style="margin: 0 0 12px;">This code expires in {{ .Tx.Data.expires_minutes }} minutes.</p>
  <p style="margin: 0; color: #6b7280;">If you didn't request this, you can ignore this email.</p>
</div>
    `.trim()
  },
  {
    key: "password_reset",
    name: "meowbert_password_reset",
    version: TEMPLATE_VERSION,
    type: "tx",
    subject: "Reset your Meowbert password",
    body: `
<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
  <h2 style="margin: 0 0 12px;">Password reset</h2>
  <p style="margin: 0 0 12px;">Click the link below to reset your password:</p>
  <p style="margin: 0 0 16px;"><a href="{{ .Tx.Data.reset_url }}">Reset password</a></p>
  <p style="margin: 0 0 12px;">This link expires in {{ .Tx.Data.expires_minutes }} minutes.</p>
  <p style="margin: 0; color: #6b7280;">If you didn't request this, you can ignore this email.</p>
</div>
    `.trim()
  },
  {
    key: "newsletter",
    name: "meowbert_newsletter",
    version: NEWSLETTER_TEMPLATE_VERSION,
    type: "tx",
    subject: "{{ .Tx.Data.subject }}",
    body: `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
  <h2 style="margin: 0 0 16px;">{{ .Tx.Data.subject }}</h2>
  <div style="margin: 0 0 16px;">
    {{ if .Tx.Data.body_html }}
      {{ Safe .Tx.Data.body_html }}
    {{ else }}
      <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">{{ .Tx.Data.body_text }}</pre>
    {{ end }}
  </div>
  {{ if .Tx.Data.unsubscribe_url }}
    <p style="margin: 0; color: #6b7280;">
      Don't want these updates?
      <a href="{{ .Tx.Data.unsubscribe_url }}">Unsubscribe</a>.
    </p>
  {{ end }}
</div>
    `.trim()
  },
  {
    key: "task_result",
    name: "meowbert_task_result",
    version: TEMPLATE_VERSION,
    type: "tx",
    subject: "{{ .Tx.Data.subject }}",
    body: `
<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
  <h2 style="margin: 0 0 12px;">Task result</h2>
  <pre style="white-space: pre-wrap; font-family: inherit; margin: 0 0 16px;">{{ .Tx.Data.response_text }}</pre>
  <p style="margin: 0;">
    Open task:
    <a href="{{ .Tx.Data.task_url }}">{{ .Tx.Data.task_url }}</a>
  </p>
</div>
    `.trim()
  }
];

export function findEmailTemplateDefinition(key: EmailTemplateKey): EmailTemplateDefinition {
  const found = EMAIL_TEMPLATE_DEFINITIONS.find((template) => template.key === key);
  if (!found) {
    throw new Error(`Unknown email template key: ${key}`);
  }
  return found;
}
