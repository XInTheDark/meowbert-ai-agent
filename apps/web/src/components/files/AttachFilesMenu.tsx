import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, FileText, FolderOpen, Link2, Loader2, Palette, Paperclip, Upload } from "lucide-react";
import { CompactMenuPortal } from "../CompactMenuPortal";
import {
  useChatToolsDropdownPlacement,
  type ChatToolsPopoverPlacement
} from "../tasks/useChatToolsDropdownPlacement";

interface AttachFilesMenuSourceAction {
  id: string;
  label: string;
  onSelect: () => void;
}

interface AttachFilesMenuProps {
  variant?: "icon" | "button";
  buttonLabel?: string;
  popoverPlacement?: ChatToolsPopoverPlacement;
  disabled?: boolean;
  isBusy?: boolean;
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  onUploadFolder?: (files: File[]) => void | Promise<void>;
  onCreateTextFile?: () => void;
  onOpenProjectFiles?: () => void;
  onOpenCanvases?: () => void;
  projectLabel?: string;
  sourceActions?: AttachFilesMenuSourceAction[];
}

function runAsyncAction(action: (() => void | Promise<void>) | undefined): void {
  if (!action) {
    return;
  }

  void Promise.resolve(action());
}

export function AttachFilesMenu(props: AttachFilesMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node
        && !menuRef.current.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const setFolderInputElement = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node;
    if (!node) {
      return;
    }

    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }, []);

  const canUploadFiles = typeof props.onUploadFiles === "function";
  const canUploadFolder = typeof props.onUploadFolder === "function";
  const canCreateTextFile = typeof props.onCreateTextFile === "function";
  const canOpenProject = typeof props.onOpenProjectFiles === "function";
  const canOpenCanvases = typeof props.onOpenCanvases === "function";
  const sourceActions = props.sourceActions ?? [];
  const hasActions = useMemo(
    () => canUploadFiles || canUploadFolder || canCreateTextFile || canOpenProject || canOpenCanvases || sourceActions.length > 0,
    [canCreateTextFile, canOpenCanvases, canOpenProject, canUploadFiles, canUploadFolder, sourceActions.length]
  );

  const triggerLabel = props.buttonLabel ?? "Attach files";
  const { popoverStyle, popoverClassName } = useChatToolsDropdownPlacement({
    triggerRef: menuRef,
    popoverRef,
    isOpen,
    placement: props.popoverPlacement,
    variant: props.variant
  });

  function closeMenu(): void {
    setIsOpen(false);
  }

  function handleFilesSelected(files: FileList | null, callback: AttachFilesMenuProps["onUploadFiles"] | AttachFilesMenuProps["onUploadFolder"]): void {
    const normalizedFiles = files ? Array.from(files) : [];
    if (normalizedFiles.length === 0 || !callback) {
      return;
    }

    closeMenu();
    void Promise.resolve(callback(normalizedFiles));
  }

  if (!hasActions) {
    return null;
  }

  return (
    <div ref={menuRef} className="chat-tools-menu">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          handleFilesSelected(event.target.files, props.onUploadFiles);
          event.target.value = "";
        }}
      />
      <input
        ref={setFolderInputElement}
        type="file"
        hidden
        multiple
        onChange={(event) => {
          handleFilesSelected(event.target.files, props.onUploadFolder);
          event.target.value = "";
        }}
      />

      {props.variant === "button" ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => setIsOpen((current) => !current)}
          disabled={props.disabled || props.isBusy}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          {props.isBusy ? <Loader2 className="spin" size={16} /> : <Paperclip size={16} />}
          {triggerLabel}
          <ChevronDown size={14} />
        </button>
      ) : (
        <button
          type="button"
          className={`icon-btn-subtle ${isOpen ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          title={triggerLabel}
          disabled={props.disabled || props.isBusy}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          {props.isBusy ? <Loader2 className="spin" size={18} /> : <Paperclip size={18} />}
        </button>
      )}

      {isOpen ? (
        <CompactMenuPortal>
          <div ref={popoverRef} className={`chat-tools-popover ${popoverClassName}`} role="menu" aria-label={triggerLabel} style={popoverStyle}>
            <div className="chat-tools-popover-scroll">
              {canUploadFiles ? (
                <button type="button" className="chat-tools-item" onClick={() => fileInputRef.current?.click()} role="menuitem">
                  <span className="chat-tools-item-label">
                    <Upload size={14} />
                    Upload file
                  </span>
                </button>
              ) : null}
              {canUploadFolder ? (
                <button type="button" className="chat-tools-item" onClick={() => folderInputRef.current?.click()} role="menuitem">
                  <span className="chat-tools-item-label">
                    <FolderOpen size={14} />
                    Upload folder
                  </span>
                </button>
              ) : null}
              {canCreateTextFile ? (
                <button
                  type="button"
                  className="chat-tools-item"
                  onClick={() => {
                    closeMenu();
                    runAsyncAction(props.onCreateTextFile);
                  }}
                  role="menuitem"
                >
                  <span className="chat-tools-item-label">
                    <FileText size={14} />
                    New text file
                  </span>
                </button>
              ) : null}
              {canOpenProject ? (
                <button
                  type="button"
                  className="chat-tools-item"
                  onClick={() => {
                    closeMenu();
                    runAsyncAction(props.onOpenProjectFiles);
                  }}
                  role="menuitem"
                >
                  <span className="chat-tools-item-label">
                    <FolderOpen size={14} />
                    {props.projectLabel ?? "From project"}
                  </span>
                </button>
              ) : null}
              {canOpenCanvases ? (
                <button
                  type="button"
                  className="chat-tools-item"
                  onClick={() => {
                    closeMenu();
                    runAsyncAction(props.onOpenCanvases);
                  }}
                  role="menuitem"
                >
                  <span className="chat-tools-item-label">
                    <Palette size={14} />
                    Canvases
                  </span>
                </button>
              ) : null}
              {sourceActions.length > 0 ? <div className="chat-tools-separator" /> : null}
              {sourceActions.length > 0 ? <div className="chat-tools-section-label">Sources</div> : null}
              {sourceActions.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="chat-tools-item"
                  onClick={() => {
                    closeMenu();
                    source.onSelect();
                  }}
                  role="menuitem"
                >
                  <span className="chat-tools-item-label">
                    <Link2 size={14} />
                    {source.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </CompactMenuPortal>
      ) : null}
    </div>
  );
}
