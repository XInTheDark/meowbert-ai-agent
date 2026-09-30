export interface OutboundEmailDraft {
  templateKey: string;
  recipientEmail: string;
  recipientUserId: string | null;
  subject: string;
  payload: Record<string, unknown>;
  campaignId?: string | null;
  messageType: "signup_verification" | "password_reset" | "newsletter" | "task_result";
}

export interface EmailTransport {
  sendTemplate(input: {
    templateKey: string;
    to: string;
    subject: string;
    data: Record<string, unknown>;
  }): Promise<{ providerMessageId: string | null }>;
}
