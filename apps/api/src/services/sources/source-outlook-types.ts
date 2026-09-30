import type { SourceProviderBaseClient } from "./source-types.js";

export type SourceBodyContentType = "text" | "html";
export type SourceImportance = "low" | "normal" | "high";
export type SourceSensitivity = "normal" | "personal" | "private" | "confidential";
export type SourceShowAs = "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
export type SourceAttendeeType = "required" | "optional" | "resource";
export type SourceOnlineMeetingProvider = "unknown" | "teamsForBusiness" | "skypeForBusiness" | "skypeForConsumer";
export type SourceEventType = "singleInstance" | "occurrence" | "exception" | "seriesMaster" | "unknown";

export interface SourceEmailAddress {
  name: string | null;
  address: string | null;
}

export interface SourceRecipient {
  emailAddress: SourceEmailAddress;
}

export interface SourceItemBody {
  contentType: SourceBodyContentType | null;
  content: string | null;
}

export interface SourceInternetMessageHeader {
  name: string;
  value: string;
}

export interface SourceMessageSummary {
  id: string;
  changeKey: string | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  hasAttachments: boolean;
  internetMessageId: string | null;
  subject: string | null;
  bodyPreview: string | null;
  importance: SourceImportance | null;
  isRead: boolean | null;
  isDraft: boolean | null;
  parentFolderId: string | null;
  conversationId: string | null;
  webLink: string | null;
  sender: SourceRecipient | null;
  from: SourceRecipient | null;
  toRecipients: SourceRecipient[];
  ccRecipients: SourceRecipient[];
  bccRecipients: SourceRecipient[];
  replyTo: SourceRecipient[];
  categories: string[];
}

export interface SourceMessageDetail extends SourceMessageSummary {
  body: SourceItemBody | null;
  uniqueBody: SourceItemBody | null;
  internetMessageHeaders: SourceInternetMessageHeader[];
}

export interface SourceMessageSearchResult {
  items: SourceMessageSummary[];
}

export interface SourceCalendarSummary {
  id: string;
  name: string;
  color: string | null;
  hexColor: string | null;
  changeKey: string | null;
  canEdit: boolean | null;
  canShare: boolean | null;
  canViewPrivateItems: boolean | null;
  isRemovable: boolean | null;
  isDefault: boolean;
  owner: SourceEmailAddress | null;
  allowedOnlineMeetingProviders: SourceOnlineMeetingProvider[];
  defaultOnlineMeetingProvider: SourceOnlineMeetingProvider | null;
}

export interface SourceCalendarListResult {
  defaultCalendarId: string | null;
  items: SourceCalendarSummary[];
}

export interface SourceDateTimeTimeZone {
  dateTime: string;
  timeZone: string | null;
}

export interface SourceResponseStatus {
  response: string | null;
  time: string | null;
}

export interface SourceLocation {
  displayName: string | null;
  locationType: string | null;
  uniqueId: string | null;
  uniqueIdType: string | null;
}

export interface SourceAttendee {
  type: SourceAttendeeType | null;
  status: SourceResponseStatus | null;
  emailAddress: SourceEmailAddress;
}

export interface SourceOnlineMeetingInfo {
  joinUrl: string | null;
  conferenceId: string | null;
  tollNumber: string | null;
}

export interface SourceRecurrencePattern {
  type: string;
  interval: number | null;
  month: number | null;
  dayOfMonth: number | null;
  daysOfWeek: string[];
  firstDayOfWeek: string | null;
  index: string | null;
}

export interface SourceRecurrenceRange {
  type: string;
  startDate: string;
  endDate: string | null;
  recurrenceTimeZone: string | null;
  numberOfOccurrences: number | null;
}

export interface SourcePatternedRecurrence {
  pattern: SourceRecurrencePattern;
  range: SourceRecurrenceRange;
}

export interface SourceEventSummary {
  id: string;
  calendarId: string | null;
  changeKey: string | null;
  createdAt: string | null;
  lastModifiedAt: string | null;
  subject: string | null;
  bodyPreview: string | null;
  start: SourceDateTimeTimeZone | null;
  end: SourceDateTimeTimeZone | null;
  location: SourceLocation | null;
  organizer: SourceRecipient | null;
  attendees: SourceAttendee[];
  categories: string[];
  importance: SourceImportance | null;
  sensitivity: SourceSensitivity | null;
  showAs: SourceShowAs | null;
  isAllDay: boolean;
  isCancelled: boolean;
  isDraft: boolean;
  isOrganizer: boolean;
  hasAttachments: boolean;
  responseRequested: boolean | null;
  hideAttendees: boolean | null;
  allowNewTimeProposals: boolean | null;
  responseStatus: SourceResponseStatus | null;
  reminderMinutesBeforeStart: number | null;
  isReminderOn: boolean | null;
  originalStartTimeZone: string | null;
  originalEndTimeZone: string | null;
  seriesMasterId: string | null;
  occurrenceId: string | null;
  transactionId: string | null;
  type: SourceEventType;
  webLink: string | null;
  isOnlineMeeting: boolean | null;
  onlineMeetingProvider: SourceOnlineMeetingProvider | null;
  onlineMeeting: SourceOnlineMeetingInfo | null;
}

