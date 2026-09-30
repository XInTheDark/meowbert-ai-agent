import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pcloudProviderClient } from "./pcloud.js";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("pcloudProviderClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges OAuth codes against the callback hostname", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      result: 0,
      access_token: "pcloud-token",
      token_type: "bearer",
      uid: 123
    }));

    const tokens = await pcloudProviderClient.exchangeCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://app.example.com/callback",
      code: "oauth-code",
      codeVerifier: "unused",
      callbackQuery: {
        hostname: "eapi.pcloud.com",
        locationid: "2"
      }
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.hostname).toBe("eapi.pcloud.com");
    expect(requestUrl.pathname).toBe("/oauth2_token");
    expect(tokens.raw.hostname).toBe("eapi.pcloud.com");
    expect(tokens.accessToken).toBe("pcloud-token");
  });

  it("browses pCloud folders using the stored API hostname", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      result: 0,
      metadata: {
        id: "d0",
        folderid: 0,
        isfolder: true,
        name: "/",
        contents: [
          {
            id: "f10",
            fileid: 10,
            parentfolderid: 0,
            isfolder: false,
            name: "notes.txt",
            contenttype: "text/plain",
            size: 12,
            modified: "Thu, 19 Sep 2013 07:31:46 +0000"
          }
        ]
      }
    }));

    const result = await pcloudProviderClient.browse({
      accessToken: "pcloud-token",
      tokens: {
        accessToken: "pcloud-token",
        refreshToken: null,
        expiresAt: null,
        scope: null,
        tokenType: "bearer",
        raw: { hostname: "eapi.pcloud.com" }
      },
      folderId: null,
      limit: 25
    });

    expect(result.items).toEqual([
      {
        id: "f10",
        name: "notes.txt",
        displayPath: null,
        kind: "file",
        mimeType: "text/plain",
        sizeBytes: 12,
        modifiedAt: "2013-09-19T07:31:46.000Z",
        parentId: "d0"
      }
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.hostname).toBe("eapi.pcloud.com");
    expect(requestUrl.pathname).toBe("/listfolder");
    expect(requestUrl.searchParams.get("access_token")).toBe("pcloud-token");
    expect(requestUrl.searchParams.get("folderid")).toBe("0");
  });

  it("searches recursively by file name and path", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      result: 0,
      metadata: {
        id: "d0",
        folderid: 0,
        isfolder: true,
        name: "/",
        contents: [
          {
            id: "d20",
            folderid: 20,
            isfolder: true,
            name: "Archive",
            path: "/Archive",
            contents: [
              {
                id: "f30",
                fileid: 30,
                parentfolderid: 20,
                isfolder: false,
                name: "Q1 planning.pdf",
                path: "/Archive/Q1 planning.pdf",
                contenttype: "application/pdf",
                size: "42"
              }
            ]
          }
        ]
      }
    }));

    const result = await pcloudProviderClient.search({
      accessToken: "pcloud-token",
      query: "planning",
      limit: 10
    });

    expect(result.items.map((item) => item.id)).toEqual(["f30"]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("recursive")).toBe("1");
  });

  it("resolves pCloud paths explicitly", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      result: 0,
      metadata: {
        id: "f30",
        fileid: 30,
        parentfolderid: 20,
        isfolder: false,
        name: "Q1 planning.pdf",
        path: "/Archive/Q1 planning.pdf",
        contenttype: "application/pdf",
        size: "42"
      }
    }));

    const result = await pcloudProviderClient.resolvePath({
      accessToken: "pcloud-token",
      path: "Archive/Q1 planning.pdf"
    });

    expect(result.items).toEqual([
      {
        id: "f30",
        name: "Q1 planning.pdf",
        displayPath: "/Archive/Q1 planning.pdf",
        kind: "file",
        mimeType: "application/pdf",
        sizeBytes: 42,
        modifiedAt: null,
        parentId: "d20"
      }
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/stat");
    expect(requestUrl.searchParams.get("path")).toBe("/Archive/Q1 planning.pdf");
  });

  it("resolves pCloud paths relative to the selected folder", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        result: 0,
        metadata: {
          id: "d20",
          folderid: 20,
          isfolder: true,
          name: "Archive",
          path: "/Archive"
        }
      }))
      .mockResolvedValueOnce(createJsonResponse({
        result: 0,
        metadata: {
          id: "f30",
          fileid: 30,
          parentfolderid: 20,
          isfolder: false,
          name: "Q1 planning.pdf",
          path: "/Archive/Q1 planning.pdf"
        }
      }));

    await pcloudProviderClient.resolvePath({
      accessToken: "pcloud-token",
      path: "Q1 planning.pdf",
      folderId: "d20"
    });

    const lookupUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(lookupUrl.searchParams.get("path")).toBe("/Archive/Q1 planning.pdf");
  });
});
