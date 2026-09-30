export class GoogleWorkspaceProxyError extends Error {
  readonly statusCode: number;
  readonly exposeMessage = true;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "GoogleWorkspaceProxyError";
    this.statusCode = statusCode;
  }
}
