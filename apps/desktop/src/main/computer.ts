import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  app,
  desktopCapturer,
  screen,
  shell,
  systemPreferences,
  type Display,
  type NativeImage
} from "electron";
import type {
  ComputerToolName,
  DesktopComputerDisplay,
  DesktopComputerExecutorResult,
  DesktopComputerObservation,
  DesktopComputerPermissionState,
  DesktopComputerStatus
} from "@meowbert/shared";
import { isVisualComputerToolName } from "@meowbert/shared";
import type { DesktopComputerActionInput } from "../shared";
import { buildComputerTypeSummary, getPostActionSettleDelayMs } from "./computerActionUtils";

const execFileAsync = promisify(execFile);
const SCREENSHOT_MAX_EDGE_PX = 1280;
const DEFAULT_JPEG_QUALITY = 80;
const DEFAULT_MOUSE_EVENT_DELAY_MS = 40;
const DEFAULT_KEY_HOLD_MS = 500;
const MAX_WAIT_MS = 30_000;
const DEFAULT_LOCAL_SHELL_TIMEOUT_MS = 30_000;
const MAX_LOCAL_SHELL_TIMEOUT_MS = 600_000;
const LOCAL_SHELL_MAX_BUFFER_BYTES = 1_000_000;

type PlatformComputerPermissionStatus = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

interface CoordinateSpace {
  display: DesktopComputerDisplay;
  displayBounds: Display["bounds"];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function delayMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePermissionState(value: string | undefined | null): PlatformComputerPermissionStatus {
  const normalized = value?.trim().toLowerCase() ?? "unknown";
  if (normalized === "granted") {
    return "granted";
  }
  if (normalized === "not-determined" || normalized === "prompt" || normalized === "unknown") {
    return "prompt";
  }
  if (normalized === "denied" || normalized === "restricted") {
    return "denied";
  }
  return "unknown";
}

function getAccessibilityPermissionState(): DesktopComputerPermissionState {
  if (process.platform === "darwin") {
    return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "prompt";
  }

  if (process.platform === "win32") {
    return "granted";
  }

  return "unsupported";
}

function getScreenRecordingPermissionState(): DesktopComputerPermissionState {
  if (process.platform === "darwin") {
    return normalizePermissionState(systemPreferences.getMediaAccessStatus("screen"));
  }

  if (process.platform === "win32") {
    return "granted";
  }

  return "unsupported";
}

function getPrimaryDisplay(): Display {
  return screen.getPrimaryDisplay();
}

function buildCoordinateSpace(): CoordinateSpace {
  const primaryDisplay = getPrimaryDisplay();
  const logicalWidth = Math.max(1, Math.round(primaryDisplay.size.width));
  const logicalHeight = Math.max(1, Math.round(primaryDisplay.size.height));
  const scale = Math.min(1, SCREENSHOT_MAX_EDGE_PX / Math.max(logicalWidth, logicalHeight));
  const coordinateSpaceWidth = Math.max(1, Math.round(logicalWidth * scale));
  const coordinateSpaceHeight = Math.max(1, Math.round(logicalHeight * scale));

  return {
    displayBounds: primaryDisplay.bounds,
    display: {
      id: String(primaryDisplay.id),
      label: `Primary display ${primaryDisplay.id}`,
      width: logicalWidth,
      height: logicalHeight,
      scaleFactor: primaryDisplay.scaleFactor,
      coordinateSpaceWidth,
      coordinateSpaceHeight
    }
  };
}

function toScreenshotCoordinate(value: number, sourceSize: number, targetSize: number): number {
  return Math.round((value / sourceSize) * targetSize);
}

function toDisplayCoordinate(value: number, sourceSize: number, targetSize: number): number {
  return Math.round((value / sourceSize) * targetSize);
}

function getCursorPositionForDisplay(coordinateSpace: CoordinateSpace): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint();
  const relativeX = clamp(cursor.x - coordinateSpace.displayBounds.x, 0, coordinateSpace.display.width);
  const relativeY = clamp(cursor.y - coordinateSpace.displayBounds.y, 0, coordinateSpace.display.height);

