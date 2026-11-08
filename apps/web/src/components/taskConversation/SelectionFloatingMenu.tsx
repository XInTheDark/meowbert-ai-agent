import { MessageSquarePlus, MessagesSquare, Quote } from "lucide-react";

export function SelectionFloatingMenu(props: {
  onAnnotate: () => void;
  onQuote: () => void;
  onAskInThread: () => void;
}): JSX.Element {
  return (
    <div className="selection-floating-menu" role="toolbar" aria-orientation="vertical" aria-label="Text selection actions">
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onAnnotate}
        aria-label="Annotate selected text"
        title="Annotate"
      >
        <MessageSquarePlus size={16} />
      </button>
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onQuote}
        aria-label="Quote selected text"
        title="Quote"
      >
        <Quote size={16} />
      </button>
      <button
        type="button"
        className="selection-floating-button"
        onClick={props.onAskInThread}
        aria-label="Ask in thread"
        title="Ask in thread"
      >
        <MessagesSquare size={16} />
      </button>
    </div>
  );
}
