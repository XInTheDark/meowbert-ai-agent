interface StreamFinalResponseLike {
  output: unknown[];
  output_text?: string;
  output_parsed?: unknown;
}

interface MutableResponseSnapshot extends StreamFinalResponseLike, Record<string, unknown> {}

interface ResponseStreamEventLike<TResponse> {
  type?: unknown;
  response?: TResponse;
  output_index?: unknown;
  content_index?: unknown;
  item?: unknown;
  part?: unknown;
  delta?: unknown;
  snapshot?: unknown;
  text?: unknown;
  arguments?: unknown;
}

interface ResponseEventStreamLike<TEvent> extends AsyncIterable<TEvent> {}

interface ResponseStreamingClientLike<TResponse, TRequest extends Record<string, unknown>, TOptions> {
  responses: {
    create(
      request: TRequest,
      options?: TOptions
    ): Promise<ResponseEventStreamLike<ResponseStreamEventLike<TResponse>> | TResponse>;
  };
}

interface ResponseStreamCaptureHooks<TEvent> {
  onEvent?: (event: TEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function cloneJsonLike<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonLike(entry)) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonLike(entry)])
    ) as T;
  }

  return value;
}

function buildOutputText(output: unknown[]): string {
  const texts: string[] = [];

  for (const outputItem of output) {
    if (!isRecord(outputItem) || outputItem.type !== "message" || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem) && contentItem.type === "output_text" && typeof contentItem.text === "string") {
        texts.push(contentItem.text);
      }
    }
  }

  return texts.join("");
}

function repeatsText(value: string, repeatedText: string): boolean {
  return (
    repeatedText.length > 0
    && (
      value === `${repeatedText}${repeatedText}`
      || value === `${repeatedText}\n${repeatedText}`
    )
  );
}

function sanitizeOutputItem(item: unknown): unknown {
  if (!isRecord(item)) {
    return item;
  }

  if (item.type === "function_call") {
    const { parsed_arguments: _parsedArguments, ...cleanedItem } = item;
    return cleanedItem;
  }

  if (item.type === "message" && Array.isArray(item.content)) {
    return {
      ...item,
      content: item.content.map((contentItem) => {
        if (!isRecord(contentItem)) {
          return contentItem;
        }

        const { parsed: _parsed, ...cleanedContentItem } = contentItem;
        return cleanedContentItem;
      })
    };
  }

  return item;
}

function normalizeResponse<TResponse extends StreamFinalResponseLike>(response: TResponse): TResponse {
  const responseRecord = response as StreamFinalResponseLike;
  const { output_parsed: _outputParsed, ...cleanedResponse } = responseRecord;
  const rawOutput = Array.isArray(responseRecord.output) ? responseRecord.output : [];
  const normalizedResponse: StreamFinalResponseLike = {
    ...cleanedResponse,
    output: rawOutput.filter(isRecord).map((outputItem) => sanitizeOutputItem(outputItem))
  };

  if (typeof normalizedResponse.output_text !== "string") {
    normalizedResponse.output_text = buildOutputText(normalizedResponse.output);
  }

  return normalizedResponse as TResponse;
}

function isAsyncIterable<TEvent>(value: unknown): value is ResponseEventStreamLike<TEvent> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isTerminalResponseEvent<TResponse>(
  event: ResponseStreamEventLike<TResponse>
): event is ResponseStreamEventLike<TResponse> & { type: "response.completed" | "response.failed" | "response.incomplete"; response: TResponse } {
  return (
    (event.type === "response.completed" || event.type === "response.failed" || event.type === "response.incomplete")
    && event.response !== undefined
  );
}

function createEmptySnapshot(): MutableResponseSnapshot {
  return {
    output: []
  };
}

function cloneSnapshot<TResponse extends StreamFinalResponseLike>(response: TResponse): MutableResponseSnapshot {
  return cloneJsonLike(response) as unknown as MutableResponseSnapshot;
}

function ensureSnapshot(snapshot: MutableResponseSnapshot | null): MutableResponseSnapshot {
  return snapshot ?? createEmptySnapshot();
}

function ensureOutputItem(snapshot: MutableResponseSnapshot, outputIndex: number): Record<string, unknown> | null {
  while (snapshot.output.length <= outputIndex) {
    snapshot.output.push(undefined);
  }

  const current = snapshot.output[outputIndex];
  if (isRecord(current)) {
    return current;
  }

  const nextItem: Record<string, unknown> = {};
  snapshot.output[outputIndex] = nextItem;
  return nextItem;
}

