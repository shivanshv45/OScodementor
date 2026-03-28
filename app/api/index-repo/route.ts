// Index a repository with progress tracking
import { fetchCompleteRepositoryData, parseGitHubUrl } from '@/lib/github'
import {
  createRepository,
  updateRepositoryStatus,
  getIndexingProgress,
  IndexedRepository
} from '@/lib/database'
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

    // Note: Elasticsearch initialization is handled by the background-index worker.
    // This endpoint just creates the DB record and triggers the worker.

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
    } catch { }

    // Create repository record (upserts on duplicate repo_url)
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

    // Trigger background indexing reliably using internal import
    // instead of an unreliable self-fetch to NEXT_PUBLIC_BASE_URL
    console.log(`🚀 Starting background indexing for repo: ${repository.id}`)

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    const backgroundIndexUrl = `${baseUrl}/api/background-index`
    console.log(`🔍 Background index URL: ${backgroundIndexUrl}`)

    // Fire-and-forget but with better error handling
    fetch(backgroundIndexUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repository.id,
        repoUrl
      })
    }).then(async response => {
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
        // Mark as failed so the user sees the error instead of stuck at pending
        try {
          await updateRepositoryStatus(repository.id, 'failed', 0, 'Background indexing failed to start', errorText)
        } catch { }
      }
    }).catch(async error => {
      console.error(`⚠️ Error triggering background indexing for ${repository.id}:`, {
        message: error.message,
        name: error.name,
        url: backgroundIndexUrl
      })
      // Mark as failed so the user sees the error
      try {
        await updateRepositoryStatus(repository.id, 'failed', 0, 'Could not reach background indexing service', error.message)
      } catch { }
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
