import { Folder, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Environment } from "../../lib/types";
import { SidebarMenu } from "./SidebarMenu";
import { SidebarNavItem } from "./SidebarNavItem";

export function SidebarNewTask(props: {
  projectId: string | null;
  workspaceId: string | null;
  projects: Environment[];
  isRail: boolean;
  onNavigate: () => void;
}) {
  const base = `/app/${props.workspaceId}/projects`;
  if (props.projectId) {
    return <SidebarNavItem item={{ to: `${base}/${props.projectId}/tasks/new`, icon: Plus,
      label: "New Task", extraClassName: "sidebar-new-task-link" }}
      collapsed={props.isRail} onNavigate={props.onNavigate} />;
  }
  return (
    <SidebarMenu label="New Task" triggerClassName="sidebar-new-task-link"
      trigger={<><Plus size={18} />{props.isRail ? null : <span>New Task</span>}</>}>
      {(close) => (
        <>
          <div className="sidebar-menu-header"><strong>Choose a project</strong></div>
          {props.projects.filter((project) => project.status !== "archived").map((project) => (
            <Link key={project.id} className="sidebar-menu-item" role="menuitem"
              to={`${base}/${project.id}/tasks/new`} onClick={() => { close(); props.onNavigate(); }}>
              <Folder size={15} /><span>{project.name}</span>
            </Link>
          ))}
          <Link className="sidebar-menu-item" role="menuitem" to={base}
            onClick={() => { close(); props.onNavigate(); }}>
            <Plus size={15} /><span>Create or manage projects</span>
          </Link>
        </>
      )}
    </SidebarMenu>
  );
}
