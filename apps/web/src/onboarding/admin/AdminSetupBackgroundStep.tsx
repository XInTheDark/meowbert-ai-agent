export function AdminSetupBackgroundStep(props: {
  modelIds: string[];
  internalModel: string;
  fastModel: string | null;
  onInternalModelChange: (modelId: string) => void;
  onFastModelChange: (modelId: string | null) => void;
  onNext: () => void;
}) {
  return (
    <div className="stack-form">
      <label>
        Internal model
        <select value={props.internalModel} onChange={(event) => props.onInternalModelChange(event.target.value)}>
          {props.modelIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <span className="hint-text">Runs background work like routing connector messages to the right project. A fast, inexpensive model works well.</span>
      </label>
      <label>
        Fast model
        <select value={props.fastModel ?? ""} onChange={(event) => props.onFastModelChange(event.target.value || null)}>
          <option value="">Same as the task's model</option>
          {props.modelIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <span className="hint-text">Used for quick jobs inside a task, such as titles and summarizing long conversations.</span>
      </label>
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={props.onNext}>Continue</button>
      </div>
    </div>
  );
}
