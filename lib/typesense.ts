// Typesense search engine implementation — fallback when Elasticsearch is unavailable
// Uses Typesense Cloud free tier or self-hosted instance

import Typesense from 'typesense'
import type { SearchEngine, SearchEngineFile, SearchEngineRepository, SearchEngineStats } from './search-engine'

const REPO_COLLECTION = 'codementor_repositories'
const FILES_COLLECTION = 'codementor_files'

function getClient(): Typesense.Client {
    const host = process.env.TYPESENSE_HOST || 'localhost'
    const protocol = process.env.TYPESENSE_PROTOCOL || (host.includes('typesense.net') ? 'https' : 'http')
    const defaultPort = protocol === 'https' ? '443' : '8108'
    const port = parseInt(process.env.TYPESENSE_PORT || defaultPort, 10)
    const apiKey = process.env.TYPESENSE_API_KEY || 'xyz'

    return new Typesense.Client({
        nodes: [{ host, port, protocol }],
        apiKey,
        connectionTimeoutSeconds: 10,
        retryIntervalSeconds: 0.5,
        numRetries: 3,
    })
}

// ── Schema definitions ────────────────────────────────────────────────────
// file_path_exact and repo_id are faceted so we can filter on them

const repoSchema: Typesense.CollectionCreateSchema = {
    name: REPO_COLLECTION,
    fields: [
        { name: 'id', type: 'string' },
        { name: 'repo_url', type: 'string', facet: false },
        { name: 'repo_name', type: 'string' },
        { name: 'repo_owner', type: 'string' },
        { name: 'repo_description', type: 'string', optional: true },
        { name: 'repo_stars', type: 'int32', optional: true },
        { name: 'repo_language', type: 'string', optional: true, facet: true },
        { name: 'repo_languages', type: 'string[]', optional: true, facet: true },
        { name: 'repo_default_branch', type: 'string', optional: true },
        { name: 'repo_updated_at', type: 'string', optional: true },
        { name: 'indexed_at', type: 'string', optional: true },
        { name: 'last_accessed_at', type: 'string', optional: true },
        { name: 'access_count', type: 'int32', optional: true },
        { name: 'index_status', type: 'string', optional: true, facet: true },
        { name: 'is_popular', type: 'bool', optional: true, facet: true },
        { name: 'created_at', type: 'string', optional: true },
    ],
}

const filesSchema: Typesense.CollectionCreateSchema = {
    name: FILES_COLLECTION,
    fields: [
        { name: 'id', type: 'string' },
        { name: 'repo_id', type: 'string', facet: true },           // filterable
        { name: 'file_path', type: 'string' },                       // searchable
        { name: 'file_path_exact', type: 'string', facet: true },   // for exact match filter
        { name: 'file_content', type: 'string' },                    // searchable
        { name: 'file_size', type: 'int32', optional: true },
        { name: 'file_language', type: 'string', optional: true, facet: true },
        { name: 'file_type', type: 'string', optional: true, facet: true },
        { name: 'indexed_at', type: 'string', optional: true },
        { name: 'created_at', type: 'string', optional: true },
    ],
}

// ── Typesense Search Engine ───────────────────────────────────────────────

export class TypesenseSearchEngine implements SearchEngine {
    readonly name = 'Typesense'
    private client: Typesense.Client

    constructor() {
        this.client = getClient()
    }

    async testConnection(): Promise<boolean> {
        try {
            console.log('🔍 Testing Typesense connection...')
            const health = await this.client.health.retrieve()
            const ok = health.ok === true
            console.log(ok ? '✅ Typesense connection successful' : '❌ Typesense health check failed')
            return ok
        } catch (error: any) {
            console.error('❌ Typesense connection failed:', error.message)
            return false
        }
    }

    async initialize(): Promise<void> {
        console.log('🔍 Initializing Typesense collections...')
        const isConnected = await this.testConnection()
        if (!isConnected) {
            throw new Error('Cannot connect to Typesense. Please check your configuration.')
        }

        // Create collections if they don't exist
        await this.ensureCollection(repoSchema)
        await this.ensureCollection(filesSchema)

        console.log('✅ Typesense collections initialized')
    }

    private async ensureCollection(schema: Typesense.CollectionCreateSchema): Promise<void> {
        try {
            await this.client.collections(schema.name).retrieve()
            // Already exists
        } catch (error: any) {
            if (error.httpStatus === 404) {
                await this.client.collections().create(schema)
                console.log(`✅ Created Typesense collection: ${schema.name}`)
            } else {
                throw error
            }
        }
    }

    async indexRepository(repoData: Partial<SearchEngineRepository>): Promise<void> {
        try {
            const doc = {
                id: repoData.id || '',
                repo_url: repoData.repo_url || '',
                repo_name: repoData.repo_name || '',
                repo_owner: repoData.repo_owner || '',
                repo_description: repoData.repo_description || '',
                repo_stars: repoData.repo_stars || 0,
                repo_language: repoData.repo_language || '',
                repo_languages: repoData.repo_languages || [],
                repo_default_branch: repoData.repo_default_branch || 'main',
                repo_updated_at: repoData.repo_updated_at || new Date().toISOString(),
                indexed_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                access_count: repoData.access_count || 0,
                index_status: repoData.index_status || 'pending',
                is_popular: repoData.is_popular || false,
            }
            await this.client.collections(REPO_COLLECTION).documents().upsert(doc)
            console.log(`✅ [Typesense] Indexed repository: ${repoData.repo_name}`)
        } catch (error) {
            console.error('❌ [Typesense] Error indexing repository:', error)
            throw error
        }
    }

