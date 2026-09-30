import { TaskParametersDropdownContent } from "./TaskParametersDropdownContent";
import {
  useTaskParametersDropdown,
  type TaskParametersDropdownProps
} from "./taskParametersDropdownController";

export function TaskParametersDropdown(props: TaskParametersDropdownProps) {
  const controller = useTaskParametersDropdown(props);
  if (typeof props.onChange !== "function") return null;
  return <TaskParametersDropdownContent controller={controller} />;
}
