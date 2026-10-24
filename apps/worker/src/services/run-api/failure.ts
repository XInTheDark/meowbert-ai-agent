import { RUN_API_ERROR_STATUS, type RunApiErrorCode } from "@meowbert/shared";

// An error the Run API reports to the executor with its code.
export class RunApiFailure extends Error {
  readonly status: number;

  constructor(
    readonly code: RunApiErrorCode,
    message: string,
    readonly currentLeafId: string | null = null
  ) {
    super(message);
    this.name = "RunApiFailure";
    this.status = RUN_API_ERROR_STATUS[code];
  }
}
