import { ArrowUp, Check, MessageSquarePlus, RotateCcw, X } from "lucide-react";
import type { CanvasComment } from "@meowbert/shared";

function commentTarget(comment: CanvasComment): string {
  const { element } = comment;
  return element.screenLabel || element.attributes["aria-label"] || element.text.slice(0, 60) || `<${element.tagName}>`;
}

function CanvasCommentItem(props: {
  comment: CanvasComment;
  pending: boolean;
  onResolve: (id: string, resolved: boolean) => void;
  onAsk?: (comment: CanvasComment) => void;
}) {
  const { comment } = props;
  return (
    <li className={`canvas-comment${comment.resolved ? " is-resolved" : ""}`}>
      <div className="canvas-comment-content">
        <span className="canvas-comment-target" title={comment.element.selector}>{commentTarget(comment)}</span>
        <p>{comment.body}</p>
      </div>
      <div className="canvas-comment-actions">
        {props.onAsk && !comment.resolved ? (
          <button className="icon-btn" type="button" title="Ask Meowbert" aria-label="Ask Meowbert" onClick={() => props.onAsk?.(comment)}>
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        ) : null}
        <button className="icon-btn" type="button" disabled={props.pending} title={comment.resolved ? "Reopen" : "Resolve"}
          aria-label={comment.resolved ? "Reopen comment" : "Resolve comment"} onClick={() => props.onResolve(comment.id, !comment.resolved)}>
          {comment.resolved ? <RotateCcw size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        </button>
      </div>
    </li>
  );
}

/** Saved comments for the page in the canvas panel, with the entry point for adding one. */
export function CanvasComments(props: {
  items: CanvasComment[];
  pending: boolean;
  error: string;
  adding: boolean;
  onAdd: () => void;
  onClose: () => void;
  onResolve: (id: string, resolved: boolean) => void;
  onAsk?: (comment: CanvasComment) => void;
}) {
  const open = props.items.filter((comment) => !comment.resolved);
  const ordered = [...open, ...props.items.filter((comment) => comment.resolved)];
  return (
    <section className="canvas-comments" aria-label="Canvas comments" aria-busy={props.pending}>
      <header className="canvas-comments-header">
        <strong>Comments{open.length ? <span className="canvas-comments-count">{open.length}</span> : null}</strong>
        <button type="button" className={`icon-btn${props.adding ? " active" : ""}`} onClick={props.onAdd}
          title="Add comment" aria-label="Add comment" aria-pressed={props.adding}>
          <MessageSquarePlus size={14} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" onClick={props.onClose} title="Hide comments" aria-label="Hide comments">
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      {props.error ? <p role="alert" className="error-text">{props.error}</p> : null}
      {!props.items.length && !props.pending && !props.error ? (
        <button type="button" className="canvas-comments-empty" onClick={props.onAdd} disabled={props.adding}>
          <MessageSquarePlus size={16} aria-hidden="true" />
          {props.adding ? "Click an element on the canvas" : "Select an element to leave a comment"}
        </button>
      ) : null}
      {ordered.length ? (
        <ul>
          {ordered.map((comment) => <CanvasCommentItem key={comment.id} comment={comment} pending={props.pending}
            onResolve={props.onResolve} onAsk={props.onAsk} />)}
        </ul>
      ) : null}
    </section>
  );
}
