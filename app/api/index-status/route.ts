import { getIndexingProgress, getRepositoryByUrl } from '@/lib/database'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { repoId, repoUrl } = await request.json()

    if (!repoId) {
      return Response.json(
        { error: 'Repository ID is required' },
        { status: 400 }
      )
    }

    const progress = await getIndexingProgress(repoId)

    if (!progress) {
      return Response.json({
        found: false,
        message: 'No indexing progress found for this repository'
      })
    }

    const isStalled = progress.status === 'indexing'
      && progress.progress <= 10
      && progress.started_at
      && (Date.now() - new Date(progress.started_at).getTime() > 30000)

    return Response.json({
      found: true,
      status: progress.status,
      progress: progress.progress,
      currentStep: progress.current_step,
      totalFiles: progress.total_files,
      indexedFiles: progress.indexed_files,
      errorMessage: progress.error_message,
      startedAt: progress.started_at,
      completedAt: progress.completed_at,
      stalled: isStalled,
      repoId
    })

  } catch (error: any) {
    console.error('❌ Error in index-status API:', error)
    return Response.json(
      { error: 'Failed to get indexing status' },
      { status: 500 }
    )
  }
}
