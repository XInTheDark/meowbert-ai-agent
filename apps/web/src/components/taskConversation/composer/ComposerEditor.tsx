import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $getSelection,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND
} from "lexical";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { $createCitationNode, $isCitationNode, CitationNode } from "./CitationNode";
import { citationTextToHtml, isTaskInputPath, parseCitationSegments, type Citation } from "./citationToken";
import {
  $buildContentNodes,
  $createCitationNodes,
  $getCitationNodes,
  $insertCitationNodes,
  $replaceContent,
  type DropPoint
} from "./composerEditorContent";

export interface ComposerEditorHandle {
  focus: () => void;
  insertCitations: (citations: Citation[], point?: DropPoint) => void;
  insertUploadingCitations: (labels: string[], point?: DropPoint) => string[];
  resolveUploadingCitation: (nodeKey: string, citation: Citation | null) => void;
  removeCitations: (path: string) => void;
}

interface ComposerEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  citablePaths: string[];
  onEnter: (event: KeyboardEvent) => boolean;
  onKeyDown: (event: KeyboardEvent) => boolean;
  onPasteFiles: (files: File[]) => void;
}

function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function useCitablePathCheck(citablePaths: string[]): (path: string) => boolean {
  const pathsRef = useLatest(citablePaths);
  return useCallback((path: string) => isTaskInputPath(path) || pathsRef.current.includes(path), [pathsRef]);
}

function ValueSyncPlugin(props: Pick<ComposerEditorProps, "value" | "onChange" | "disabled"> & { isCitablePath: (path: string) => boolean }): null {
  const [editor] = useLexicalComposerContext();
  const lastEmittedRef = useRef(props.value);
  const onChangeRef = useLatest(props.onChange);

  useEffect(() => editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
    if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
    const text = editorState.read(() => $getRoot().getTextContent());
    if (text === lastEmittedRef.current) return;
    lastEmittedRef.current = text;
    onChangeRef.current(text);
  }), [editor, onChangeRef]);

  // Runs at commit so a keystroke can't land between this value rendering and the comparison.
  useLayoutEffect(() => {
    if (props.value === lastEmittedRef.current) return;
    lastEmittedRef.current = props.value;
    editor.update(() => $replaceContent(props.value, props.isCitablePath), { discrete: true, tag: "history-merge" });
  }, [editor, props.isCitablePath, props.value]);

  useEffect(() => editor.setEditable(!props.disabled), [editor, props.disabled]);
  return null;
}

function ClipboardAndKeysPlugin(props: Pick<ComposerEditorProps, "onEnter" | "onKeyDown" | "onPasteFiles"> & { isCitablePath: (path: string) => boolean }): null {
  const [editor] = useLexicalComposerContext();
  const handlersRef = useLatest(props);

  useEffect(() => mergeRegister(
    editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (!event || !handlersRef.current.onEnter(event)) return false;
      event.preventDefault();
      return true;
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_DOWN_COMMAND, (event) => handlersRef.current.onKeyDown(event), COMMAND_PRIORITY_HIGH),
    editor.registerCommand(COPY_COMMAND, (event) => {
      const clipboardData = event && "clipboardData" in event ? event.clipboardData : null;
      const text = $getSelection()?.getTextContent();
      if (!event || !clipboardData || !text) return false;
      event.preventDefault();
      clipboardData.setData("text/plain", text);
      clipboardData.setData("text/html", citationTextToHtml(text, handlersRef.current.isCitablePath));
      return true;
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      const clipboardData = "clipboardData" in event ? event.clipboardData : null;
      if (!clipboardData) return false;
      if (clipboardData.files.length > 0) {
        event.preventDefault();
        handlersRef.current.onPasteFiles(Array.from(clipboardData.files));
        return true;
      }
      const text = clipboardData.getData("text/plain");
      const hasCitation = parseCitationSegments(text, handlersRef.current.isCitablePath).some((segment) => segment.kind === "citation");
      const selection = $getSelection();
      if (!hasCitation || !selection) return false;
      event.preventDefault();
      selection.insertNodes($buildContentNodes(text, handlersRef.current.isCitablePath));
      return true;
    }, COMMAND_PRIORITY_HIGH)
  ), [editor, handlersRef]);
  return null;
}

const EditorHandlePlugin = forwardRef<ComposerEditorHandle>(function EditorHandlePlugin(_props, ref) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(ref, () => ({
    focus() {
      // Focusing scrolls every scrollable ancestor to the input, which can move the conversation beside it.
      editor.getRootElement()?.focus({ preventScroll: true });
      editor.update(() => {
        if ($getSelection() === null) $getRoot().selectEnd();
      });
    },
    insertCitations(citations, point) {
      editor.update(() => $insertCitationNodes($createCitationNodes(citations), editor.getRootElement(), point));
    },
    insertUploadingCitations(labels, point) {
      const keys: string[] = [];
      editor.update(() => {
        const nodes = labels.map((label) => $createCitationNode(label, null));
        keys.push(...nodes.map((node) => node.getKey()));
        $insertCitationNodes(nodes, editor.getRootElement(), point);
      }, { discrete: true });
      return keys;
    },
    resolveUploadingCitation(nodeKey, citation) {
      editor.update(() => {
        const node = $getCitationNodes().find((candidate) => candidate.getKey() === nodeKey);
        if (!$isCitationNode(node)) return;
        if (citation) {
          node.resolve(citation);
          return;
        }
        const space = node.getNextSibling();
        if (space?.getTextContent() === " ") space.remove();
        node.remove();
      }, { discrete: true });
    },
    removeCitations(path) {
      editor.update(() => {
        $getCitationNodes().filter((node) => node.getPath() === path).forEach((node) => node.remove());
      });
    }
  }), [editor]);
  return null;
});

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor(props, ref) {
  const isCitablePath = useCitablePathCheck(props.citablePaths);
  const initialConfig = {
    namespace: "meowbert-composer",
    nodes: [CitationNode],
    editable: !props.disabled,
    onError: (error: Error) => console.error("Composer editor error", error),
    editorState: () => $replaceContent(props.value, isCitablePath)
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="chat-editor">
        <PlainTextPlugin
          contentEditable={<ContentEditable className="chat-textarea" aria-label={props.placeholder} />}
          placeholder={<div className="chat-editor-placeholder">{props.placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ValueSyncPlugin value={props.value} onChange={props.onChange} disabled={props.disabled} isCitablePath={isCitablePath} />
      <ClipboardAndKeysPlugin onEnter={props.onEnter} onKeyDown={props.onKeyDown} onPasteFiles={props.onPasteFiles} isCitablePath={isCitablePath} />
      <EditorHandlePlugin ref={ref} />
    </LexicalComposer>
  );
});
