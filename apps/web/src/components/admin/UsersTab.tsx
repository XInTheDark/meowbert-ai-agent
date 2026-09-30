import { AdminUsersTabContent } from "./AdminUsersTabContent";
import { useAdminUsersTab } from "./useAdminUsersTab";

export function UsersTab() {
  const controller = useAdminUsersTab();
  return <AdminUsersTabContent controller={controller} />;
}