  return {
    x: toScreenshotCoordinate(relativeX, coordinateSpace.display.width, coordinateSpace.display.coordinateSpaceWidth),
    y: toScreenshotCoordinate(relativeY, coordinateSpace.display.height, coordinateSpace.display.coordinateSpaceHeight)
  };
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

const WINDOWS_COMPUTER_SCRIPT = `
$ActionJson = '__ACTION_JSON__'

Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeComputer {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$MOUSEEVENTF_MOVE = 0x0001
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP = 0x0040
$MOUSEEVENTF_WHEEL = 0x0800
$MOUSEEVENTF_HWHEEL = 0x01000
$KEYEVENTF_KEYUP = 0x0002

$action = $ActionJson | ConvertFrom-Json -Depth 8

function Move-Cursor([int]$x, [int]$y) {
  [NativeComputer]::SetCursorPos($x, $y) | Out-Null
}

function Click-Button([string]$button, [int]$count) {
  $downFlag = $MOUSEEVENTF_LEFTDOWN
  $upFlag = $MOUSEEVENTF_LEFTUP
  if ($button -eq "right") {
    $downFlag = $MOUSEEVENTF_RIGHTDOWN
    $upFlag = $MOUSEEVENTF_RIGHTUP
  } elseif ($button -eq "middle") {
    $downFlag = $MOUSEEVENTF_MIDDLEDOWN
    $upFlag = $MOUSEEVENTF_MIDDLEUP
  }

  for ($i = 0; $i -lt $count; $i++) {
    [NativeComputer]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeComputer]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
  }
}

function Escape-SendKeys([string]$text) {
  $escaped = $text.Replace("{", "{{}").Replace("}", "{}}")
  $escaped = $escaped.Replace("+", "{+}").Replace("^", "{^}").Replace("%", "{%}")
  $escaped = $escaped.Replace("~", "{~}").Replace("(", "{(}").Replace(")", "{)}")
  $escaped = $escaped.Replace("[", "{[}").Replace("]", "{]}")
  return $escaped
}

function Convert-ToSendKeys([string]$combo) {
  $parts = @($combo.ToLower().Split("+") | Where-Object { $_ -ne "" })
  if ($parts.Count -eq 0) {
    throw "Missing key combination."
  }

  $modifiers = @()
  $main = $parts[$parts.Count - 1]
  if ($parts.Count -gt 1) {
    $modifiers = $parts[0..($parts.Count - 2)]
  }

  $modifierPrefix = ""
  foreach ($modifier in $modifiers) {
    switch ($modifier) {
      "ctrl" { $modifierPrefix += "^" }
      "control" { $modifierPrefix += "^" }
      "shift" { $modifierPrefix += "+" }
      "alt" { $modifierPrefix += "%" }
      default { throw "Unsupported modifier: $modifier" }
    }
  }

  $special = @{
    "enter" = "{ENTER}"
    "return" = "{ENTER}"
    "tab" = "{TAB}"
    "space" = " "
    "escape" = "{ESC}"
    "esc" = "{ESC}"
    "backspace" = "{BACKSPACE}"
    "delete" = "{DELETE}"
    "del" = "{DELETE}"
    "up" = "{UP}"
    "down" = "{DOWN}"
    "left" = "{LEFT}"
    "right" = "{RIGHT}"
    "home" = "{HOME}"
    "end" = "{END}"
    "pageup" = "{PGUP}"
    "pagedown" = "{PGDN}"
    "f1" = "{F1}"
    "f2" = "{F2}"
    "f3" = "{F3}"
    "f4" = "{F4}"
    "f5" = "{F5}"
    "f6" = "{F6}"
    "f7" = "{F7}"
    "f8" = "{F8}"
    "f9" = "{F9}"
    "f10" = "{F10}"
    "f11" = "{F11}"
    "f12" = "{F12}"
  }

  if ($special.ContainsKey($main)) {
    return "$modifierPrefix$($special[$main])"
  }

  if ($main.Length -eq 1) {
    return "$modifierPrefix$main"
  }

  throw "Unsupported key combination: $combo"
}

function Get-VirtualKey([string]$keyName) {
  $normalized = $keyName.ToLower()
  $map = @{
    "shift" = 0x10
    "ctrl" = 0x11
    "control" = 0x11
    "alt" = 0x12
    "enter" = 0x0D
    "return" = 0x0D
    "tab" = 0x09
    "space" = 0x20
    "escape" = 0x1B
    "esc" = 0x1B
    "left" = 0x25
    "up" = 0x26
    "right" = 0x27
    "down" = 0x28
  }
  if ($map.ContainsKey($normalized)) {
    return $map[$normalized]
  }
  if ($normalized.Length -eq 1) {
    return [byte][char]$normalized.ToUpperInvariant()[0]
  }
  throw "Unsupported hold_key value: $keyName"
}

switch ($action.type) {
  "mouse_move" {
    Move-Cursor([int]$action.x, [int]$action.y)
  }
  "left_click" {
    Move-Cursor([int]$action.x, [int]$action.y)
    Click-Button("left", [int]$action.clickCount)
  }
  "right_click" {
    Move-Cursor([int]$action.x, [int]$action.y)
    Click-Button("right", 1)
  }
  "middle_click" {
    Move-Cursor([int]$action.x, [int]$action.y)
    Click-Button("middle", 1)
  }
  "left_mouse_down" {
    Move-Cursor([int]$action.x, [int]$action.y)
    [NativeComputer]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  }
  "left_mouse_up" {
    Move-Cursor([int]$action.x, [int]$action.y)
    [NativeComputer]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  }
  "left_click_drag" {
    Move-Cursor([int]$action.startX, [int]$action.startY)
    Start-Sleep -Milliseconds 40
    [NativeComputer]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    Move-Cursor([int]$action.endX, [int]$action.endY)
    Start-Sleep -Milliseconds 80
    [NativeComputer]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  }
  "scroll" {
    if ($null -ne $action.deltaY -and [int]$action.deltaY -ne 0) {
      [NativeComputer]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [uint32]([int]$action.deltaY), [UIntPtr]::Zero)
    }
    if ($null -ne $action.deltaX -and [int]$action.deltaX -ne 0) {
      [NativeComputer]::mouse_event($MOUSEEVENTF_HWHEEL, 0, 0, [uint32]([int]$action.deltaX), [UIntPtr]::Zero)
    }
  }
  "type" {
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys([string]$action.text)))
  }
  "key" {
    [System.Windows.Forms.SendKeys]::SendWait((Convert-ToSendKeys([string]$action.keys)))
  }
  "hold_key" {
    $vk = Get-VirtualKey([string]$action.key)
    [NativeComputer]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds ([int]$action.durationMs)
    [NativeComputer]::keybd_event([byte]$vk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  }
  "wait" {
    Start-Sleep -Milliseconds ([int]$action.durationMs)
  }
  default {
    throw "Unsupported action type: $($action.type)"
  }
}

$result = @{ ok = $true }
Write-Output ($result | ConvertTo-Json -Compress)
`;

const MAC_COMPUTER_SCRIPT = `
ObjC.import('Foundation');
ObjC.import('ApplicationServices');

const ACTION_JSON = __ACTION_JSON__;

function unwrap(value) {
  return ObjC.unwrap(value);
}

function getArguments() {
  return JSON.parse(ACTION_JSON);
}

function point(x, y) {
  return $.CGPointMake(x, y);
}

function releaseIfNeeded(value) {
  // JXA can bridge CoreGraphics event refs well enough for short-lived scripts,
  // but explicitly CFRelease'ing them here crashes osascript on macOS.
  void value;
}

function sleepMs(ms) {
  delay(Math.max(0, ms) / 1000);
}

function createMouseEvent(type, x, y, button) {
  return $.CGEventCreateMouseEvent(null, type, point(x, y), button);
}

function postMouse(type, x, y, button, clickState) {
  const event = createMouseEvent(type, x, y, button);
  if (clickState > 1) {
    $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, clickState);
  }
  $.CGEventPost($.kCGHIDEventTap, event);
  releaseIfNeeded(event);
}

const modifiers = {
  cmd: $.kCGEventFlagMaskCommand,
  command: $.kCGEventFlagMaskCommand,
  ctrl: $.kCGEventFlagMaskControl,
  control: $.kCGEventFlagMaskControl,
  shift: $.kCGEventFlagMaskShift,
  option: $.kCGEventFlagMaskAlternate,
  alt: $.kCGEventFlagMaskAlternate,
  fn: $.kCGEventFlagMaskSecondaryFn
};

const keyCodes = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, 1: 18, 2: 19,
  3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27,
  8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35,
  l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\\\': 42, ',': 43,
  '/': 44, n: 45, m: 46, '.': 47, '\`': 50,
  enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51,
  escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98,
  f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};

function resolveKeyCode(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(keyCodes, normalized)) {
    throw new Error('Unsupported key: ' + name);
  }
  return keyCodes[normalized];
}

function resolveFlags(parts) {
  let flags = 0;
  parts.forEach((part) => {
    const normalized = String(part).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(modifiers, normalized)) {
      flags |= modifiers[normalized];
    }
  });
  return flags;
}

function sendKeyEvent(keyName, isDown, flags) {
  const event = $.CGEventCreateKeyboardEvent(null, resolveKeyCode(keyName), isDown);
  if (flags) {
    $.CGEventSetFlags(event, flags);
  }
  $.CGEventPost($.kCGHIDEventTap, event);
  releaseIfNeeded(event);
}

function typeText(text) {
  Application('System Events').keystroke(String(text));
}

function pressKeyCombo(combo) {
  const parts = String(combo || '').split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Missing key combination.');
  }

  const keyName = parts[parts.length - 1];
  const flags = resolveFlags(parts.slice(0, -1));
  sendKeyEvent(keyName, true, flags);
  sleepMs(20);
  sendKeyEvent(keyName, false, flags);
}

function holdKey(keyName, durationMs) {
  sendKeyEvent(keyName, true, 0);
  sleepMs(durationMs);
  sendKeyEvent(keyName, false, 0);
}

function moveMouse(x, y) {
  $.CGWarpMouseCursorPosition(point(x, y));
  sleepMs(20);
}

function clickAt(x, y, button, count) {
  moveMouse(x, y);
  const downType = button === 'right' ? $.kCGEventRightMouseDown : button === 'center' ? $.kCGEventOtherMouseDown : $.kCGEventLeftMouseDown;
  const upType = button === 'right' ? $.kCGEventRightMouseUp : button === 'center' ? $.kCGEventOtherMouseUp : $.kCGEventLeftMouseUp;
  for (let index = 1; index <= count; index += 1) {
    postMouse(downType, x, y, button === 'right' ? $.kCGMouseButtonRight : button === 'center' ? $.kCGMouseButtonCenter : $.kCGMouseButtonLeft, index);
    sleepMs(20);
    postMouse(upType, x, y, button === 'right' ? $.kCGMouseButtonRight : button === 'center' ? $.kCGMouseButtonCenter : $.kCGMouseButtonLeft, index);
    sleepMs(40);
  }
}

function mouseDownAt(x, y) {
  moveMouse(x, y);
  postMouse($.kCGEventLeftMouseDown, x, y, $.kCGMouseButtonLeft, 1);
}

function mouseUpAt(x, y) {
  moveMouse(x, y);
  postMouse($.kCGEventLeftMouseUp, x, y, $.kCGMouseButtonLeft, 1);
}

function drag(startX, startY, endX, endY) {
  moveMouse(startX, startY);
  postMouse($.kCGEventLeftMouseDown, startX, startY, $.kCGMouseButtonLeft, 1);
  sleepMs(60);
  const dragEvent = createMouseEvent($.kCGEventLeftMouseDragged, endX, endY, $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, dragEvent);
  releaseIfNeeded(dragEvent);
  sleepMs(60);
  postMouse($.kCGEventLeftMouseUp, endX, endY, $.kCGMouseButtonLeft, 1);
}

function scrollBy(deltaY, deltaX) {
  const event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, deltaY || 0, deltaX || 0);
  $.CGEventPost($.kCGHIDEventTap, event);
  releaseIfNeeded(event);
}

// Avoid JXA's reserved run entrypoint name; osascript invokes that
// automatically, which would execute every computer action twice.
function main() {
  const action = getArguments();

  switch (action.type) {
    case 'mouse_move':
      moveMouse(action.x, action.y);
      break;
    case 'left_click':
      clickAt(action.x, action.y, 'left', action.clickCount || 1);
      break;
    case 'right_click':
      clickAt(action.x, action.y, 'right', 1);
      break;
    case 'middle_click':
      clickAt(action.x, action.y, 'center', 1);
      break;
    case 'left_mouse_down':
      mouseDownAt(action.x, action.y);
      break;
    case 'left_mouse_up':
      mouseUpAt(action.x, action.y);
      break;
    case 'left_click_drag':
      drag(action.startX, action.startY, action.endX, action.endY);
      break;
    case 'scroll':
      scrollBy(action.deltaY || 0, action.deltaX || 0);
      break;
    case 'type':
      typeText(action.text || '');
      break;
    case 'key':
      pressKeyCombo(action.keys || '');
      break;
    case 'hold_key':
      holdKey(action.key || '', action.durationMs || 0);
      break;
    case 'wait':
      sleepMs(action.durationMs || 0);
      break;
    default:
      throw new Error('Unsupported action type: ' + action.type);
  }

  return JSON.stringify({ ok: true });
}

try {
  console.log(main());
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error) }));
  throw error;
}
`;

function createUnsupportedResult(toolName: ComputerToolName, error: string): DesktopComputerExecutorResult {
  return {
    type: "computer_action_result",
    requestId: "",
    taskId: "",
    toolName,
    ok: false,
    error,
    completedAt: new Date().toISOString()
  };
}

function buildObservationText(input: {
  toolName: ComputerToolName;
  display: DesktopComputerDisplay;
  cursor: { x: number; y: number } | null;
  output: Record<string, unknown>;
}): string {
  const cursorText = input.cursor ? ` Cursor: (${input.cursor.x}, ${input.cursor.y}).` : "";
  const summary = typeof input.output.summary === "string" ? ` ${input.output.summary}` : "";
  return [
    `Computer observation after ${input.toolName}.`,
    `Primary display size: ${input.display.width}x${input.display.height}.`,
    `Coordinate space for future actions: ${input.display.coordinateSpaceWidth}x${input.display.coordinateSpaceHeight}.`,
    cursorText,
    summary
  ].join(" ").trim();
}

function validateFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

function parsePointArgs(args: Record<string, unknown>, coordinateSpace: CoordinateSpace): { screenshotX: number; screenshotY: number; logicalX: number; logicalY: number } {
  const screenshotX = clamp(
    Math.round(validateFiniteNumber(args.x, "x")),
    0,
    coordinateSpace.display.coordinateSpaceWidth
  );
  const screenshotY = clamp(
    Math.round(validateFiniteNumber(args.y, "y")),
    0,
    coordinateSpace.display.coordinateSpaceHeight
  );

  return {
    screenshotX,
    screenshotY,
    logicalX: toDisplayCoordinate(screenshotX, coordinateSpace.display.coordinateSpaceWidth, coordinateSpace.display.width),
    logicalY: toDisplayCoordinate(screenshotY, coordinateSpace.display.coordinateSpaceHeight, coordinateSpace.display.height)
  };
}

function toWindowsPhysicalPoint(input: { logicalX: number; logicalY: number; scaleFactor: number }): { x: number; y: number } {
  return {
    x: Math.round(input.logicalX * input.scaleFactor),
    y: Math.round(input.logicalY * input.scaleFactor)
  };
}

async function capturePrimaryDisplayScreenshot(): Promise<{
  image: NativeImage;
  display: DesktopComputerDisplay;
  cursor: { x: number; y: number } | null;
}> {
  const coordinateSpace = buildCoordinateSpace();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: coordinateSpace.display.coordinateSpaceWidth,
      height: coordinateSpace.display.coordinateSpaceHeight
    },
    fetchWindowIcons: false
  });
  const matched = sources.find((source) => source.display_id === coordinateSpace.display.id) ?? sources[0];
  if (!matched) {
    throw new Error("Unable to capture the primary display.");
  }

  return {
    image: matched.thumbnail,
    display: coordinateSpace.display,
    cursor: getCursorPositionForDisplay(coordinateSpace)
  };
}

