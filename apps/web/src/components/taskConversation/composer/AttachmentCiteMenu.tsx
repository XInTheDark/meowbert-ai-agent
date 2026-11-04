import { Quote } from "lucide-react";
import { useEffect } from "react";
import { FileContextMenu } from "../../files/FileContextMenu";

export function AttachmentCiteMenu(props: { x: number; y: number; onCite: () => void; onClose: () => void }): JSX.Element {
  const { onClose } = props;

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".context-menu")) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <FileContextMenu x={props.x} y={props.y} onClose={onClose}>
      <button
        type="button"
        className="context-menu-item btn ghost full"
        style={{ justifyContent: "flex-start", border: "none" }}
        // Keeps the caret where it is, since the citation goes in at the caret.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          props.onCite();
          onClose();
        }}
      >
        <Quote size={16} />
        Cite
      </button>
    </FileContextMenu>
  );
}
