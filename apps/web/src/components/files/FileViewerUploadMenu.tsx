import { ChevronDown, Loader2, Upload } from "lucide-react";

interface FileViewerUploadMenuProps {
  isOpen: boolean;
  isUploading: boolean;
  onToggle: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}

export function FileViewerUploadMenu(props: FileViewerUploadMenuProps) {
  return (
    <div className="topbar-dropdown" onClick={(event) => event.stopPropagation()}>
      <div style={{ display: "inline-flex", alignItems: "stretch" }}>
        <button
          className="btn primary"
          type="button"
          onClick={props.onUploadFiles}
          disabled={props.isUploading}
          title="Upload files"
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        >
          {props.isUploading ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
          Upload
        </button>
        <button
          className="btn primary"
          type="button"
          aria-label="More upload options"
          aria-haspopup="menu"
          aria-expanded={props.isOpen}
          disabled={props.isUploading}
          onClick={props.onToggle}
          title="More upload options"
          style={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            marginLeft: "-1px",
            paddingLeft: "0.72rem",
            paddingRight: "0.72rem",
            minWidth: "2.6rem"
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {props.isOpen ? (
        <div className="topbar-dropdown-menu">
          <button type="button" onClick={props.onUploadFolder} disabled={props.isUploading}>
            Upload folder
          </button>
        </div>
      ) : null}
    </div>
  );
}
