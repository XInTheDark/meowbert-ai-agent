import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";

export function SelectionAnnotationCard(props: {
  onSave: (comment: string) => void;
  onDiscard: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (event?: FormEvent): void => {
    event?.preventDefault();
    if (draft.trim()) {
      props.onSave(draft.trim());
    }
  };

  return (
    <form className="selection-annotation-card" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onDiscard();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Add an annotation..."
        rows={2}
      />
      <div className="selection-annotation-card-footer">
        <button
          type="button"
          className="selection-annotation-action-btn discard"
          aria-label="Discard annotation"
          title="Discard"
          onClick={props.onDiscard}
        >
          <Trash2 size={14} />
        </button>
        <div className="selection-annotation-card-footer-right">
          <button
            type="button"
            className="selection-annotation-action-btn cancel"
            onClick={props.onDiscard}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="selection-annotation-action-btn save"
            disabled={!draft.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </form>
  );
}
