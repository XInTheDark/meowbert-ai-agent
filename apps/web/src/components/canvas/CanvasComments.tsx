import { Check, RotateCcw } from "lucide-react";
import type { CanvasComment } from "@meowbert/shared";

export function CanvasComments(props: {
  items: CanvasComment[];
  pending: boolean;
  error: string;
  onResolve: (id: string, resolved: boolean) => void;
  onAsk?: (comment: CanvasComment) => void;
}) {
  return <div className="canvas-comments" aria-label="Canvas comments" aria-busy={props.pending}>
    {props.error ? <p role="alert" className="error-text">{props.error}</p> : null}
    {!props.items.length && !props.pending && !props.error ? <p className="muted-text">Select an element to leave a comment.</p> : null}
    {props.items.map((comment) => <article key={comment.id} className={comment.resolved ? "is-resolved" : ""}>
      <div>
        <small title={comment.element.selector}>{comment.element.screenLabel || comment.element.text.slice(0, 60) || comment.element.tagName}</small>
        <p>{comment.body}</p>
      </div>
      {props.onAsk ? <button className="btn" type="button" onClick={() => props.onAsk?.(comment)}>Ask Meowbert</button> : null}
      <button className="icon-btn" type="button" disabled={props.pending} aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"}
        onClick={() => props.onResolve(comment.id, !comment.resolved)}>
        {comment.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
      </button>
    </article>)}
  </div>;
}
