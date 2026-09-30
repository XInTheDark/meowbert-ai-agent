export interface InboundEmailAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentBase64: string;
}

export interface InboundEmailMessage {
  provider: "listmonk" | "smtp" | "unknown";
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  receivedAt: string;
  headers: Record<string, string>;
  attachments: InboundEmailAttachment[];
}

export interface InboundEmailAdapter {
  parseInboundPayload(payload: unknown): InboundEmailMessage | null;
}
