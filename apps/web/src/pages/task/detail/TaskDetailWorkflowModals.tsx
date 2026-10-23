import { useEffect, type Ref } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function WorkflowModalShell(props: {
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  wide?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  children: JSX.Element;
}): JSX.Element {
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  const modal = (
    <div className="workflow-modal-overlay" onClick={props.onClose}>
      <div
        className={`workflow-modal${props.wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-modal-header">
          <div style={{ minWidth: 0 }}>
            <h2>{props.title}</h2>
            {props.subtitle ? <p>{props.subtitle}</p> : null}
          </div>
          <button type="button" className="legal-close" onClick={props.onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div ref={props.bodyRef} className="workflow-modal-body">{props.children}</div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modal;
  }

  return createPortal(modal, document.body);
}

function WorkflowPreformattedText(props: { value: string | null | undefined; emptyLabel: string }): JSX.Element {
  if (!props.value || props.value.trim().length === 0) {
    return <div className="muted-text">{props.emptyLabel}</div>;
  }

  return (
    <pre className="workflow-modal-preformatted">
      {props.value}
    </pre>
  );
}

export function WorkflowTextModal(props: {
  title: string;
  subtitle?: string | null;
  content: string | null | undefined;
  emptyLabel: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <WorkflowModalShell title={props.title} subtitle={props.subtitle} onClose={props.onClose}>
      <WorkflowPreformattedText value={props.content} emptyLabel={props.emptyLabel} />
    </WorkflowModalShell>
  );
}
