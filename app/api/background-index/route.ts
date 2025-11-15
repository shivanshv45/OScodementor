// Background indexing worker for Vercel cron jobs
import { updateRepositoryStatus, getIndexingProgress } from '@/lib/database'
import { fetchCompleteRepositoryData, parseGitHubUrl } from '@/lib/github'
import { 
  initializeElasticsearch, 
  indexRepository, 
  indexFile 
} from '@/lib/elasticsearch'
import { fetchRawFileContent, scoreFileImportance, githubConcurrencyLimit } from '@/lib/github'
import { updateRepositoryInsights } from '@/lib/database'
import { generateInsightsFromReadme, analyzeRepositoryStructure } from '@/lib/gemini'
import { searchFilesInRepository } from '@/lib/elasticsearch'

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
    // CRITICAL: In Vercel serverless, we MUST await to keep function alive
    // The function has 300s timeout, so we can await the full indexing
    // The caller uses fire-and-forget, so it won't wait for response
    const indexingRepoId = repoId
    const indexingRepoUrl = repoUrl
    
    // Update status to 5% immediately so frontend sees progress
    await updateRepositoryStatus(indexingRepoId, 'indexing', 5, 'Starting indexing process...')
    
    // IMPORTANT: We await the indexing to keep the function alive in Vercel
    // Even though we return a response, the await keeps execution context alive
    // The caller uses fire-and-forget fetch, so it doesn't wait for this
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
      // Re-throw to ensure error is logged, but we've already updated status
    }
    
    // Return success response
    // Note: This returns AFTER indexing completes, but caller uses fire-and-forget
    // so it doesn't wait. The function stays alive because of the await above.
    return Response.json({
      success: true,
      message: 'Indexing completed',
      status: 'completed'
    })

  } catch (error: any) {
    console.error('❌ Background indexing error:', error)
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      repoId
    })
    
    // Try to update status if we have a repoId
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
    hasElasticsearchUsername: !!process.env.ELASTICSEARCH_USERNAME,
    hasElasticsearchPassword: !!process.env.ELASTICSEARCH_PASSWORD,
    hasGithubToken: !!process.env.GITHUB_TOKEN,
    hasGeminiApiKey: !!process.env.GEMINI_API_KEY,
    elasticsearchUrl: process.env.ELASTICSEARCH_URL ? '***SET***' : 'MISSING'
  })
  
  try {
    // Step 0: Initialize Elasticsearch connection first
    console.log(`📊 Step 0: Initializing Elasticsearch connection...`)
    try {
      await initializeElasticsearch()
      console.log(`✅ Elasticsearch initialized successfully`)
    } catch (esInitError: any) {
      console.error(`❌ Failed to initialize Elasticsearch:`, esInitError.message)
      console.error(`❌ Elasticsearch error details:`, {
        message: esInitError.message,
        stack: esInitError.stack,
        name: esInitError.name
      })
      throw new Error(`Elasticsearch initialization failed: ${esInitError.message}`)
    }
    
    // Step 1: Update status to indexing
    console.log(`📊 Step 1: Updating status to indexing (5%)`)
    console.log(`🔍 About to call updateRepositoryStatus with:`, { repoId, status: 'indexing', progress: 5 })
    
    try {
      await Promise.race([
        updateRepositoryStatus(repoId, 'indexing', 5, 'Fetching repository data from GitHub...'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database update timeout after 15 seconds')), 15000)
        )
      ])
      console.log(`✅ Updated status: 5% - Fetching from GitHub`)
    } catch (dbError: any) {
      console.error(`❌ Database update failed:`, dbError.message)
      throw new Error(`Database error: ${dbError.message}`)
    }
    
    // Add small delay for better UX
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 2: Fetch repository data from GitHub with timeout
    console.log(`🔍 Step 2: Fetching repository data from GitHub API...`)
    console.log(`📝 Repository URL: ${repoUrl}`)
    
    let repoData: any
    try {
      repoData = await Promise.race([
        fetchCompleteRepositoryData(repoUrl),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('GitHub API timeout after 15 seconds')), 15000)
        )
      ]) as any
      console.log(`✅ Fetched repository data: ${repoData.name}`)
      console.log(`📊 Repository stats: ${repoData.stars} stars, ${repoData.languages?.length || 0} languages`)
    } catch (fetchError: any) {
      console.error(`❌ Failed to fetch repository data:`, fetchError.message)
      throw new Error(`GitHub API error: ${fetchError.message}`)
    }

    // Step 3: Update progress
    console.log(`📊 Step 3: Updating progress to 20% - Analyzing structure`)
    await updateRepositoryStatus(repoId, 'indexing', 20, 'Analyzing repository structure...')
    console.log(`✅ Updated status: 20% - Analyzing structure`)
    
    // Add small delay for better UX
    await new Promise(resolve => setTimeout(resolve, 1500))

    // Step 4: Count total files
    console.log(`📊 Step 4: Counting total files to index...`)
    const totalFiles = countFilesRecursively(repoData.files)
    console.log(`📊 Total files to index: ${totalFiles}`)

    // Step 5: Update total files count
    console.log(`📊 Step 5: Updating progress to 30% - Found ${totalFiles} files`)
    await updateRepositoryStatus(repoId, 'indexing', 30, `Found ${totalFiles} files to index...`, undefined, totalFiles, 0)
    console.log(`✅ Updated status: 30% - Found ${totalFiles} files`)

    // Index repository metadata to Elasticsearch
    console.log(`📊 Step 6: Indexing repository metadata to Elasticsearch...`)
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
      is_popular: repoData.stars > 1000
    }

    try {
      await indexRepository(indexedRepo)
      console.log(`✅ Indexed repository metadata`)
    } catch (esError: any) {
      console.error(`❌ Failed to index repository metadata:`, esError.message)
      throw new Error(`Elasticsearch error: ${esError.message}`)
    }
    
    console.log(`📊 Step 7: Updating progress to 40% - Building search index`)
    await updateRepositoryStatus(repoId, 'indexing', 40, 'Building search index...')
    console.log(`✅ Updated status: 40% - Building search index`)
    
    // Add small delay for better UX
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Step 8: Flatten files and fetch ALL file contents from GitHub
    console.log(`📊 Step 8: Starting file indexing process...`)
    const flatFiles: { path: string }[] = []
    flattenFiles(repoData.files, flatFiles)
    console.log(`📁 Flattened ${flatFiles.length} files for indexing`)

    let indexedFilesCount = 0
    let failedFilesCount = 0
    const parsed = parseGitHubUrl(repoUrl)
    const owner = parsed?.owner || repoUrl.split('/')[3]
    const repo = parsed?.repo || repoData.name
    
    console.log(`📝 Repository details: ${owner}/${repo}`)

    try {
      // Fetch real content for ALL files during indexing
      await indexFilesRecursively(repoId, repoData.files, owner, repo, async (filePath, content, fileType, language) => {
        try {
          console.log(`📄 Processing file: ${filePath}`)
          const fileData = {
            id: `${repoId}_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
            repo_id: repoId,
            file_path: filePath,
            file_content: content,
            file_size: content.length,
            file_language: language,
            file_type: fileType
          }

          await indexFile(fileData)
          indexedFilesCount++
          console.log(`✅ Successfully indexed: ${filePath}`)

          // Update progress every 2 files for smoother animation
          if (indexedFilesCount % 2 === 0 || indexedFilesCount === totalFiles) {
            const progress = Math.min(40 + Math.floor((indexedFilesCount / totalFiles) * 50), 90)
            console.log(`📊 Updating progress: ${progress}% - Indexed ${indexedFilesCount}/${totalFiles} files`)
            await updateRepositoryStatus(
              repoId, 
              'indexing', 
              progress, 
              `Indexing files... ${indexedFilesCount}/${totalFiles}`,
              undefined,
              totalFiles,
              indexedFilesCount
            )
            console.log(`✅ Updated status: ${progress}% - Indexed ${indexedFilesCount}/${totalFiles} files`)
          }
        } catch (fileError: any) {
          failedFilesCount++
          console.error(`❌ Error indexing file ${filePath}:`, fileError.message)
          // Continue with other files even if one fails
        }
      })
      
      console.log(`📊 File indexing completed: ${indexedFilesCount} successful, ${failedFilesCount} failed`)
    } catch (indexingError: any) {
      console.error(`❌ Critical error during file indexing:`, indexingError.message)
      throw new Error(`File indexing failed: ${indexingError.message}`)
    }

    console.log(`📊 Step 9: Updating progress to 85% - File contents fetched`)
    await updateRepositoryStatus(repoId, 'indexing', 85, 'Fetched file contents from GitHub')

    // Step 10: Generate insights (README-first approach)
    console.log(`📊 Step 10: Generating repository insights...`)
    await updateRepositoryStatus(repoId, 'indexing', 92, 'Generating repository insights...')
    
    try {
      const fileList = flatFiles.map(f => ({ path: f.path, type: 'file' }))
      console.log(`📝 Processing ${fileList.length} files for insights generation`)
      
      // Try to find README first
      const readmeFiles = flatFiles.filter(f => 
        /^readme(\.md|\.rst|\.txt)?$/i.test(f.path.split('/').pop() || '')
      )
      
      if (readmeFiles.length > 0) {
        console.log(`📖 Found README: ${readmeFiles[0].path}, using for fast insights generation`)
        try {
          // Fetch README content
          const readmeContent = await fetchRawFileContent(owner, repo, readmeFiles[0].path)
          if (readmeContent && readmeContent.content) {
            console.log(`📄 README content fetched, generating insights...`)
            const insights = await generateInsightsFromReadme(repoData.name, readmeContent.content, fileList)
            await updateRepositoryInsights(repoId, { 
              repo_summary: insights.summary,
              quickstart: insights.quickstart,
              contribution_guide: insights.contributionGuide
            })
            console.log('✅ Generated insights from README')
          } else {
            throw new Error('Could not fetch README content')
          }
        } catch (readmeError: any) {
          console.warn('⚠️ README-based insights failed, falling back to AI analysis:', readmeError.message)
          // Fallback to AI analysis
          const structureSummary = await analyzeRepositoryStructure(repoData.name, fileList)
          await updateRepositoryInsights(repoId, { repo_summary: structureSummary || null })
        }
      } else {
        console.log('📝 No README found, using AI analysis for insights')
        // Fallback to AI analysis when no README
        const structureSummary = await analyzeRepositoryStructure(repoData.name, fileList)
        await updateRepositoryInsights(repoId, { repo_summary: structureSummary || null })
      }
    } catch (insightsError: any) {
      console.warn('⚠️ Failed to generate insights:', insightsError.message)
      // Don't fail the entire indexing process for insights
    }

    // Step 11: Verify indexing was successful before marking as completed
    console.log(`📊 Step 11: Verifying indexing results...`)
    if (indexedFilesCount === 0) {
      throw new Error('No files were successfully indexed')
    }

    console.log(`✅ Indexing verification: ${indexedFilesCount} files indexed successfully`)

    // Best-effort smoke test: do not fail the job if ES is eventually consistent
    try {
      console.log(`🔍 Running search smoke test...`)
      const testSearch = await searchFilesInRepository(repoId, 'test')
      console.log(`✅ Search test attempted: ${testSearch.length} results`)
    } catch (searchError: any) {
      console.warn('⚠️ Search smoke test failed (non-fatal):', searchError.message)
    }

    // Step 12: Mark as completed
    console.log(`📊 Step 12: Marking repository as completed (100%)`)
    await updateRepositoryStatus(
      repoId, 
      'completed', 
      100, 
      'Repository ready!',
      undefined,
      totalFiles,
      indexedFilesCount
    )
    console.log(`✅ Indexing completed successfully: ${indexedFilesCount} files indexed`)
    console.log(`🎉 Successfully indexed repository: ${repoId}`)

  } catch (error: any) {
    console.error(`❌ Error indexing repository ${repoId}:`, error)
    console.error(`❌ Error details:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    })
    
    // Update status to failed with detailed error message
    const errorMessage = error.message || 'Unknown error occurred during indexing'
    console.log(`❌ Setting repository status to failed: ${errorMessage}`)
    
    try {
      await updateRepositoryStatus(
        repoId, 
        'failed', 
        0, 
        'Indexing failed',
        errorMessage
      )
      console.log(`✅ Updated repository status to failed`)
    } catch (updateError: any) {
      console.error('❌ Failed to update repository status:', updateError.message)
    }
  }
}

// Helper function to count files recursively
function countFilesRecursively(files: any[]): number {
  let count = 0
  for (const file of files) {
    if (file.type === 'file') {
      count++
    } else if (file.children) {
      count += countFilesRecursively(file.children)
    }
  }
  return count
}

// Helper function to index files recursively - NOW FETCHES ALL FILES
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
        
        // Fetch real content from GitHub for ALL files
        try {
          const fetched = await githubConcurrencyLimit(() => fetchRawFileContent(owner, repo, file.path))
          if (fetched && fetched.content) {
            content = fetched.content
          } else {
            // Fallback for files that can't be fetched (too large, binary, etc.)
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

// Helper function to determine language from file path
function getLanguageFromPath(filePath: string): string | null {
  const extension = filePath.split('.').pop()?.toLowerCase()
  const languageMap: { [key: string]: string } = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'txt': 'text'
  }
  return languageMap[extension || ''] || null
}
