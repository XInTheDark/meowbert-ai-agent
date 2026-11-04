import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type LexicalNode
} from "lexical";
import { $createCitationNode, $isCitationNode, type CitationNode } from "./CitationNode";
import { parseCitationSegments, type Citation } from "./citationToken";

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

// Each pill is followed by a space so the caret has somewhere to land and typing carries on normally.
export function $insertCitationNodes(citations: CitationNode[]): void {
  if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  selection.insertNodes(citations.flatMap((citation) => [citation, $createTextNode(" ")]));
}

export function $createCitationNodes(citations: Citation[]): CitationNode[] {
  return citations.map((citation) => $createCitationNode(citation.label, citation.path));
}
