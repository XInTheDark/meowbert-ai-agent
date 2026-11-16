/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInputSendButton } from "./ChatInputSendButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function renderButton(blocked = false) {
  const onClick = vi.fn();
  const onScheduleSend = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<ChatInputSendButton isSubmitting={false} submitBlockedByUploads={blocked}
    isQueuedSubmitPending={false} isSendButtonDisabled={false} onClick={onClick} onScheduleSend={onScheduleSend} />));
  return { onClick, onScheduleSend, button: container.querySelector("button")! };
}

describe("Schedule send", () => {
  it("opens the picker from the right-click menu and schedules without sending immediately", () => {
    const view = renderButton();
    act(() => view.button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("Schedule send");
    act(() => (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    const expected = new Date(picker.value).toISOString();
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(view.onScheduleSend).toHaveBeenCalledWith(expected);
    expect(view.onClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preserves normal clicks and refuses scheduling unfinished uploads", () => {
    const view = renderButton(true);
    act(() => view.button.click());
    expect(view.onClick).toHaveBeenCalledOnce();
    act(() => view.button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(view.onScheduleSend).not.toHaveBeenCalled();
  });
});
