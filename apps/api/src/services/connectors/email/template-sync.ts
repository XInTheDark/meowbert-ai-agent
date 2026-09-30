import { ListmonkClient, type ListmonkTemplate } from "@meowbert/shared";
import { config } from "../../../lib/config.js";
import { query } from "../../../lib/db.js";
import { getListmonkClientConfig } from "./provider-settings.js";
import { EMAIL_TEMPLATE_DEFINITIONS, type EmailTemplateDefinition } from "./template-registry.js";

interface TemplateBindingRow {
  template_key: string;
  provider_template_id: string | number;
  template_version: string;
}

function parseTemplateId(rawTemplateId: string | number): number {
  const parsed =
    typeof rawTemplateId === "number"
      ? rawTemplateId
      : Number(rawTemplateId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid Listmonk template binding id: ${rawTemplateId}`);
  }

  return parsed;
}

async function buildListmonkClient(): Promise<ListmonkClient | null> {
  const clientConfig = await getListmonkClientConfig();
  if (!clientConfig) {
    return null;
  }

  return new ListmonkClient(clientConfig);
}

function findTemplateByName(templates: ListmonkTemplate[], name: string): ListmonkTemplate | undefined {
  return templates.find((template) => template.name === name && template.type === "tx");
}

async function upsertTemplateBinding(input: {
  key: string;
  providerTemplateId: number;
  templateVersion: string;
}): Promise<void> {
  await query(
    `INSERT INTO email_template_bindings (template_key, provider, provider_template_id, template_version, updated_at)
     VALUES ($1, 'listmonk', $2, $3, now())
     ON CONFLICT (template_key)
     DO UPDATE SET
       provider = EXCLUDED.provider,
       provider_template_id = EXCLUDED.provider_template_id,
       template_version = EXCLUDED.template_version,
       updated_at = now()`,
    [input.key, input.providerTemplateId, input.templateVersion]
  );
}

async function syncTemplate(
  client: ListmonkClient,
  currentTemplates: ListmonkTemplate[],
  currentBinding: TemplateBindingRow | undefined,
  definition: EmailTemplateDefinition
): Promise<void> {
  let targetTemplate = findTemplateByName(currentTemplates, definition.name);
  const currentBindingTemplateId = currentBinding ? parseTemplateId(currentBinding.provider_template_id) : null;

  if (!targetTemplate && currentBindingTemplateId) {
    targetTemplate = currentTemplates.find((template) => template.id === currentBindingTemplateId);
  }

  if (!targetTemplate) {
    const created = await client.createTemplate({
      name: definition.name,
      type: definition.type,
      subject: definition.subject,
      body: definition.body
    });

    await upsertTemplateBinding({
      key: definition.key,
      providerTemplateId: created.id,
      templateVersion: definition.version
    });
    return;
  }

  const shouldUpdate =
    targetTemplate.subject !== definition.subject ||
    targetTemplate.body !== definition.body ||
    currentBinding?.template_version !== definition.version;

  if (shouldUpdate) {
    await client.updateTemplate(targetTemplate.id, {
      name: definition.name,
      type: definition.type,
      subject: definition.subject,
      body: definition.body
    });
  }

  await upsertTemplateBinding({
    key: definition.key,
    providerTemplateId: targetTemplate.id,
    templateVersion: definition.version
  });
}

export async function ensureListmonkTemplatesSynced(options: {
  requireConfigured?: boolean;
} = {}): Promise<boolean> {
  if (!config.email.enabled) {
    return false;
  }

  const client = await buildListmonkClient();
  if (!client) {
    if (options.requireConfigured) {
      throw new Error("Listmonk provider is disabled or missing credentials in admin connectors settings.");
    }
    return false;
  }

  const [bindingsResult, clientTemplates] = await Promise.all([
    query<TemplateBindingRow>(
      `SELECT template_key, provider_template_id, template_version
         FROM email_template_bindings
        WHERE provider = 'listmonk'`
    ),
    client.listTemplates()
  ]);

  const bindingMap = new Map(bindingsResult.rows.map((row) => [row.template_key, row]));

  for (const definition of EMAIL_TEMPLATE_DEFINITIONS) {
    await syncTemplate(client, clientTemplates, bindingMap.get(definition.key), definition);
  }

  return true;
}
