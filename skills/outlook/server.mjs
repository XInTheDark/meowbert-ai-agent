import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createOutlookCalendarEvent,
  deleteOutlookCalendarEvent,
  listOutlookCalendars,
  readOutlookCalendarEvent,
  readOutlookEmail,
  searchOutlookCalendarEvents,
  searchOutlookEmails,
  updateOutlookCalendarEvent,
  viewOutlookCalendar
} from "../shared/source-proxy-client.mjs";

const server = new McpServer({
  name: "outlook-source",
  version: "1.0.0"
});

const bodyFormatSchema = z.enum(["text", "html"]).nullable().optional();
const dateTimeTimeZoneSchema = z.object({
  dateTime: z.string().min(1).describe("ISO 8601 local date-time, e.g. 2026-04-10T09:00:00."),
  timeZone: z.string().min(1).nullable().optional().describe("Windows time zone name, e.g. Singapore Standard Time.")
});
const attendeeSchema = z.object({
  emailAddress: z.object({
    address: z.string().min(3),
    name: z.string().min(1).nullable().optional()
  }),
  type: z.enum(["required", "optional", "resource"]).nullable().optional()
});
const bodySchema = z.object({
  content: z.string().min(1),
  contentType: z.enum(["text", "html"]).nullable().optional()
});
const recurrenceSchema = z.object({
  pattern: z.record(z.unknown()).describe("Microsoft Graph recurrence pattern, e.g. {type: \"weekly\", interval: 1, daysOfWeek: [\"monday\"]}."),
  range: z.record(z.unknown()).describe("Microsoft Graph recurrence range, e.g. {type: \"endDate\", startDate: \"2026-04-10\", endDate: \"2026-06-10\"}.")
});
const eventFieldShape = {
  body: bodySchema.nullable().optional(),
  isAllDay: z.boolean().nullable().optional(),
  location: z.object({ displayName: z.string().min(1) }).nullable().optional(),
  attendees: z.array(attendeeSchema).max(500).nullable().optional().describe("Outlook may send invites, so confirmAttendeeNotifications must be true."),
  isReminderOn: z.boolean().nullable().optional(),
  reminderMinutesBeforeStart: z.number().int().min(0).max(40320).nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
  confirmAttendeeNotifications: z.boolean().nullable().optional().describe("Must be true when attendees are involved.")
};
const createEventSchema = z.object({
  calendarId: z.string().min(1).nullable().optional().describe("Omit for the default calendar."),
  subject: z.string().min(1),
  start: dateTimeTimeZoneSchema,
  end: dateTimeTimeZoneSchema,
  isOnlineMeeting: z.boolean().nullable().optional(),
  ...eventFieldShape
});
const updateEventSchema = z.object({
  calendarId: z.string().min(1).nullable().optional().describe("Omit for the default calendar."),
  expectedChangeKey: z.string().min(1).describe("Latest changeKey from read_outlook_calendar_event."),
  subject: z.string().min(1).nullable().optional(),
  start: dateTimeTimeZoneSchema.nullable().optional(),
  end: dateTimeTimeZoneSchema.nullable().optional(),
  ...eventFieldShape
});

server.tool(
  "search_outlook_emails",
  "Search the connected Outlook mailbox for matching emails.",
  {
    query: z.string().min(1).describe("Search query. Outlook message search supports general text and Outlook-style search terms."),
    limit: z.number().int().min(1).max(200).nullable().optional().describe("Maximum number of email matches to return.")
  },
  async ({ query, limit }) => searchOutlookEmails({ query, limit: limit ?? undefined })
);

server.tool(
  "read_outlook_email",
  "Read a specific Outlook email by message ID.",
  {
    message_id: z.string().min(1).describe("Outlook message ID from search_outlook_emails."),
    body_format: bodyFormatSchema.describe("Whether to return the body as plain text or HTML. Text is safer for analysis.")
  },
  async ({ message_id, body_format }) => readOutlookEmail({
    messageId: message_id,
    bodyFormat: body_format ?? undefined
  })
);

server.tool(
  "list_outlook_calendars",
  "List calendars available to the connected Outlook account.",
  {
    limit: z.number().int().min(1).max(200).nullable().optional().describe("Maximum number of calendars to return.")
  },
  async ({ limit }) => listOutlookCalendars({ limit: limit ?? undefined })
);

