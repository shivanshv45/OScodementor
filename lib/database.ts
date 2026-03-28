// Database connection and schema for CodeMentor indexing system
import { Pool } from 'pg'

// Strip channel_binding param from DATABASE_URL since node-postgres doesn't support it
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

// Database connection pool — SSL always enabled for Neon
const pool = new Pool({
  connectionString: sanitizeDatabaseUrl(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  maxUses: 7500,
})

// Database schema interfaces
export interface IndexedRepository {
  id: string
  repo_url: string
  repo_name: string
  repo_owner: string
  repo_description: string | null
  repo_stars: number
  repo_language: string | null
  repo_languages: string[]
  repo_default_branch: string
  repo_updated_at: string
  indexed_at: string
  last_accessed_at: string
  access_count: number
  index_status: 'pending' | 'indexing' | 'completed' | 'failed'
  index_progress: number
  total_files: number
  indexed_files: number
  error_message: string | null
  cache_ttl_hours: number
  is_popular: boolean
  // Optional insights
  repo_summary?: string | null
  quickstart?: string | null
  contribution_guide?: string | null
  good_first_issues?: any | null
}

export interface IndexedFile {
  id: string
  repo_id: string
  file_path: string
  file_content: string
  file_size: number
  file_language: string | null
  file_type: 'file' | 'folder'
  indexed_at: string
  elasticsearch_id: string | null
}

export interface IndexingProgress {
  repo_id: string
  status: 'pending' | 'indexing' | 'completed' | 'failed'
  progress: number
  current_step: string
  total_files: number
  indexed_files: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// Initialize database tables
export async function initializeDatabase() {
  const client = await pool.connect()

  try {
    // Create repositories table
    await client.query(`
      CREATE TABLE IF NOT EXISTS indexed_repositories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_url TEXT UNIQUE NOT NULL,
        repo_name TEXT NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_description TEXT,
        repo_stars INTEGER DEFAULT 0,
        repo_language TEXT,
        repo_languages TEXT[] DEFAULT '{}',
        repo_default_branch TEXT DEFAULT 'main',
        repo_updated_at TIMESTAMP WITH TIME ZONE,
        indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        access_count INTEGER DEFAULT 1,
        index_status TEXT DEFAULT 'pending' CHECK (index_status IN ('pending', 'indexing', 'completed', 'failed')),
        index_progress INTEGER DEFAULT 0 CHECK (index_progress >= 0 AND index_progress <= 100),
        total_files INTEGER DEFAULT 0,
        indexed_files INTEGER DEFAULT 0,
        error_message TEXT,
        cache_ttl_hours INTEGER DEFAULT 24,
        is_popular BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create indexed files table
    await client.query(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_id UUID NOT NULL REFERENCES indexed_repositories(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        file_content TEXT,
        file_size INTEGER DEFAULT 0,
        file_language TEXT,
        file_type TEXT DEFAULT 'file' CHECK (file_type IN ('file', 'folder')),
        indexed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        elasticsearch_id TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create indexing progress table
    await client.query(`
      CREATE TABLE IF NOT EXISTS indexing_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_id UUID NOT NULL REFERENCES indexed_repositories(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'completed', 'failed')),
        progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        current_step TEXT DEFAULT 'Starting...',
        total_files INTEGER DEFAULT 0,
        indexed_files INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_repos_url ON indexed_repositories(repo_url)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_repos_status ON indexed_repositories(index_status)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_repos_accessed ON indexed_repositories(last_accessed_at)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_files_repo ON indexed_files(repo_id)
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_files_path ON indexed_files(file_path)
    `)

    // Ensure a single progress row per repository for proper upserts
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_indexing_progress_repo ON indexing_progress(repo_id)
    `)

    // Add insights columns if they do not exist (Neon-compatible)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='indexed_repositories' AND column_name='repo_summary'
        ) THEN
          ALTER TABLE indexed_repositories ADD COLUMN repo_summary TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='indexed_repositories' AND column_name='quickstart'
        ) THEN
          ALTER TABLE indexed_repositories ADD COLUMN quickstart TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='indexed_repositories' AND column_name='contribution_guide'
        ) THEN
          ALTER TABLE indexed_repositories ADD COLUMN contribution_guide TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='indexed_repositories' AND column_name='good_first_issues'
        ) THEN
          ALTER TABLE indexed_repositories ADD COLUMN good_first_issues JSONB;
        END IF;
      END$$;
    `)

    console.log('✅ Database tables initialized successfully')
  } catch (error) {
    console.error('❌ Error initializing database:', error)
    throw error
  } finally {
    client.release()
  }
}

// Repository operations
export async function getRepositoryByUrl(repoUrl: string): Promise<IndexedRepository | null> {
  const client = await pool.connect()
  try {
    const result = await client.query(
      'SELECT * FROM indexed_repositories WHERE repo_url = $1',
      [repoUrl]
    )
    return result.rows[0] || null
  } finally {
    client.release()
  }
}

export async function createRepository(repoData: Omit<IndexedRepository, 'id' | 'indexed_at' | 'last_accessed_at' | 'access_count'>): Promise<IndexedRepository> {
  const client = await pool.connect()
  try {
    const result = await client.query(`
      INSERT INTO indexed_repositories (
        repo_url, repo_name, repo_owner, repo_description, repo_stars, 
        repo_language, repo_languages, repo_default_branch, repo_updated_at,
        index_status, index_progress, total_files, indexed_files, cache_ttl_hours,
        repo_summary, quickstart, contribution_guide, good_first_issues
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (repo_url) DO UPDATE SET
        repo_name = EXCLUDED.repo_name,
        repo_owner = EXCLUDED.repo_owner,
        repo_description = EXCLUDED.repo_description,
        repo_stars = EXCLUDED.repo_stars,
        index_status = 'pending',
        index_progress = 0,
        total_files = 0,
        indexed_files = 0,
        error_message = NULL,
        updated_at = NOW()
      RETURNING *
    `, [
      repoData.repo_url, repoData.repo_name, repoData.repo_owner,
      repoData.repo_description, repoData.repo_stars, repoData.repo_language,
      repoData.repo_languages, repoData.repo_default_branch, repoData.repo_updated_at,
      repoData.index_status, repoData.index_progress, repoData.total_files,
      repoData.indexed_files, repoData.cache_ttl_hours,
      null, null, null, null
    ])
    return result.rows[0]
  } finally {
    client.release()
  }
}

// Retry helper for database operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error
      console.warn(`Database operation failed (attempt ${attempt}/${maxRetries}):`, error.message)

      if (attempt === maxRetries) {
        throw error
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError!
}

export async function updateRepositoryStatus(
  repoId: string,
  status: IndexedRepository['index_status'],
  progress: number,
  currentStep: string,
  errorMessage?: string,
  totalFiles?: number,
  indexedFiles?: number
): Promise<void> {
  console.log(`🔍 updateRepositoryStatus called with:`, { repoId, status, progress, currentStep })

  await withRetry(async () => {
    console.log(`🔍 Getting database connection...`)
    const client = await pool.connect()
    console.log(`✅ Database connection acquired`)

    try {
      console.log(`📊 Updating repository status: ${repoId} -> ${status} (${progress}%)`)

      console.log(`🔍 Executing UPDATE query...`)
      const updateResult = await client.query(`
        UPDATE indexed_repositories 
        SET index_status = $1, index_progress = $2, updated_at = NOW()
        WHERE id = $3
      `, [status, progress, repoId])
      console.log(`✅ UPDATE query completed, rows affected: ${updateResult.rowCount}`)

      console.log(`🔍 Executing INSERT/UPDATE query for progress table...`)
      // Update progress table
      const progressResult = await client.query(`
        INSERT INTO indexing_progress (repo_id, status, progress, current_step, error_message, total_files, indexed_files)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (repo_id) DO UPDATE SET
          status = EXCLUDED.status,
          progress = EXCLUDED.progress,
          current_step = EXCLUDED.current_step,
          error_message = EXCLUDED.error_message,
          total_files = EXCLUDED.total_files,
          indexed_files = EXCLUDED.indexed_files,
          updated_at = NOW()
      `, [repoId, status, progress, currentStep, errorMessage, totalFiles || 0, indexedFiles || 0])
      console.log(`✅ Progress table query completed`)

      console.log(`✅ Repository status updated successfully: ${repoId}`)
    } catch (queryError: any) {
      console.error(`❌ Database query failed:`, queryError.message)
      throw queryError
    } finally {
      console.log(`🔍 Releasing database connection...`)
      client.release()
      console.log(`✅ Database connection released`)
    }
  })
}

export async function updateRepositoryAccess(repoId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(`
      UPDATE indexed_repositories 
      SET last_accessed_at = NOW(), access_count = access_count + 1
      WHERE id = $1
    `, [repoId])
  } finally {
    client.release()
  }
}

export async function getIndexingProgress(repoId: string): Promise<IndexingProgress | null> {
  const client = await pool.connect()
  try {
    const result = await client.query(
      'SELECT * FROM indexing_progress WHERE repo_id = $1 ORDER BY created_at DESC LIMIT 1',
      [repoId]
    )
    return result.rows[0] || null
  } finally {
    client.release()
  }
}

export async function getAllIndexedRepositories(): Promise<IndexedRepository[]> {
  const client = await pool.connect()
  try {
    const result = await client.query(`
      SELECT * FROM indexed_repositories 
      ORDER BY last_accessed_at DESC
    `)
    return result.rows
  } finally {
    client.release()
  }
}

export async function clearRepositoryCache(repoId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('DELETE FROM indexed_repositories WHERE id = $1', [repoId])
    await client.query('DELETE FROM indexed_files WHERE repo_id = $1', [repoId])
    await client.query('DELETE FROM indexing_progress WHERE repo_id = $1', [repoId])
  } finally {
    client.release()
  }
}

// Repository insights helpers
export async function updateRepositoryInsights(
  repoId: string,
  insights: { repo_summary?: string | null; quickstart?: string | null; contribution_guide?: string | null; good_first_issues?: any | null }
): Promise<void> {
  const client = await pool.connect()
  try {
    const { repo_summary, quickstart, contribution_guide, good_first_issues } = insights
    await client.query(`
      UPDATE indexed_repositories
      SET 
        repo_summary = COALESCE($2, repo_summary),
        quickstart = COALESCE($3, quickstart),
        contribution_guide = COALESCE($4, contribution_guide),
        good_first_issues = COALESCE($5, good_first_issues),
        updated_at = NOW()
      WHERE id = $1
    `, [repoId, repo_summary ?? null, quickstart ?? null, contribution_guide ?? null, good_first_issues ?? null])
  } finally {
    client.release()
  }
}

export async function getRepositoryInsights(repoUrl: string): Promise<{
  repo_summary: string | null
  quickstart: string | null
  contribution_guide: string | null
  good_first_issues: any | null
} | null> {
  const client = await pool.connect()
  try {
    const result = await client.query(
      `SELECT repo_summary, quickstart, contribution_guide, good_first_issues 
       FROM indexed_repositories WHERE repo_url = $1`,
      [repoUrl]
    )
    return result.rows[0] || null
  } finally {
    client.release()
  }
}

export { pool }
