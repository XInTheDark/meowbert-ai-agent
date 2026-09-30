import { randomUUID } from "node:crypto";
import { buildSourceBearerHeaders, buildStoredSourceTokens, fetchJsonOrThrow } from "../provider-http.js";
import type {
  SourceAccountProfile,
  StoredSourceTokens
} from "../source-types.js";
import type {
  SourceAttendee,
  SourceAttendeeInput,
  SourceBodyContentType,
  SourceCalendarListResult,
  SourceCalendarSearchResult,
  SourceCalendarSummary,
  SourceCalendarViewResult,
  SourceDateTimeTimeZone,
  SourceEmailAddress,
  SourceEventCreateInput,
  SourceEventDetail,
  SourceEventSummary,
  SourceEventUpdateInput,
  SourceItemBody,
  SourceLocation,
  SourceMessageDetail,
  SourceMessageSearchResult,
  SourceMessageSummary,
  SourceOnlineMeetingInfo,
  SourceOnlineMeetingProvider,
  SourceOutlookProviderClient,
  SourcePatternedRecurrence,
  SourceRecipient,
  SourceResponseStatus
} from "../source-outlook-types.js";

const OUTLOOK_SCOPES = ["Mail.Read", "Calendars.ReadWrite", "offline_access", "User.Read"].join(" ");
const MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const MESSAGE_SELECT = [
  "id",
  "changeKey",
  "createdDateTime",
  "lastModifiedDateTime",
  "receivedDateTime",
  "sentDateTime",
  "hasAttachments",
  "internetMessageId",
  "subject",
  "bodyPreview",
  "importance",
  "isRead",
  "isDraft",
  "parentFolderId",
  "conversationId",
  "webLink",
  "sender",
  "from",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "replyTo",
  "categories"
].join(",");
const MESSAGE_DETAIL_SELECT = `${MESSAGE_SELECT},body,uniqueBody,internetMessageHeaders`;
const CALENDAR_SELECT = [
  "id",
  "name",
  "color",
  "hexColor",
  "changeKey",
  "canEdit",
  "canShare",
  "canViewPrivateItems",
  "isRemovable",
  "owner",
  "allowedOnlineMeetingProviders",
  "defaultOnlineMeetingProvider"
].join(",");
const EVENT_SELECT = [
  "id",
  "changeKey",
  "subject",
  "bodyPreview",
  "start",
  "end",
  "location",
  "organizer",
  "attendees",
  "categories",
  "importance",
  "sensitivity",
  "showAs",
  "isAllDay",
  "isCancelled",
  "isDraft",
  "isOrganizer",
  "hasAttachments",
  "responseRequested",
  "hideAttendees",
  "allowNewTimeProposals",
  "responseStatus",
  "reminderMinutesBeforeStart",
  "isReminderOn",
  "originalStartTimeZone",
  "originalEndTimeZone",
  "seriesMasterId",
  "occurrenceId",
  "transactionId",
  "type",
  "webLink",
  "isOnlineMeeting",
  "onlineMeetingProvider",
  "onlineMeeting"
].join(",");
const EVENT_DETAIL_SELECT = `${EVENT_SELECT},createdDateTime,lastModifiedDateTime,body,locations,recurrence,cancelledOccurrences`;

type GraphEmailAddress = {
  name?: string;
  address?: string;
};

type GraphRecipient = {
  emailAddress?: GraphEmailAddress | null;
};

type GraphItemBody = {
  contentType?: string;
  content?: string;
};

type GraphInternetMessageHeader = {
  name?: string;
  value?: string;
};

type GraphLocation = {
  displayName?: string;
  locationType?: string;
  uniqueId?: string;
  uniqueIdType?: string;
};

type GraphResponseStatus = {
  response?: string;
  time?: string;
};

type GraphAttendee = {
  type?: string;
  status?: GraphResponseStatus | null;
  emailAddress?: GraphEmailAddress | null;
};

type GraphOnlineMeetingInfo = {
  joinUrl?: string;
  conferenceId?: string;
  tollNumber?: string;
};

type GraphDateTimeTimeZone = {
  dateTime?: string;
  timeZone?: string;
};

type GraphPatternedRecurrence = {
  pattern?: {
    type?: string;
    interval?: number;
    month?: number;
    dayOfMonth?: number;
    daysOfWeek?: string[];
    firstDayOfWeek?: string;
    index?: string;
  } | null;
  range?: {
    type?: string;
    startDate?: string;
    endDate?: string;
    recurrenceTimeZone?: string;
    numberOfOccurrences?: number;
  } | null;
};

