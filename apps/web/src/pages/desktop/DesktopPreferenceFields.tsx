import { useId, type ReactNode } from "react";

export function DesktopPreferenceSection(props: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className="desktop-preference-section" aria-labelledby={titleId}>
      <h3 id={titleId}>{props.title}</h3>
      <div className="desktop-preference-rows">{props.children}</div>
    </section>
  );
}

export function DesktopPreferenceRow(props: {
  title: string;
  description?: ReactNode;
  controlId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="desktop-preference-row">
      <div className="desktop-preference-copy">
        {props.controlId ? <label htmlFor={props.controlId}>{props.title}</label> : <strong>{props.title}</strong>}
        {props.description ? <p>{props.description}</p> : null}
      </div>
      {props.children ? <div className="desktop-preference-control">{props.children}</div> : null}
    </div>
  );
}

export function DesktopPreferenceSwitch(props: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      className="desktop-preference-switch"
      id={props.id}
      type="checkbox"
      role="switch"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}
