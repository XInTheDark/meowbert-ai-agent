import type { MouseEvent, ReactNode } from "react";
import type { EnvironmentFileEntry } from "../../lib/types";
import { InlineProgressBar } from "../InlineProgressBar";
import { formatBytes, formatDateTime } from "../../lib/utils";
import {
  ExplorerBody,
  ExplorerCell,
  ExplorerCheckbox,
  ExplorerHeader,
  ExplorerRow,
  ExplorerSortButton,
  ExplorerTable
} from "../explorer/ExplorerTable";
import { getFileEntryIcon } from "./fileEntryIcons";

interface FileBrowserEntriesProps {
  isLoadingList: boolean;
  entries: EnvironmentFileEntry[];
  sortedEntries: EnvironmentFileEntry[];
  viewMode: "list" | "grid";
  selectedPaths: Set<string>;
  allEntriesSelected: boolean;
  onToggleSelectAll: () => void;
  onSortToggle: (column: "name" | "sizeBytes" | "kind" | "createdAt" | "modifiedAt") => void;
  renderSortIndicator: (column: "name" | "sizeBytes" | "kind" | "createdAt" | "modifiedAt") => ReactNode;
  onEntryClick: (entry: EnvironmentFileEntry, index: number, event: MouseEvent<HTMLDivElement>) => void;
  onEntryDoubleClick: (entry: EnvironmentFileEntry) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, entry?: EnvironmentFileEntry, index?: number) => void;
  onCheckboxClick: (entry: EnvironmentFileEntry, index: number, event: MouseEvent<HTMLInputElement>) => void;
}

export function FileBrowserEntries(props: FileBrowserEntriesProps) {
  const isEmpty = !props.isLoadingList && props.entries.length === 0;
  return (
    <div className="file-browser-area" onContextMenu={(event) => props.onContextMenu(event)}>
      {props.isLoadingList ? (
        <InlineProgressBar pin="top" />
      ) : null}

      {isEmpty ? (
        <div className="file-browser-empty">
          <div className="file-browser-empty-title">Folder is empty</div>
          <p className="empty-hint">Add files, docs, or notes to get started.</p>
        </div>
      ) : null}

      {!props.isLoadingList && !isEmpty && props.viewMode === "list" ? (
        <ExplorerTable className="file-list-table" columns="var(--file-list-columns)">
          <ExplorerHeader className="file-list-header">
            <ExplorerCell align="center">
              <ExplorerCheckbox
                checked={props.allEntriesSelected}
                onChange={props.onToggleSelectAll}
                ariaLabel="Select all files and directories"
              />
            </ExplorerCell>
            <ExplorerCell />
            <ExplorerCell>
              <ExplorerSortButton onClick={() => props.onSortToggle("name")} indicator={props.renderSortIndicator("name")}>
                Name
              </ExplorerSortButton>
            </ExplorerCell>
            <ExplorerCell>
              <ExplorerSortButton onClick={() => props.onSortToggle("sizeBytes")} indicator={props.renderSortIndicator("sizeBytes")}>
                Size
              </ExplorerSortButton>
            </ExplorerCell>
            <ExplorerCell>
              <ExplorerSortButton onClick={() => props.onSortToggle("kind")} indicator={props.renderSortIndicator("kind")}>
                Kind
              </ExplorerSortButton>
            </ExplorerCell>
            <ExplorerCell>
              <ExplorerSortButton onClick={() => props.onSortToggle("createdAt")} indicator={props.renderSortIndicator("createdAt")}>
                Created
              </ExplorerSortButton>
            </ExplorerCell>
            <ExplorerCell>
              <ExplorerSortButton onClick={() => props.onSortToggle("modifiedAt")} indicator={props.renderSortIndicator("modifiedAt")}>
                Modified
              </ExplorerSortButton>
            </ExplorerCell>
          </ExplorerHeader>
          <ExplorerBody>
            {props.sortedEntries.map((entry, index) => (
              <ExplorerRow
                key={entry.relativePath}
                className={`file-row file-list-row ${props.selectedPaths.has(entry.relativePath) ? "selected" : ""}`}
                title={entry.relativePath}
                onClick={(event) => props.onEntryClick(entry, index, event)}
                onDoubleClick={() => props.onEntryDoubleClick(entry)}
                onContextMenu={(event) => props.onContextMenu(event, entry, index)}
              >
                <ExplorerCell className="file-list-checkbox-cell" align="center">
                  <ExplorerCheckbox
                    checked={props.selectedPaths.has(entry.relativePath)}
                    ariaLabel={`Select ${entry.name}`}
                    onClick={(event) => props.onCheckboxClick(entry, index, event)}
                  />
                </ExplorerCell>
                <ExplorerCell className="file-list-icon-cell" align="center">{getFileEntryIcon(entry)}</ExplorerCell>
                <ExplorerCell className="file-entry-name">
                  <span className="file-entry-name-text">{entry.name}</span>
                  <span className="file-entry-badges">
                    {entry.note ? (
                      <span className="badge muted" title={entry.note}>
                        Note
                      </span>
                    ) : null}
                    {entry.liveSync ? (
                      <span className="badge muted" title={`Live synced with ${entry.liveSync.remoteName}`}>
                        Live
                      </span>
                    ) : null}
                  </span>
                </ExplorerCell>
                <ExplorerCell className="muted-text file-entry-meta">{entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : "--"}</ExplorerCell>
                <ExplorerCell className="muted-text file-entry-meta">{entry.kind}</ExplorerCell>
                <ExplorerCell className="muted-text file-entry-meta" title={entry.createdAt ?? undefined}>
                  {entry.createdAt ? formatDateTime(entry.createdAt) : "--"}
                </ExplorerCell>
                <ExplorerCell className="muted-text file-entry-meta" title={entry.modifiedAt ?? undefined}>
                  {entry.modifiedAt ? formatDateTime(entry.modifiedAt) : "--"}
                </ExplorerCell>
              </ExplorerRow>
            ))}
          </ExplorerBody>
        </ExplorerTable>
      ) : null}

      {!props.isLoadingList && !isEmpty && props.viewMode === "grid" ? (
        <div className="file-grid-browser">
          {props.sortedEntries.map((entry, index) => (
            <div
              key={entry.relativePath}
              className={`file-grid-item ${props.selectedPaths.has(entry.relativePath) ? "selected" : ""}`}
              onClick={(event) => props.onEntryClick(entry, index, event)}
              onDoubleClick={() => props.onEntryDoubleClick(entry)}
              onContextMenu={(event) => props.onContextMenu(event, entry, index)}
            >
              <input
                type="checkbox"
                checked={props.selectedPaths.has(entry.relativePath)}
                aria-label={`Select ${entry.name}`}
                onClick={(event) => props.onCheckboxClick(entry, index, event)}
                onChange={() => undefined}
                className="file-grid-item-checkbox"
              />
              <div className="file-grid-item-icon">{getFileEntryIcon(entry)}</div>
              <span className="file-grid-item-name">{entry.name}</span>
              <span className="file-grid-item-badges">
                {entry.note ? (
                  <span className="badge muted" title={entry.note}>Note</span>
                ) : null}
                {entry.liveSync ? (
                  <span className="badge muted" title={`Live synced with ${entry.liveSync.remoteName}`}>Live</span>
                ) : null}
              </span>
              <span className="muted-text file-grid-item-meta">
                {entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : entry.kind}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
