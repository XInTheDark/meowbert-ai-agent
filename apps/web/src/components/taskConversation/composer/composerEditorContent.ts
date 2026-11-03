import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type LexicalNode
} from "lexical";
import { $createCitationNode, $isCitationNode, type CitationNode } from "./CitationNode";
import { parseCitationSegments, type Citation } from "./citationToken";

export interface DropPoint {
  x: number;
  y: number;
}

function buildTextNodes(text: string): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) nodes.push($createLineBreakNode());
    if (line.length > 0) nodes.push($createTextNode(line));
  });
  return nodes;
}

export function $buildContentNodes(text: string, isCitablePath?: (path: string) => boolean): LexicalNode[] {
  return parseCitationSegments(text, isCitablePath).flatMap((segment) => (
    segment.kind === "text"
      ? buildTextNodes(segment.text)
      : [$createCitationNode(segment.citation.label, segment.citation.path)]
  ));
}

export function $replaceContent(text: string, isCitablePath?: (path: string) => boolean): void {
  const paragraph = $createParagraphNode();
  paragraph.append(...$buildContentNodes(text, isCitablePath));
  const root = $getRoot();
  root.clear();
  root.append(paragraph);
}

function $collectCitations(node: LexicalNode, citations: CitationNode[]): void {
  if ($isCitationNode(node)) citations.push(node);
  if ($isElementNode(node)) node.getChildren().forEach((child) => $collectCitations(child, citations));
}

export function $getCitationNodes(): CitationNode[] {
  const citations: CitationNode[] = [];
  $collectCitations($getRoot(), citations);
  return citations;
}

function caretRangeFromPoint(point: DropPoint): Range | null {
  if (typeof document.caretRangeFromPoint === "function") {
    return document.caretRangeFromPoint(point.x, point.y);
  }
  const position = document.caretPositionFromPoint?.(point.x, point.y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function $selectInsertionPoint(rootElement: HTMLElement | null, point: DropPoint | undefined): void {
  const range = point ? caretRangeFromPoint(point) : null;
  if (range && rootElement?.contains(range.startContainer)) {
    const selection = $createRangeSelection();
    selection.applyDOMRange(range);
    $setSelection(selection);
    return;
  }
  if (!$isRangeSelection($getSelection())) {
    $getRoot().selectEnd();
  }
}

// Each pill is followed by a space so the caret has somewhere to land and typing carries on normally.
export function $insertCitationNodes(citations: CitationNode[], rootElement: HTMLElement | null, point?: DropPoint): void {
  $selectInsertionPoint(rootElement, point);
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  selection.insertNodes(citations.flatMap((citation) => [citation, $createTextNode(" ")]));
}

export function $createCitationNodes(citations: Citation[]): CitationNode[] {
  return citations.map((citation) => $createCitationNode(citation.label, citation.path));
}