function ensureOutputContentPart(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  contentIndex: number,
  fallbackType: "output_text" | "reasoning_text"
): Record<string, unknown> | null {
  const outputItem = ensureOutputItem(snapshot, outputIndex);
  if (!outputItem) {
    return null;
  }

  if (!Array.isArray(outputItem.content)) {
    outputItem.content = [];
  }

  const content = outputItem.content as unknown[];
  while (content.length <= contentIndex) {
    content.push(undefined);
  }

  const current = content[contentIndex];
  if (isRecord(current)) {
    return current;
  }

  const nextPart: Record<string, unknown> = {
    type: fallbackType,
    text: ""
  };
  content[contentIndex] = nextPart;
  return nextPart;
}

function appendFunctionCallArguments(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  delta: string
): void {
  const outputItem = ensureOutputItem(snapshot, outputIndex);
  if (!outputItem) {
    return;
  }

  if (typeof outputItem.type !== "string") {
    outputItem.type = "function_call";
  }

  const existingArguments = typeof outputItem.arguments === "string" ? outputItem.arguments : "";
  outputItem.arguments = `${existingArguments}${delta}`;
}

function setFunctionCallArguments(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  argumentsText: string
): void {
  const outputItem = ensureOutputItem(snapshot, outputIndex);
  if (!outputItem) {
    return;
  }

  if (typeof outputItem.type !== "string") {
    outputItem.type = "function_call";
  }

  outputItem.arguments = argumentsText;
}

function appendOutputTextDelta(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  contentIndex: number,
  delta: string
): void {
  const contentPart = ensureOutputContentPart(snapshot, outputIndex, contentIndex, "output_text");
  if (!contentPart) {
    return;
  }

  if (typeof contentPart.type !== "string") {
    contentPart.type = "output_text";
  }

  const existingText = typeof contentPart.text === "string" ? contentPart.text : "";
  contentPart.text = `${existingText}${delta}`;
}

function setOutputText(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  contentIndex: number,
  text: string
): void {
  const contentPart = ensureOutputContentPart(snapshot, outputIndex, contentIndex, "output_text");
  if (!contentPart) {
    return;
  }

  contentPart.type = "output_text";
  contentPart.text = text;
}

function getOutputTextPartText(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  contentIndex: number
): string {
  const outputItem = snapshot.output[outputIndex];
  if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
    return "";
  }

  const contentPart = outputItem.content[contentIndex];
  if (!isRecord(contentPart) || typeof contentPart.text !== "string") {
    return "";
  }

  return contentPart.text;
}

function setContentPart(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  contentIndex: number,
  part: unknown
): void {
  const outputItem = ensureOutputItem(snapshot, outputIndex);
  if (!outputItem) {
    return;
  }

  if (!Array.isArray(outputItem.content)) {
    outputItem.content = [];
  }

  const content = outputItem.content as unknown[];
  while (content.length <= contentIndex) {
    content.push(undefined);
  }

  if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
    const existingText = getOutputTextPartText(snapshot, outputIndex, contentIndex);
    if (repeatsText(part.text, existingText)) {
      return;
    }
  }

  content[contentIndex] = cloneJsonLike(part);
}

function replaceOutputItem(
  snapshot: MutableResponseSnapshot,
  outputIndex: number,
  item: unknown
): void {
  while (snapshot.output.length <= outputIndex) {
    snapshot.output.push(undefined);
  }

  const current = snapshot.output[outputIndex];
  if (isRecord(current) && isRecord(item) && item.type === "message") {
    const currentText = buildOutputText([current]);
    const nextText = buildOutputText([item]);
    if (repeatsText(nextText, currentText)) {
      return;
    }
  }

  snapshot.output[outputIndex] = cloneJsonLike(item);
}

