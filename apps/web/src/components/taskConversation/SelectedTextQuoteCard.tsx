import { X } from "lucide-react";
import type { SelectedTextQuote } from "./selectedTextQuoteUtils";

export function SelectedTextQuoteCard(props: {
  quote: SelectedTextQuote;
  index?: number;
  className?: string;
  onRemove?: () => void;
  removeLabel?: string;
}): JSX.Element {
  const comment = props.quote.comment?.trim() ?? "";
  const excerpt = props.quote.text.trim();
  const tooltip = props.quote.location ? `${excerpt}\n\n${props.quote.location}` : excerpt;
  const removeLabel = props.removeLabel ?? (comment ? "Remove annotation" : "Remove quote");

  return (
    <figure
      className={["selected-text-quote", comment ? "has-comment" : "", props.className].filter(Boolean).join(" ")}
    >
      {typeof props.index === "number" ? (
        <span className="selected-text-quote-index" aria-hidden="true">{props.index}</span>
      ) : null}
      <div className="selected-text-quote-body">
        <blockquote title={tooltip}>{excerpt}</blockquote>
        {comment ? <p className="selected-text-quote-comment">{comment}</p> : null}
      </div>
      {props.onRemove ? (
        <button
          type="button"
          className="selected-text-quote-remove"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={props.onRemove}
        >
          <X size={14} />
        </button>
      ) : null}
    </figure>
  );
}