type GraphMessage = {
  id: string;
  changeKey?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  importance?: string;
  isRead?: boolean;
  isDraft?: boolean;
  parentFolderId?: string;
  conversationId?: string;
  webLink?: string;
  sender?: GraphRecipient | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  categories?: string[];
  body?: GraphItemBody | null;
  uniqueBody?: GraphItemBody | null;
  internetMessageHeaders?: GraphInternetMessageHeader[];
};

type GraphCalendar = {
  id: string;
  name?: string;
  color?: string;
  hexColor?: string;
  changeKey?: string;
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
  isRemovable?: boolean;
  owner?: GraphEmailAddress | null;
  allowedOnlineMeetingProviders?: string[];
  defaultOnlineMeetingProvider?: string;
};

type GraphEvent = {
  id: string;
  changeKey?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  subject?: string;
  bodyPreview?: string;
  body?: GraphItemBody | null;
  start?: GraphDateTimeTimeZone | null;
  end?: GraphDateTimeTimeZone | null;
  location?: GraphLocation | null;
  locations?: GraphLocation[];
  organizer?: GraphRecipient | null;
  attendees?: GraphAttendee[];
  categories?: string[];
  importance?: string;
  sensitivity?: string;
  showAs?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isDraft?: boolean;
  isOrganizer?: boolean;
  hasAttachments?: boolean;
  responseRequested?: boolean;
  hideAttendees?: boolean;
  allowNewTimeProposals?: boolean;
  responseStatus?: GraphResponseStatus | null;
  reminderMinutesBeforeStart?: number;
  isReminderOn?: boolean;
  originalStartTimeZone?: string;
  originalEndTimeZone?: string;
  seriesMasterId?: string;
  occurrenceId?: string;
  transactionId?: string;
  type?: string;
  webLink?: string;
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  onlineMeeting?: GraphOnlineMeetingInfo | null;
  recurrence?: GraphPatternedRecurrence | null;
  cancelledOccurrences?: string[];
};

type GraphSearchResponse = {
  value?: Array<{
    hitsContainers?: Array<{
      hits?: Array<{
        resource?: GraphEvent | null;
      }>;
    }>;
  }>;
};

function normalizeLowercaseEnum(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function normalizeBodyContentType(value: string | undefined): SourceBodyContentType | null {
  const normalized = normalizeLowercaseEnum(value);
  if (normalized === "text" || normalized === "html") {
    return normalized;
  }
  return null;
}

function normalizeImportance(value: string | undefined): SourceMessageSummary["importance"] {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "low" || normalized === "normal" || normalized === "high" ? normalized : null;
}

function normalizeSensitivity(value: string | undefined): SourceEventSummary["sensitivity"] {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "normal"
    || normalized === "personal"
    || normalized === "private"
    || normalized === "confidential"
    ? normalized
    : null;
}

function normalizeShowAs(value: string | undefined): SourceEventSummary["showAs"] {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "free"
    || normalized === "tentative"
    || normalized === "busy"
    || normalized === "oof"
    || normalized === "workingelsewhere"
    || normalized === "unknown"
    ? (normalized === "workingelsewhere" ? "workingElsewhere" : normalized)
    : null;
}

function normalizeAttendeeType(value: string | undefined): SourceAttendee["type"] {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "required" || normalized === "optional" || normalized === "resource" ? normalized : null;
}

function normalizeOnlineMeetingProvider(value: string | undefined): SourceOnlineMeetingProvider | null {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "unknown"
    || normalized === "teamsforbusiness"
    || normalized === "skypeforbusiness"
    || normalized === "skypeforconsumer"
    ? ({
        unknown: "unknown",
        teamsforbusiness: "teamsForBusiness",
        skypeforbusiness: "skypeForBusiness",
        skypeforconsumer: "skypeForConsumer"
      })[normalized] as SourceOnlineMeetingProvider
    : null;
}

function normalizeEventType(value: string | undefined): SourceEventSummary["type"] {
  const normalized = normalizeLowercaseEnum(value);
  return normalized === "singleinstance"
    || normalized === "occurrence"
    || normalized === "exception"
    || normalized === "seriesmaster"
    || normalized === "single"
    ? ({
        singleinstance: "singleInstance",
        single: "singleInstance",
        occurrence: "occurrence",
        exception: "exception",
        seriesmaster: "seriesMaster"
      })[normalized] as SourceEventSummary["type"]
    : "unknown";
}

function normalizeEmailAddress(value: GraphEmailAddress | null | undefined): SourceEmailAddress {
  return {
    name: typeof value?.name === "string" ? value.name : null,
    address: typeof value?.address === "string" ? value.address : null
  };
}

function normalizeRecipient(value: GraphRecipient | null | undefined): SourceRecipient {
  return {
    emailAddress: normalizeEmailAddress(value?.emailAddress ?? null)
  };
}

function normalizeRecipients(value: GraphRecipient[] | undefined): SourceRecipient[] {
  return Array.isArray(value) ? value.map((entry) => normalizeRecipient(entry)) : [];
}

function normalizeItemBody(value: GraphItemBody | null | undefined): SourceItemBody | null {
  if (!value) {
    return null;
  }

  return {
    contentType: normalizeBodyContentType(value.contentType),
    content: typeof value.content === "string" ? value.content : null
  };
}

function normalizeResponseStatus(value: GraphResponseStatus | null | undefined): SourceResponseStatus | null {
  if (!value) {
    return null;
  }

  return {
    response: typeof value.response === "string" ? value.response : null,
    time: typeof value.time === "string" ? value.time : null
  };
}

function normalizeLocation(value: GraphLocation | null | undefined): SourceLocation | null {
  if (!value) {
    return null;
  }

  return {
    displayName: typeof value.displayName === "string" ? value.displayName : null,
    locationType: typeof value.locationType === "string" ? value.locationType : null,
    uniqueId: typeof value.uniqueId === "string" ? value.uniqueId : null,
    uniqueIdType: typeof value.uniqueIdType === "string" ? value.uniqueIdType : null
  };
}

function normalizeLocations(value: GraphLocation[] | undefined): SourceLocation[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeLocation(entry)).filter((entry): entry is SourceLocation => entry !== null)
    : [];
}

