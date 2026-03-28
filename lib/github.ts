// GitHub API utility functions for repository data fetching

import { Octokit } from '@octokit/rest'
import {
  GitHubRepository,
  GitHubTreeResponse,
  GitHubIssue,
  GitHubLanguage,
  GitHubApiResponse,
  GitHubRateLimit,
  RepoData,
  ApiError
} from './types'
// Simple concurrency limiter; avoids external deps to keep Next build clean

// Initialize Octokit with authentication
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  baseUrl: process.env.GITHUB_API_BASE_URL || 'https://api.github.com',
})

/**
 * Parse GitHub repository URL to extract owner and repo name
 */
export function parseGitHubUrl(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl)

    // Handle both github.com and www.github.com
    if (!url.hostname.includes('github.com')) {
      return null
    }

    const pathParts = url.pathname.split('/').filter(part => part.length > 0)

    if (pathParts.length < 2) {
      return null
    }

    const owner = pathParts[0]
    const repo = pathParts[1].replace(/\.git$/, '') // Remove .git suffix if present

    return { owner, repo }
  } catch (error) {
    return null
  }
}

/**
 * Fetch repository metadata from GitHub API
 */
export async function fetchRepository(owner: string, repo: string): Promise<GitHubRepository> {
  try {
    console.log(`🔍 GitHub API: Fetching repository ${owner}/${repo}`)

    const response: GitHubApiResponse<GitHubRepository> = await Promise.race([
      octokit.rest.repos.get({
        owner,
        repo,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Repository fetch timeout after 5 seconds')), 5000)
      )
    ]) as GitHubApiResponse<GitHubRepository>

    console.log(`✅ GitHub API: Repository fetched successfully`)
    return response.data
  } catch (error: any) {
    console.error(`❌ GitHub API: Error fetching repository:`, error.message)
    if (error.status === 401) {
      throw new ApiError('GitHub token is invalid or has been revoked. Please generate a new token.', 401, 'GITHUB_ERROR')
    }
    if (error.status === 404) {
      throw new ApiError('Repository not found or is private', 404, 'NOT_FOUND')
    }
    if (error.status === 403 && error.message?.includes('rate limit')) {
      throw new ApiError('GitHub API rate limit exceeded', 429, 'RATE_LIMITED')
    }
    if (error.message?.includes('timeout')) {
      throw new ApiError('GitHub API request timed out', 408, 'TIMEOUT')
    }
    throw new ApiError(`GitHub API error: ${error.message}`, error.status || 500, 'GITHUB_ERROR')
  }
}

/**
 * Fetch repository languages from GitHub API
 */
export async function fetchRepositoryLanguages(owner: string, repo: string): Promise<string[]> {
  try {
    const response: GitHubApiResponse<GitHubLanguage> = await octokit.rest.repos.listLanguages({
      owner,
      repo,
    })

    // Sort languages by bytes of code (descending) and return top 10
    const sortedLanguages = Object.entries(response.data)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([language]) => language)

    return sortedLanguages
  } catch (error: any) {
    console.warn('Failed to fetch repository languages:', error.message)
    return []
  }
}

/**
 * Fetch repository tree structure from GitHub API
 */
export async function fetchRepositoryTree(owner: string, repo: string, branch: string = 'main'): Promise<GitHubTreeResponse> {
  try {
    console.log(`🔍 GitHub API: Fetching repository tree for ${owner}/${repo} (${branch})`)

    // First, get the branch reference to get the tree SHA
    const branchRef = await Promise.race([
      octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Branch ref fetch timeout after 5 seconds')), 5000)
      )
    ]) as any

    const commitSha = branchRef.data.object.sha

    // Get the commit to get the tree SHA
    const commit = await Promise.race([
      octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: commitSha,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Commit fetch timeout after 5 seconds')), 5000)
      )
    ]) as any

    const treeSha = commit.data.tree.sha

    // Get the tree with recursive listing
    const response: GitHubApiResponse<GitHubTreeResponse> = await Promise.race([
      octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: 'true',
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tree fetch timeout after 10 seconds')), 10000)
      )
    ]) as GitHubApiResponse<GitHubTreeResponse>

    console.log(`✅ GitHub API: Repository tree fetched successfully (${response.data.tree.length} items)`)
    return response.data
  } catch (error: any) {
    console.error(`❌ GitHub API: Error fetching repository tree:`, error.message)
    if (error.status === 404) {
      throw new ApiError('Repository tree not found', 404, 'NOT_FOUND')
    }
    if (error.message?.includes('timeout')) {
      throw new ApiError('GitHub API request timed out', 408, 'TIMEOUT')
    }
    throw new ApiError(`Failed to fetch repository tree: ${error.message}`, error.status || 500, 'GITHUB_ERROR')
  }
}

