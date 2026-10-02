import type { ApiClient } from "../../../lib/api";
import type { ProjectFileEntry, TaskAttachment } from "../../../lib/types";
import { CreateTextFileModal } from "../../../components/files/CreateTextFileModal";
import { SourceFilePickerModal } from "../../../components/modals/SourceFilePickerModal";
import type { WorkspaceSourceSummary } from "../../../sources/sourceTypes";
import { ProjectContextNoteModal } from "./ProjectContextNoteModal";

interface ProjectContextDialogsProps {
  api: ApiClient;
  workspaceId: string | null;
  projectId: string;
  contextPath: string;
  noteTargetEntry: ProjectFileEntry | null;
  isCreateTextFileOpen: boolean;
  selectedSource: WorkspaceSourceSummary | null;
  onCloseNote: () => void;
  onSaveNote: (relativePath: string, note: string | null) => Promise<void>;
  onCloseCreateTextFile: () => void;
  onCreateTextFile: (name: string, content: string) => Promise<void>;
  onCloseSource: () => void;
  onImportSourceAttachments: (attachments: TaskAttachment[]) => void;
}

export function ProjectContextDialogs(props: ProjectContextDialogsProps) {
  const noteTarget = props.noteTargetEntry;
  return (
    <>
      <ProjectContextNoteModal
        isOpen={!!noteTarget}
        targetLabel={noteTarget?.name ?? "context item"}
        initialValue={noteTarget?.note ?? ""}
        onClose={props.onCloseNote}
        onSubmit={async (note) => {
          if (noteTarget) await props.onSaveNote(noteTarget.relativePath, note);
        }}
      />
      <CreateTextFileModal
        isOpen={props.isCreateTextFileOpen}
        title="Create context text file"
        description="Create a text file directly inside project context so future tasks can use it immediately."
        submitLabel="Add to context"
        initialName="context-notes.txt"
        onClose={props.onCloseCreateTextFile}
        onSubmit={({ name, content }) => props.onCreateTextFile(name, content)}
      />
      <SourceFilePickerModal
        api={props.api}
        workspaceId={props.workspaceId}
        projectId={props.projectId}
        environmentId={props.projectId}
        source={props.selectedSource}
        isOpen={props.selectedSource !== null}
        onClose={props.onCloseSource}
        onSelect={props.onImportSourceAttachments}
        targetLabel="project context"
        destinationPath={props.contextPath}
        createDirectories
      />
    </>
  );
}
