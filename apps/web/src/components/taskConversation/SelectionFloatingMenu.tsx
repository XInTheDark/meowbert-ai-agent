export function SelectionFloatingMenu(props: {
  onAnnotate: () => void;
  onQuote: () => void;
  onAskInThread: () => void;
}): JSX.Element {
  return (
    <div className="selection-floating-menu" role="toolbar" aria-label="Text selection actions">
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onAnnotate}
        aria-label="Annotate selected text"
      >
        Annotate
      </button>
      <span className="selection-floating-divider" aria-hidden="true" />
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onQuote}
        aria-label="Quote selected text"
      >
        Quote
      </button>
      <span className="selection-floating-divider" aria-hidden="true" />
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onAskInThread}
        aria-label="Ask in thread"
      >
        Ask in thread
      </button>
    </div>
  );
}
