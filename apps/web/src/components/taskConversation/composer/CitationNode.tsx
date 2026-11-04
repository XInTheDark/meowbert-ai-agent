import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import type { JSX } from "react";
import { CitationPill } from "./CitationPill";
import { buildCitationToken, type Citation } from "./citationToken";
import { isSkillPath } from "./skillMention";

type SerializedCitationNode = Spread<{ label: string; path: string | null }, SerializedLexicalNode>;

// An uploading citation has no path yet and adds nothing to the message text.
export class CitationNode extends DecoratorNode<JSX.Element> {
  __label: string;
  __path: string | null;

  static getType(): string {
    return "citation";
  }

  static clone(node: CitationNode): CitationNode {
    return new CitationNode(node.__label, node.__path, node.__key);
  }

  static importJSON(serialized: SerializedCitationNode): CitationNode {
    return new CitationNode(serialized.label, serialized.path);
  }

  constructor(label: string, path: string | null, key?: NodeKey) {
    super(key);
    this.__label = label;
    this.__path = path;
  }

  exportJSON(): SerializedCitationNode {
    return { ...super.exportJSON(), type: "citation", version: 1, label: this.__label, path: this.__path };
  }

  createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "composer-citation";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getPath(): string | null {
    return this.getLatest().__path;
  }

  resolve(citation: Citation): void {
    const writable = this.getWritable();
    writable.__label = citation.label;
    writable.__path = citation.path;
  }

  getTextContent(): string {
    const { __label: label, __path: path } = this.getLatest();
    return path === null ? "" : buildCitationToken({ label, path });
  }

  decorate(): JSX.Element {
    return <CitationPill nodeKey={this.getKey()} label={this.__label} isUploading={this.__path === null} isSkill={isSkillPath(this.__path ?? undefined)} />;
  }
}

export function $createCitationNode(label: string, path: string | null): CitationNode {
  return new CitationNode(label, path);
}

export function $isCitationNode(node: LexicalNode | null | undefined): node is CitationNode {
  return node instanceof CitationNode;
}