function buildImageDataUrl(image: NativeImage): string {
  const jpeg = image.toJPEG(DEFAULT_JPEG_QUALITY);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

function buildComputerStatus(reasonOverride?: string | null): DesktopComputerStatus {
  const coordinateSpace = buildCoordinateSpace();
  const permissions = {
    accessibility: getAccessibilityPermissionState(),
    screenRecording: getScreenRecordingPermissionState()
  };
  const cursor = (() => {
    try {
      return getCursorPositionForDisplay(coordinateSpace);
    } catch {
      return null;
    }
  })();

  const canTakeScreenshot = process.platform === "win32" || permissions.screenRecording === "granted";
  const canControlComputer = process.platform === "win32" || permissions.accessibility === "granted";
  const reason = reasonOverride ?? (
    !canTakeScreenshot
      ? "Screen recording permission is required before the desktop can send screenshots."
      : !canControlComputer
        ? "Accessibility permission is required before the desktop can control the computer."
        : null
  );

  return {
    available: process.platform === "darwin" || process.platform === "win32",
    platform: process.platform,
    permissions,
    display: coordinateSpace.display,
    cursor,
    canTakeScreenshot,
    canControlComputer,
    requiresRestart: false,
    reason
  };
}

async function runWindowsAction(action: Record<string, unknown>): Promise<void> {
  const script = WINDOWS_COMPUTER_SCRIPT.replace("__ACTION_JSON__", escapePowerShellSingleQuoted(JSON.stringify(action)));
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    windowsHide: true,
    timeout: MAX_WAIT_MS
  });
}