function accumulateCompatibleResponseEvent<TResponse extends StreamFinalResponseLike>(
  snapshot: MutableResponseSnapshot | null,
  event: ResponseStreamEventLike<TResponse>
): {
  snapshot: MutableResponseSnapshot | null;
  sawCompatibleCompletion: boolean;
} {
  if (event.type === "response.created" && event.response) {
    return {
      snapshot: cloneSnapshot(event.response),
      sawCompatibleCompletion: false
    };
  }

  let nextSnapshot = snapshot;
  let sawCompatibleCompletion = false;

  if (event.type === "response.output_item.added" && isNonNegativeInteger(event.output_index)) {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    replaceOutputItem(nextSnapshot, event.output_index, event.item);
    return { snapshot: nextSnapshot, sawCompatibleCompletion };
  }

  if (event.type === "response.output_item.done" && isNonNegativeInteger(event.output_index)) {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    replaceOutputItem(nextSnapshot, event.output_index, event.item);
    return { snapshot: nextSnapshot, sawCompatibleCompletion: true };
  }

  if (event.type === "response.function_call_arguments.delta" && isNonNegativeInteger(event.output_index) && typeof event.delta === "string") {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    if (typeof event.snapshot === "string") {
      setFunctionCallArguments(nextSnapshot, event.output_index, event.snapshot);
    } else {
      appendFunctionCallArguments(nextSnapshot, event.output_index, event.delta);
    }
    return { snapshot: nextSnapshot, sawCompatibleCompletion };
  }

  if (event.type === "response.function_call_arguments.done" && isNonNegativeInteger(event.output_index) && typeof event.arguments === "string") {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    setFunctionCallArguments(nextSnapshot, event.output_index, event.arguments);
    return { snapshot: nextSnapshot, sawCompatibleCompletion: true };
  }

  if (event.type === "response.content_part.added" && isNonNegativeInteger(event.output_index) && isNonNegativeInteger(event.content_index)) {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    setContentPart(nextSnapshot, event.output_index, event.content_index, event.part);
    return { snapshot: nextSnapshot, sawCompatibleCompletion };
  }

  if (event.type === "response.content_part.done" && isNonNegativeInteger(event.output_index) && isNonNegativeInteger(event.content_index)) {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    setContentPart(nextSnapshot, event.output_index, event.content_index, event.part);
    return { snapshot: nextSnapshot, sawCompatibleCompletion: true };
  }

  if (event.type === "response.output_text.delta" && isNonNegativeInteger(event.output_index) && isNonNegativeInteger(event.content_index) && typeof event.delta === "string") {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    if (typeof event.snapshot === "string") {
      setOutputText(nextSnapshot, event.output_index, event.content_index, event.snapshot);
    } else {
      appendOutputTextDelta(nextSnapshot, event.output_index, event.content_index, event.delta);
    }
    return { snapshot: nextSnapshot, sawCompatibleCompletion };
  }

  if (event.type === "response.output_text.done" && isNonNegativeInteger(event.output_index) && isNonNegativeInteger(event.content_index) && typeof event.text === "string") {
    nextSnapshot = ensureSnapshot(nextSnapshot);
    setOutputText(nextSnapshot, event.output_index, event.content_index, event.text);
    return { snapshot: nextSnapshot, sawCompatibleCompletion: true };
  }

  return {
    snapshot: nextSnapshot,
    sawCompatibleCompletion
  };
}

function normalizeCompatibleSnapshot<TResponse extends StreamFinalResponseLike>(
  snapshot: MutableResponseSnapshot
): TResponse {
  const normalized = normalizeResponse(snapshot as unknown as TResponse) as unknown as MutableResponseSnapshot;
  if (!normalized.status || normalized.status === "in_progress") {
    normalized.status = "completed";
  }
  return normalized as unknown as TResponse;
}

function hasCompatibleSnapshotContent(snapshot: MutableResponseSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }

  if (typeof snapshot.output_text === "string" && snapshot.output_text.trim().length > 0) {
    return true;
  }

  if (!Array.isArray(snapshot.output) || snapshot.output.length === 0) {
    return false;
  }

  for (const item of snapshot.output) {
    if (!isRecord(item)) continue;
    if (item.type === "function_call") {
      if (typeof item.name === "string" && item.name.length > 0) {
        return true;
      }
      if (typeof item.arguments === "string" && item.arguments.length > 0) {
        return true;
      }
    }
    if (item.type === "message") {
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (isRecord(part) && typeof part.text === "string" && part.text.length > 0) {
            return true;
          }
        }
      }
    }
    if (typeof item.text === "string" && item.text.length > 0) {
      return true;
    }
  }

  return false;
}

