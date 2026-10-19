import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useWastedTurnsReport } from "./debug-tool/useWastedTurnsReport";
import { WastedTurnsReportView } from "./debug-tool/WastedTurnsReportView";
import "./debug-tool/debug-tool.css";

export function DebugToolTab() {
  const [target, setTarget] = useState("");
  const { report, loading, error, analyze } = useWastedTurnsReport();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (target.trim()) void analyze(target.trim());
  }

  return (
    <section className="debug-tool" aria-labelledby="debug-tool-title">
      <h2 id="debug-tool-title">Wasted turns</h2>
      <p className="muted-text">Turns where the model produced nothing usable and had to be asked again, with their weighted cost. Includes spawned agents.</p>
      <form className="debug-tool__form" onSubmit={submit}>
        <input
          type="text"
          value={target}
          placeholder="Task URL or id"
          aria-label="Task URL or id"
          onChange={(event) => setTarget(event.target.value)}
        />
        <button type="submit" className="btn primary icon-btn" aria-label="Analyze task" disabled={loading || !target.trim()}>
          <Search size={16} />
        </button>
      </form>
      {loading ? <p role="status">Analyzing…</p> : null}
      {error ? <p role="alert" className="error-text">{error}</p> : null}
      {report && !loading ? <WastedTurnsReportView report={report} /> : null}
    </section>
  );
}