async function runMacAction(action: Record<string, unknown>): Promise<void> {
  const script = MAC_COMPUTER_SCRIPT.replace("__ACTION_JSON__", JSON.stringify(JSON.stringify(action)));
  await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout: MAX_WAIT_MS
  });
}

async function runPlatformAction(action: Record<string, unknown>): Promise<void> {
  if (process.platform === "win32") {
    await runWindowsAction(action);
    return;
  }

  if (process.platform === "darwin") {
    await runMacAction(action);
    return;
  }

  throw new Error("Computer use is only supported on macOS and Windows desktop builds.");
}

function localShellCommandConfig(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", command]
    };
  }

  const shellPath = process.env.SHELL?.trim() || "/bin/zsh";
  return {
    file: shellPath,
    args: ["-lc", command]
  };
}

function getLocalShellWorkingDir(): string {
  const sandboxDir = path.join(app.getPath("userData"), "sandbox-workspace");
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }
  return sandboxDir;
}

async function runLocalShellCommand(input: {
  command: string;
  timeoutMs: number;
}): Promise<{
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  const { file, args } = localShellCommandConfig(input.command);
  const cwd = getLocalShellWorkingDir();

  try {
    const result = await execFileAsync(file, args, {
      cwd,
      timeout: input.timeoutMs,
      maxBuffer: LOCAL_SHELL_MAX_BUFFER_BYTES,
      windowsHide: true
    });
    return {
      cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      timedOut: false
    };
  } catch (error) {
    const commandError = error as Error & {
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string | null;
    };
    const timedOut = commandError.killed === true && /timed out/i.test(commandError.message);
    return {
      cwd,
      stdout: typeof commandError.stdout === "string" ? commandError.stdout : "",
      stderr: typeof commandError.stderr === "string" ? commandError.stderr : commandError.message,
      exitCode: typeof commandError.code === "number" ? commandError.code : 1,
      timedOut
    };
  }
}

