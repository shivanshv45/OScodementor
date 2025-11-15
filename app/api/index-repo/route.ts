// Index a repository with progress tracking
import { fetchCompleteRepositoryData, parseGitHubUrl } from '@/lib/github'
import { 
  createRepository, 
  updateRepositoryStatus, 
  getIndexingProgress,
  IndexedRepository 
} from '@/lib/database'
import { 
  initializeElasticsearch, 
  indexRepository, 
  indexFile 
} from '@/lib/elasticsearch'
import { fetchRawFileContent, scoreFileImportance, githubConcurrencyLimit } from '@/lib/github'
import { updateRepositoryInsights } from '@/lib/database'
import { generateInsightsFromReadme, analyzeRepositoryStructure } from '@/lib/gemini'
import { searchFilesInRepository } from '@/lib/elasticsearch'
import { ApiError } from '@/lib/types'

export async function POST(request: Request) {
  console.log('🔍 API Route: index-repo called')
  
  try {
    const { repoUrl } = await request.json()
    
    if (!repoUrl) {
      return Response.json(
        { error: 'Repository URL is required' },
        { status: 400 }
      )
    }

    // Initialize Elasticsearch if needed
    await initializeElasticsearch()

    // Extract repo info from URL
    const urlParts = repoUrl.replace('https://github.com/', '').split('/')
    const repoOwner = urlParts[0]
    const repoName = urlParts[1]

    // Fetch basic repo info to get stars before indexing
    let initialStars = 0
    let initialDesc = null
    try {
      const quickInfo = await fetchCompleteRepositoryData(repoUrl)
      initialStars = quickInfo.stars || 0
      initialDesc = quickInfo.description || null
    } catch {}

    // Create repository record
    const repoData: Omit<IndexedRepository, 'id' | 'indexed_at' | 'last_accessed_at' | 'access_count'> = {
      repo_url: repoUrl,
      repo_name: repoName,
      repo_owner: repoOwner,
      repo_description: initialDesc,
      repo_stars: initialStars,
      repo_language: null,
      repo_languages: [],
      repo_default_branch: 'main',
      repo_updated_at: new Date().toISOString(),
      index_status: 'pending',
      index_progress: 0,
      total_files: 0,
      indexed_files: 0,
      error_message: null,
      cache_ttl_hours: 24,
      is_popular: initialStars > 1000
    }

    const repository = await createRepository(repoData)
    console.log(`✅ Created repository record: ${repository.id}`)

    // Start indexing process (non-blocking)
    console.log(`🚀 Starting background indexing for repo: ${repository.id}`)
    console.log(`🔍 Repository details:`, { repoId: repository.id, repoUrl })
    
    // Get the base URL for the fetch call
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const backgroundIndexUrl = `${baseUrl}/api/background-index`
    console.log(`🔍 Background index URL: ${backgroundIndexUrl}`)
    
    // Trigger background indexing via separate API call
    // This ensures the indexing runs in a separate function context
    // Note: We use a longer timeout (60s) just to catch if the endpoint is completely broken
    // The actual indexing will continue in the background and can take up to 300s
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 second timeout (just to catch broken endpoints)
    
    fetch(backgroundIndexUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        repoId: repository.id, 
        repoUrl 
      }),
      signal: controller.signal
    }).then(async response => {
      clearTimeout(timeoutId)
      if (response.ok) {
        const result = await response.json().catch(() => ({}))
        console.log(`✅ Background indexing triggered for ${repository.id}:`, result)
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        console.error(`❌ Failed to trigger background indexing for ${repository.id}:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        })
        await updateRepositoryStatus(
          repository.id, 
          'failed', 
          0, 
          'Failed to start indexing', 
          `Background indexing trigger failed: ${response.status} ${response.statusText}`
        ).catch(updateError => {
          console.error('❌ Failed to update status to failed:', updateError)
        })
      }
    }).catch(error => {
      clearTimeout(timeoutId)
      // Only report as error if it's not a timeout (timeout means endpoint is broken, not indexing)
      const isTimeout = error.name === 'AbortError' || error.message.includes('aborted')
      
      if (isTimeout) {
        // If endpoint doesn't respond in 60s, it's likely broken
        console.error(`❌ Background indexing endpoint did not respond within 60 seconds for ${repository.id}`)
        updateRepositoryStatus(
          repository.id, 
          'failed', 
          0, 
          'Failed to start indexing', 
          'Background indexing endpoint did not respond. Please check server logs.'
        ).catch(updateError => {
          console.error('❌ Failed to update status to failed:', updateError)
        })
      } else {
        // Network errors should be reported
        console.error(`❌ Network error triggering background indexing for ${repository.id}:`, {
          message: error.message,
          name: error.name,
          stack: error.stack,
          url: backgroundIndexUrl
        })
        updateRepositoryStatus(
          repository.id, 
          'failed', 
          0, 
          'Failed to start indexing', 
          `Network error: ${error.message}`
        ).catch(updateError => {
          console.error('❌ Failed to update status to failed:', updateError)
        })
      }
    })

    return Response.json({
      success: true,
      repoId: repository.id,
      message: 'Indexing started',
      status: 'pending'
    })

  } catch (error: any) {
    console.error('❌ Error in index-repo API:', error)
    return Response.json(
      { error: 'Failed to start indexing process' },
      { status: 500 }
    )
  }
}

