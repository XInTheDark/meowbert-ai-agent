// Tells a task's agent when a user-role message was written by the Project Master rather than the user.
export function labelMessageSender(contentJson: Record<string, unknown>, text: string): string {
  return contentJson.sender === "project_master" ? `[Message from the project Master]\n${text}` : text;
}