async function performAction(toolName: ComputerToolName, args: Record<string, unknown>, coordinateSpace: CoordinateSpace): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "computer_screenshot":
      return {
        ok: true,
        summary: "Captured a fresh screenshot."
      };

    case "computer_cursor_position": {
      const cursor = getCursorPositionForDisplay(coordinateSpace);
      return {
        ok: true,
        cursor
      };
    }

    case "computer_mouse_move": {
      const point = parsePointArgs(args, coordinateSpace);
      const action = process.platform === "win32"
        ? {
            type: "mouse_move",
            ...toWindowsPhysicalPoint({ logicalX: point.logicalX, logicalY: point.logicalY, scaleFactor: coordinateSpace.display.scaleFactor })
          }
        : { type: "mouse_move", x: point.logicalX, y: point.logicalY };
      await runPlatformAction(action);
      return {
        ok: true,
        target: { x: point.screenshotX, y: point.screenshotY },
        summary: `Moved the mouse to (${point.screenshotX}, ${point.screenshotY}).`
      };
    }

    case "computer_left_click":
    case "computer_double_click":
    case "computer_triple_click":
    case "computer_right_click":
    case "computer_middle_click":
    case "computer_left_mouse_down":
    case "computer_left_mouse_up": {
      const point = parsePointArgs(args, coordinateSpace);
      const clickCount = toolName === "computer_double_click" ? 2 : toolName === "computer_triple_click" ? 3 : 1;
      const actionType = toolName === "computer_right_click"
        ? "right_click"
        : toolName === "computer_middle_click"
          ? "middle_click"
          : toolName === "computer_left_mouse_down"
            ? "left_mouse_down"
            : toolName === "computer_left_mouse_up"
              ? "left_mouse_up"
              : "left_click";
      const action = process.platform === "win32"
        ? {
            type: actionType,
            clickCount,
            ...toWindowsPhysicalPoint({ logicalX: point.logicalX, logicalY: point.logicalY, scaleFactor: coordinateSpace.display.scaleFactor })
          }
        : {
            type: actionType,
            clickCount,
            x: point.logicalX,
            y: point.logicalY
          };
      await runPlatformAction(action);
      return {
        ok: true,
        target: { x: point.screenshotX, y: point.screenshotY },
        clickCount,
        summary: `${toolName.replace(/_/g, " ")} at (${point.screenshotX}, ${point.screenshotY}).`
      };
    }

    case "computer_left_click_drag": {
      const startPoint = {
        x: validateFiniteNumber(args.start_x, "start_x"),
        y: validateFiniteNumber(args.start_y, "start_y")
      };
      const endPoint = {
        x: validateFiniteNumber(args.end_x, "end_x"),
        y: validateFiniteNumber(args.end_y, "end_y")
      };
      const parsedStart = parsePointArgs(startPoint, coordinateSpace);
      const parsedEnd = parsePointArgs(endPoint, coordinateSpace);
      const action = process.platform === "win32"
        ? {
            type: "left_click_drag",
            startX: toWindowsPhysicalPoint({
              logicalX: parsedStart.logicalX,
              logicalY: parsedStart.logicalY,
              scaleFactor: coordinateSpace.display.scaleFactor
            }).x,
            startY: toWindowsPhysicalPoint({
              logicalX: parsedStart.logicalX,
              logicalY: parsedStart.logicalY,
              scaleFactor: coordinateSpace.display.scaleFactor
            }).y,
            endX: toWindowsPhysicalPoint({
              logicalX: parsedEnd.logicalX,
              logicalY: parsedEnd.logicalY,
              scaleFactor: coordinateSpace.display.scaleFactor
            }).x,
            endY: toWindowsPhysicalPoint({
              logicalX: parsedEnd.logicalX,
              logicalY: parsedEnd.logicalY,
              scaleFactor: coordinateSpace.display.scaleFactor
            }).y
          }
        : {
            type: "left_click_drag",
            startX: parsedStart.logicalX,
            startY: parsedStart.logicalY,
            endX: parsedEnd.logicalX,
            endY: parsedEnd.logicalY
          };
      await runPlatformAction(action);
      return {
        ok: true,
        start: { x: parsedStart.screenshotX, y: parsedStart.screenshotY },
        end: { x: parsedEnd.screenshotX, y: parsedEnd.screenshotY },
        summary: `Dragged from (${parsedStart.screenshotX}, ${parsedStart.screenshotY}) to (${parsedEnd.screenshotX}, ${parsedEnd.screenshotY}).`
      };
    }

    case "computer_scroll": {
      const deltaX = Math.round(validateFiniteNumber(args.delta_x ?? 0, "delta_x"));
      const deltaY = Math.round(validateFiniteNumber(args.delta_y ?? 0, "delta_y"));
      await runPlatformAction({
        type: "scroll",
        deltaX,
        deltaY
      });
      return {
        ok: true,
        deltaX,
        deltaY,
        summary: `Scrolled by (${deltaX}, ${deltaY}).`
      };
    }

    case "computer_type": {
      const text = typeof args.text === "string" ? args.text : "";
      await runPlatformAction({ type: "type", text });
      return {
        ok: true,
        textLength: text.length,
        summary: buildComputerTypeSummary(text)
      };
    }

    case "computer_key": {
      const keys = typeof args.keys === "string" ? args.keys : "";
      if (!keys.trim()) {
        throw new Error("keys must be a non-empty string.");
      }
      await runPlatformAction({ type: "key", keys });
      return {
        ok: true,
        keys,
        summary: `Pressed ${keys}.`
      };
    }

    case "computer_hold_key": {
      const key = typeof args.key === "string" ? args.key : "";
      if (!key.trim()) {
        throw new Error("key must be a non-empty string.");
      }
      const durationMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.round(validateFiniteNumber(args.duration_ms ?? DEFAULT_KEY_HOLD_MS, "duration_ms"))));
      await runPlatformAction({ type: "hold_key", key, durationMs });
      return {
        ok: true,
        key,
        durationMs,
        summary: `Held ${key} for ${durationMs}ms.`
      };
    }

    case "computer_wait": {
      const durationMs = Math.max(0, Math.min(MAX_WAIT_MS, Math.round(validateFiniteNumber(args.duration_ms ?? DEFAULT_MOUSE_EVENT_DELAY_MS, "duration_ms"))));
      await runPlatformAction({ type: "wait", durationMs });
      return {
        ok: true,
        durationMs,
        summary: `Waited for ${durationMs}ms.`
      };
    }

    case "computer_local_shell": {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) {
        throw new Error("command must be a non-empty string.");
      }

      const rawTimeoutSeconds = args.timeout_seconds;
      const timeoutMs = rawTimeoutSeconds === null || rawTimeoutSeconds === undefined
        ? DEFAULT_LOCAL_SHELL_TIMEOUT_MS
        : Math.max(
            1_000,
            Math.min(
              MAX_LOCAL_SHELL_TIMEOUT_MS,
              Math.round(validateFiniteNumber(rawTimeoutSeconds, "timeout_seconds") * 1_000)
            )
          );
      const result = await runLocalShellCommand({
        command,
        timeoutMs
      });

      return {
        command,
        cwd: result.cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        summary: result.timedOut
          ? `Local shell command timed out after ${Math.round(timeoutMs / 1_000)}s.`
          : `Local shell command exited with code ${result.exitCode}.`
      };
    }
  }

  throw new Error(`Unsupported action type: ${toolName}`);
}

