import { describe, expect, it } from "vitest";
import { SourceFileLinkActionError } from "./provider-errors.js";

describe("SourceFileLinkActionError", () => {
  it("marks live sync action failures as client-visible conflicts", () => {
    const error = new SourceFileLinkActionError("The local working copy is missing.");

    expect(error).toMatchObject({
      statusCode: 409,
      exposeMessage: true,
      message: "The local working copy is missing."
    });
  });
});
