// Background indexing worker for Vercel cron jobs
// Now uses the unified search adapter (ES → Typesense fallback)
import { updateRepositoryStatus, getIndexingProgress } from '@/lib/database'
import { fetchCompleteRepositoryData, parseGitHubUrl } from '@/lib/github'
import {
  initializeSearchEngine,
  indexRepository,
  indexFile,
  searchFilesInRepository,
  getActiveEngineName,
} from '@/lib/search-adapter'
import { fetchRawFileContent, scoreFileImportance, githubConcurrencyLimit } from '@/lib/github'
import { updateRepositoryInsights } from '@/lib/database'
import { generateInsightsFromReadme, analyzeRepositoryStructure } from '@/lib/gemini'

export const maxDuration = 60

export async function POST(request: Request) {
  console.log('🔄 Background indexing worker started')
  console.log('🔍 Request received at:', new Date().toISOString())

  let repoId: string | null = null

  try {
    const body = await request.json()
    repoId = body.repoId
    const repoUrl = body.repoUrl

    console.log('🔍 Request body:', { repoId, repoUrl: repoUrl ? '***SET***' : 'MISSING' })

    if (!repoId || !repoUrl) {
      console.error('❌ Missing required parameters:', { repoId: !!repoId, repoUrl: !!repoUrl })
      return Response.json(
        { error: 'Repository ID and URL are required' },
        { status: 400 }
      )
    }

    // Check if indexing is already in progress
    const currentProgress = await getIndexingProgress(repoId)
    if (currentProgress && currentProgress.status === 'completed') {
      console.log(`✅ Repository ${repoId} already indexed`)
      return Response.json({
        success: true,
        message: 'Repository already indexed',
        status: 'completed'
      })
    }

    if (currentProgress && currentProgress.status === 'indexing' && currentProgress.progress > 5) {
      console.log(`⏳ Repository ${repoId} indexing already in progress at ${currentProgress.progress}%`)
      return Response.json({
        success: true,
        message: 'Indexing already in progress',
        status: 'indexing',
        progress: currentProgress.progress
      })
    }

    // Start the indexing process
    const indexingRepoId = repoId
    const indexingRepoUrl = repoUrl

    // Update status to 5% immediately so frontend sees progress
    await updateRepositoryStatus(indexingRepoId, 'indexing', 5, 'Starting indexing process...')

    try {
      await indexRepositoryAsync(indexingRepoId, indexingRepoUrl)
      console.log(`✅ Indexing completed successfully for ${indexingRepoId}`)
    } catch (error: any) {
      console.error(`❌ Error in background indexing for ${indexingRepoId}:`, error)
      try {
        await updateRepositoryStatus(
          indexingRepoId,
          'failed',
          0,
          'Indexing failed',
          error.message || 'Unknown error occurred during indexing'
        )
      } catch (updateError: any) {
        console.error('❌ Failed to update status after error:', updateError)
      }
    }

    return Response.json({
      success: true,
      message: 'Indexing completed',
      status: 'completed'
    })

  } catch (error: any) {
    console.error('❌ Background indexing error:', error)

    if (repoId && typeof repoId === 'string') {
      try {
        await updateRepositoryStatus(
          repoId,
          'failed',
          0,
          'Indexing failed',
          error.message || 'Unknown error occurred'
        )
      } catch (updateError: any) {
        console.error('❌ Failed to update status to failed:', updateError)
      }
    }

    return Response.json(
      { error: 'Background indexing failed', details: error.message },
      { status: 500 }
    )
  }
}

