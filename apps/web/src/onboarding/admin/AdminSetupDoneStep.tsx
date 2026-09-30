export function AdminSetupDoneStep(props: { onOpenAdmin: () => void; onClose: () => void }) {
  return (
    <div className="stack-form">
      <p style={{ margin: 0 }}>Meowbert is ready. Create a project and start your first task.</p>
      <p className="muted-text" style={{ margin: 0 }}>
        Everything you set here, and much more (connectors, storage, users, limits, and advanced model settings), lives in the
        <strong> Admin Panel</strong> in the sidebar.
      </p>
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={props.onClose}>Start using Meowbert</button>
        <button type="button" className="btn ghost" onClick={props.onOpenAdmin}>Open Admin Panel</button>
      </div>
    </div>
  );
}
