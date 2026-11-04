import { describe, expect, test } from "bun:test"
import { Provider, type Model } from "@opencode/plugin"
import type { ModelEditor } from "@opencode/plugin/promise/model"
import type { ProviderEditor } from "@opencode/plugin/promise/provider"
import type { Types } from "effect"
import { asCatalogModelID } from "../ids.ts"
import { applyDefaultModel, applyProvider, modelParamsFromOptions, parseListedModels, toCatalogVariants } from "./catalog.ts"

describe("parseListedModels", () => {
  test("reads a Cursor SDK list", () => {
    const listed = parseListedModels([
      { id: "gpt-5", displayName: "GPT-5" },
      { id: "composer-2.5", displayName: "Composer 2.5" },
    ])
    expect(listed.map((model) => model.catalogID)).toEqual([
      asCatalogModelID("gpt-5"),
      asCatalogModelID("composer-2.5"),
      asCatalogModelID("auto"),
    ])
    expect(listed[0]?.name).toBe("GPT-5")
  })

  test("reads a wrapped items payload", () => {
    const listed = parseListedModels({
      items: [{ id: "sonnet-4", displayName: "Sonnet 4" }],
    })
    expect(listed.map((model) => model.catalogID)).toContain(asCatalogModelID("sonnet-4"))
  })

  test("empty input keeps the seed models", () => {
    expect(parseListedModels([]).map((model) => model.catalogID)).toEqual([
      asCatalogModelID("composer-2.5"),
      asCatalogModelID("auto"),
    ])
  })

  test("preserves model parameters and predefined variants", () => {
    const listed = parseListedModels([
      {
        id: "composer",
        displayName: "Composer",
        parameters: [{ id: "thinking", displayName: "Thinking", values: [{ value: "high" }] }],
        variants: [{ displayName: "High", params: [{ id: "thinking", value: "high" }], isDefault: true }],
      },
    ])

    expect(listed[0]?.parameters).toEqual([
      { id: "thinking", displayName: "Thinking", values: [{ value: "high" }] },
    ])
    const variants = toCatalogVariants(listed[0])
    expect(String(variants[0]?.id)).toBe("High")
    expect(variants[0]?.body).toEqual({ cursorModelParams: [{ id: "thinking", value: "high" }] })
  })
})

describe("modelParamsFromOptions", () => {
  test("reads Cursor params from OpenCode request options", () => {
    expect(modelParamsFromOptions({ cursorModelParams: [{ id: "thinking", value: "high" }] })).toEqual([
      { id: "thinking", value: "high" },
    ])
  })
})

describe("catalog transforms", () => {
  const models = parseListedModels([
    {
      id: "composer",
      displayName: "Composer",
      variants: [{ displayName: "High", params: [{ id: "thinking", value: "high" }] }],
    },
  ])

  function providerEditor(existing?: Provider.Info) {
    const added: Array<{ info: Provider.Info; models: readonly Model.Info[] }> = []
    const updated: Array<(provider: Types.DeepMutable<Provider.Info>) => void> = []
    const setModels: Array<readonly Model.Info[]> = []
    const editor = {
      list: () => [],
      get: () => (existing ? { provider: existing, models: new Map() } : undefined),
      add: (input) => void added.push(input),
      update: (_id, update) => void updated.push(update),
      remove: () => {},
      models: {
        set: (_id, entries) => void setModels.push(entries),
        update: () => {},
        remove: () => {},
      },
    } satisfies ProviderEditor
    return { editor, added, updated, setModels }
  }

  test("registers the Cursor provider with its models", () => {
    const { editor, added } = providerEditor()
    applyProvider(editor, models)

    expect(added).toHaveLength(1)
    const [entry] = added
    expect(String(entry?.info.id)).toBe("cursor")
    expect(entry?.info.name).toBe("Cursor")
    expect(String(entry?.info.integrationID)).toBe("cursor")
    expect(entry?.info.activation).toBe("auto")
    expect(entry?.models.map((model) => String(model.id))).toEqual(["composer", "composer-2.5", "auto", "default"])
    const composer = entry?.models.find((model) => String(model.id) === "composer")
    expect(String(composer?.modelID)).toBe("composer")
    expect(composer?.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(composer?.variants.map((variant) => String(variant.id))).toEqual(["High"])
    const fallback = entry?.models.find((model) => String(model.id) === "default")
    expect(String(fallback?.modelID)).toBe("composer")
  })

  test("updates an existing Cursor provider and drops its base URL", () => {
    const provider = { id: Provider.ID.make("cursor"), name: "Other", settings: { baseURL: "https://example.test" } }
    const { editor, added, updated, setModels } = providerEditor(provider as unknown as Provider.Info)
    applyProvider(editor, models)

    expect(added).toHaveLength(0)
    const draft = { ...provider } as unknown as Types.DeepMutable<Provider.Info>
    updated[0]?.(draft)
    expect(draft.name).toBe("Cursor")
    expect(draft.settings?.baseURL).toBeUndefined()
    expect(setModels).toHaveLength(1)
  })

  test("selects the first listed model as the default", () => {
    const selected: Array<[string, string]> = []
    const editor = {
      default: { get: () => undefined, set: (providerID: string, modelID: string) => void selected.push([providerID, modelID]) },
    } as unknown as ModelEditor
    applyDefaultModel(editor, models)
    expect(selected).toEqual([["cursor", "composer"]])
  })
})
