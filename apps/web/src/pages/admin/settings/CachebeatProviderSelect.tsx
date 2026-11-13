import { useAdminAiProviders } from "./useAdminAiProviders";

const FOLLOW_SELECTED_PROVIDER = "";

interface CachebeatProviderSelectProps {
  value: string | null;
  onChange: (providerId: string | null) => void;
}

// Beats go to Meridian's own session route, which a gateway in front of it may not forward.
export function CachebeatProviderSelect({ value, onChange }: CachebeatProviderSelectProps) {
  const { providers } = useAdminAiProviders();
  const selectedProvider = providers.find((provider) => provider.selected);
  const missing = value !== null && providers.length > 0 && !providers.some((provider) => provider.id === value);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
      Beat through
      <select
        aria-label="Cachebeat provider"
        value={value ?? FOLLOW_SELECTED_PROVIDER}
        onChange={(event) => onChange(event.target.value || null)}
        style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
      >
        <option value={FOLLOW_SELECTED_PROVIDER}>
          Selected AI provider{selectedProvider ? ` (${selectedProvider.baseUrl})` : ""}
        </option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.baseUrl}</option>
        ))}
        {missing ? <option value={value}>Removed provider (uses the selected one)</option> : null}
      </select>
    </span>
  );
}
