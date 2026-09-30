import { z } from "zod";

export const outlookBodyFormatSchema = z.enum(["text", "html"]);

export const outlookCalendarsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export const outlookMessageReadQuery = z.object({
  bodyFormat: outlookBodyFormatSchema.optional()
});

export const outlookMessageReadByIdQuery = outlookMessageReadQuery.extend({
  messageId: z.string().trim().min(1).max(1200)
});

export const outlookCalendarSearchQuery = z.object({
  q: z.string().trim().min(1).max(240),
  calendarId: z.string().trim().min(1).max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export const outlookCalendarViewQuery = z.object({
  calendarId: z.string().trim().min(1).max(400).optional(),
  startDateTime: z.string().trim().min(1).max(80),
  endDateTime: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

export const outlookEventReadQuery = z.object({
  calendarId: z.string().trim().min(1).max(400).optional(),
  timezone: z.string().trim().min(1).max(120).optional(),
  bodyFormat: outlookBodyFormatSchema.optional()
});

export const outlookEventReadByIdQuery = outlookEventReadQuery.extend({
  eventId: z.string().trim().min(1).max(1200)
});

export const outlookDateTimeTimeZoneSchema = z.object({
  dateTime: z.string().trim().min(1).max(80),
  timeZone: z.string().trim().min(1).max(120).nullable().optional()
}).strict();

export const outlookAttendeeAddressSchema = z.object({
  address: z.string().trim().min(3).max(320),
  name: z.string().trim().min(1).max(200).nullable().optional()
}).strict();

export const outlookAttendeeSchema = z.object({
  emailAddress: outlookAttendeeAddressSchema,
  type: z.enum(["required", "optional", "resource"]).nullable().optional()
}).strict();

export const outlookBodySchema = z.object({
  content: z.string().max(100000),
  contentType: outlookBodyFormatSchema.nullable().optional()
}).strict();

export const outlookLocationSchema = z.object({
  displayName: z.string().trim().min(1).max(400)
}).strict();

export const outlookRecurrencePatternSchema = z.object({
  type: z.string().trim().min(1).max(80),
  interval: z.number().int().min(1).max(999).nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  daysOfWeek: z.array(z.string().trim().min(1).max(20)).max(7).optional(),
  firstDayOfWeek: z.string().trim().min(1).max(20).nullable().optional(),
  index: z.string().trim().min(1).max(20).nullable().optional()
}).strict();

export const outlookRecurrenceRangeSchema = z.object({
  type: z.string().trim().min(1).max(80),
  startDate: z.string().trim().min(1).max(40),
  endDate: z.string().trim().min(1).max(40).nullable().optional(),
  recurrenceTimeZone: z.string().trim().min(1).max(120).nullable().optional(),
  numberOfOccurrences: z.number().int().min(1).max(999).nullable().optional()
}).strict();

export const outlookRecurrenceSchema = z.object({
  pattern: outlookRecurrencePatternSchema,
  range: outlookRecurrenceRangeSchema
}).strict();

export const outlookCreateEventBody = z.object({
  calendarId: z.string().trim().min(1).max(400).nullable().optional(),
  subject: z.string().trim().min(1).max(400),
  body: outlookBodySchema.nullable().optional(),
  start: outlookDateTimeTimeZoneSchema,
  end: outlookDateTimeTimeZoneSchema,
  isAllDay: z.boolean().nullable().optional(),
  location: outlookLocationSchema.nullable().optional(),
  attendees: z.array(outlookAttendeeSchema).max(500).nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
  importance: z.enum(["low", "normal", "high"]).nullable().optional(),
  sensitivity: z.enum(["normal", "personal", "private", "confidential"]).nullable().optional(),
  showAs: z.enum(["free", "tentative", "busy", "oof", "workingElsewhere", "unknown"]).nullable().optional(),
  hideAttendees: z.boolean().nullable().optional(),
  allowNewTimeProposals: z.boolean().nullable().optional(),
  responseRequested: z.boolean().nullable().optional(),
  isReminderOn: z.boolean().nullable().optional(),
  reminderMinutesBeforeStart: z.number().int().min(0).max(40320).nullable().optional(),
  isOnlineMeeting: z.boolean().nullable().optional(),
  onlineMeetingProvider: z.enum(["unknown", "teamsForBusiness", "skypeForBusiness", "skypeForConsumer"]).nullable().optional(),
  recurrence: outlookRecurrenceSchema.nullable().optional(),
  transactionId: z.string().trim().min(1).max(120).nullable().optional(),
  confirmAttendeeNotifications: z.boolean().nullable().optional()
}).strict();

export const outlookUpdateEventBody = z.object({
  calendarId: z.string().trim().min(1).max(400).nullable().optional(),
  expectedChangeKey: z.string().trim().min(1).max(400),
  subject: z.string().trim().min(1).max(400).nullable().optional(),
  body: outlookBodySchema.nullable().optional(),
  start: outlookDateTimeTimeZoneSchema.nullable().optional(),
  end: outlookDateTimeTimeZoneSchema.nullable().optional(),
  isAllDay: z.boolean().nullable().optional(),
  location: outlookLocationSchema.nullable().optional(),
  attendees: z.array(outlookAttendeeSchema).max(500).nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
  importance: z.enum(["low", "normal", "high"]).nullable().optional(),
  sensitivity: z.enum(["normal", "personal", "private", "confidential"]).nullable().optional(),
  showAs: z.enum(["free", "tentative", "busy", "oof", "workingElsewhere", "unknown"]).nullable().optional(),
  hideAttendees: z.boolean().nullable().optional(),
  allowNewTimeProposals: z.boolean().nullable().optional(),
  responseRequested: z.boolean().nullable().optional(),
  isReminderOn: z.boolean().nullable().optional(),
  reminderMinutesBeforeStart: z.number().int().min(0).max(40320).nullable().optional(),
  recurrence: outlookRecurrenceSchema.nullable().optional(),
  confirmAttendeeNotifications: z.boolean().nullable().optional()
}).strict();

export const outlookCreateEventRequestBody = z.object({
  timezone: z.string().trim().min(1).max(120).nullable().optional(),
  bodyFormat: outlookBodyFormatSchema.nullable().optional(),
  event: outlookCreateEventBody
}).strict();

export const outlookUpdateEventRequestBody = z.object({
  timezone: z.string().trim().min(1).max(120).nullable().optional(),
  bodyFormat: outlookBodyFormatSchema.nullable().optional(),
  event: outlookUpdateEventBody
}).strict();

export const outlookDeleteEventQuery = z.object({
  calendarId: z.string().trim().min(1).max(400).optional(),
  expectedChangeKey: z.string().trim().min(1).max(400),
  confirmAttendeeCancellation: z.coerce.boolean().optional()
});

export const outlookDeleteEventByIdQuery = outlookDeleteEventQuery.extend({
  eventId: z.string().trim().min(1).max(1200)
});

export function normalizeOutlookDateTimeTimeZoneInput(
  input: z.infer<typeof outlookDateTimeTimeZoneSchema> | null | undefined
) {
  if (!input) {
    return input;
  }

  return {
    ...input,
    timeZone: input.timeZone ?? null
  };
}

export function normalizeOutlookRecurrenceInput(input: z.infer<typeof outlookRecurrenceSchema> | null | undefined) {
  if (!input) {
    return input;
  }

  return {
    pattern: {
      ...input.pattern,
      interval: input.pattern.interval ?? null,
      month: input.pattern.month ?? null,
      dayOfMonth: input.pattern.dayOfMonth ?? null,
      daysOfWeek: input.pattern.daysOfWeek ?? [],
      firstDayOfWeek: input.pattern.firstDayOfWeek ?? null,
      index: input.pattern.index ?? null
    },
    range: {
      ...input.range,
      endDate: input.range.endDate ?? null,
      recurrenceTimeZone: input.range.recurrenceTimeZone ?? null,
      numberOfOccurrences: input.range.numberOfOccurrences ?? null
    }
  };
}

export function normalizeOutlookCreateEventInput(input: z.infer<typeof outlookCreateEventBody>) {
  return {
    ...input,
    calendarId: input.calendarId ?? null,
    start: normalizeOutlookDateTimeTimeZoneInput(input.start)!,
    end: normalizeOutlookDateTimeTimeZoneInput(input.end)!,
    recurrence: normalizeOutlookRecurrenceInput(input.recurrence)
  };
}

export function normalizeOutlookUpdateEventInput(input: z.infer<typeof outlookUpdateEventBody>) {
  return {
    ...input,
    calendarId: input.calendarId ?? null,
    start: normalizeOutlookDateTimeTimeZoneInput(input.start),
    end: normalizeOutlookDateTimeTimeZoneInput(input.end),
    recurrence: normalizeOutlookRecurrenceInput(input.recurrence)
  };
}
