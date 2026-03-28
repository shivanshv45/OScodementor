// Elasticsearch integration for code indexing and search
// Uses @elastic/elasticsearch v9 API (no body wrapper)
// Now implements the SearchEngine interface for use with the search adapter

import { Client } from '@elastic/elasticsearch'
import type { SearchEngine, SearchEngineFile, SearchEngineRepository, SearchEngineStats } from './search-engine'

// Index names
const REPOSITORY_INDEX = 'codementor_repositories'
const FILES_INDEX = 'codementor_files'

function createClient(): Client {
  return new Client({
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    auth: {
      username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
      password: process.env.ELASTICSEARCH_PASSWORD || 'changeme',
    },
    tls: {
      rejectUnauthorized: false,
    },
    requestTimeout: 30000,
    maxRetries: 3,
  })
}

// ── Elasticsearch Search Engine class ─────────────────────────────────────

export class ElasticsearchSearchEngine implements SearchEngine {
  readonly name = 'Elasticsearch'
  private client: Client

  constructor() {
    this.client = createClient()
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing Elasticsearch connection...')
      await this.client.ping()
      console.log('✅ Elasticsearch connection successful')
      return true
    } catch (error: any) {
      console.error('❌ Elasticsearch connection failed:', error.message)
      return false
    }
  }

  async initialize(): Promise<void> {
    console.log('🔍 Initializing Elasticsearch...')
    const isConnected = await this.testConnection()
    if (!isConnected) {
      throw new Error('Cannot connect to Elasticsearch. Please check your configuration.')
    }

    // Check and create repositories index
    const repoExists = await this.client.indices.exists({ index: REPOSITORY_INDEX })
    if (!repoExists) {
      await this.client.indices.create({
        index: REPOSITORY_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            repo_url: { type: 'keyword' },
            repo_name: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
            repo_owner: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
            repo_description: { type: 'text', analyzer: 'standard' },
            repo_stars: { type: 'integer' },
            repo_language: { type: 'keyword' },
            repo_languages: { type: 'keyword' },
            repo_default_branch: { type: 'keyword' },
            repo_updated_at: { type: 'date' },
            indexed_at: { type: 'date' },
            last_accessed_at: { type: 'date' },
            access_count: { type: 'integer' },
            index_status: { type: 'keyword' },
            is_popular: { type: 'boolean' },
            created_at: { type: 'date' },
          },
        },
      })
      console.log('✅ Created repositories index')
    }

    // Check and create files index
    const filesExists = await this.client.indices.exists({ index: FILES_INDEX })
    if (!filesExists) {
      await this.client.indices.create({
        index: FILES_INDEX,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            repo_id: { type: 'keyword' },
            file_path: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
            file_content: { type: 'text', analyzer: 'standard' },
            file_size: { type: 'integer' },
            file_language: { type: 'keyword' },
            file_type: { type: 'keyword' },
            indexed_at: { type: 'date' },
            created_at: { type: 'date' },
          },
        },
      })
      console.log('✅ Created files index')
    }

    console.log('✅ Elasticsearch indices initialized successfully')
  }

  async indexRepository(repoData: Partial<SearchEngineRepository>): Promise<void> {
    try {
      await this.client.index({
        index: REPOSITORY_INDEX,
        id: repoData.id,
        document: {
          ...repoData,
          indexed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      })
      console.log(`✅ Indexed repository: ${repoData.repo_name}`)
    } catch (error) {
      console.error('❌ Error indexing repository:', error)
      throw error
    }
  }

  async indexFile(fileData: Partial<SearchEngineFile>): Promise<string> {
    const maxRetries = 3
    let lastError: Error = new Error('Unknown')

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📄 Indexing file: ${fileData.file_path} (attempt ${attempt}/${maxRetries})`)
        const response = await this.client.index({
          index: FILES_INDEX,
          id: fileData.id,
          document: {
            ...fileData,
            indexed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
        })
        console.log(`✅ Indexed file: ${fileData.file_path}`)
        return response._id
      } catch (error: any) {
        lastError = error
        console.warn(`❌ Error indexing file ${fileData.file_path} (attempt ${attempt}/${maxRetries}):`, error.message)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw lastError
  }

  async searchRepositories(query: string, filters: Record<string, any> = {}): Promise<SearchEngineRepository[]> {
    try {
      const must: any[] = [{
        multi_match: {
          query,
          fields: ['repo_name^2', 'repo_description', 'repo_owner'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      }]

      const filter: any[] = []
      if (filters.language) filter.push({ term: { repo_language: filters.language } })
      if (filters.is_popular !== undefined) filter.push({ term: { is_popular: filters.is_popular } })

      const response = await this.client.search({
        index: REPOSITORY_INDEX,
        query: {
          bool: {
            must,
            ...(filter.length > 0 ? { filter } : {}),
          },
        },
        sort: [
          { access_count: { order: 'desc' } },
          { repo_stars: { order: 'desc' } },
          { indexed_at: { order: 'desc' } },
        ],
        size: 20,
      })

      return (response.hits?.hits || []).map((hit: any) => ({
        ...(hit._source || {}),
        _score: hit._score,
      }))
    } catch (error) {
      console.error('❌ Error searching repositories:', error)
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
      const must: any[] = [{ term: { repo_id: repoId } }]
      const normalized = (query || '').trim()
      if (normalized && normalized !== '*') {
        must.push({
          multi_match: {
            query: normalized,
            fields: ['file_path^2', 'file_content'],
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        })
      }

      const filter: any[] = []
      if (fileType) filter.push({ term: { file_type: fileType } })
      if (language) filter.push({ term: { file_language: language } })

      const response = await this.client.search({
        index: FILES_INDEX,
        query: {
          bool: {
            must,
            ...(filter.length > 0 ? { filter } : {}),
          },
        },
        sort: [
          { _score: { order: 'desc' } },
          { 'file_path.keyword': { order: 'asc' } },
        ],
        size: 1000,
      })

      return (response.hits?.hits || []).map((hit: any) => ({
        ...(hit._source || {}),
        _score: hit._score,
      }))
    } catch (error) {
      console.error('❌ Error searching files:', error)
      throw error
    }
  }

  async getFileContent(repoId: string, filePath: string): Promise<SearchEngineFile | null> {
    try {
      const response = await this.client.search({
        index: FILES_INDEX,
        query: {
          bool: {
            must: [
              { term: { repo_id: repoId } },
              { term: { 'file_path.keyword': filePath } },
            ],
          },
        },
        size: 1,
      })

      const hits = response.hits?.hits || []
      if (hits.length > 0) {
        return (hits[0] as any)._source || null
      }
      return null
    } catch (error) {
      console.error('❌ Error getting file content:', error)
      throw error
    }
  }

  async deleteRepository(repoId: string): Promise<void> {
    try {
      await this.client.delete({
        index: REPOSITORY_INDEX,
        id: repoId,
      })

      await this.client.deleteByQuery({
        index: FILES_INDEX,
        query: { term: { repo_id: repoId } },
      })

      console.log(`✅ Deleted repository ${repoId} from Elasticsearch`)
    } catch (error) {
      console.error('❌ Error deleting repository from index:', error)
      throw error
    }
  }

  async getStats(): Promise<SearchEngineStats> {
    try {
      const [repoStats, fileStats] = await Promise.all([
        this.client.count({ index: REPOSITORY_INDEX }),
        this.client.count({ index: FILES_INDEX }),
      ])

      return {
        total_repositories: repoStats.count,
        total_files: fileStats.count,
      }
    } catch (error) {
      console.error('❌ Error getting repository stats:', error)
      throw error
    }
  }
}

// ── Legacy exports (backward compatibility) ───────────────────────────────
// These allow existing code that imports from elasticsearch.ts directly to
// keep working until fully migrated to the search adapter.

const legacyClient = createClient()

export async function testElasticsearchConnection(): Promise<boolean> {
  try {
    await legacyClient.ping()
    return true
  } catch {
    return false
  }
}

export async function initializeElasticsearch() {
  const engine = new ElasticsearchSearchEngine()
  await engine.initialize()
}

export async function indexRepository(repoData: any): Promise<void> {
  const engine = new ElasticsearchSearchEngine()
  await engine.indexRepository(repoData)
}

export async function indexFile(fileData: any): Promise<string> {
  const engine = new ElasticsearchSearchEngine()
  return engine.indexFile(fileData)
}

export async function searchRepositories(query: string, filters: any = {}): Promise<any[]> {
  const engine = new ElasticsearchSearchEngine()
  return engine.searchRepositories(query, filters)
}

export async function searchFilesInRepository(
  repoId: string,
  query: string,
  fileType?: string,
  language?: string
): Promise<any[]> {
  const engine = new ElasticsearchSearchEngine()
  return engine.searchFilesInRepository(repoId, query, fileType, language)
}

export async function getFileContent(repoId: string, filePath: string): Promise<any | null> {
  const engine = new ElasticsearchSearchEngine()
  return engine.getFileContent(repoId, filePath)
}

export async function deleteRepositoryFromIndex(repoId: string): Promise<void> {
  const engine = new ElasticsearchSearchEngine()
  return engine.deleteRepository(repoId)
}

export async function getRepositoryStats(): Promise<any> {
  const engine = new ElasticsearchSearchEngine()
  return engine.getStats()
}

export { legacyClient as client }