// Async function to handle the actual indexing
async function indexRepositoryAsync(repoId: string, repoUrl: string) {
  console.log(`🔄 Starting indexing for repository: ${repoId}`)
  console.log(`📝 Repository URL: ${repoUrl}`)
  console.log(`🔍 Environment check:`, {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasElasticsearchUrl: !!process.env.ELASTICSEARCH_URL,
    hasTypesenseHost: !!process.env.TYPESENSE_HOST,
    hasGithubToken: !!process.env.GITHUB_TOKEN,
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
  })

  try {
    // Step 0: Initialize search engine (ES → Typesense fallback)
    console.log(`📊 Step 0: Initializing search engine connection...`)
    try {
      await updateRepositoryStatus(repoId, 'indexing', 7, 'Initializing search engine connection...')
    } catch (dbError: any) {
      console.warn(`⚠️ Failed to update status (non-fatal):`, dbError.message)
    }

    try {
      await initializeSearchEngine()
      console.log(`✅ Search engine initialized: ${getActiveEngineName()}`)
    } catch (esInitError: any) {
      console.error(`❌ Failed to initialize search engine:`, esInitError.message)
      throw new Error(`Search engine initialization failed: ${esInitError.message}`)
    }

    // Step 1: Update status
    console.log(`📊 Step 1: Updating status to indexing (8%)`)
    try {
      await Promise.race([
        updateRepositoryStatus(repoId, 'indexing', 8, `Preparing to fetch repository data... (engine: ${getActiveEngineName()})`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database update timeout after 15 seconds')), 15000)
        )
      ])
    } catch (dbError: any) {
      console.warn(`⚠️ Database update failed (non-fatal):`, dbError.message)
    }

    // Step 2: Fetch repository data from GitHub
    console.log(`🔍 Step 2: Fetching repository data from GitHub API...`)
    try {
      await updateRepositoryStatus(repoId, 'indexing', 10, 'Connecting to GitHub API...')
    } catch (dbError: any) {
      console.warn(`⚠️ Failed to update status (non-fatal):`, dbError.message)
    }

    let repoData: any
    try {
      const fetchPromise = fetchCompleteRepositoryData(repoUrl)
      const progressPromise = new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, 2000))
        try {
          await updateRepositoryStatus(repoId, 'indexing', 12, 'Fetching repository data from GitHub...')
        } catch { }
        resolve(null)
      })

      repoData = await Promise.race([
        fetchPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('GitHub API timeout after 30 seconds')), 30000)
        )
      ]) as any

      await progressPromise.catch(() => { })
      console.log(`✅ Fetched repository data: ${repoData.name}`)

      try {
        await updateRepositoryStatus(repoId, 'indexing', 15, 'Repository data received, processing...')
      } catch { }
    } catch (fetchError: any) {
      console.error(`❌ Failed to fetch repository data:`, fetchError.message)
      throw new Error(`GitHub API error: ${fetchError.message}`)
    }

    // Step 3: Update progress
    await updateRepositoryStatus(repoId, 'indexing', 20, 'Analyzing repository structure...')
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Step 4: Count total files
    const totalFiles = countFilesRecursively(repoData.files)
    console.log(`📊 Total files to index: ${totalFiles}`)

    // Step 5: Update total files count
    await updateRepositoryStatus(repoId, 'indexing', 30, `Found ${totalFiles} files to index...`, undefined, totalFiles, 0)

    // Step 6: Index repository metadata
    console.log(`📊 Step 6: Indexing repository metadata...`)
    const indexedRepo = {
      id: repoId,
      repo_url: repoUrl,
      repo_name: repoData.name,
      repo_owner: repoUrl.split('/')[3],
      repo_description: repoData.description,
      repo_stars: repoData.stars,
      repo_language: repoData.languages[0] || null,
      repo_languages: repoData.languages,
      repo_default_branch: 'main',
      repo_updated_at: new Date().toISOString(),
      index_status: 'indexing',
      is_popular: repoData.stars > 1000,
    }

    try {
      await indexRepository(indexedRepo)
      console.log(`✅ Indexed repository metadata via ${getActiveEngineName()}`)
    } catch (esError: any) {
      console.error(`❌ Failed to index repository metadata:`, esError.message)
      throw new Error(`Search engine error: ${esError.message}`)
    }

    await updateRepositoryStatus(repoId, 'indexing', 40, 'Building search index...')
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 8: Index files
    console.log(`📊 Step 8: Starting file indexing process...`)
    const flatFiles: { path: string }[] = []
    flattenFiles(repoData.files, flatFiles)

    let indexedFilesCount = 0
    let failedFilesCount = 0
    const parsed = parseGitHubUrl(repoUrl)
    const owner = parsed?.owner || repoUrl.split('/')[3]
    const repo = parsed?.repo || repoData.name

    try {
      await indexFilesRecursively(repoId, repoData.files, owner, repo, async (filePath, content, fileType, language) => {
        try {
          const fileData = {
            id: `${repoId}_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
            repo_id: repoId,
            file_path: filePath,
            file_content: content,
            file_size: content.length,
            file_language: language,
            file_type: fileType,
          }

          await indexFile(fileData)
          indexedFilesCount++

          if (indexedFilesCount % 5 === 0 || indexedFilesCount === totalFiles) {
            const progress = Math.min(40 + Math.floor((indexedFilesCount / totalFiles) * 50), 90)
            await updateRepositoryStatus(
              repoId,
              'indexing',
              progress,
              `Indexing files... ${indexedFilesCount}/${totalFiles}`,
              undefined,
              totalFiles,
              indexedFilesCount
            )
          }
        } catch (fileError: any) {
          failedFilesCount++
          console.error(`❌ Error indexing file ${filePath}:`, fileError.message)
        }
      })

      console.log(`📊 File indexing completed: ${indexedFilesCount} successful, ${failedFilesCount} failed`)
    } catch (indexingError: any) {
      console.error(`❌ Critical error during file indexing:`, indexingError.message)
      throw new Error(`File indexing failed: ${indexingError.message}`)
    }

    await updateRepositoryStatus(repoId, 'indexing', 85, 'Fetched file contents from GitHub')

    // Step 10: Generate insights (NON-FATAL — indexing completes even if Gemini is down)
    await updateRepositoryStatus(repoId, 'indexing', 92, 'Generating repository insights...')

    try {
      const fileList = flatFiles.map(f => ({ path: f.path, type: 'file' }))

      const readmeFiles = flatFiles.filter(f =>
        /^readme(\.md|\.rst|\.txt)?$/i.test(f.path.split('/').pop() || '')
      )

      if (readmeFiles.length > 0) {
        try {
          const readmeContent = await fetchRawFileContent(owner, repo, readmeFiles[0].path)
          if (readmeContent && readmeContent.content) {
            const insights = await generateInsightsFromReadme(repoData.name, readmeContent.content, fileList)
            await updateRepositoryInsights(repoId, {
              repo_summary: insights.summary,
              quickstart: insights.quickstart,
              contribution_guide: insights.contributionGuide,
            })
            console.log('✅ Generated insights from README')
          } else {
            console.warn('⚠️ Could not fetch README content — skipping insights')
          }
        } catch (readmeError: any) {
          console.warn('⚠️ README-based insights failed (non-fatal):', readmeError.message)
          try {
            const structureSummary = await analyzeRepositoryStructure(repoData.name, fileList)
            await updateRepositoryInsights(repoId, { repo_summary: structureSummary || null })
          } catch (structErr: any) {
            console.warn('⚠️ Structure analysis also failed (non-fatal):', structErr.message)
          }
        }
      } else {
        try {
          const structureSummary = await analyzeRepositoryStructure(repoData.name, fileList)
          await updateRepositoryInsights(repoId, { repo_summary: structureSummary || null })
        } catch (structErr: any) {
          console.warn('⚠️ Structure analysis failed (non-fatal):', structErr.message)
        }
      }
    } catch (insightsError: any) {
      console.warn('⚠️ Failed to generate insights (non-fatal, indexing continues):', insightsError.message)
    }

    // Step 11: Verify
    if (indexedFilesCount === 0) {
      throw new Error('No files were successfully indexed')
    }

    try {
      const testSearch = await searchFilesInRepository(repoId, 'test')
      console.log(`✅ Search smoke test: ${testSearch.length} results (via ${getActiveEngineName()})`)
    } catch (searchError: any) {
      console.warn('⚠️ Search smoke test failed (non-fatal):', searchError.message)
    }

    // Step 12: Mark as completed
    await updateRepositoryStatus(
      repoId,
      'completed',
      100,
      'Repository ready!',
      undefined,
      totalFiles,
      indexedFilesCount
    )
    console.log(`🎉 Successfully indexed repository: ${repoId} (engine: ${getActiveEngineName()})`)

  } catch (error: any) {
    console.error(`❌ Error indexing repository ${repoId}:`, error)
    try {
      await updateRepositoryStatus(repoId, 'failed', 0, 'Indexing failed', error.message || 'Unknown error')
    } catch (updateError: any) {
      console.error('❌ Failed to update repository status:', updateError.message)
    }
  }
}

// Helper: count files recursively
function countFilesRecursively(files: any[]): number {
  let count = 0
  for (const file of files) {
    if (file.type === 'file') count++
    else if (file.children) count += countFilesRecursively(file.children)
  }
  return count
}

// Helper: index files recursively (fetches ALL file content from GitHub)
async function indexFilesRecursively(
  repoId: string,
  files: any[],
  owner: string,
  repo: string,
  indexCallback: (filePath: string, content: string, fileType: string, language: string) => Promise<void>
) {
  for (const file of files) {
    if (file.type === 'file') {
      try {
        const language = getLanguageFromPath(file.path)
        let content = ''

        try {
          const fetched = await githubConcurrencyLimit(() => fetchRawFileContent(owner, repo, file.path))
          if (fetched && fetched.content) {
            content = fetched.content
          } else {
            content = `// File: ${file.path}\n// Content unavailable (file may be too large or binary)`
          }
        } catch (fetchError) {
          console.log(`⚠️ Could not fetch ${file.path}:`, (fetchError as any)?.message)
          content = `// File: ${file.path}\n// Content unavailable`
        }

        await indexCallback(file.path, content, 'file', language || 'unknown')
      } catch (error) {
        console.error(`Error processing file ${file.path}:`, error)
      }
    } else if (file.children) {
      await indexFilesRecursively(repoId, file.children, owner, repo, indexCallback)
    }
  }
}

// Flatten files helper
function flattenFiles(files: any[], out: { path: string }[]) {
  for (const f of files) {
    if (f.type === 'file') out.push({ path: f.path })
    if (f.children) flattenFiles(f.children, out)
  }
}

// Helper: determine programming language from file extension
function getLanguageFromPath(filePath: string): string | null {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const languageMap: { [key: string]: string } = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp',
    php: 'php', rb: 'ruby', go: 'go', rs: 'rust', swift: 'swift',
    kt: 'kotlin', scala: 'scala', html: 'html', css: 'css',
    scss: 'scss', sass: 'sass', json: 'json', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', md: 'markdown', txt: 'text',
  }
  return languageMap[extension || ''] || null
}
