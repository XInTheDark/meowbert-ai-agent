// The opening line of a Master conversation that has no history yet. It is never stored as a message.
export function ProjectMasterGreeting() {
  return (
    <div className="chat-bubble assistant project-master-greeting">
      <div className="bubble-content markdown-content">
        <p>Hi! I&apos;m the Master of this project.</p>
        <p>
          Tell me what you need and I&apos;ll split it into tasks, keep an eye on them, and report back
          when they&apos;re done. What should we work on first?
        </p>
      </div>
    </div>
  );
}
