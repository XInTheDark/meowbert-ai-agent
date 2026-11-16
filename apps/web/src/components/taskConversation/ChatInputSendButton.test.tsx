/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInputSendButton, type ChatInputSendButtonProps } from "./ChatInputSendButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

function renderButton(overrides: Partial<ChatInputSendButtonProps> = {}) {
  const onClick = vi.fn();
  const onScheduleSend = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<ChatInputSendButton isSubmitting={false} submitBlockedByUploads={false}
    isQueuedSubmitPending={false} isSendButtonDisabled={false} onClick={onClick} onScheduleSend={onScheduleSend} {...overrides} />));
  return { onClick, onScheduleSend, button: container.querySelector("button")!,
    arrow: container.querySelector<HTMLButtonElement>('[aria-label="Send options"]') };
}

describe("Schedule send", () => {
  it("opens the picker from the arrow without sending immediately", () => {
    const view = renderButton();
    act(() => view.arrow!.click());
    expect(view.arrow!.getAttribute("aria-expanded")).toBe("true");
    act(() => (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(view.onScheduleSend).toHaveBeenCalledOnce();
    expect(view.onClick).not.toHaveBeenCalled();
  });

  it("toggles the menu from the arrow and dismisses it with Escape or an outside click", () => {
    const view = renderButton();
    act(() => view.arrow!.click());
    act(() => {
      view.arrow!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      view.arrow!.click();
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => view.arrow!.click());
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(view.arrow);
    act(() => view.arrow!.click());
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(view.arrow!.getAttribute("aria-expanded")).toBe("false");
  });

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
    const view = renderButton({ submitBlockedByUploads: true });
    act(() => view.button.click());
    expect(view.onClick).toHaveBeenCalledOnce();
    expect(view.arrow!.disabled).toBe(true);
    act(() => view.arrow!.click());
    act(() => view.button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(view.onScheduleSend).not.toHaveBeenCalled();
  });

  it("keeps the main button sending immediately", () => {
    const view = renderButton();
    act(() => view.button.click());
    expect(view.onClick).toHaveBeenCalledOnce();
    expect(view.onScheduleSend).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("disables both actions when sending is unavailable", () => {
    const view = renderButton({ isSendButtonDisabled: true });
    expect(view.arrow!.disabled).toBe(true);
    act(() => { view.button.click(); view.arrow!.click(); });
    act(() => view.button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(view.onClick).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps a single Send button when scheduling is unavailable", () => {
    const view = renderButton({ onScheduleSend: undefined });
    expect(view.arrow).toBeNull();
    act(() => view.button.click());
    expect(view.onClick).toHaveBeenCalledOnce();
  });
});
