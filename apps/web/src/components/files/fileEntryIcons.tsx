import { File, FileCode, FileText, Folder, Image as ImageIcon } from "lucide-react";
import type { EnvironmentFileEntry } from "../../lib/types";

export function getFileEntryIcon(entry: EnvironmentFileEntry) {
  if (entry.kind === "directory") {
    return <Folder size={20} fill="currentColor" className="text-blue-400" style={{ color: "var(--brand)" }} />;
  }

  const ext = entry.name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext || "")) {
    return <ImageIcon size={20} />;
  }
  if (["ts", "tsx", "js", "jsx", "json", "html", "css", "py", "go", "rs", "c", "cpp"].includes(ext || "")) {
    return <FileCode size={20} />;
  }
  if (["md", "txt", "log"].includes(ext || "")) {
    return <FileText size={20} />;
  }

  return <File size={20} />;
}
