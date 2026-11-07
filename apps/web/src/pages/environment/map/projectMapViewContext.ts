import type { ProjectMapDialog } from "./ProjectMapDialogs";
import type { ProjectMapModel } from "./projectMapModel";
import type { ProjectMapDrag } from "./useProjectMapDrag";
import type { ProjectMapSelection } from "./useProjectMapSelection";

// What every part of the map view needs, passed down as one prop.
export interface ProjectMapViewContext {
  model: ProjectMapModel;
  selection: ProjectMapSelection;
  drag: ProjectMapDrag;
  openDialog: (dialog: ProjectMapDialog) => void;
  deleteFolder: (folderId: string, name: string) => void;
  deleteCard: (cardId: string) => void;
  taskHref: (taskId: string) => string;
}