// Simple retry with exponential backoff for GitHub API calls
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 400
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err: any) {
      attempt++
      const status = err?.status
      // Do not retry 404
      if (attempt > retries || status === 404) throw err
      const delay = baseMs * Math.pow(2, attempt - 1)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// Cache for default branch per owner/repo to avoid redundant API calls
const defaultBranchCache = new Map<string, string>()

/**
 * Fetch raw file content from GitHub (text files only)
 */
export async function fetchRawFileContent(owner: string, repo: string, path: string, ref?: string): Promise<{ content: string; size: number } | null> {
  try {
    let branch = ref
    if (!branch) {
      const cacheKey = `${owner}/${repo}`
      if (defaultBranchCache.has(cacheKey)) {
        branch = defaultBranchCache.get(cacheKey)!
      } else {
        const repoMeta = await withRetry(() => octokit.rest.repos.get({ owner, repo }))
        branch = repoMeta.data.default_branch || 'main'
        defaultBranchCache.set(cacheKey, branch)
      }
    }

    const response = await withRetry(() => octokit.rest.repos.getContent({ owner, repo, path, ref: branch }))
    if (Array.isArray(response.data)) {
      return null
    }
    if (response.data.type !== 'file') {
      return null
    }
    const size = response.data.size || 0
    if (size > 256 * 1024) { // 256KB cap
      return null
    }
    let content = ''
    if ((response.data as any).encoding === 'base64') {
      content = Buffer.from((response.data as any).content, 'base64').toString('utf-8')
    } else {
      content = (response.data as any).content || ''
    }
    return { content, size }
  } catch (error: any) {
    if (error.status === 403 || error.status === 404) return null
    throw error
  }
}

/**
 * Score files by importance for initial indexing
 */
export function scoreFileImportance(filePath: string): number {
  const path = filePath.toLowerCase()
  let score = 0
  // Top-level docs
  if (/^readme(\.md|\.rst|\.txt)?$/.test(path.split('/').pop() || '')) score += 10
  if (/^contributing(\.md)?$/.test(path.split('/').pop() || '')) score += 9
  if (/^license/.test(path.split('/').pop() || '')) score += 8
  // Package/config
  if (path.endsWith('package.json')) score += 9
  if (/(requirements\.txt|pyproject\.toml|setup\.py)$/.test(path)) score += 8
  if (/(go\.mod|cargo\.toml|build\.gradle|pom\.xml)$/.test(path)) score += 8
  if (/(pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/.test(path)) score += 2
  // Entry points
  if (/(^|\/)src\/(index|main)\./.test(path)) score += 7
  if (/(^|\/)app\/(index|main)\./.test(path)) score += 7
  if (/server\.|router\.|routes?\./.test(path)) score += 5
  // Depth preference (shallower is more important)
  const depth = (filePath.match(/\//g) || []).length
  score += Math.max(0, 5 - depth)
  // Language preference
  if (/(\.ts|\.tsx|\.js|\.jsx|\.py|\.go|\.rs|\.java|\.rb|\.php)$/.test(path)) score += 3
  // Deprioritize minified/bundles
  if (/\.min\.|dist\//.test(path)) score -= 5
  return score
}

/**
 * Limit concurrency for GitHub API calls
 */
function createLimit(concurrency: number) {
  let activeCount = 0
  const queue: Array<() => void> = []

  const next = () => {
    if (queue.length === 0) return
    if (activeCount >= concurrency) return
    const run = queue.shift()!
    activeCount++
    run()
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        fn().then(resolve, reject).finally(() => {
          activeCount--
          next()
        })
      }
      queue.push(task)
      next()
    })
  }
}

export const githubConcurrencyLimit = createLimit(5)

/**
 * Fetch repository issues with "good first issue" labels
 */
export async function fetchGoodFirstIssues(owner: string, repo: string): Promise<GitHubIssue[]> {
  try {
    const response: GitHubApiResponse<GitHubIssue[]> = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      labels: 'good first issue',
      per_page: 20,
      sort: 'created',
      direction: 'asc',
    })

    return response.data
  } catch (error: any) {
    console.warn('Failed to fetch good first issues:', error.message)
    return []
  }
}

/**
 * Convert GitHub tree structure to hierarchical file structure
 */
