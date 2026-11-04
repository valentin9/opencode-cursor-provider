import type { ModelParameterDefinition, ModelParameterValue, ModelVariant } from "@cursor/sdk"
import { Integration, Model, Provider } from "@opencode/plugin"
import type { ModelEditor } from "@opencode/plugin/promise/model"
import type { ProviderEditor } from "@opencode/plugin/promise/provider"
import { PACKAGE_SPEC, PROVIDER_ID, asCatalogModelID, asCursorModelID, type CatalogModelID, type CursorModelID } from "../ids.ts"

export interface CursorModelDescriptor {
  readonly catalogID: CatalogModelID
  readonly wireID: CursorModelID
  readonly name: string
  readonly parameters: readonly ModelParameterDefinition[]
  readonly variants: readonly ModelVariant[]
}

export const CURSOR_MODEL_PARAMS = "cursorModelParams"

export const SEED_MODELS: readonly CursorModelDescriptor[] = [
  {
    catalogID: asCatalogModelID("composer-2.5"),
    wireID: asCursorModelID("composer-2.5"),
    name: "Composer 2.5",
    parameters: [],
    variants: [],
  },
  {
    catalogID: asCatalogModelID("auto"),
    wireID: asCursorModelID("auto"),
    name: "Cursor Auto",
    parameters: [],
    variants: [],
  },
]

export function providerId() {
  return Provider.ID.make(PROVIDER_ID)
}

export function applyProvider(draft: ProviderEditor, models: readonly CursorModelDescriptor[]): void {
  const entries = catalogModels(models)
  if (draft.get(PROVIDER_ID) === undefined) {
    draft.add({ info: providerInfo(), models: entries })
    return
  }
  draft.update(PROVIDER_ID, (provider) => {
    provider.id = providerId()
    provider.name = "Cursor"
    provider.package = PACKAGE_SPEC
    provider.integrationID = Integration.ID.make(PROVIDER_ID)
    provider.activation = "auto"
    dropBaseURL(provider.settings)
  })
  draft.models.set(PROVIDER_ID, entries)
}

export function applyDefaultModel(draft: ModelEditor, models: readonly CursorModelDescriptor[]): void {
  const preferred = models[0]
  if (preferred) draft.default.set(PROVIDER_ID, preferred.catalogID)
}

function providerInfo(): Provider.Info {
  return {
    id: providerId(),
    name: "Cursor",
    package: PACKAGE_SPEC,
    integrationID: Integration.ID.make(PROVIDER_ID),
    activation: "auto",
  }
}

function catalogModels(models: readonly CursorModelDescriptor[]): Model.Info[] {
  const entries = models.map((model) => catalogModel(model.catalogID, model))
  const preferred = models[0]
  if (preferred) entries.push(catalogModel("default", preferred))
  return entries
}

function catalogModel(catalogID: string, model: CursorModelDescriptor): Model.Info {
  const defaults = Model.Info.default(providerId(), Model.ID.make(catalogID))
  return {
    ...defaults,
    modelID: Model.ID.make(model.wireID),
    name: model.name,
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: toCatalogVariants(model),
    status: "active",
    enabled: true,
    package: PACKAGE_SPEC,
  }
}

export function parseListedModels(raw: unknown): CursorModelDescriptor[] {
  const listed: CursorModelDescriptor[] = []
  const seen = new Set<string>()
  for (const item of listedItems(raw)) {
    const parsed = parseListedItem(item)
    if (parsed === undefined) continue
    if (seen.has(parsed.catalogID)) continue
    seen.add(parsed.catalogID)
    listed.push(parsed)
  }
  if (listed.length === 0) return [...SEED_MODELS]
  for (const seed of SEED_MODELS) {
    if (!seen.has(seed.catalogID)) listed.push(seed)
  }
  return listed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function listedItems(raw: unknown): readonly unknown[] {
  if (Array.isArray(raw)) return raw
  if (isRecord(raw) && Array.isArray(raw.items)) return raw.items
  return []
}

function parseListedItem(item: unknown): CursorModelDescriptor | undefined {
  if (!isRecord(item)) return undefined
  const nested = isRecord(item.model) ? item.model : undefined
  const rawId = typeof item.id === "string" ? item.id : typeof nested?.id === "string" ? nested.id : undefined
  if (rawId === undefined) return undefined
  const id = rawId.trim()
  if (id.length === 0) return undefined
  const rawName = typeof item.displayName === "string" ? item.displayName : undefined
  const name = rawName && rawName.length > 0 ? rawName : id
  return {
    catalogID: asCatalogModelID(id),
    wireID: asCursorModelID(id),
    name,
    parameters: parseParameters(item.parameters),
    variants: parseVariants(item.variants),
  }
}

function parseParameters(value: unknown): ModelParameterDefinition[] {
  if (!Array.isArray(value)) return []
  const definitions: ModelParameterDefinition[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !Array.isArray(item.values)) continue
    const values: Array<{ value: string; displayName?: string }> = []
    for (const candidate of item.values) {
      if (!isRecord(candidate) || typeof candidate.value !== "string") continue
      values.push({
        value: candidate.value,
        ...(typeof candidate.displayName === "string" ? { displayName: candidate.displayName } : {}),
      })
    }
    definitions.push({
      id: item.id,
      values,
      ...(typeof item.displayName === "string" ? { displayName: item.displayName } : {}),
    })
  }
  return definitions
}

function parseVariants(value: unknown): ModelVariant[] {
  if (!Array.isArray(value)) return []
  const variants: ModelVariant[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.displayName !== "string") continue
    const params = parseParams(item.params)
    if (params === undefined) continue
    variants.push({
      displayName: item.displayName,
      params,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      ...(typeof item.isDefault === "boolean" ? { isDefault: item.isDefault } : {}),
    })
  }
  return variants
}

function parseParams(value: unknown): ModelParameterValue[] | undefined {
  if (!Array.isArray(value)) return undefined
  const params: ModelParameterValue[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.value !== "string") return undefined
    params.push({ id: item.id, value: item.value })
  }
  return params
}

export function toCatalogVariants(model: CursorModelDescriptor | undefined): Model.Variant[] {
  if (model === undefined) return []
  const seen = new Map<string, number>()
  return model.variants.map((variant) => {
    const count = (seen.get(variant.displayName) ?? 0) + 1
    seen.set(variant.displayName, count)
    const id = count === 1 ? variant.displayName : `${variant.displayName}-${count}`
    return {
      id: Model.VariantID.make(id),
      body: { [CURSOR_MODEL_PARAMS]: variant.params.map((param) => ({ ...param })) },
    }
  })
}

export function modelParamsFromOptions(options: unknown): readonly ModelParameterValue[] | undefined {
  if (!isRecord(options)) return undefined
  return parseParams(options[CURSOR_MODEL_PARAMS])
}

function dropBaseURL(settings: Record<string, unknown> | undefined): void {
  if (settings === undefined) return
  delete settings.baseURL
}

export function resolveWireId(
  models: readonly CursorModelDescriptor[],
  catalogID: string,
): CursorModelID | undefined {
  const match = models.find((model) => model.catalogID === catalogID)
  return match?.wireID
}
