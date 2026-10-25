/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{delete window.meowbertDesktop;vi.resetModules();});
it("asks older desktop versions to update without invoking their destructive retry action",async()=>{
  const retry=vi.fn();window.meowbertDesktop={capabilities:{isDesktop:true},retryLocalExecution:retry} as never;
  vi.resetModules();const {platform}=await import("./platform");
  expect(await platform.checkSandboxUpdates()).toEqual({state:"error",message:"Update Meowbert Desktop to check sandbox updates safely."});
  expect(retry).not.toHaveBeenCalled();
});
it("uses the safe native update action and status subscription when provided",async()=>{
  const check=vi.fn().mockResolvedValue({state:"checking",message:null});const unsubscribe=vi.fn();const subscribe=vi.fn().mockReturnValue(unsubscribe);
  window.meowbertDesktop={capabilities:{isDesktop:true},checkSandboxUpdates:check,onLocalExecutionStatusChanged:subscribe} as never;
  vi.resetModules();const {platform}=await import("./platform");
  expect(await platform.checkSandboxUpdates()).toEqual({state:"checking",message:null});
  const listener=vi.fn();platform.onLocalExecutionStatusChanged(listener)();
  expect(subscribe).toHaveBeenCalledWith(listener);expect(unsubscribe).toHaveBeenCalledOnce();
});
