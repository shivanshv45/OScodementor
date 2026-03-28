import { fetchCompleteRepositoryData, parseGitHubUrl } from '@/lib/github'
import {
  createRepository,
  updateRepositoryStatus,
  getIndexingProgress,
  IndexedRepository
} from '@/lib/database'
import { ApiError } from '@/lib/types'
import {
  initializeSearchEngine,
  indexRepository,
  indexFile,
  searchFilesInRepository,
  getActiveEngineName,
} from '@/lib/search-adapter'
import { fetchRawFileContent, githubConcurrencyLimit } from '@/lib/github'
import { updateRepositoryInsights } from '@/lib/database'
import { generateInsightsFromReadme, analyzeRepositoryStructure } from '@/lib/gemini'

export const maxDuration = 60

export async function POST(request: Request) {
  console.log('🔍 API Route: index-repo called')

  let repoId: string | null = null

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
    repoId = repository.id
    console.log(`✅ Created repository record: ${repository.id}`)

    await updateRepositoryStatus(repoId, 'indexing', 5, 'Starting indexing process...')

    indexRepositoryInline(repoId, repoUrl).catch(async (error) => {
      console.error(`❌ Inline indexing failed for ${repoId}:`, error)
      try {
        await updateRepositoryStatus(repoId!, 'failed', 0, 'Indexing failed', error.message || 'Unknown error')
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
    if (repoId) {
      try {
        await updateRepositoryStatus(repoId, 'failed', 0, 'Indexing failed to start', error.message)
      } catch { }
    }
    return Response.json(
      { error: 'Failed to start indexing process' },
      { status: 500 }
    )
  }
}

async function indexRepositoryInline(repoId: string, repoUrl: string) {
  console.log(`🔄 Starting inline indexing for: ${repoId}`)

  try {
    await updateRepositoryStatus(repoId, 'indexing', 7, 'Initializing search engine...')
    await initializeSearchEngine()
    console.log(`✅ Search engine initialized: ${getActiveEngineName()}`)
  } catch (err: any) {
    throw new Error(`Search engine initialization failed: ${err.message}`)
  }

  await updateRepositoryStatus(repoId, 'indexing', 10, 'Fetching repository data from GitHub...')

  let repoData: any
  try {
    repoData = await Promise.race([
      fetchCompleteRepositoryData(repoUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GitHub timeout')), 25000))
    ]) as any
    console.log(`✅ Fetched repository data: ${repoData.name}`)
  } catch (err: any) {
    throw new Error(`GitHub API error: ${err.message}`)
  }

  await updateRepositoryStatus(repoId, 'indexing', 20, 'Analyzing repository structure...')

  const totalFiles = countFiles(repoData.files)
  console.log(`📊 Total files to index: ${totalFiles}`)

  await updateRepositoryStatus(repoId, 'indexing', 25, `Found ${totalFiles} files...`, undefined, totalFiles, 0)

  const parsed = parseGitHubUrl(repoUrl)
  const owner = parsed?.owner || repoUrl.split('/')[3]
  const repo = parsed?.repo || repoData.name

  try {
    await indexRepository({
      id: repoId,
      repo_url: repoUrl,
      repo_name: repoData.name,
      repo_owner: owner,
      repo_description: repoData.description,
      repo_stars: repoData.stars,
      repo_language: repoData.languages[0] || null,
      repo_languages: repoData.languages,
      repo_default_branch: 'main',
      repo_updated_at: new Date().toISOString(),
      index_status: 'indexing',
      is_popular: repoData.stars > 1000,
    })
    console.log(`✅ Indexed repository metadata via ${getActiveEngineName()}`)
  } catch (err: any) {
    throw new Error(`Search engine error: ${err.message}`)
  }

  await updateRepositoryStatus(repoId, 'indexing', 35, 'Building search index...')

  let indexedCount = 0
  let failedCount = 0
  const flatFiles: { path: string }[] = []
  flattenFiles(repoData.files, flatFiles)

  await indexFilesRecursive(repoId, repoData.files, owner, repo, async (filePath, content, fileType, language) => {
    try {
      await indexFile({
        id: `${repoId}_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
        repo_id: repoId,
        file_path: filePath,
        file_content: content,
        file_size: content.length,
        file_language: language,
        file_type: fileType,
      })
      indexedCount++

      if (indexedCount % 3 === 0 || indexedCount === totalFiles) {
        const progress = Math.min(35 + Math.floor((indexedCount / totalFiles) * 50), 88)
        await updateRepositoryStatus(repoId, 'indexing', progress, `Indexing files... ${indexedCount}/${totalFiles}`, undefined, totalFiles, indexedCount)
      }
    } catch (err: any) {
      failedCount++
      console.error(`❌ Error indexing ${filePath}:`, err.message)
    }
  })

  console.log(`📊 File indexing: ${indexedCount} ok, ${failedCount} failed`)

  await updateRepositoryStatus(repoId, 'indexing', 90, 'Generating insights...')

  try {
    const readmeFiles = flatFiles.filter(f =>
      /^readme(\.md|\.rst|\.txt)?$/i.test(f.path.split('/').pop() || '')
    )
    const fileList = flatFiles.map(f => ({ path: f.path, type: 'file' }))

    if (readmeFiles.length > 0) {
      try {
        const readmeContent = await fetchRawFileContent(owner, repo, readmeFiles[0].path)
        if (readmeContent?.content) {
          const insights = await generateInsightsFromReadme(repoData.name, readmeContent.content, fileList)
          await updateRepositoryInsights(repoId, {
            repo_summary: insights.summary,
            quickstart: insights.quickstart,
            contribution_guide: insights.contributionGuide,
          })
        } else {
          throw new Error('No README content')
        }
      } catch {
        const summary = await analyzeRepositoryStructure(repoData.name, fileList)
        await updateRepositoryInsights(repoId, { repo_summary: summary || null })
      }
    } else {
      const summary = await analyzeRepositoryStructure(repoData.name, fileList)
      await updateRepositoryInsights(repoId, { repo_summary: summary || null })
    }
  } catch (err: any) {
    console.warn('⚠️ Insights generation failed:', err.message)
  }

  if (indexedCount === 0) {
    throw new Error('No files were successfully indexed')
  }

  try {
    const testSearch = await searchFilesInRepository(repoId, 'test')
    console.log(`✅ Search test: ${testSearch.length} results (${getActiveEngineName()})`)
  } catch { }

  await updateRepositoryStatus(repoId, 'completed', 100, 'Repository ready!', undefined, totalFiles, indexedCount)
  console.log(`🎉 Indexing complete: ${repoId} (${getActiveEngineName()})`)
}

function countFiles(files: any[]): number {
  let count = 0
  for (const f of files) {
    if (f.type === 'file') count++
    else if (f.children) count += countFiles(f.children)
  }
  return count
}

function flattenFiles(files: any[], out: { path: string }[]) {
  for (const f of files) {
    if (f.type === 'file') out.push({ path: f.path })
    if (f.children) flattenFiles(f.children, out)
  }
}

function getLanguageFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: { [k: string]: string } = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp',
    php: 'php', rb: 'ruby', go: 'go', rs: 'rust', swift: 'swift',
    kt: 'kotlin', scala: 'scala', html: 'html', css: 'css',
    scss: 'scss', sass: 'sass', json: 'json', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', md: 'markdown', txt: 'text',
  }
  return map[ext || ''] || null
}

async function indexFilesRecursive(
  repoId: string, files: any[], owner: string, repo: string,
  cb: (path: string, content: string, type: string, lang: string) => Promise<void>
) {
  for (const file of files) {
    if (file.type === 'file') {
      try {
        const lang = getLanguageFromPath(file.path)
        let content = ''
        try {
          const fetched = await githubConcurrencyLimit(() => fetchRawFileContent(owner, repo, file.path))
          content = fetched?.content || `// File: ${file.path}\n// Content unavailable`
        } catch {
          content = `// File: ${file.path}\n// Content unavailable`
        }
        await cb(file.path, content, 'file', lang || 'unknown')
      } catch (err) {
        console.error(`Error processing ${file.path}:`, err)
      }
    } else if (file.children) {
      await indexFilesRecursive(repoId, file.children, owner, repo, cb)
    }
  }
}
