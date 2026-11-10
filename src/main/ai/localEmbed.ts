import type { EmbedProvider } from './provider'

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>

const cache = new Map<string, Promise<Extractor>>()

/**
 * Fully local embeddings via transformers.js (ONNX). The model is downloaded on first use
 * and cached in the app data folder. E5-family models use "query:"/"passage:" prefixes.
 */
export class LocalEmbedder implements EmbedProvider {
  readonly modelId: string

  constructor(
    private model: string,
    private cacheDir: string
  ) {
    this.modelId = `local:${model}`
  }

  private load(): Promise<Extractor> {
    let p = cache.get(this.model)
    if (!p) {
      p = (async () => {
        const t = await import('@huggingface/transformers')
        t.env.cacheDir = this.cacheDir
        return (await t.pipeline('feature-extraction', this.model, { dtype: 'q8' })) as unknown as Extractor
      })()
      cache.set(this.model, p)
      p.catch(() => cache.delete(this.model))
    }
    return p
  }

  private get isE5(): boolean {
    return /e5/i.test(this.model)
  }

  private async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load()
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 16) {
      const res = await extractor(texts.slice(i, i + 16), { pooling: 'mean', normalize: true })
      for (const row of res.tolist()) out.push(Float32Array.from(row))
    }
    return out
  }

  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return this.embed(this.isE5 ? texts.map((t) => `passage: ${t}`) : texts)
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embed([this.isE5 ? `query: ${text}` : text]))[0]
  }
}
