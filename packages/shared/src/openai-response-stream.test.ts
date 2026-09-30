import { describe, expect, it, vi } from "vitest";
import { streamResponseToFinal } from "./openai-response-stream.js";

function createEventStream(events: unknown[], errorAfterEvents?: unknown): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }

      if (errorAfterEvents !== undefined) {
        throw errorAfterEvents;
      }
    }
  };
}

describe("streamResponseToFinal", () => {
  it("calls responses.create with stream:true and uses the terminal response event", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.created",
        response: {
          output: []
        }
      },
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Hello"
                },
                {
                  type: "output_text",
                  text: " world"
                }
              ]
            }
          ]
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(createMock).toHaveBeenCalledWith({
      model: "gpt-test",
      input: "hi",
      stream: true
    }, undefined);
    expect(response.output_text).toBe("Hello world");
  });

  it("returns at the terminal response event without waiting for the stream to close", async () => {
    const iterator = {
      next: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "done"
                    }
                  ]
                }
              ]
            }
          }
        })
        .mockImplementation(() => new Promise<IteratorResult<unknown>>(() => {})),
      return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      [Symbol.asyncIterator]() {
        return this;
      }
    };
    const createMock = vi.fn().mockResolvedValue(iterator);

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("done");
    expect(iterator.next).toHaveBeenCalledTimes(1);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it("strips SDK-only parsed fields before returning the final response", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "function_call",
              name: "demo_tool",
              arguments: "{\"ok\":true}",
              parsed_arguments: {
                ok: true
              }
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "done",
                  parsed: {
                    done: true
                  }
                }
              ]
            }
          ],
          output_parsed: {
            done: true
          }
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response).not.toHaveProperty("output_parsed");
    expect(response.output[0]).not.toHaveProperty("parsed_arguments");
    expect(response.output[1]).toMatchObject({
      type: "message"
    });
    const messageOutput = response.output[1] as { content?: Array<Record<string, unknown>> };
    expect(messageOutput.content?.[0]).not.toHaveProperty("parsed");
  });

  it("throws when the stream ends with 0 events", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([]));

    await expect(streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    })).rejects.toThrow("Stream ended without any response events.");
  });

  it("throws when the stream ends without content or a terminal response event", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.created",
        response: {
          id: "resp_created",
          status: "in_progress",
          output: []
        }
      }
    ]));

    await expect(streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    })).rejects.toThrow("Stream ended without a terminal response event.");
  });

  it("recovers streamed deltas when the stream ends without done or terminal events", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: []
        }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Hello from partial stream"
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("Hello from partial stream");
  });

  it("recovers streamed deltas when the stream parser errors after emitting content", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: []
        }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Recovered content"
      }
    ], new SyntaxError("Unexpected end of JSON input")));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("Recovered content");
  });

  it("returns the terminal response when the stream parser errors after completion", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "done"
                }
              ]
            }
          ]
        }
      }
    ], new SyntaxError("Unexpected end of JSON input")));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("done");
  });

  it("prefers streamed output items when the terminal response is present but empty", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          name: "final_response",
          arguments: ""
        }
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "{\"response\":\"hello\""
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: ",\"notify\":true}"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          name: "final_response",
          arguments: "{\"response\":\"hello\",\"notify\":true}"
        }
      },
      {
        type: "response.completed",
        response: {
          id: "resp_123",
          output: []
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response).toMatchObject({
      id: "resp_123",
      output: [
        {
          type: "function_call",
          name: "final_response",
          arguments: "{\"response\":\"hello\",\"notify\":true}"
        }
      ]
    });
  });

  it("synthesizes a final response from output item events when terminal response events are missing", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          name: "set_task_title",
          arguments: "",
          parsed_arguments: {
            title: "ignored"
          }
        }
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "{\"title\":\""
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "Weekly infra report"
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "\"}"
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 0,
        arguments: "{\"title\":\"Weekly infra report\"}"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          name: "set_task_title",
          arguments: "{\"title\":\"Weekly infra report\"}",
          parsed_arguments: {
            title: "ignored"
          }
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output).toEqual([
      {
        type: "function_call",
        name: "set_task_title",
        arguments: "{\"title\":\"Weekly infra report\"}"
      }
    ]);
  });

  it("synthesizes message text from output text delta events when top-level response events are missing", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: []
        }
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: ""
        }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Hello"
      },
      {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text: "Hello world"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Hello world",
              parsed: {
                hello: true
              }
            }
          ]
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("Hello world");
    expect(response.output[0]).toEqual({
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "Hello world"
        }
      ]
    });
  });

  it("keeps clean delta text when done events repeat the accumulated content", async () => {
    const cleanText = "Good catch.\n\nDetails.";
    const doubledText = `${cleanText}\n${cleanText}`;
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: []
        }
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: ""
        }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Good catch."
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "\n\nDetails."
      },
      {
        type: "response.content_part.done",
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: doubledText
        }
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: doubledText
            }
          ]
        }
      },
      {
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: doubledText
                }
              ]
            }
          ]
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe(cleanText);
    expect(response.output).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: cleanText
          }
        ]
      }
    ]);
  });

  it("uses accumulated text snapshots from compatible delta streams instead of appending them", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: []
        }
      },
      {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: ""
        }
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Hello",
        snapshot: "Hello"
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Hello world",
        snapshot: "Hello world"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Hello world"
            }
          ]
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output_text).toBe("Hello world");
  });

  it("uses accumulated argument snapshots from compatible function-call delta streams", async () => {
    const createMock = vi.fn().mockResolvedValue(createEventStream([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "function_call",
          name: "final_response",
          arguments: ""
        }
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "{\"response\":\"",
        snapshot: "{\"response\":\""
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 0,
        delta: "{\"response\":\"done\",\"notify\":true}",
        snapshot: "{\"response\":\"done\",\"notify\":true}"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          name: "final_response",
          arguments: "{\"response\":\"done\",\"notify\":true}"
        }
      }
    ]));

    const response = await streamResponseToFinal({
      responses: {
        create: createMock
      }
    }, {
      model: "gpt-test",
      input: "hi"
    });

    expect(response.output[0]).toMatchObject({
      type: "function_call",
      name: "final_response",
      arguments: "{\"response\":\"done\",\"notify\":true}"
    });
  });
});