export async function getComputerUseStatus(): Promise<DesktopComputerStatus> {
  return buildComputerStatus();
}

export async function requestAccessibilityPermission(): Promise<DesktopComputerStatus> {
  if (process.platform === "darwin") {
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  return buildComputerStatus();
}

export async function openScreenRecordingSettings(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "darwin") {
    return { ok: false, error: "Screen recording settings are only exposed on macOS." };
  }

  const target = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
  try {
    await shell.openExternal(target);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function performComputerAction(input: DesktopComputerActionInput): Promise<DesktopComputerExecutorResult> {
  const completedAt = new Date().toISOString();
  const initialStatus = buildComputerStatus();
  if (!initialStatus.available) {
    return {
      ...createUnsupportedResult(input.toolName, initialStatus.reason ?? "Computer use is not supported on this platform."),
      completedAt
    };
  }

  const needsVisualAccess = isVisualComputerToolName(input.toolName);
  const needsAccessibility = input.toolName !== "computer_screenshot" && input.toolName !== "computer_cursor_position" && input.toolName !== "computer_local_shell";
  if (needsVisualAccess && !initialStatus.canTakeScreenshot) {
    return {
      ...createUnsupportedResult(input.toolName, initialStatus.reason ?? "Screen recording permission is required."),
      completedAt
    };
  }
  if (needsAccessibility && !initialStatus.canControlComputer) {
    return {
      ...createUnsupportedResult(input.toolName, initialStatus.reason ?? "Accessibility permission is required."),
      completedAt
    };
  }

  try {
    const coordinateSpace = buildCoordinateSpace();
    const output = await performAction(input.toolName, input.args, coordinateSpace);
    if (!needsVisualAccess) {
      return {
        type: "computer_action_result",
        requestId: "",
        taskId: "",
        toolName: input.toolName,
        ok: true,
        output,
        observation: null,
        completedAt
      };
    }

    await delayMs(getPostActionSettleDelayMs(input.toolName, input.args));
    const screenshot = await capturePrimaryDisplayScreenshot();
    const observation: DesktopComputerObservation = {
      text: buildObservationText({
        toolName: input.toolName,
        display: screenshot.display,
        cursor: screenshot.cursor,
        output
      }),
      imageDataUrl: buildImageDataUrl(screenshot.image),
      display: screenshot.display,
      cursor: screenshot.cursor
    };

    return {
      type: "computer_action_result",
      requestId: "",
      taskId: "",
      toolName: input.toolName,
      ok: true,
      output,
      observation,
      completedAt
    };
  } catch (error) {
    return {
      type: "computer_action_result",
      requestId: "",
      taskId: "",
      toolName: input.toolName,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      completedAt
    };
  }
}
