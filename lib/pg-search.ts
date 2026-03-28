import { Pool } from 'pg'
import type { SearchEngine, SearchEngineFile, SearchEngineRepository, SearchEngineStats } from './search-engine'

function sanitizeDatabaseUrl(url?: string): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('channel_binding')
    return parsed.toString()
  } catch {
    return url
  }
}

const pool = new Pool({
  connectionString: sanitizeDatabaseUrl(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  maxUses: 7500,
})

export class PostgresSearchEngine implements SearchEngine {
  readonly name = 'PostgreSQL'

  async testConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing PostgreSQL search connection...')
      const client = await pool.connect()
      await client.query('SELECT 1')
      client.release()
      console.log('✅ PostgreSQL search connection successful')
      return true
    } catch (error: any) {
      console.error('❌ PostgreSQL search connection failed:', error.message)
      return false
    }
  }

  async initialize(): Promise<void> {
    console.log('🔍 Initializing PostgreSQL search tables...')
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS search_repositories (
          id TEXT PRIMARY KEY,
          repo_url TEXT,
          repo_name TEXT,
          repo_owner TEXT,
          repo_description TEXT,
          repo_stars INTEGER DEFAULT 0,
          repo_language TEXT,
          repo_languages TEXT[] DEFAULT '{}',
          repo_default_branch TEXT DEFAULT 'main',
          repo_updated_at TEXT,
          indexed_at TEXT,
          last_accessed_at TEXT,
          access_count INTEGER DEFAULT 0,
          index_status TEXT DEFAULT 'pending',
          is_popular BOOLEAN DEFAULT FALSE,
          created_at TEXT,
          search_vector TSVECTOR
        )
      `)

      await client.query(`
        CREATE TABLE IF NOT EXISTS search_files (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_content TEXT,
          file_size INTEGER DEFAULT 0,
          file_language TEXT,
          file_type TEXT DEFAULT 'file',
          indexed_at TEXT,
          created_at TEXT,
          search_vector TSVECTOR
        )
      `)

      await client.query(`CREATE INDEX IF NOT EXISTS idx_search_files_repo_id ON search_files(repo_id)`)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_search_files_path ON search_files(file_path)`)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_search_files_vector ON search_files USING GIN(search_vector)`)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_search_repos_vector ON search_repositories USING GIN(search_vector)`)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_search_repos_url ON search_repositories(repo_url)`)

      console.log('✅ PostgreSQL search tables initialized')
    } finally {
      client.release()
    }
  }

  async indexRepository(repoData: Partial<SearchEngineRepository>): Promise<void> {
    const client = await pool.connect()
    try {
      const searchText = [
        repoData.repo_name || '',
        repoData.repo_owner || '',
        repoData.repo_description || '',
      ].join(' ')

      await client.query(`
        INSERT INTO search_repositories (id, repo_url, repo_name, repo_owner, repo_description,
          repo_stars, repo_language, repo_languages, repo_default_branch, repo_updated_at,
          indexed_at, created_at, access_count, index_status, is_popular, search_vector)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          to_tsvector('english', $16))
        ON CONFLICT (id) DO UPDATE SET
          repo_url = EXCLUDED.repo_url,
          repo_name = EXCLUDED.repo_name,
          repo_owner = EXCLUDED.repo_owner,
          repo_description = EXCLUDED.repo_description,
          repo_stars = EXCLUDED.repo_stars,
          repo_language = EXCLUDED.repo_language,
          repo_languages = EXCLUDED.repo_languages,
          repo_default_branch = EXCLUDED.repo_default_branch,
          repo_updated_at = EXCLUDED.repo_updated_at,
          indexed_at = EXCLUDED.indexed_at,
          index_status = EXCLUDED.index_status,
          is_popular = EXCLUDED.is_popular,
          search_vector = to_tsvector('english', $16)
      `, [
        repoData.id || '',
        repoData.repo_url || '',
        repoData.repo_name || '',
        repoData.repo_owner || '',
        repoData.repo_description || '',
        repoData.repo_stars || 0,
        repoData.repo_language || null,
        repoData.repo_languages || [],
        repoData.repo_default_branch || 'main',
        repoData.repo_updated_at || new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
        repoData.access_count || 0,
        repoData.index_status || 'pending',
        repoData.is_popular || false,
        searchText,
      ])
      console.log(`✅ [PostgreSQL] Indexed repository: ${repoData.repo_name}`)
    } catch (error) {
      console.error('❌ [PostgreSQL] Error indexing repository:', error)
      throw error
    } finally {
      client.release()
    }
  }

  async indexFile(fileData: Partial<SearchEngineFile>): Promise<string> {
    const maxRetries = 3
    let lastError: Error = new Error('Unknown')

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await pool.connect()
      try {
        const contentForSearch = (fileData.file_content || '').substring(0, 50000)
        const searchText = [
          fileData.file_path || '',
          contentForSearch,
        ].join(' ')

        await client.query(`
          INSERT INTO search_files (id, repo_id, file_path, file_content, file_size,
            file_language, file_type, indexed_at, created_at, search_vector)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
            to_tsvector('english', $10))
          ON CONFLICT (id) DO UPDATE SET
            repo_id = EXCLUDED.repo_id,
            file_path = EXCLUDED.file_path,
            file_content = EXCLUDED.file_content,
            file_size = EXCLUDED.file_size,
            file_language = EXCLUDED.file_language,
            file_type = EXCLUDED.file_type,
            indexed_at = EXCLUDED.indexed_at,
            search_vector = to_tsvector('english', $10)
        `, [
          fileData.id || '',
          fileData.repo_id || '',
          fileData.file_path || '',
          fileData.file_content || '',
          fileData.file_size || 0,
          fileData.file_language || 'unknown',
          fileData.file_type || 'file',
          new Date().toISOString(),
          new Date().toISOString(),
          searchText,
        ])
        return fileData.id || ''
      } catch (error: any) {
        lastError = error
        console.warn(`❌ [PostgreSQL] Error indexing file (attempt ${attempt}/${maxRetries}):`, error.message)
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt))
        }
      } finally {
        client.release()
      }
    }
    throw lastError
  }

  async searchRepositories(query: string, filters: Record<string, any> = {}): Promise<SearchEngineRepository[]> {
    const client = await pool.connect()
    try {
      const tsQuery = query.split(/\s+/).filter(Boolean).map(w => w.replace(/[^a-zA-Z0-9]/g, '') + ':*').join(' | ')
      if (!tsQuery) return []

      let whereClause = `search_vector @@ to_tsquery('english', $1)`
      const params: any[] = [tsQuery]
      let paramIdx = 2

      if (filters.language) {
        whereClause += ` AND repo_language = $${paramIdx}`
        params.push(filters.language)
        paramIdx++
      }
      if (filters.is_popular !== undefined) {
        whereClause += ` AND is_popular = $${paramIdx}`
        params.push(filters.is_popular)
        paramIdx++
      }

      const result = await client.query(`
        SELECT *, ts_rank(search_vector, to_tsquery('english', $1)) as _score
        FROM search_repositories
        WHERE ${whereClause}
        ORDER BY _score DESC, repo_stars DESC
        LIMIT 20
      `, params)

      return result.rows.map(row => ({
        ...row,
        _score: parseFloat(row._score) || 0,
      }))
    } catch (error) {
      console.error('❌ [PostgreSQL] Error searching repositories:', error)
      throw error
    } finally {
      client.release()
    }
  }

  async searchFilesInRepository(
    repoId: string,
    query: string,
    fileType?: string,
    language?: string
  ): Promise<SearchEngineFile[]> {
    const client = await pool.connect()
    try {
      const normalized = (query || '').trim()

      if (!normalized || normalized === '*') {
        let sql = `SELECT *, 1.0 as _score FROM search_files WHERE repo_id = $1`
        const params: any[] = [repoId]
        let paramIdx = 2
        if (fileType) {
          sql += ` AND file_type = $${paramIdx}`
          params.push(fileType)
          paramIdx++
        }
        if (language) {
          sql += ` AND file_language = $${paramIdx}`
          params.push(language)
          paramIdx++
        }
        sql += ` ORDER BY file_path ASC LIMIT 1000`
        const result = await client.query(sql, params)
        return result.rows
      }

      const tsQuery = normalized.split(/\s+/).filter(Boolean).map(w => w.replace(/[^a-zA-Z0-9_./]/g, '') + ':*').join(' | ')
      if (!tsQuery) {
        const result = await client.query(
          `SELECT *, 1.0 as _score FROM search_files WHERE repo_id = $1 ORDER BY file_path LIMIT 1000`,
          [repoId]
        )
        return result.rows
      }

      let whereClause = `repo_id = $1 AND (search_vector @@ to_tsquery('english', $2) OR file_path ILIKE $3)`
      const params: any[] = [repoId, tsQuery, `%${normalized}%`]
      let paramIdx = 4

      if (fileType) {
        whereClause += ` AND file_type = $${paramIdx}`
        params.push(fileType)
        paramIdx++
      }
      if (language) {
        whereClause += ` AND file_language = $${paramIdx}`
        params.push(language)
        paramIdx++
      }

      const result = await client.query(`
        SELECT *,
          CASE WHEN search_vector @@ to_tsquery('english', $2)
            THEN ts_rank(search_vector, to_tsquery('english', $2))
            ELSE 0.1
          END as _score
        FROM search_files
        WHERE ${whereClause}
        ORDER BY _score DESC, file_path ASC
        LIMIT 1000
      `, params)

      return result.rows.map(row => ({
        ...row,
        _score: parseFloat(row._score) || 0,
      }))
    } catch (error) {
      console.error('❌ [PostgreSQL] Error searching files:', error)
      throw error
    } finally {
      client.release()
    }
  }

  async getFileContent(repoId: string, filePath: string): Promise<SearchEngineFile | null> {
    const client = await pool.connect()
    try {
      const result = await client.query(
        `SELECT * FROM search_files WHERE repo_id = $1 AND file_path = $2 LIMIT 1`,
        [repoId, filePath]
      )
      return result.rows[0] || null
    } catch (error) {
      console.error('❌ [PostgreSQL] Error getting file content:', error)
      throw error
    } finally {
      client.release()
    }
  }

  async deleteRepository(repoId: string): Promise<void> {
    const client = await pool.connect()
    try {
      await client.query(`DELETE FROM search_files WHERE repo_id = $1`, [repoId])
      await client.query(`DELETE FROM search_repositories WHERE id = $1`, [repoId])
      console.log(`✅ [PostgreSQL] Deleted repository ${repoId}`)
    } catch (error) {
      console.error('❌ [PostgreSQL] Error deleting repository:', error)
      throw error
    } finally {
      client.release()
    }
  }

  async getStats(): Promise<SearchEngineStats> {
    const client = await pool.connect()
    try {
      const [repoResult, fileResult] = await Promise.all([
        client.query(`SELECT COUNT(*) as count FROM search_repositories`),
        client.query(`SELECT COUNT(*) as count FROM search_files`),
      ])
      return {
        total_repositories: parseInt(repoResult.rows[0].count) || 0,
        total_files: parseInt(fileResult.rows[0].count) || 0,
      }
    } catch (error) {
      console.error('❌ [PostgreSQL] Error getting stats:', error)
      throw error
    } finally {
      client.release()
    }
  }
}
