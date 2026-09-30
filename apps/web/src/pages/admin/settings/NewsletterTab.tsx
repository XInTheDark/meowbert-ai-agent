import type { FormEvent } from "react";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import type { NewsletterCampaignSummary } from "./shared";

function summarizeNewsletterBody(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface NewsletterTabProps {
  campaigns: NewsletterCampaignSummary[];
  newsletterSubject: string;
  newsletterBodyFormat: "markdown" | "html";
  newsletterMarkdownBody: string;
  newsletterHtmlBody: string;
  newsletterTrialRecipients: string;
  isNewsletterSending: boolean;
  isNewsletterTrialSending: boolean;
  error: string | null;
  onNewsletterSubjectChange: (value: string) => void;
  onNewsletterBodyFormatChange: (value: "markdown" | "html") => void;
  onNewsletterMarkdownBodyChange: (value: string) => void;
  onNewsletterHtmlBodyChange: (value: string) => void;
  onNewsletterTrialRecipientsChange: (value: string) => void;
  onSendNewsletter: (event: FormEvent) => Promise<void>;
  onSendTrialNewsletter: () => Promise<void>;
  onRefreshHistory: () => Promise<void>;
}

export function NewsletterTab(props: NewsletterTabProps) {
  const isBusy = props.isNewsletterSending || props.isNewsletterTrialSending;
  const isMarkdownMode = props.newsletterBodyFormat === "markdown";

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <form className="stack-form" onSubmit={(event) => void props.onSendNewsletter(event)}>
        <label>
          <strong>Subject</strong>
          <input
            value={props.newsletterSubject}
            onChange={(event) => props.onNewsletterSubjectChange(event.target.value)}
            placeholder="Product updates"
          />
        </label>
        <div className="row-actions">
          <button
            className={`btn ${isMarkdownMode ? "primary" : "ghost"}`}
            type="button"
            onClick={() => props.onNewsletterBodyFormatChange("markdown")}
            disabled={isBusy}
          >
            Markdown
          </button>
          <button
            className={`btn ${isMarkdownMode ? "ghost" : "primary"}`}
            type="button"
            onClick={() => props.onNewsletterBodyFormatChange("html")}
            disabled={isBusy}
          >
            HTML
          </button>
        </div>
        <label>
          <strong>{isMarkdownMode ? "Markdown body" : "HTML body"}</strong>
          <textarea
            value={isMarkdownMode ? props.newsletterMarkdownBody : props.newsletterHtmlBody}
            onChange={(event) =>
              isMarkdownMode
                ? props.onNewsletterMarkdownBodyChange(event.target.value)
                : props.onNewsletterHtmlBodyChange(event.target.value)
            }
            rows={isMarkdownMode ? 12 : 10}
            placeholder={
              isMarkdownMode
                ? "## What we shipped this week\n\n- Faster sends\n- Better previews"
                : "<p>Write your newsletter HTML here...</p>"
            }
          />
        </label>
        <p className="muted-text" style={{ margin: "-0.5rem 0 0", fontSize: "0.9rem" }}>
          {isMarkdownMode
            ? "Markdown is converted to HTML before the email is sent."
            : "HTML is sent directly in newsletter emails."}
        </p>
        <label>
          <strong>Trial recipients</strong>
          <textarea
            value={props.newsletterTrialRecipients}
            onChange={(event) => props.onNewsletterTrialRecipientsChange(event.target.value)}
            rows={3}
            placeholder={"alice@example.com\nbob@example.com"}
          />
        </label>
        <p className="muted-text" style={{ margin: "-0.5rem 0 0", fontSize: "0.9rem" }}>
          Comma- or newline-separated emails for a trial send.
        </p>
        <div className="row-actions">
          <button className="btn primary" type="submit" disabled={isBusy}>
            {props.isNewsletterSending ? "Sending..." : "Send to all active users"}
          </button>
          <button className="btn ghost" type="button" onClick={() => void props.onSendTrialNewsletter()} disabled={isBusy}>
            {props.isNewsletterTrialSending ? "Sending trial..." : "Send trial"}
          </button>
          <button className="btn ghost" type="button" onClick={() => void props.onRefreshHistory()} disabled={isBusy}>
            Refresh history
          </button>
        </div>
      </form>

      <AdminTable
        columns={[
          { key: "subject", label: "Subject" },
          { key: "status", label: "Status" },
          { key: "recipients", label: "Recipients" },
          { key: "created", label: "Created" }
        ]}
      >
        {props.campaigns.length === 0 ? (
          <AdminTableRow>
            <AdminTableCell colSpan={4}>
              <span className="muted-text">No campaigns sent yet.</span>
            </AdminTableCell>
          </AdminTableRow>
        ) : (
          props.campaigns.map((campaign) => {
            const preview = summarizeNewsletterBody(campaign.bodyText);

            return (
              <AdminTableRow key={campaign.id}>
                <AdminTableCell>
                  <div><strong>{campaign.subject}</strong></div>
                  <div className="muted-text" style={{ fontSize: "0.8rem" }}>
                    {preview.slice(0, 120)}{preview.length > 120 ? "..." : ""}
                  </div>
                </AdminTableCell>
                <AdminTableCell>{campaign.status}</AdminTableCell>
                <AdminTableCell>
                  <span>{campaign.sentCount} sent</span>
                  <span className="muted-text"> · {campaign.failedCount} failed · {campaign.queuedCount} queued</span>
                </AdminTableCell>
                <AdminTableCell>{new Date(campaign.createdAt).toLocaleString()}</AdminTableCell>
              </AdminTableRow>
            );
          })
        )}
      </AdminTable>

      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}
