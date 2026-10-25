import type { DesktopLocalExecutionStatus } from "../../desktop/platform";

export function LocalSandboxStatus({ sandbox }: { sandbox: DesktopLocalExecutionStatus["sandbox"] }) {
  const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "Not recorded";
  return <dl className="desktop-sandbox-history">
    <div><dt>Installed sandbox</dt><dd>{sandbox?.image ? <code title={sandbox.image}>{sandbox.image}</code> : "Not recorded"}</dd></div>
    <div><dt>Last checked</dt><dd>{date(sandbox?.lastCheckedAt)}</dd></div>
    <div><dt>Last updated</dt><dd>{date(sandbox?.lastUpdatedAt)}</dd></div>
  </dl>;
}