export interface SourceEventDetail extends SourceEventSummary {
  body: SourceItemBody | null;
  locations: SourceLocation[];
  recurrence: SourcePatternedRecurrence | null;
  cancelledOccurrences: string[] | null;
}

export interface SourceCalendarViewResult {
  calendarId: string | null;
  startDateTime: string;
  endDateTime: string;
  timezone: string | null;
  items: SourceEventSummary[];
}

export interface SourceCalendarSearchResult {
  items: SourceEventSummary[];
}

export interface SourceAttendeeInput {
  emailAddress: {
    address: string;
    name?: string | null;
  };
  type?: SourceAttendeeType | null;
}

export interface SourceEventBodyInput {
  content: string;
  contentType?: SourceBodyContentType | null;
}

export interface SourceEventLocationInput {
  displayName: string;
}

export interface SourceEventCreateInput {
  calendarId: string | null;
  subject: string;
  body?: SourceEventBodyInput | null;
  start: SourceDateTimeTimeZone;
  end: SourceDateTimeTimeZone;
  isAllDay?: boolean | null;
  location?: SourceEventLocationInput | null;
  attendees?: SourceAttendeeInput[] | null;
  categories?: string[] | null;
  importance?: SourceImportance | null;
  sensitivity?: SourceSensitivity | null;
  showAs?: SourceShowAs | null;
  hideAttendees?: boolean | null;
  allowNewTimeProposals?: boolean | null;
  responseRequested?: boolean | null;
  isReminderOn?: boolean | null;
  reminderMinutesBeforeStart?: number | null;
  isOnlineMeeting?: boolean | null;
  onlineMeetingProvider?: SourceOnlineMeetingProvider | null;
  recurrence?: SourcePatternedRecurrence | null;
  transactionId?: string | null;
  confirmAttendeeNotifications?: boolean | null;
}

export interface SourceEventUpdateInput {
  calendarId: string | null;
  expectedChangeKey: string;
  subject?: string | null;
  body?: SourceEventBodyInput | null;
  start?: SourceDateTimeTimeZone | null;
  end?: SourceDateTimeTimeZone | null;
  isAllDay?: boolean | null;
  location?: SourceEventLocationInput | null;
  attendees?: SourceAttendeeInput[] | null;
  categories?: string[] | null;
  importance?: SourceImportance | null;
  sensitivity?: SourceSensitivity | null;
  showAs?: SourceShowAs | null;
  hideAttendees?: boolean | null;
  allowNewTimeProposals?: boolean | null;
  responseRequested?: boolean | null;
  isReminderOn?: boolean | null;
  reminderMinutesBeforeStart?: number | null;
  recurrence?: SourcePatternedRecurrence | null;
  confirmAttendeeNotifications?: boolean | null;
}

export interface SourceOutlookProviderClient extends SourceProviderBaseClient {
  provider: "outlook";
  searchMessages(input: {
    accessToken: string;
    query: string;
    limit?: number;
  }): Promise<SourceMessageSearchResult>;
  getMessage(input: {
    accessToken: string;
    messageId: string;
    bodyFormat?: SourceBodyContentType | null;
  }): Promise<SourceMessageDetail>;
  listCalendars(input: {
    accessToken: string;
    limit?: number;
  }): Promise<SourceCalendarListResult>;
  searchCalendarEvents(input: {
    accessToken: string;
    query: string;
    limit?: number;
  }): Promise<SourceCalendarSearchResult>;
  viewCalendar(input: {
    accessToken: string;
    calendarId: string | null;
    startDateTime: string;
    endDateTime: string;
    timezone?: string | null;
    limit?: number;
  }): Promise<SourceCalendarViewResult>;
  getCalendarEvent(input: {
    accessToken: string;
    calendarId: string | null;
    eventId: string;
    timezone?: string | null;
    bodyFormat?: SourceBodyContentType | null;
  }): Promise<SourceEventDetail>;
  createCalendarEvent(input: {
    accessToken: string;
    event: SourceEventCreateInput;
    timezone?: string | null;
    bodyFormat?: SourceBodyContentType | null;
  }): Promise<SourceEventDetail>;
  updateCalendarEvent(input: {
    accessToken: string;
    eventId: string;
    event: SourceEventUpdateInput;
    timezone?: string | null;
    bodyFormat?: SourceBodyContentType | null;
  }): Promise<SourceEventDetail>;
  deleteCalendarEvent(input: {
    accessToken: string;
    calendarId: string | null;
    eventId: string;
  }): Promise<void>;
}