function normalizeAttendees(value: GraphAttendee[] | undefined): SourceAttendee[] {
  return Array.isArray(value)
    ? value.map((entry) => ({
        type: normalizeAttendeeType(entry.type),
        status: normalizeResponseStatus(entry.status),
        emailAddress: normalizeEmailAddress(entry.emailAddress ?? null)
      }))
    : [];
}

function normalizeDateTimeTimeZone(value: GraphDateTimeTimeZone | null | undefined): SourceDateTimeTimeZone | null {
  if (!value || typeof value.dateTime !== "string") {
    return null;
  }

  return {
    dateTime: value.dateTime,
    timeZone: typeof value.timeZone === "string" ? value.timeZone : null
  };
}

function normalizeOnlineMeeting(value: GraphOnlineMeetingInfo | null | undefined): SourceOnlineMeetingInfo | null {
  if (!value) {
    return null;
  }

  return {
    joinUrl: typeof value.joinUrl === "string" ? value.joinUrl : null,
    conferenceId: typeof value.conferenceId === "string" ? value.conferenceId : null,
    tollNumber: typeof value.tollNumber === "string" ? value.tollNumber : null
  };
}

function normalizeRecurrence(value: GraphPatternedRecurrence | null | undefined): SourcePatternedRecurrence | null {
  if (!value?.pattern || !value.range || typeof value.range.startDate !== "string" || typeof value.pattern.type !== "string") {
    return null;
  }

  return {
    pattern: {
      type: value.pattern.type,
      interval: typeof value.pattern.interval === "number" ? value.pattern.interval : null,
      month: typeof value.pattern.month === "number" ? value.pattern.month : null,
      dayOfMonth: typeof value.pattern.dayOfMonth === "number" ? value.pattern.dayOfMonth : null,
      daysOfWeek: Array.isArray(value.pattern.daysOfWeek)
        ? value.pattern.daysOfWeek.filter((entry): entry is string => typeof entry === "string")
        : [],
      firstDayOfWeek: typeof value.pattern.firstDayOfWeek === "string" ? value.pattern.firstDayOfWeek : null,
      index: typeof value.pattern.index === "string" ? value.pattern.index : null
    },
    range: {
      type: value.range.type ?? "",
      startDate: value.range.startDate,
      endDate: typeof value.range.endDate === "string" ? value.range.endDate : null,
      recurrenceTimeZone: typeof value.range.recurrenceTimeZone === "string" ? value.range.recurrenceTimeZone : null,
      numberOfOccurrences: typeof value.range.numberOfOccurrences === "number" ? value.range.numberOfOccurrences : null
    }
  };
}

