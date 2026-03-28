// API route for fetching file content from GitHub
import { Octokit } from '@octokit/rest'
import { ApiError } from '@/lib/types'
import { indexFile } from '@/lib/search-adapter'
import { parseGitHubUrl } from '@/lib/github'
import { getRepositoryByUrl } from '@/lib/database'

// Initialize Octokit with authentication
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  baseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
})

export async function POST(request: Request) {
  console.log('🔍 API Route: fetch-file-content called')

  try {
    const { repoUrl, filePath, branch } = await request.json()

    // Validate input
    if (!repoUrl || !filePath) {
      return Response.json(
        { error: 'Repository URL and file path are required' },
        { status: 400 }
      )
    }

    // Check if GitHub token is configured
    if (!process.env.GITHUB_TOKEN) {
      console.error('❌ GITHUB_TOKEN environment variable is not set')
      return Response.json(
        { error: 'GitHub API token not configured' },
        { status: 500 }
      )
    }

    // Parse repository URL to get owner and repo
    const parsed = parseGitHubUrl(repoUrl)
    if (!parsed) {
      return Response.json(
        { error: 'Invalid GitHub repository URL' },
        { status: 400 }
      )
    }

    console.log('✅ Parsed repository:', parsed.owner, parsed.repo)
    console.log('📁 Fetching file:', filePath)

    // Determine default branch if not provided
    let refBranch = branch
    if (!refBranch) {
      try {
        const repoMeta = await octokit.rest.repos.get({ owner: parsed.owner, repo: parsed.repo })
        refBranch = repoMeta.data.default_branch || 'main'
      } catch (e) {
        refBranch = 'main'
      }
    }

    // Fetch file content from GitHub
    const response = await octokit.rest.repos.getContent({
      owner: parsed.owner,
      repo: parsed.repo,
      path: filePath,
      ref: refBranch
    })

    // Check if it's a file (not a directory)
    if (Array.isArray(response.data)) {
      return Response.json(
        { error: 'Path is a directory, not a file' },
        { status: 400 }
      )
    }

    // Decode the content
    let content = ''
    if (response.data.type === 'file') {
      if (response.data.encoding === 'base64') {
        content = Buffer.from(response.data.content, 'base64').toString('utf-8')
      } else {
        content = response.data.content || ''
      }
    } else {
      return Response.json(
        { error: 'Path is not a file' },
        { status: 400 }
      )
    }

    console.log('✅ File content fetched successfully, length:', content.length)

    // Best-effort: cache into Elasticsearch for future queries
    try {
      const repoData = await getRepositoryByUrl(repoUrl)
      if (repoData && content && content.length > 0) {
        const getLanguageFromPath = (p: string): string | null => {
          const ext = p.split('.').pop()?.toLowerCase()
          const map: { [k: string]: string } = {
            js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
            py: 'python', java: 'java', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
            kt: 'kotlin', swift: 'swift', cpp: 'cpp', c: 'c', cs: 'csharp', md: 'markdown',
            html: 'html', css: 'css', json: 'json', yml: 'yaml', yaml: 'yaml'
          }
          return map[ext || ''] || null
        }
        await indexFile({
          id: `${repoData.id}_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
          repo_id: repoData.id,
          file_path: filePath,
          file_content: content,
          file_size: response.data.size || content.length,
          file_language: getLanguageFromPath(filePath),
          file_type: 'file'
        })
      }
    } catch (cacheErr) {
      console.warn('⚠️ Failed to cache fetched file into Elasticsearch:', (cacheErr as any)?.message || cacheErr)
    }

    return Response.json({
      content,
      size: response.data.size,
      sha: response.data.sha,
      download_url: response.data.download_url,
      html_url: response.data.html_url
    })

  } catch (error: any) {
    console.error('❌ Error fetching file content:', error)

    if (error.status === 404) {
      return Response.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    if (error.status === 403 && error.message?.includes('rate limit')) {
      return Response.json(
        { error: 'GitHub API rate limit exceeded' },
        { status: 429 }
      )
    }

    if (error.status === 403) {
      return Response.json(
        { error: 'File is too large to display' },
        { status: 403 }
      )
    }

    return Response.json(
      { error: 'Failed to fetch file content' },
      { status: 500 }
    )
  }
}
