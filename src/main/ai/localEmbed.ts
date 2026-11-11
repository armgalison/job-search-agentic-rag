import { logger } from '../log'
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
        logger.info('embeddings', `Loading local embedding model ${this.model} (downloaded once, ~120 MB)…`)
        let lastPct = -10
        const ex = (await t.pipeline('feature-extraction', this.model, {
          dtype: 'q8',
          // Download progress, throttled to every 10%
          progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
            if (p.status === 'progress' && typeof p.progress === 'number' && /onnx/i.test(p.file ?? '') && p.progress - lastPct >= 10) {
              lastPct = Math.floor(p.progress / 10) * 10
              logger.info('embeddings', `Downloading ${p.file}: ${lastPct}%`)
            }
          }
        } as never)) as unknown as Extractor
        logger.info('embeddings', 'Local embedding model ready')
        return ex
      })()
      cache.set(this.model, p)
      p.catch((err: Error) => {
        cache.delete(this.model)
        logger.error('embeddings', `Could not load the embedding model: ${err.message}`)
      })
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
