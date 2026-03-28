import { fetchCompleteRepositoryData } from '@/lib/github'
import {
  createRepository,
  updateRepositoryStatus,
  IndexedRepository
} from '@/lib/database'

export const maxDuration = 30

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

    const urlParts = repoUrl.replace('https://github.com/', '').split('/')
    const repoOwner = urlParts[0]
    const repoName = urlParts[1]

    let initialStars = 0
    let initialDesc = null
    try {
      const quickInfo = await fetchCompleteRepositoryData(repoUrl)
      initialStars = quickInfo.stars || 0
      initialDesc = quickInfo.description || null
    } catch { }

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

    await updateRepositoryStatus(repository.id, 'indexing', 5, 'Waiting to start indexing...')

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