function normalizeMessage(value: GraphMessage): SourceMessageSummary {
  return {
    id: value.id,
    changeKey: typeof value.changeKey === "string" ? value.changeKey : null,
    createdAt: typeof value.createdDateTime === "string" ? value.createdDateTime : null,
    lastModifiedAt: typeof value.lastModifiedDateTime === "string" ? value.lastModifiedDateTime : null,
    receivedAt: typeof value.receivedDateTime === "string" ? value.receivedDateTime : null,
    sentAt: typeof value.sentDateTime === "string" ? value.sentDateTime : null,
    hasAttachments: value.hasAttachments === true,
    internetMessageId: typeof value.internetMessageId === "string" ? value.internetMessageId : null,
    subject: typeof value.subject === "string" ? value.subject : null,
    bodyPreview: typeof value.bodyPreview === "string" ? value.bodyPreview : null,
    importance: normalizeImportance(value.importance),
    isRead: typeof value.isRead === "boolean" ? value.isRead : null,
    isDraft: typeof value.isDraft === "boolean" ? value.isDraft : null,
    parentFolderId: typeof value.parentFolderId === "string" ? value.parentFolderId : null,
    conversationId: typeof value.conversationId === "string" ? value.conversationId : null,
    webLink: typeof value.webLink === "string" ? value.webLink : null,
    sender: value.sender ? normalizeRecipient(value.sender) : null,
    from: value.from ? normalizeRecipient(value.from) : null,
    toRecipients: normalizeRecipients(value.toRecipients),
    ccRecipients: normalizeRecipients(value.ccRecipients),
    bccRecipients: normalizeRecipients(value.bccRecipients),
    replyTo: normalizeRecipients(value.replyTo),
    categories: Array.isArray(value.categories) ? value.categories.filter((entry): entry is string => typeof entry === "string") : []
  };
}

function normalizeMessageDetail(value: GraphMessage): SourceMessageDetail {
  return {
    ...normalizeMessage(value),
    body: normalizeItemBody(value.body),
    uniqueBody: normalizeItemBody(value.uniqueBody),
    internetMessageHeaders: Array.isArray(value.internetMessageHeaders)
      ? value.internetMessageHeaders
        .filter((entry): entry is GraphInternetMessageHeader => !!entry)
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "",
          value: typeof entry.value === "string" ? entry.value : ""
        }))
        .filter((entry) => entry.name.length > 0)
      : []
  };
}

function normalizeCalendar(value: GraphCalendar, defaultCalendarId: string | null): SourceCalendarSummary {
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "Calendar",
    color: typeof value.color === "string" ? value.color : null,
    hexColor: typeof value.hexColor === "string" ? value.hexColor : null,
    changeKey: typeof value.changeKey === "string" ? value.changeKey : null,
    canEdit: typeof value.canEdit === "boolean" ? value.canEdit : null,
    canShare: typeof value.canShare === "boolean" ? value.canShare : null,
    canViewPrivateItems: typeof value.canViewPrivateItems === "boolean" ? value.canViewPrivateItems : null,
    isRemovable: typeof value.isRemovable === "boolean" ? value.isRemovable : null,
    isDefault: defaultCalendarId !== null && value.id === defaultCalendarId,
    owner: value.owner ? normalizeEmailAddress(value.owner) : null,
    allowedOnlineMeetingProviders: Array.isArray(value.allowedOnlineMeetingProviders)
      ? value.allowedOnlineMeetingProviders
        .map((entry) => normalizeOnlineMeetingProvider(entry))
        .filter((entry): entry is SourceOnlineMeetingProvider => entry !== null)
      : [],
    defaultOnlineMeetingProvider: normalizeOnlineMeetingProvider(value.defaultOnlineMeetingProvider)
  };
}

