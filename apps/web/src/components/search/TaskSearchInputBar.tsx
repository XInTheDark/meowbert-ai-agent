import { Search } from "lucide-react";

interface TaskSearchInputBarProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function TaskSearchInputBar(props: TaskSearchInputBarProps) {
  return (
    <form
      className="task-toolbar-left"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <Search size={16} className="task-search-icon" />
      <input
        type="search"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="task-search-input"
      />
      <button type="submit" className="btn primary task-search-submit">
        <Search size={15} />
        <span>Search</span>
      </button>
    </form>
  );
}
