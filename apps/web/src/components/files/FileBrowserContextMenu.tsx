import { Download, Loader2 } from "lucide-react";
import { FileContextMenu } from "./FileContextMenu";

interface FileBrowserContextMenuProps {
  contextMenu: { x: number; y: number; path: string | null } | null;
  selectedRelativePaths: string[];
  selectedPathSet: Set<string>;
  isDownloading: boolean;
  onDownload: (paths: string[]) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function FileBrowserContextMenu(props: FileBrowserContextMenuProps) {
  if (!props.contextMenu) {
    return null;
  }

  return (
    <FileContextMenu x={props.contextMenu.x} y={props.contextMenu.y}>
      {props.contextMenu.path ? (
        <>
          {props.selectedRelativePaths.length > 1 && props.selectedPathSet.has(props.contextMenu.path) ? (
            <button
              type="button"
              className="context-menu-item btn ghost full"
              disabled={props.isDownloading}
              onClick={() => {
                props.onDownload(props.selectedRelativePaths);
                props.onClose();
              }}
              style={{ justifyContent: "flex-start", border: "none" }}
            >
              {props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              Download selected ({props.selectedRelativePaths.length})
            </button>
          ) : null}
          <button
            type="button"
            className="context-menu-item"
            disabled={props.isDownloading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 0.8rem",
              textDecoration: "none",
              color: "var(--text)",
              fontSize: "0.9rem",
              borderRadius: "0.3rem",
              width: "100%",
              border: "none",
              background: "transparent"
            }}
            onClick={() => {
              if (props.contextMenu?.path) {
                props.onDownload([props.contextMenu.path]);
              }
              props.onClose();
            }}
          >
            {props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            Download
          </button>
        </>
      ) : (
        <button
          className="context-menu-item btn ghost full"
          onClick={() => {
            props.onRefresh();
            props.onClose();
          }}
          style={{ justifyContent: "flex-start", border: "none" }}
        >
          Refresh
        </button>
      )}
    </FileContextMenu>
  );
}