function normalizeEvent(value: GraphEvent, calendarId: string | null): SourceEventSummary {
  return {
    id: value.id,
    calendarId,
    changeKey: typeof value.changeKey === "string" ? value.changeKey : null,
    createdAt: typeof value.createdDateTime === "string" ? value.createdDateTime : null,
    lastModifiedAt: typeof value.lastModifiedDateTime === "string" ? value.lastModifiedDateTime : null,
    subject: typeof value.subject === "string" ? value.subject : null,
    bodyPreview: typeof value.bodyPreview === "string" ? value.bodyPreview : null,
    start: normalizeDateTimeTimeZone(value.start),
    end: normalizeDateTimeTimeZone(value.end),
    location: normalizeLocation(value.location),
    organizer: value.organizer ? normalizeRecipient(value.organizer) : null,
    attendees: normalizeAttendees(value.attendees),
    categories: Array.isArray(value.categories) ? value.categories.filter((entry): entry is string => typeof entry === "string") : [],
    importance: normalizeImportance(value.importance),
    sensitivity: normalizeSensitivity(value.sensitivity),
    showAs: normalizeShowAs(value.showAs),
    isAllDay: value.isAllDay === true,
    isCancelled: value.isCancelled === true,
    isDraft: value.isDraft === true,
    isOrganizer: value.isOrganizer === true,
    hasAttachments: value.hasAttachments === true,
    responseRequested: typeof value.responseRequested === "boolean" ? value.responseRequested : null,
    hideAttendees: typeof value.hideAttendees === "boolean" ? value.hideAttendees : null,
    allowNewTimeProposals: typeof value.allowNewTimeProposals === "boolean" ? value.allowNewTimeProposals : null,
    responseStatus: normalizeResponseStatus(value.responseStatus),
    reminderMinutesBeforeStart: typeof value.reminderMinutesBeforeStart === "number" ? value.reminderMinutesBeforeStart : null,
    isReminderOn: typeof value.isReminderOn === "boolean" ? value.isReminderOn : null,
    originalStartTimeZone: typeof value.originalStartTimeZone === "string" ? value.originalStartTimeZone : null,
    originalEndTimeZone: typeof value.originalEndTimeZone === "string" ? value.originalEndTimeZone : null,
    seriesMasterId: typeof value.seriesMasterId === "string" ? value.seriesMasterId : null,
    occurrenceId: typeof value.occurrenceId === "string" ? value.occurrenceId : null,
    transactionId: typeof value.transactionId === "string" ? value.transactionId : null,
    type: normalizeEventType(value.type),
    webLink: typeof value.webLink === "string" ? value.webLink : null,
    isOnlineMeeting: typeof value.isOnlineMeeting === "boolean" ? value.isOnlineMeeting : null,
    onlineMeetingProvider: normalizeOnlineMeetingProvider(value.onlineMeetingProvider),
    onlineMeeting: normalizeOnlineMeeting(value.onlineMeeting)
  };
}

function normalizeEventDetail(value: GraphEvent, calendarId: string | null): SourceEventDetail {
  return {
    ...normalizeEvent(value, calendarId),
    body: normalizeItemBody(value.body),
    locations: normalizeLocations(value.locations),
    recurrence: normalizeRecurrence(value.recurrence),
    cancelledOccurrences: Array.isArray(value.cancelledOccurrences)
      ? value.cancelledOccurrences.filter((entry): entry is string => typeof entry === "string")
      : null
  };
}

function buildSearchQueryLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildEventCollectionPath(calendarId: string | null): string {
  return calendarId
    ? `/me/calendars/${encodePathSegment(calendarId)}/events`
    : "/me/calendar/events";
}

function buildEventItemPath(calendarId: string | null, eventId: string): string {
  return calendarId
    ? `/me/calendars/${encodePathSegment(calendarId)}/events/${encodePathSegment(eventId)}`
    : `/me/events/${encodePathSegment(eventId)}`;
}

function buildCalendarViewPath(calendarId: string | null): string {
  return calendarId
    ? `/me/calendars/${encodePathSegment(calendarId)}/calendarView`
    : "/me/calendar/calendarView";
}

