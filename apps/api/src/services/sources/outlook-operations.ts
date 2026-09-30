import { getSourceOutlookProviderClient } from "./provider-clients.js";
import { getSourceCatalogEntry } from "./source-catalog.js";
import { resolveWorkspaceSourceAccess } from "./source-access.js";
import type {
  SourceBodyContentType,
  SourceCalendarListResult,
  SourceCalendarSearchResult,
  SourceCalendarViewResult,
  SourceEventCreateInput,
  SourceEventDetail,
  SourceEventUpdateInput,
  SourceMessageDetail,
  SourceMessageSearchResult
} from "./source-outlook-types.js";

function requireOutlookSourceCatalogEntry(sourceId: string) {
  const entry = getSourceCatalogEntry(sourceId);
  if (!entry) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  if (entry.provider !== "outlook") {
    throw new Error(`Source ${sourceId} does not expose Outlook mail/calendar operations.`);
  }
  return entry;
}

async function resolveOutlookSource(input: { workspaceId: string; sourceId: string }) {
  const sourceEntry = requireOutlookSourceCatalogEntry(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: sourceEntry.provider
  });
  return {
    sourceEntry,
    access,
    client: getSourceOutlookProviderClient(sourceEntry.provider)
  };
}

function hasAttendees(event: { attendees: unknown[] }): boolean {
  return event.attendees.length > 0;
}

function requireAttendeeMutationConfirmation(input: {
  hasAttendees: boolean;
  confirmed: boolean | null | undefined;
  action: "create" | "update" | "delete";
}): void {
  if (!input.hasAttendees || input.confirmed === true) {
    return;
  }

  if (input.action === "delete") {
    throw new Error(
      "This meeting has attendees. Retrying with confirmAttendeeCancellation=true acknowledges that Outlook will send cancellation notices."
    );
  }

  throw new Error(
    "This meeting has attendees. Retrying with confirmAttendeeNotifications=true acknowledges that Outlook may send meeting updates or invites."
  );
}

function requireLatestChangeKey(currentChangeKey: string | null, expectedChangeKey: string): void {
  if (!currentChangeKey || currentChangeKey !== expectedChangeKey) {
    throw new Error("This Outlook event changed since it was last read. Reload the event and retry with the latest changeKey.");
  }
}

function requireSafeOnlineMeetingBodyEdit(input: {
  currentIsOnlineMeeting: boolean | null | undefined;
  nextBody: SourceEventUpdateInput["body"] | undefined;
}): void {
  if (!input.nextBody || input.currentIsOnlineMeeting !== true) {
    return;
  }

  throw new Error(
    "Editing the body of an online meeting is blocked for safety because Outlook can disable the meeting join blob. Update other fields here, or edit the body directly in Outlook."
  );
}

export async function searchWorkspaceOutlookMessages(input: {
  workspaceId: string;
  sourceId: string;
  query: string;
  limit?: number;
}): Promise<SourceMessageSearchResult> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  return client.searchMessages({
    accessToken: access.accessToken,
    query: input.query,
    limit: input.limit
  });
}

export async function readWorkspaceOutlookMessage(input: {
  workspaceId: string;
  sourceId: string;
  messageId: string;
  bodyFormat?: SourceBodyContentType | null;
}): Promise<SourceMessageDetail> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  return client.getMessage({
    accessToken: access.accessToken,
    messageId: input.messageId,
    bodyFormat: input.bodyFormat ?? "text"
  });
}

export async function listWorkspaceOutlookCalendars(input: {
  workspaceId: string;
  sourceId: string;
  limit?: number;
}): Promise<SourceCalendarListResult> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  return client.listCalendars({
    accessToken: access.accessToken,
    limit: input.limit
  });
}

export async function searchWorkspaceOutlookCalendarEvents(input: {
  workspaceId: string;
  sourceId: string;
  query: string;
  calendarId?: string | null;
  limit?: number;
}): Promise<SourceCalendarSearchResult> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  if (input.calendarId) {
    const calendars = await client.listCalendars({
      accessToken: access.accessToken,
      limit: 200
    });
    if (calendars.defaultCalendarId && calendars.defaultCalendarId !== input.calendarId) {
      throw new Error(
        "Outlook keyword search is only supported on the connected account's primary calendar. Use calendar view for other calendars."
      );
    }
  }

  return client.searchCalendarEvents({
    accessToken: access.accessToken,
    query: input.query,
    limit: input.limit
  });
}

