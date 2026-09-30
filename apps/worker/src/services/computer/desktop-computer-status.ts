interface DesktopComputerStatusLike {
  available?: boolean;
  reason?: string | null;
}

export function buildDesktopComputerUnavailableMessage(status: DesktopComputerStatusLike | null | undefined): string {
  const reason = status?.reason ?? "The desktop app may be offline or missing required permissions.";
  const prefix = status?.available === true
    ? "Computer use was requested, and a Meowbert Desktop executor is connected, but it is not ready yet."
    : "Computer use was requested, but no ready Meowbert Desktop executor is connected.";

  return `${prefix} ${reason}`;
}