function buildPreferHeader(input: { timezone?: string | null; bodyFormat?: SourceBodyContentType | null }): string | null {
  const parts: string[] = [];
  if (input.timezone) {
    parts.push(`outlook.timezone="${input.timezone.replace(/"/g, "")}"`);
  }
  if (input.bodyFormat) {
    parts.push(`outlook.body-content-type="${input.bodyFormat}"`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function buildOutlookHeaders(input: {
  accessToken: string;
  timezone?: string | null;
  bodyFormat?: SourceBodyContentType | null;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers = buildSourceBearerHeaders(input.accessToken, input.extra);
  const preferHeader = buildPreferHeader({
    timezone: input.timezone,
    bodyFormat: input.bodyFormat
  });
  if (preferHeader) {
    headers.Prefer = preferHeader;
  }
  return headers;
}

async function fetchOutlookJson<T>(input: {
  accessToken: string;
  path: string;
  method?: string;
  body?: BodyInit;
  timezone?: string | null;
  bodyFormat?: SourceBodyContentType | null;
  extraHeaders?: Record<string, string>;
  errorPrefix: string;
}): Promise<T> {
  return fetchJsonOrThrow<T>({
    url: `${MICROSOFT_GRAPH_BASE_URL}${input.path}`,
    method: input.method,
    headers: buildOutlookHeaders({
      accessToken: input.accessToken,
      timezone: input.timezone,
      bodyFormat: input.bodyFormat,
      extra: input.extraHeaders
    }),
    body: input.body,
    errorPrefix: input.errorPrefix
  });
}

function buildEventBody(value: SourceEventCreateInput["body"] | SourceEventUpdateInput["body"]): GraphItemBody | undefined {
  if (!value) {
    return undefined;
  }

  return {
    contentType: value.contentType ?? "text",
    content: value.content
  };
}

function buildEventAttendees(value: SourceAttendeeInput[] | null | undefined): GraphAttendee[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((entry) => ({
    type: entry.type ?? "required",
    emailAddress: {
      address: entry.emailAddress.address,
      ...(entry.emailAddress.name ? { name: entry.emailAddress.name } : {})
    }
  }));
}

function buildDateTimeTimeZone(value: SourceDateTimeTimeZone | null | undefined): GraphDateTimeTimeZone | undefined {
  if (!value) {
    return undefined;
  }

  return {
    dateTime: value.dateTime,
    ...(value.timeZone ? { timeZone: value.timeZone } : {})
  };
}

function buildRecurrence(value: SourcePatternedRecurrence | null | undefined): GraphPatternedRecurrence | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return {
    pattern: {
      type: value.pattern.type,
      ...(typeof value.pattern.interval === "number" ? { interval: value.pattern.interval } : {}),
      ...(typeof value.pattern.month === "number" ? { month: value.pattern.month } : {}),
      ...(typeof value.pattern.dayOfMonth === "number" ? { dayOfMonth: value.pattern.dayOfMonth } : {}),
      ...(value.pattern.daysOfWeek.length > 0 ? { daysOfWeek: value.pattern.daysOfWeek } : {}),
      ...(value.pattern.firstDayOfWeek ? { firstDayOfWeek: value.pattern.firstDayOfWeek } : {}),
      ...(value.pattern.index ? { index: value.pattern.index } : {})
    },
    range: {
      type: value.range.type,
      startDate: value.range.startDate,
      ...(value.range.endDate ? { endDate: value.range.endDate } : {}),
      ...(value.range.recurrenceTimeZone ? { recurrenceTimeZone: value.range.recurrenceTimeZone } : {}),
      ...(typeof value.range.numberOfOccurrences === "number" ? { numberOfOccurrences: value.range.numberOfOccurrences } : {})
    }
  };
}

function buildEventCreatePayload(input: SourceEventCreateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    subject: input.subject,
    start: buildDateTimeTimeZone(input.start),
    end: buildDateTimeTimeZone(input.end),
    transactionId: input.transactionId ?? randomUUID()
  };

  const body = buildEventBody(input.body);
  const attendees = buildEventAttendees(input.attendees ?? undefined);
  const recurrence = buildRecurrence(input.recurrence ?? undefined);

  if (body) {
    payload.body = body;
  }
  if (body === null) {
    payload.body = null;
  }
  if (input.location) {
    payload.location = { displayName: input.location.displayName };
  }
  if (attendees) {
    payload.attendees = attendees;
  }
  if (Array.isArray(input.categories)) {
    payload.categories = input.categories;
  }
  if (typeof input.isAllDay === "boolean") {
    payload.isAllDay = input.isAllDay;
  }
  if (input.importance) {
    payload.importance = input.importance;
  }
  if (input.sensitivity) {
    payload.sensitivity = input.sensitivity;
  }
  if (input.showAs) {
    payload.showAs = input.showAs;
  }
  if (typeof input.hideAttendees === "boolean") {
    payload.hideAttendees = input.hideAttendees;
  }
  if (typeof input.allowNewTimeProposals === "boolean") {
    payload.allowNewTimeProposals = input.allowNewTimeProposals;
  }
  if (typeof input.responseRequested === "boolean") {
    payload.responseRequested = input.responseRequested;
  }
  if (typeof input.isReminderOn === "boolean") {
    payload.isReminderOn = input.isReminderOn;
  }
  if (typeof input.reminderMinutesBeforeStart === "number") {
    payload.reminderMinutesBeforeStart = input.reminderMinutesBeforeStart;
  }
  if (typeof input.isOnlineMeeting === "boolean") {
    payload.isOnlineMeeting = input.isOnlineMeeting;
  }
  if (input.onlineMeetingProvider && input.onlineMeetingProvider !== "unknown") {
    payload.onlineMeetingProvider = input.onlineMeetingProvider;
  }
  if (recurrence !== undefined) {
    payload.recurrence = recurrence;
  }

  return payload;
}

function buildEventUpdatePayload(input: SourceEventUpdateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const hasOwn = (key: keyof SourceEventUpdateInput) => Object.prototype.hasOwnProperty.call(input, key);

  if (hasOwn("subject") && typeof input.subject === "string") {
    payload.subject = input.subject;
  }
  if (hasOwn("body") && input.body) {
    payload.body = buildEventBody(input.body);
  }
  if (hasOwn("start") && input.start) {
    payload.start = buildDateTimeTimeZone(input.start);
  }
  if (hasOwn("end") && input.end) {
    payload.end = buildDateTimeTimeZone(input.end);
  }
  if (hasOwn("isAllDay") && typeof input.isAllDay === "boolean") {
    payload.isAllDay = input.isAllDay;
  }
  if (hasOwn("location")) {
    payload.location = input.location ? { displayName: input.location.displayName } : { displayName: "" };
  }
  if (hasOwn("attendees")) {
    payload.attendees = buildEventAttendees(input.attendees ?? []) ?? [];
  }
  if (hasOwn("categories")) {
    payload.categories = Array.isArray(input.categories) ? input.categories : [];
  }
  if (hasOwn("importance") && input.importance) {
    payload.importance = input.importance;
  }
  if (hasOwn("sensitivity") && input.sensitivity) {
    payload.sensitivity = input.sensitivity;
  }
  if (hasOwn("showAs") && input.showAs) {
    payload.showAs = input.showAs;
  }
  if (hasOwn("hideAttendees") && typeof input.hideAttendees === "boolean") {
    payload.hideAttendees = input.hideAttendees;
  }
  if (hasOwn("allowNewTimeProposals") && typeof input.allowNewTimeProposals === "boolean") {
    payload.allowNewTimeProposals = input.allowNewTimeProposals;
  }
  if (hasOwn("responseRequested") && typeof input.responseRequested === "boolean") {
    payload.responseRequested = input.responseRequested;
  }
  if (hasOwn("isReminderOn") && typeof input.isReminderOn === "boolean") {
    payload.isReminderOn = input.isReminderOn;
  }
  if (hasOwn("reminderMinutesBeforeStart") && typeof input.reminderMinutesBeforeStart === "number") {
    payload.reminderMinutesBeforeStart = input.reminderMinutesBeforeStart;
  }
  if (hasOwn("recurrence")) {
    payload.recurrence = buildRecurrence(input.recurrence);
  }

  return payload;
}

async function fetchDefaultCalendarId(accessToken: string): Promise<string | null> {
  const payload = await fetchOutlookJson<{ id?: string }>({
    accessToken,
    path: `/me/calendar?$select=${encodeURIComponent("id")}`,
    errorPrefix: "Outlook default calendar lookup failed"
  });
  return typeof payload.id === "string" ? payload.id : null;
}

export const outlookProviderClient: SourceOutlookProviderClient = {
  provider: "outlook",
  buildAuthorizationUrl(input) {
    const url = new URL(MICROSOFT_AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OUTLOOK_SCOPES);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },
  async exchangeCode(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      scope: OUTLOOK_SCOPES
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: MICROSOFT_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "Outlook OAuth exchange failed"
    });
    return buildStoredSourceTokens({ payload });
  },
  async refreshTokens(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: OUTLOOK_SCOPES
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: MICROSOFT_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "Outlook token refresh failed"
    });
    return buildStoredSourceTokens({ payload, fallbackRefreshToken: input.refreshToken });
  },
  async fetchAccountProfile(input): Promise<SourceAccountProfile> {
    const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me`);
    url.searchParams.set("$select", "id,displayName,userPrincipalName");
    const payload = await fetchJsonOrThrow<{ id?: string; displayName?: string; userPrincipalName?: string }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "Outlook account lookup failed"
    });
    return {
      accountId: payload.id ?? null,
      accountLabel: payload.userPrincipalName ?? payload.displayName ?? null
    };
  },
  async searchMessages(input): Promise<SourceMessageSearchResult> {
    const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/messages`);
    url.searchParams.set("$top", `${input.limit ?? 25}`);
    url.searchParams.set("$select", MESSAGE_SELECT);
    url.searchParams.set("$search", buildSearchQueryLiteral(input.query.trim()));
    const payload = await fetchJsonOrThrow<{ value?: GraphMessage[] }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "Outlook message search failed"
    });
    return {
      items: (payload.value ?? []).map(normalizeMessage)
    };
  },
  async getMessage(input): Promise<SourceMessageDetail> {
    const path = `/me/messages/${encodePathSegment(input.messageId)}?$select=${encodeURIComponent(MESSAGE_DETAIL_SELECT)}`;
    const payload = await fetchOutlookJson<GraphMessage>({
      accessToken: input.accessToken,
      path,
      bodyFormat: input.bodyFormat ?? "text",
      errorPrefix: "Outlook message lookup failed"
    });
    return normalizeMessageDetail(payload);
  },
  async listCalendars(input): Promise<SourceCalendarListResult> {
    const defaultCalendarId = await fetchDefaultCalendarId(input.accessToken);
    const path = `/me/calendars?$top=${input.limit ?? 50}&$select=${encodeURIComponent(CALENDAR_SELECT)}`;
    const payload = await fetchOutlookJson<{ value?: GraphCalendar[] }>({
      accessToken: input.accessToken,
      path,
      errorPrefix: "Outlook calendar list failed"
    });

    return {
      defaultCalendarId,
      items: (payload.value ?? []).map((entry) => normalizeCalendar(entry, defaultCalendarId))
    };
  },
  async searchCalendarEvents(input): Promise<SourceCalendarSearchResult> {
    const payload = await fetchOutlookJson<GraphSearchResponse>({
      accessToken: input.accessToken,
      path: "/search/query",
      method: "POST",
      extraHeaders: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            entityTypes: ["event"],
            query: {
              queryString: input.query.trim()
            },
            from: 0,
            size: input.limit ?? 25
          }
        ]
      }),
      errorPrefix: "Outlook calendar search failed"
    });

    const hits = payload.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
    return {
      items: hits
        .map((entry) => entry.resource)
        .filter((entry): entry is GraphEvent => !!entry && typeof entry.id === "string")
        .map((entry) => normalizeEvent(entry, null))
    };
  },
  async viewCalendar(input): Promise<SourceCalendarViewResult> {
    const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}${buildCalendarViewPath(input.calendarId)}`);
    url.searchParams.set("startDateTime", input.startDateTime);
    url.searchParams.set("endDateTime", input.endDateTime);
    url.searchParams.set("$top", `${input.limit ?? 100}`);
    url.searchParams.set("$select", EVENT_SELECT);
    const payload = await fetchJsonOrThrow<{ value?: GraphEvent[] }>({
      url: url.toString(),
      headers: buildOutlookHeaders({
        accessToken: input.accessToken,
        timezone: input.timezone ?? null
      }),
      errorPrefix: "Outlook calendar view failed"
    });

    return {
      calendarId: input.calendarId,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      timezone: input.timezone ?? null,
      items: (payload.value ?? []).map((entry) => normalizeEvent(entry, input.calendarId))
    };
  },
  async getCalendarEvent(input): Promise<SourceEventDetail> {
    const path = `${buildEventItemPath(input.calendarId, input.eventId)}?$select=${encodeURIComponent(EVENT_DETAIL_SELECT)}`;
    const payload = await fetchOutlookJson<GraphEvent>({
      accessToken: input.accessToken,
      path,
      timezone: input.timezone ?? null,
      bodyFormat: input.bodyFormat ?? "text",
      errorPrefix: "Outlook event lookup failed"
    });
    return normalizeEventDetail(payload, input.calendarId);
  },
  async createCalendarEvent(input): Promise<SourceEventDetail> {
    const payload = await fetchOutlookJson<GraphEvent>({
      accessToken: input.accessToken,
      path: buildEventCollectionPath(input.event.calendarId),
      method: "POST",
      timezone: input.timezone ?? null,
      bodyFormat: input.bodyFormat ?? "text",
      extraHeaders: { "content-type": "application/json" },
      body: JSON.stringify(buildEventCreatePayload(input.event)),
      errorPrefix: "Outlook event creation failed"
    });
    return normalizeEventDetail(payload, input.event.calendarId);
  },
  async updateCalendarEvent(input): Promise<SourceEventDetail> {
    const payload = await fetchOutlookJson<GraphEvent>({
      accessToken: input.accessToken,
      path: `${buildEventItemPath(input.event.calendarId, input.eventId)}?$select=${encodeURIComponent(EVENT_DETAIL_SELECT)}`,
      method: "PATCH",
      timezone: input.timezone ?? null,
      bodyFormat: input.bodyFormat ?? "text",
      extraHeaders: { "content-type": "application/json" },
      body: JSON.stringify(buildEventUpdatePayload(input.event)),
      errorPrefix: "Outlook event update failed"
    });
    return normalizeEventDetail(payload, input.event.calendarId);
  },
  async deleteCalendarEvent(input): Promise<void> {
    const response = await fetch(`${MICROSOFT_GRAPH_BASE_URL}${buildEventItemPath(input.calendarId, input.eventId)}`, {
      method: "DELETE",
      headers: buildSourceBearerHeaders(input.accessToken)
    });
    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Outlook event delete failed: ${payload || `HTTP ${response.status}`}`);
    }
  }
};
