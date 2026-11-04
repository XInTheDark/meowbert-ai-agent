import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, COMMAND_PRIORITY_CRITICAL, type TextNode } from "lexical";
import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskAttachment } from "../../../lib/types";
import { $createCitationNode } from "./CitationNode";
import { CitationIcon } from "./CitationPill";
import { buildMentionOptions, ComposerMentionOption, findMentionMatch, type MentionSkill } from "./composerMentionOptions";
import { isSkillPath } from "./skillMention";

export function ComposerMentionMenu(props: { attachments: TaskAttachment[]; skills: MentionSkill[] }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const options = useMemo(
    () => buildMentionOptions(query ?? "", props.attachments, props.skills),
    [props.attachments, props.skills, query]
  );

  const handleSelect = useCallback((option: ComposerMentionOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
    editor.update(() => {
      const pill = $createCitationNode(option.citation.label, option.citation.path);
      const space = $createTextNode(" ");
      if (nodeToReplace) {
        nodeToReplace.replace(pill);
        pill.insertAfter(space);
        space.select();
      }
      closeMenu();
    });
  }, [editor]);

  return (
    <LexicalTypeaheadMenuPlugin<ComposerMentionOption>
      options={options}
      triggerFn={findMentionMatch}
      onQueryChange={setQuery}
      onSelectOption={handleSelect}
      // The composer's own Enter handler sends the message, so the open menu has to see Enter first.
      commandPriority={COMMAND_PRIORITY_CRITICAL}
      anchorClassName="composer-mention-anchor"
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => (
        anchorRef.current && options.length > 0
          ? createPortal(
            <ul className="composer-mention-menu" role="listbox" aria-label="Mention a file or skill">
              {options.map((option, index) => (
                <li
                  key={option.key}
                  ref={(element) => option.setRefElement(element)}
                  role="option"
                  aria-selected={selectedIndex === index}
                  className={`composer-mention-option${selectedIndex === index ? " selected" : ""}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOptionAndCleanUp(option)}
                >
                  <CitationIcon label={option.citation.label} isSkill={isSkillPath(option.citation.path)} />
                  <span className="composer-mention-label" title={option.citation.label}>{option.citation.label}</span>
                  <span className="composer-mention-type">{option.typeLabel}</span>
                </li>
              ))}
            </ul>,
            anchorRef.current
          )
          : null
      )}
    />
  );
}
