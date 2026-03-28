import type { SearchEngine, SearchEngineFile, SearchEngineRepository, SearchEngineStats } from './search-engine'

let esEngine: SearchEngine | null = null
let tsEngine: SearchEngine | null = null
let pgEngine: SearchEngine | null = null
let activeEngine: SearchEngine | null = null
let initialized = false

export function getActiveEngineName(): string {
    return activeEngine?.name || 'none'
}

async function getElasticsearchEngine(): Promise<SearchEngine | null> {
    if (esEngine) return esEngine
    if (!process.env.ELASTICSEARCH_URL) return null
    try {
        const { ElasticsearchSearchEngine } = await import('./elasticsearch')
        esEngine = new ElasticsearchSearchEngine()
        return esEngine
    } catch (err) {
        console.warn('⚠️ Could not load Elasticsearch engine:', (err as any)?.message)
        return null
    }
}

async function getTypesenseEngine(): Promise<SearchEngine | null> {
    if (tsEngine) return tsEngine
    if (!process.env.TYPESENSE_API_KEY && !process.env.TYPESENSE_HOST) {
        return null
    }
    try {
        const { TypesenseSearchEngine } = await import('./typesense')
        tsEngine = new TypesenseSearchEngine()
        return tsEngine
    } catch (err) {
        console.warn('⚠️ Could not load Typesense engine:', (err as any)?.message)
        return null
    }
}

async function getPostgresEngine(): Promise<SearchEngine | null> {
    if (pgEngine) return pgEngine
    if (!process.env.DATABASE_URL) return null
    try {
        const { PostgresSearchEngine } = await import('./pg-search')
        pgEngine = new PostgresSearchEngine()
        return pgEngine
    } catch (err) {
        console.warn('⚠️ Could not load PostgreSQL search engine:', (err as any)?.message)
        return null
    }
}

export async function initializeSearchEngine(): Promise<void> {
    if (initialized && activeEngine) return

    console.log('🔍 Search Adapter: Detecting available search engines...')

    const es = await getElasticsearchEngine()
    if (es) {
        try {
            const connected = await es.testConnection()
            if (connected) {
                await es.initialize()
                activeEngine = es
                initialized = true
                console.log('✅ Search Adapter: Using Elasticsearch (primary)')
                return
            }
        } catch (err: any) {
            console.warn('⚠️ Elasticsearch failed to initialize:', err.message)
        }
    }

    const ts = await getTypesenseEngine()
    if (ts) {
        try {
            const connected = await ts.testConnection()
            if (connected) {
                await ts.initialize()
                activeEngine = ts
                initialized = true
                console.log('✅ Search Adapter: Using Typesense (fallback)')
                return
            }
        } catch (err: any) {
            console.warn('⚠️ Typesense failed to initialize:', err.message)
        }
    }

    const pg = await getPostgresEngine()
    if (pg) {
        try {
            const connected = await pg.testConnection()
            if (connected) {
                await pg.initialize()
                activeEngine = pg
                initialized = true
                console.log('✅ Search Adapter: Using PostgreSQL full-text search (fallback)')
                return
            }
        } catch (err: any) {
            console.warn('⚠️ PostgreSQL search failed to initialize:', err.message)
        }
    }

    throw new Error(
        'No search engine available. Please configure either Elasticsearch, Typesense, or PostgreSQL.\n' +
        'PostgreSQL: Set DATABASE_URL (already used for the main database)\n' +
        'Elasticsearch: Set ELASTICSEARCH_URL, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD\n' +
        'Typesense: Set TYPESENSE_HOST, TYPESENSE_API_KEY'
    )
}

async function getEngine(): Promise<SearchEngine> {
    if (!activeEngine) {
        await initializeSearchEngine()
    }
    return activeEngine!
}

async function withFallback<T>(operation: (engine: SearchEngine) => Promise<T>): Promise<T> {
    const primary = await getEngine()
    try {
        return await operation(primary)
    } catch (primaryError: any) {
        console.warn(`⚠️ ${primary.name} operation failed: ${primaryError.message}`)

        const fallbacks: Array<() => Promise<SearchEngine | null>> = []
        if (primary.name !== 'Elasticsearch') fallbacks.push(getElasticsearchEngine)
        if (primary.name !== 'Typesense') fallbacks.push(getTypesenseEngine)
        if (primary.name !== 'PostgreSQL') fallbacks.push(getPostgresEngine)

        for (const getFallback of fallbacks) {
            const fallback = await getFallback()
            if (fallback && fallback !== primary) {
                try {
                    const connected = await fallback.testConnection()
                    if (connected) {
                        console.log(`🔄 Falling back to ${fallback.name}...`)
                        return await operation(fallback)
                    }
                } catch {
                }
            }
        }

        throw primaryError
    }
}

export async function testSearchConnection(): Promise<boolean> {
    try {
        const engine = await getEngine()
        return await engine.testConnection()
    } catch {
        return false
    }
}

export async function indexRepository(repoData: Partial<SearchEngineRepository>): Promise<void> {
    const engine = await getEngine()
    return engine.indexRepository(repoData)
}

export async function indexFile(fileData: Partial<SearchEngineFile>): Promise<string> {
    const engine = await getEngine()
    return engine.indexFile(fileData)
}

export async function searchRepositories(
    query: string,
    filters?: Record<string, any>
): Promise<SearchEngineRepository[]> {
    return withFallback(engine => engine.searchRepositories(query, filters))
}

export async function searchFilesInRepository(
    repoId: string,
    query: string,
    fileType?: string,
    language?: string
): Promise<SearchEngineFile[]> {
    return withFallback(engine => engine.searchFilesInRepository(repoId, query, fileType, language))
}

export async function getFileContent(
    repoId: string,
    filePath: string
): Promise<SearchEngineFile | null> {
    return withFallback(engine => engine.getFileContent(repoId, filePath))
}

export async function deleteRepositoryFromIndex(repoId: string): Promise<void> {
    const engine = await getEngine()
    return engine.deleteRepository(repoId)
}

export async function getRepositoryStats(): Promise<SearchEngineStats> {
    return withFallback(engine => engine.getStats())
}
