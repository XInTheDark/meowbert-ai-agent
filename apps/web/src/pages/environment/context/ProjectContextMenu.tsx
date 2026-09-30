import type { ReactNode } from "react";
import { Download, Loader2, NotebookPen, RefreshCw, Trash2 } from "lucide-react";
import { FileContextMenu } from "../../../components/files/FileContextMenu";

interface ProjectContextMenuProps {
  contextMenu: { x: number; y: number; path: string | null } | null;
  selectedRelativePaths: string[];
  selectedPathSet: Set<string>;
  hasNoteForPath: boolean;
  isDownloading?: boolean;
  onDownload: (paths: string[]) => void;
  onEditNote: () => void;
  onDelete: (paths: string[]) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function MenuButton(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="context-menu-item"
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.8rem",
        textDecoration: "none",
        color: props.danger ? "var(--danger)" : "var(--text)",
        fontSize: "0.9rem",
        borderRadius: "0.3rem",
        width: "100%",
        border: "none",
        background: "transparent",
        opacity: props.disabled ? 0.6 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer"
      }}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

export function ProjectContextMenu(props: ProjectContextMenuProps) {
  if (!props.contextMenu) {
    return null;
  }

  const targetPath = props.contextMenu.path;
  const isMultiSelection = !!targetPath
    && props.selectedRelativePaths.length > 1
    && props.selectedPathSet.has(targetPath);

  return (
    <FileContextMenu x={props.contextMenu.x} y={props.contextMenu.y}>
      {targetPath ? (
        <>
          {isMultiSelection ? (
            <MenuButton
              icon={props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              label={props.isDownloading ? "Downloading selected..." : `Download selected (${props.selectedRelativePaths.length})`}
              disabled={props.isDownloading}
              onClick={() => {
                props.onDownload(props.selectedRelativePaths);
                props.onClose();
              }}
            />
          ) : null}
          <MenuButton
            icon={<NotebookPen size={16} />}
            label={props.hasNoteForPath ? "Edit note" : "Add note"}
            onClick={() => {
              props.onEditNote();
              props.onClose();
            }}
          />
          <MenuButton
            icon={props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            label={props.isDownloading ? "Downloading..." : "Download"}
            disabled={props.isDownloading}
            onClick={() => {
              props.onDownload([targetPath]);
              props.onClose();
            }}
          />
          <MenuButton
            icon={<Trash2 size={16} />}
            label={isMultiSelection ? `Remove selected (${props.selectedRelativePaths.length})` : "Remove from context"}
            onClick={() => {
              props.onDelete(isMultiSelection ? props.selectedRelativePaths : [targetPath]);
              props.onClose();
            }}
            danger
          />
        </>
      ) : (
        <MenuButton
          icon={<RefreshCw size={16} />}
          label="Refresh"
          onClick={() => {
            props.onRefresh();
            props.onClose();
          }}
        />
      )}
    </FileContextMenu>
  );
}