    async indexFile(fileData: Partial<SearchEngineFile>): Promise<string> {
        const maxRetries = 3
        let lastError: Error = new Error('Unknown')

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const doc = {
                    id: fileData.id || '',
                    repo_id: fileData.repo_id || '',
                    file_path: fileData.file_path || '',
                    file_path_exact: fileData.file_path || '',   // exact-match copy
                    file_content: fileData.file_content || '',
                    file_size: fileData.file_size || 0,
                    file_language: fileData.file_language || 'unknown',
                    file_type: fileData.file_type || 'file',
                    indexed_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                }
                await this.client.collections(FILES_COLLECTION).documents().upsert(doc)
                return doc.id
            } catch (error: any) {
                lastError = error
                console.warn(`❌ [Typesense] Error indexing file (attempt ${attempt}/${maxRetries}):`, error.message)
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 1000 * attempt))
                }
            }
        }
        throw lastError
    }

    async searchRepositories(query: string, filters: Record<string, any> = {}): Promise<SearchEngineRepository[]> {
        try {
            const filterParts: string[] = []
            if (filters.language) filterParts.push(`repo_language:=\`${filters.language}\``)
            if (filters.is_popular !== undefined) filterParts.push(`is_popular:=${filters.is_popular}`)

            const result = await this.client.collections(REPO_COLLECTION).documents().search({
                q: query,
                query_by: 'repo_name,repo_description,repo_owner',
                filter_by: filterParts.length > 0 ? filterParts.join(' && ') : undefined,
                sort_by: 'repo_stars:desc',
                per_page: 20,
            })

            return (result.hits || []).map((hit: any) => ({
                ...hit.document,
                _score: hit.text_match_info?.score || 0,
            }))
        } catch (error) {
            console.error('❌ [Typesense] Error searching repositories:', error)
            throw error
        }
    }

    async searchFilesInRepository(
        repoId: string,
        query: string,
        fileType?: string,
        language?: string
    ): Promise<SearchEngineFile[]> {
        try {
            const filterParts: string[] = [`repo_id:=\`${repoId}\``]
            if (fileType) filterParts.push(`file_type:=\`${fileType}\``)
            if (language) filterParts.push(`file_language:=\`${language}\``)

            const normalized = (query || '').trim()
            const searchQuery = normalized && normalized !== '*' ? normalized : '*'

            // For wildcard queries we only need filter_by, no text match
            const searchParams: any = {
                q: searchQuery,
                query_by: 'file_path,file_content',
                filter_by: filterParts.join(' && '),
                per_page: 250,
            }

            const result = await this.client.collections(FILES_COLLECTION).documents().search(searchParams)

            return (result.hits || []).map((hit: any) => ({
                ...hit.document,
                _score: hit.text_match_info?.score || 0,
            }))
        } catch (error) {
            console.error('❌ [Typesense] Error searching files:', error)
            throw error
        }
    }

    async getFileContent(repoId: string, filePath: string): Promise<SearchEngineFile | null> {
        try {
            // Use the exact-match faceted field for filtering
            const result = await this.client.collections(FILES_COLLECTION).documents().search({
                q: '*',
                query_by: 'file_path',
                filter_by: `repo_id:=\`${repoId}\` && file_path_exact:=\`${filePath}\``,
                per_page: 1,
            })

            const hits = result.hits || []
            if (hits.length > 0) {
                return hits[0].document as unknown as SearchEngineFile
            }
            return null
        } catch (error) {
            console.error('❌ [Typesense] Error getting file content:', error)
            throw error
        }
    }

    async deleteRepository(repoId: string): Promise<void> {
        try {
            // Delete repository document
            try {
                await this.client.collections(REPO_COLLECTION).documents(repoId).delete()
            } catch (e: any) {
                if (e.httpStatus !== 404) throw e
            }

            // Delete all files belonging to this repository
            await this.client.collections(FILES_COLLECTION).documents().delete({
                filter_by: `repo_id:=\`${repoId}\``,
            })

            console.log(`✅ [Typesense] Deleted repository ${repoId}`)
        } catch (error) {
            console.error('❌ [Typesense] Error deleting repository:', error)
            throw error
        }
    }

    async getStats(): Promise<SearchEngineStats> {
        try {
            const [repoCollection, filesCollection] = await Promise.all([
                this.client.collections(REPO_COLLECTION).retrieve(),
                this.client.collections(FILES_COLLECTION).retrieve(),
            ])

            return {
                total_repositories: repoCollection.num_documents || 0,
                total_files: filesCollection.num_documents || 0,
            }
        } catch (error) {
            console.error('❌ [Typesense] Error getting stats:', error)
            throw error
        }
    }
}