function shouldMergeCompatibleSnapshot<TResponse extends StreamFinalResponseLike>(
  terminalResponse: TResponse,
  compatibleSnapshot: MutableResponseSnapshot | null,
  sawCompatibleCompletion: boolean
): compatibleSnapshot is MutableResponseSnapshot {
  if (!compatibleSnapshot || !sawCompatibleCompletion) {
    return false;
  }

  const terminalOutputCount = Array.isArray(terminalResponse.output) ? terminalResponse.output.length : 0;
  const snapshotOutputCount = compatibleSnapshot.output.length;
  if (snapshotOutputCount > terminalOutputCount) {
    return true;
  }

  const terminalOutputText = typeof terminalResponse.output_text === "string"
    ? terminalResponse.output_text
    : buildOutputText(terminalResponse.output);
  const snapshotOutputText = buildOutputText(compatibleSnapshot.output);
  if (repeatsText(terminalOutputText, snapshotOutputText)) {
    return true;
  }

  return terminalOutputText.length === 0 && snapshotOutputText.length > 0;
}

function mergeTerminalResponseWithCompatibleSnapshot<TResponse extends StreamFinalResponseLike>(
  terminalResponse: TResponse,
  compatibleSnapshot: MutableResponseSnapshot
): TResponse {
  return {
    ...cloneSnapshot(terminalResponse),
    output: cloneJsonLike(compatibleSnapshot.output),
    ...(typeof compatibleSnapshot.output_text === "string"
      ? { output_text: compatibleSnapshot.output_text }
      : {})
  } as TResponse;
}

export async function streamResponseToFinal<
  TResponse extends StreamFinalResponseLike,
  TRequest extends Record<string, unknown>,
  TOptions
>(
  client: ResponseStreamingClientLike<TResponse, TRequest, TOptions>,
  request: TRequest,
  options?: TOptions,
  hooks?: ResponseStreamCaptureHooks<ResponseStreamEventLike<TResponse>>
): Promise<TResponse> {
  const stream = await client.responses.create({
    ...request,
    stream: true
  } as TRequest, options);

  if (!isAsyncIterable<ResponseStreamEventLike<TResponse>>(stream)) {
    throw new Error("Streaming create() did not return an async event stream.");
  }

  let terminalResponse: TResponse | null = null;
  let compatibleSnapshot: MutableResponseSnapshot | null = null;
  let sawCompatibleCompletion = false;
  let eventCount = 0;

  try {
    for await (const event of stream) {
      eventCount += 1;
      hooks?.onEvent?.(cloneJsonLike(event));
      if (isTerminalResponseEvent(event)) {
        terminalResponse = event.response;
      }

      const accumulated: {
        snapshot: MutableResponseSnapshot | null;
        sawCompatibleCompletion: boolean;
      } = accumulateCompatibleResponseEvent(compatibleSnapshot, event);
      compatibleSnapshot = accumulated.snapshot;
      sawCompatibleCompletion = sawCompatibleCompletion || accumulated.sawCompatibleCompletion;

      if (terminalResponse) {
        if (shouldMergeCompatibleSnapshot(terminalResponse, compatibleSnapshot, sawCompatibleCompletion)) {
          return normalizeResponse(mergeTerminalResponseWithCompatibleSnapshot(terminalResponse, compatibleSnapshot));
        }
        return normalizeResponse(terminalResponse);
      }
    }
  } catch (error) {
    if (terminalResponse) {
      // Some OpenAI-compatible proxies deliver a valid terminal response event and then
      // terminate the SSE stream without a clean trailing frame. Once we have the
      // terminal response object, prefer returning it instead of failing the whole turn.
      return normalizeResponse(terminalResponse);
    }

    if (compatibleSnapshot && hasCompatibleSnapshotContent(compatibleSnapshot)) {
      return normalizeCompatibleSnapshot<TResponse>(compatibleSnapshot);
    }

    throw error;
  }

  if (terminalResponse) {
    if (shouldMergeCompatibleSnapshot(terminalResponse, compatibleSnapshot, sawCompatibleCompletion)) {
      return normalizeResponse(mergeTerminalResponseWithCompatibleSnapshot(terminalResponse, compatibleSnapshot));
    }
    return normalizeResponse(terminalResponse);
  }

  if (compatibleSnapshot && hasCompatibleSnapshotContent(compatibleSnapshot)) {
    return normalizeCompatibleSnapshot<TResponse>(compatibleSnapshot);
  }

  if (eventCount === 0) {
    throw new Error("Stream ended without any response events.");
  }

  throw new Error("Stream ended without a terminal response event.");
}
