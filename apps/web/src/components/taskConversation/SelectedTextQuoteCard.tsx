import { MessageSquare, X } from "lucide-react";
import type { SelectedTextQuote } from "./selectedTextQuoteUtils";
import { getSelectedTextQuotePreview } from "./selectedTextQuoteUtils";

export function SelectedTextQuoteCard(props: {
  quote: SelectedTextQuote;
  index?: number;
  className?: string;
  onRemove?: () => void;
  removeLabel?: string;
}): JSX.Element {
  const preview = getSelectedTextQuotePreview(props.quote.text);
  const hasComment = Boolean(props.quote.comment?.trim());

  if (hasComment) {
    return (
      <figure className={["selected-text-quote", "has-comment", props.className].filter(Boolean).join(" ")}>
        <div className="selected-text-annotation-header">
          <div className="selected-text-annotation-meta">
            {typeof props.index === "number" ? (
              <span className="selected-text-annotation-badge">{props.index}</span>
            ) : (
              <MessageSquare size={13} className="selected-text-annotation-icon" />
            )}
            <span className="selected-text-annotation-title">
              {typeof props.index === "number" ? `Annotation ${props.index}` : "Annotation"}
            </span>
          </div>
          {props.onRemove ? (
            <button
              type="button"
              className="selected-text-quote-remove"
              aria-label={props.removeLabel ?? "Remove annotation"}
              title={props.removeLabel ?? "Remove annotation"}
              onClick={props.onRemove}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="selected-text-annotation-body">
          <p className="selected-text-annotation-comment">{props.quote.comment}</p>
        </div>
        <div className="selected-text-annotation-excerpt">
          <blockquote title={props.quote.text}>{preview}</blockquote>
        </div>
        {props.quote.location ? <figcaption>{props.quote.location}</figcaption> : null}
      </figure>
    );
  }

  return (
    <figure className={["selected-text-quote", props.className].filter(Boolean).join(" ")}>
      <div className="selected-text-quote-main">
        <blockquote title={props.quote.text}>{preview}</blockquote>
        {props.onRemove ? (
          <button
            type="button"
            className="selected-text-quote-remove"
            aria-label={props.removeLabel ?? "Remove selected snippet"}
            title={props.removeLabel ?? "Remove selected snippet"}
            onClick={props.onRemove}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {props.quote.location ? <figcaption>{props.quote.location}</figcaption> : null}
    </figure>
  );
}