export function buildFileTree(treeItems: any[]): RepoData['files'] {
  console.log('🔍 GitHub API: Building file tree from', treeItems.length, 'items')

  const fileMap = new Map<string, any>()
  const rootFiles: RepoData['files'] = []

  // Create a map of all items by path
  treeItems.forEach(item => {
    fileMap.set(item.path, {
      path: item.path,
      type: item.type === 'tree' ? 'folder' : 'file',
      children: []
    })
  })

  // Build hierarchy
  treeItems.forEach(item => {
    const pathParts = item.path.split('/')
    const isRoot = pathParts.length === 1

    if (isRoot) {
      rootFiles.push(fileMap.get(item.path)!)
    } else {
      const parentPath = pathParts.slice(0, -1).join('/')
      const parent = fileMap.get(parentPath)
      if (parent) {
        parent.children = parent.children || []
        parent.children.push(fileMap.get(item.path)!)
      } else {
        // If parent doesn't exist, it might be a deeper nested structure
        // Add to root for now, the frontend will handle the display
        rootFiles.push(fileMap.get(item.path)!)
      }
    }
  })

  // Sort items: folders first, then files
  const sortItems = (items: any[]) => {
    return items.sort((a, b) => {
      if (a.type === 'folder' && b.type === 'file') return -1
      if (a.type === 'file' && b.type === 'folder') return 1
      return a.path.localeCompare(b.path)
    })
  }

  const sortRecursively = (items: any[]) => {
    sortItems(items)
    items.forEach(item => {
      if (item.children && item.children.length > 0) {
        sortRecursively(item.children)
      }
    })
  }

  sortRecursively(rootFiles)

  console.log('✅ GitHub API: File tree built with', rootFiles.length, 'root items')
  return rootFiles
}

/**
 * Get GitHub API rate limit information
 */
export async function getRateLimit(): Promise<GitHubRateLimit> {
  try {
    const response = await octokit.rest.rateLimit.get()
    return response.data.rate
  } catch (error: any) {
    console.warn('Failed to fetch rate limit info:', error.message)
    return {
      limit: 5000,
      remaining: 0,
      reset: Date.now() + 3600000,
      used: 5000
    }
  }
}

/**
 * Main function to fetch complete repository data
 */
export async function fetchCompleteRepositoryData(repoUrl: string): Promise<RepoData> {
  console.log('🔍 GitHub API: Starting repository data fetch for:', repoUrl)

  // Parse the repository URL
  const parsed = parseGitHubUrl(repoUrl)
  if (!parsed) {
    console.log('❌ GitHub API: Invalid URL format')
    throw new ApiError('Invalid GitHub repository URL', 400, 'INVALID_URL')
  }

  const { owner, repo } = parsed
  console.log('✅ GitHub API: Parsed URL - owner:', owner, 'repo:', repo)

  // Check rate limit before making requests
  console.log('🔍 GitHub API: Checking rate limit...')
  const rateLimit = await getRateLimit()
  console.log('📊 GitHub API: Rate limit status:', rateLimit)

  if (rateLimit.remaining < 5) {
    console.log('❌ GitHub API: Rate limit exceeded')
    throw new ApiError('GitHub API rate limit exceeded. Please try again later.', 429, 'RATE_LIMITED')
  }

  try {
    console.log('🚀 GitHub API: Fetching repository data in parallel...')

    // First fetch repository to get default branch
    const repository = await fetchRepository(owner, repo)
    console.log('✅ GitHub API: Repository fetched:', repository.name)

    // Then fetch other data in parallel
    const [languages, tree, issues] = await Promise.all([
      fetchRepositoryLanguages(owner, repo),
      fetchRepositoryTree(owner, repo, repository.default_branch),
      fetchGoodFirstIssues(owner, repo)
    ])

    console.log('✅ GitHub API: All data fetched - languages:', languages.length, 'tree items:', tree.tree.length, 'issues:', issues.length)

    // Build file tree structure
    const files = buildFileTree(tree.tree)
    console.log('✅ GitHub API: File tree built with', files.length, 'root items')

    // Transform issues to match expected format
    const transformedIssues = issues.map(issue => ({
      title: issue.title,
      url: issue.html_url,
      labels: issue.labels.map(label => label.name)
    }))

    const result = {
      name: repository.name || 'Unknown Repository',
      description: repository.description || 'No description available',
      stars: repository.stargazers_count || 0,
      languages: languages || [],
      files: files || [],
      issues: transformedIssues || []
    }

    console.log('✅ GitHub API: Repository data prepared successfully')
    return result
  } catch (error: any) {
    console.error('❌ GitHub API: Error in fetchCompleteRepositoryData:', error)

    // If it's a timeout or network error, provide a fallback response
    if (error.message?.includes('timeout') || error.message?.includes('network')) {
      console.log('🔄 GitHub API timeout/network error, providing fallback data')
      const urlParts = repoUrl.replace('https://github.com/', '').split('/')
      const repoName = urlParts[1] || 'Unknown Repository'

      return {
        name: repoName,
        description: 'Repository data temporarily unavailable',
        stars: 0,
        languages: [],
        files: [],
        issues: []
      }
    }

    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(`Unexpected error: ${error.message}`, 500, 'UNKNOWN')
  }
}

