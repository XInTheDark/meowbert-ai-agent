import { useEffect, useRef, useState, type FormEvent } from "react";

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
        placeholder="Add a note"
        rows={2}
      />
      <div className="selection-annotation-card-footer">
        <span className="selection-annotation-hint">Esc to cancel</span>
        <button
          type="submit"
          className="selection-annotation-action-btn save"
          disabled={!draft.trim()}
        >
          Add
        </button>
      </div>
    </form>
  );
}