server.tool(
  "search_outlook_calendar_events",
  "Keyword-search the connected account's primary Outlook calendar for events.",
  {
    query: z.string().min(1).describe("Search query for calendar events."),
    calendar_id: z.string().min(1).nullable().optional().describe("Optional calendar ID. Only the primary calendar supports keyword search."),
    limit: z.number().int().min(1).max(100).nullable().optional().describe("Maximum number of event matches to return.")
  },
  async ({ query, calendar_id, limit }) => searchOutlookCalendarEvents({
    query,
    calendarId: calendar_id ?? undefined,
    limit: limit ?? undefined
  })
);

server.tool(
  "view_outlook_calendar",
  "View a calendar's events within a time range.",
  {
    calendar_id: z.string().min(1).nullable().optional().describe("Optional calendar ID. Omit to use the default calendar."),
    start_datetime: z.string().min(1).describe("Inclusive range start in ISO 8601 with timezone offset when possible."),
    end_datetime: z.string().min(1).describe("Exclusive range end in ISO 8601 with timezone offset when possible."),
    timezone: z.string().min(1).nullable().optional().describe("Optional Outlook timezone for returned start/end values."),
    limit: z.number().int().min(1).max(1000).nullable().optional().describe("Maximum number of events to return.")
  },
  async ({ calendar_id, start_datetime, end_datetime, timezone, limit }) => viewOutlookCalendar({
    calendarId: calendar_id ?? undefined,
    startDateTime: start_datetime,
    endDateTime: end_datetime,
    timezone: timezone ?? undefined,
    limit: limit ?? undefined
  })
);

server.tool(
  "read_outlook_calendar_event",
  "Read a specific Outlook calendar event by event ID.",
  {
    event_id: z.string().min(1).describe("Outlook event ID."),
    calendar_id: z.string().min(1).nullable().optional().describe("Optional calendar ID when the event is not in the default calendar."),
    timezone: z.string().min(1).nullable().optional().describe("Optional Outlook timezone for returned start/end values."),
    body_format: bodyFormatSchema.describe("Whether to return the event body as text or HTML. Text is safer for analysis.")
  },
  async ({ event_id, calendar_id, timezone, body_format }) => readOutlookCalendarEvent({
    eventId: event_id,
    calendarId: calendar_id ?? undefined,
    timezone: timezone ?? undefined,
    bodyFormat: body_format ?? undefined
  })
);

server.tool(
  "create_outlook_calendar_event",
  "Create an Outlook calendar event. If attendees are present, set confirmAttendeeNotifications=true to acknowledge that Outlook may send invites.",
  {
    timezone: z.string().min(1).nullable().optional().describe("Optional Outlook timezone for returned start/end values."),
    body_format: bodyFormatSchema.describe("Optional response body format for the returned event."),
    event: createEventSchema.describe("Event details to create.")
  },
  async ({ timezone, body_format, event }) => createOutlookCalendarEvent({
    timezone: timezone ?? undefined,
    bodyFormat: body_format ?? undefined,
    event
  })
);

server.tool(
  "update_outlook_calendar_event",
  "Update an Outlook calendar event safely. You must provide the latest expectedChangeKey from a prior read.",
  {
    event_id: z.string().min(1).describe("Outlook event ID to update."),
    timezone: z.string().min(1).nullable().optional().describe("Optional Outlook timezone for returned start/end values."),
    body_format: bodyFormatSchema.describe("Optional response body format for the returned event."),
    event: updateEventSchema.describe("Patch fields for the event update.")
  },
  async ({ event_id, timezone, body_format, event }) => updateOutlookCalendarEvent({
    eventId: event_id,
    timezone: timezone ?? undefined,
    bodyFormat: body_format ?? undefined,
    event
  })
);

server.tool(
  "delete_outlook_calendar_event",
  "Delete an Outlook calendar event safely. You must provide the latest expected changeKey, and confirm attendee cancellation when applicable.",
  {
    event_id: z.string().min(1).describe("Outlook event ID to delete."),
    calendar_id: z.string().min(1).nullable().optional().describe("Optional calendar ID when the event is not in the default calendar."),
    expected_change_key: z.string().min(1).describe("Latest changeKey from read_outlook_calendar_event."),
    confirm_attendee_cancellation: z.boolean().nullable().optional().describe("Must be true when deleting a meeting that has attendees because Outlook will send cancellations.")
  },
  async ({ event_id, calendar_id, expected_change_key, confirm_attendee_cancellation }) => deleteOutlookCalendarEvent({
    eventId: event_id,
    calendarId: calendar_id ?? undefined,
    expectedChangeKey: expected_change_key,
    confirmAttendeeCancellation: confirm_attendee_cancellation ?? undefined
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
