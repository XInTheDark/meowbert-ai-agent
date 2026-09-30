import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, FileText, Folder, Search } from "lucide-react";
import type { SourceFileEntry } from "../../sources/sourceTypes";

export interface SourceBreadcrumbItem {
  id?: string | null;
  name: string;
}

export interface SourceFilePickerPathRibbonProps {
  sourceName: string;
  mode: "browse" | "search";
  breadcrumbs: SourceBreadcrumbItem[];
  selectedEntry: SourceFileEntry | null;
  selectedCount: number;
  searchQuery?: string;
  onNavigateToFolder: (folderId: string | null, breadcrumbIndex?: number) => void;
}

export interface PathRibbonSegment {
  name: string;
  folderId?: string | null;
  isClickable: boolean;
  isLast: boolean;
}

export function buildRibbonSegments(
  sourceName: string,
  mode: "browse" | "search",
  breadcrumbs: SourceBreadcrumbItem[],
  selectedEntry: SourceFileEntry | null,
  searchQuery?: string
): { segments: PathRibbonSegment[]; icon: "folder" | "file" | "search" } {
  if (selectedEntry) {
    return buildSelectedEntrySegments(mode, breadcrumbs, selectedEntry);
  }

  if (mode === "search") {
    const rootName = breadcrumbs[0]?.name || sourceName;
    const queryLabel = searchQuery?.trim() ? `Search: "${searchQuery.trim()}"` : "Search results";
    return {
      icon: "search",
      segments: [
        { name: rootName, folderId: null, isClickable: true, isLast: false },
        { name: queryLabel, isClickable: false, isLast: true }
      ]
    };
  }

  const effectiveBreadcrumbs = breadcrumbs.length > 0
    ? breadcrumbs
    : [{ id: null, name: sourceName }];

  return {
    icon: "folder",
    segments: effectiveBreadcrumbs.map((crumb, index) => ({
      name: crumb.name,
      folderId: crumb.id,
      isClickable: crumb.id !== undefined && index < effectiveBreadcrumbs.length - 1,
      isLast: index === effectiveBreadcrumbs.length - 1
    }))
  };
}

function buildSelectedEntrySegments(
  mode: "browse" | "search",
  breadcrumbs: SourceBreadcrumbItem[],
  selectedEntry: SourceFileEntry
): { segments: PathRibbonSegment[]; icon: "folder" | "file" } {
  const icon = selectedEntry.kind === "folder" ? "folder" : "file";
  const displayPath = selectedEntry.displayPath?.trim();

  if (mode === "search" && displayPath) {
    const parts = displayPath.split("/").map((part) => part.trim()).filter(Boolean);
    return {
      icon,
      segments: parts.map((part, index) => ({
        name: part,
        isClickable: false,
        isLast: index === parts.length - 1
      }))
    };
  }

  const ancestors = (mode === "browse" ? breadcrumbs : [{ name: "Location unavailable" }]).map((crumb: SourceBreadcrumbItem) => ({
    name: crumb.name,
    folderId: crumb.id,
    isClickable: crumb.id !== undefined,
    isLast: false
  }));

  return {
    icon,
    segments: [
      ...ancestors,
      { name: selectedEntry.name, isClickable: false, isLast: true }
    ]
  };
}

export function SourceFilePickerPathRibbon(props: SourceFilePickerPathRibbonProps) {
  const [copied, setCopied] = useState(false);

  const { segments, icon } = useMemo(
    () => buildRibbonSegments(
      props.sourceName,
      props.mode,
      props.breadcrumbs,
      props.selectedEntry,
      props.searchQuery
    ),
    [props.breadcrumbs, props.mode, props.searchQuery, props.selectedEntry, props.sourceName]
  );

  const fullPathText = useMemo(
    () => props.mode === "search" && props.selectedEntry && !props.selectedEntry.displayPath
      ? ""
      : segments.map((segment) => segment.name).join("/"),
    [props.mode, props.selectedEntry, segments]
  );

  const handleCopy = useCallback(async () => {
    if (!fullPathText) return;
    try {
      await navigator.clipboard.writeText(fullPathText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures in unsupported browser contexts
    }
  }, [fullPathText]);

  const renderIcon = (): ReactNode => {
    if (icon === "file") return <FileText size={14} />;
    if (icon === "search") return <Search size={14} />;
    return <Folder size={14} />;
  };

  return (
    <div className="source-file-picker-ribbon" role="region" aria-label="Path ribbon">
      <div className="source-file-picker-ribbon-content">
        <span className="source-file-picker-ribbon-icon" aria-hidden="true">
          {renderIcon()}
        </span>
        <nav className="source-file-picker-ribbon-path" aria-label="Breadcrumb path">
          {segments.map((segment, index) => (
            <span key={`${segment.name}-${index}`} className="source-file-picker-ribbon-item">
              {index > 0 ? (
                <ChevronRight size={13} className="source-file-picker-ribbon-separator" aria-hidden="true" />
              ) : null}
              {segment.isClickable ? (
                <button
                  type="button"
                  className="source-file-picker-ribbon-link"
                  onClick={() => props.onNavigateToFolder(segment.folderId ?? null, index)}
                  title={`Navigate to ${segment.name}`}
                >
                  {segment.name}
                </button>
              ) : (
                <span
                  className={`source-file-picker-ribbon-segment${segment.isLast ? " current" : ""}`}
                  title={segment.name}
                >
                  {segment.name}
                </span>
              )}
            </span>
          ))}
          {props.selectedCount > 1 ? (
            <span className="badge muted source-file-picker-ribbon-badge">
              {props.selectedCount} selected
            </span>
          ) : null}
        </nav>
      </div>
      {fullPathText ? (
        <button
          type="button"
          className="btn ghost icon-btn source-file-picker-ribbon-copy"
          onClick={() => void handleCopy()}
          title={copied ? "Copied!" : "Copy path"}
          aria-label={copied ? "Path copied to clipboard" : "Copy path to clipboard"}
        >
          {copied ? <Check size={14} className="success-text" /> : <Copy size={14} />}
        </button>
      ) : null}
    </div>
  );
}
