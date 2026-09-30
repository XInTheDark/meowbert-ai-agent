export class SourceFileLinkProviderError extends Error {
  readonly statusCode: number;
  readonly exposeMessage = true;
  readonly upstreamStatus: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    input: {
      statusCode: number;
      upstreamStatus?: number | null;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "SourceFileLinkProviderError";
    this.statusCode = input.statusCode;
    this.upstreamStatus = input.upstreamStatus ?? null;
    this.retryable = input.retryable ?? false;
  }
}

export class SourceFileLinkActionError extends Error {
  readonly statusCode = 409;
  readonly exposeMessage = true;

  constructor(message: string) {
    super(message);
    this.name = "SourceFileLinkActionError";
  }
}

export type SourceFileLinkAttachmentStage =
  | "remote metadata"
  | "destination"
  | "link creation"
  | "live folder mount";

export class SourceFileLinkAttachmentError extends Error {
  readonly statusCode: number;
  readonly exposeMessage = true;
  readonly stage: SourceFileLinkAttachmentStage;
  readonly retryable: boolean;

  constructor(
    stage: SourceFileLinkAttachmentStage,
    message: string,
    input: { statusCode?: number; retryable?: boolean } = {}
  ) {
    super(`Google Drive live folder attachment failed during ${stage}: ${message}`);
    this.name = "SourceFileLinkAttachmentError";
    this.stage = stage;
    this.statusCode = input.statusCode ?? 500;
    this.retryable = input.retryable ?? false;
  }
}

export class SourceFileLinkRemoteMissingError extends SourceFileLinkProviderError {
  constructor(message = "The remote source file no longer exists.") {
    super(message, {
      statusCode: 404,
      upstreamStatus: 404
    });
    this.name = "SourceFileLinkRemoteMissingError";
  }
}

export class SourceFileLinkRemoteConflictError extends SourceFileLinkProviderError {
  constructor(message = "The remote source file changed since the last sync.") {
    super(message, {
      statusCode: 409,
      upstreamStatus: 409
    });
    this.name = "SourceFileLinkRemoteConflictError";
  }
}

export class SourceFileLinkRemoteLockedError extends SourceFileLinkProviderError {
  constructor(message = "The remote source file is locked. Close it in the provider and try again.") {
    super(message, {
      statusCode: 423,
      upstreamStatus: 423
    });
    this.name = "SourceFileLinkRemoteLockedError";
  }
}
