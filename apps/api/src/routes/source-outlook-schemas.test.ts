import { describe, expect, it } from "vitest";
import { outlookDeleteEventByIdQuery, outlookDeleteEventQuery } from "./source-outlook-schemas.js";

describe("Outlook attendee cancellation confirmation", () => {
  it.each([false, "false", undefined])("preserves unconfirmed input %s", (value) => {
    const parsed = outlookDeleteEventQuery.parse({ expectedChangeKey: "v1", confirmAttendeeCancellation: value });
    expect(parsed.confirmAttendeeCancellation).not.toBe(true);
  });

  it.each([true, "true"])("accepts explicit confirmation %s for both delete routes", (value) => {
    const input = { expectedChangeKey: "v1", confirmAttendeeCancellation: value };
    expect(outlookDeleteEventQuery.parse(input).confirmAttendeeCancellation).toBe(true);
    expect(outlookDeleteEventByIdQuery.parse({ ...input, eventId: "event-1" }).confirmAttendeeCancellation).toBe(true);
  });

  it.each(["0", "1", "FALSE", "yes", [], ["false", "true"]].map((value) => ({ value })))("rejects ambiguous confirmation $value", ({ value }) => {
    expect(outlookDeleteEventQuery.safeParse({ expectedChangeKey: "v1", confirmAttendeeCancellation: value }).success).toBe(false);
  });
});