export async function viewWorkspaceOutlookCalendar(input: {
  workspaceId: string;
  sourceId: string;
  calendarId?: string | null;
  startDateTime: string;
  endDateTime: string;
  timezone?: string | null;
  limit?: number;
}): Promise<SourceCalendarViewResult> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  return client.viewCalendar({
    accessToken: access.accessToken,
    calendarId: input.calendarId ?? null,
    startDateTime: input.startDateTime,
    endDateTime: input.endDateTime,
    timezone: input.timezone ?? null,
    limit: input.limit
  });
}

export async function readWorkspaceOutlookCalendarEvent(input: {
  workspaceId: string;
  sourceId: string;
  eventId: string;
  calendarId?: string | null;
  timezone?: string | null;
  bodyFormat?: SourceBodyContentType | null;
}): Promise<SourceEventDetail> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  return client.getCalendarEvent({
    accessToken: access.accessToken,
    calendarId: input.calendarId ?? null,
    eventId: input.eventId,
    timezone: input.timezone ?? null,
    bodyFormat: input.bodyFormat ?? "text"
  });
}

export async function createWorkspaceOutlookCalendarEvent(input: {
  workspaceId: string;
  sourceId: string;
  timezone?: string | null;
  bodyFormat?: SourceBodyContentType | null;
  event: SourceEventCreateInput;
}): Promise<SourceEventDetail> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  requireAttendeeMutationConfirmation({
    hasAttendees: Array.isArray(input.event.attendees) && input.event.attendees.length > 0,
    confirmed: input.event.confirmAttendeeNotifications,
    action: "create"
  });

  return client.createCalendarEvent({
    accessToken: access.accessToken,
    timezone: input.timezone ?? null,
    bodyFormat: input.bodyFormat ?? "text",
    event: input.event
  });
}

export async function updateWorkspaceOutlookCalendarEvent(input: {
  workspaceId: string;
  sourceId: string;
  eventId: string;
  timezone?: string | null;
  bodyFormat?: SourceBodyContentType | null;
  event: SourceEventUpdateInput;
}): Promise<SourceEventDetail> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  const current = await client.getCalendarEvent({
    accessToken: access.accessToken,
    calendarId: input.event.calendarId ?? null,
    eventId: input.eventId,
    timezone: input.timezone ?? null,
    bodyFormat: "text"
  });

  requireLatestChangeKey(current.changeKey, input.event.expectedChangeKey);
  requireSafeOnlineMeetingBodyEdit({
    currentIsOnlineMeeting: current.isOnlineMeeting,
    nextBody: input.event.body
  });
  requireAttendeeMutationConfirmation({
    hasAttendees: hasAttendees(current) || (Array.isArray(input.event.attendees) && input.event.attendees.length > 0),
    confirmed: input.event.confirmAttendeeNotifications,
    action: "update"
  });

  return client.updateCalendarEvent({
    accessToken: access.accessToken,
    eventId: input.eventId,
    timezone: input.timezone ?? null,
    bodyFormat: input.bodyFormat ?? "text",
    event: input.event
  });
}

export async function deleteWorkspaceOutlookCalendarEvent(input: {
  workspaceId: string;
  sourceId: string;
  eventId: string;
  calendarId?: string | null;
  expectedChangeKey: string;
  confirmAttendeeCancellation?: boolean | null;
}): Promise<{ ok: true }> {
  const { access, client } = await resolveOutlookSource({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });

  const current = await client.getCalendarEvent({
    accessToken: access.accessToken,
    calendarId: input.calendarId ?? null,
    eventId: input.eventId,
    bodyFormat: "text"
  });

  requireLatestChangeKey(current.changeKey, input.expectedChangeKey);
  requireAttendeeMutationConfirmation({
    hasAttendees: hasAttendees(current),
    confirmed: input.confirmAttendeeCancellation,
    action: "delete"
  });

  await client.deleteCalendarEvent({
    accessToken: access.accessToken,
    calendarId: input.calendarId ?? null,
    eventId: input.eventId
  });

  return { ok: true };
}
