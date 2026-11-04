import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey
} from "lexical";
import { FileText, Image, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

const IMAGE_FILE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i;

export function CitationIcon({ label, isUploading = false, isSkill = false }: { label: string; isUploading?: boolean; isSkill?: boolean }): JSX.Element {
  if (isSkill) return <Sparkles size={13} aria-hidden="true" />;
  if (isUploading) return <LoaderCircle size={13} className="spin-icon" aria-hidden="true" />;
  return IMAGE_FILE_NAME.test(label) ? <Image size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />;
}

export function CitationPill(props: { nodeKey: NodeKey; label: string; isUploading: boolean; isSkill: boolean }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(props.nodeKey);
  const pillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const removeIfSelected = (event: KeyboardEvent): boolean => {
      if (!isSelected) return false;
      event.preventDefault();
      $getNodeByKey(props.nodeKey)?.remove();
      return true;
    };
    return mergeRegister(
      editor.registerCommand(CLICK_COMMAND, (event) => {
        if (!pillRef.current?.contains(event.target as Node)) return false;
        if (!event.shiftKey) clearSelection();
        setSelected(true);
        return true;
      }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, removeIfSelected, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, removeIfSelected, COMMAND_PRIORITY_LOW)
    );
  }, [clearSelection, editor, isSelected, props.nodeKey, setSelected]);

  const className = [
    "citation-pill",
    isSelected ? "selected" : "",
    props.isUploading ? "uploading" : ""
  ].filter(Boolean).join(" ");

  return (
    <span ref={pillRef} className={className} title={props.label} aria-busy={props.isUploading || undefined}>
      <CitationIcon label={props.label} isUploading={props.isUploading} isSkill={props.isSkill} />
      <span className="citation-pill-label">{props.label}</span>
    </span>
  );
}
