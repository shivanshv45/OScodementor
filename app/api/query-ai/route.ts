// Gemini AI integration for intelligent code analysis
// Now uses the unified search adapter (ES → Typesense fallback)
import { generateCodeResponse, explainFile, analyzeRepositoryStructure, suggestContributions, enforceAssertiveTone } from '@/lib/gemini'
import { searchFilesInRepository, getFileContent, indexFile } from '@/lib/search-adapter'
import { getRepositoryByUrl, getRepositoryInsights } from '@/lib/database'
import { fetchRawFileContent } from '@/lib/github'

export const maxDuration = 60

export async function POST(request: Request) {
  console.log('API Route: query-ai called')

  try {
    const { question, file, skillLevel = 'beginner', repoUrl, conversationHistory = [] } = await request.json()
    let selectedPath: string | undefined = file || undefined

    if (!question) {
      return Response.json(
        { error: 'Question is required' },
        { status: 400 }
      )
    }

    // Check if Gemini API key is configured
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY environment variable is not set')
      return Response.json(
        { error: 'AI service not configured' },
        { status: 500 }
      )
    }

    let repoData = null
    let fileContent: any = null
    let retrievedFiles: Array<{ file_path: string; file_content: string; score?: number }> = []

    // Get repository context if repoUrl is provided
    if (repoUrl) {
      try {
        repoData = await getRepositoryByUrl(repoUrl)
        if (repoData) {
          console.log(`Processing question: "${question}" for repo: ${repoData.repo_name}`)
          // Load repository insights for grounding context
          try {
            const insights = await getRepositoryInsights(repoUrl)
            if (insights) {
              (repoData as any)._insights = insights
            }
          } catch { }

          // If a specific file is selected/open, ALWAYS fetch directly from GitHub first for freshest content
          if (selectedPath) {
            console.log(`Fetching specific file directly from GitHub: ${selectedPath}`)
            try {
              const fetched = await fetchRawFileContent(repoData.repo_owner, repoData.repo_name, selectedPath)
              if (fetched && fetched.content) {
                // Use fetched content and cache it to search engine for future retrievals
                await indexFile({
                  id: `${repoData.id}_${selectedPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
                  repo_id: repoData.id,
                  file_path: selectedPath,
                  file_content: fetched.content,
                  file_size: fetched.size || fetched.content.length,
                  file_language: undefined,
                  file_type: 'file'
                })
                fileContent = { file_content: fetched.content }
                retrievedFiles.push({
                  file_path: selectedPath,
                  file_content: fetched.content,
                  score: 1.0
                })
                console.log(`File fetched from GitHub: ${fetched.content.length} chars`)
              } else {
                // Fallback to search engine if GitHub could not return content
                console.log('GitHub fetch returned no content; falling back to search engine')
                const esContent = await getFileContent(repoData.id, selectedPath)
                if (esContent?.file_content) {
                  fileContent = { file_content: esContent.file_content }
                  retrievedFiles.push({ file_path: selectedPath, file_content: esContent.file_content, score: 1.0 })
                }
              }
            } catch (e) {
              console.warn('Direct GitHub fetch failed; trying search engine:', (e as any)?.message || e)
              const esContent = await getFileContent(repoData.id, selectedPath)
              if (esContent?.file_content) {
                fileContent = { file_content: esContent.file_content }
                retrievedFiles.push({ file_path: selectedPath, file_content: esContent.file_content, score: 1.0 })
              }
            }
          }

          // If no explicit file is provided, detect filenames mentioned in question and load matching files
          if (!selectedPath) {
            try {
              const filenameMatch = (question || '').match(/([\w\-\/]+\.(?:ts|tsx|js|jsx|py|java|kt|swift|go|rb|php|rs|c|cpp|cs|json|md|yml|yaml|xml|html|css))\b/i)
              if (filenameMatch) {
                const mentionedName = filenameMatch[1]
                console.log(`Detected filename in question: ${mentionedName}`)
                const base = mentionedName.split('/').pop()?.toLowerCase() || mentionedName.toLowerCase()
                const candidates = await searchFilesInRepository(repoData.id, base)

                const allMatches = candidates.filter((c: any) => !!c.file_path)

                const scored = allMatches
                  .map((m: any) => {
                    const p = (m.file_path || '').toLowerCase()
                    let score = 0
                    if (p === mentionedName.toLowerCase()) score = 3
                    else if (p.endsWith(base)) score = 2
                    else if (p.includes(base)) score = 1
                    return { ...m, _localScore: score }
                  })
                  .filter((m: any) => m._localScore > 0)
                  .sort((a: any, b: any) => {
                    if (a._localScore !== b._localScore) return b._localScore - a._localScore
                    return a.file_path.length - b.file_path.length
                  })

                const best = scored[0]
                if (best?.file_path) {
                  selectedPath = best.file_path
                  let detectedContent = best.file_content || ''
                  if (!detectedContent || detectedContent.length === 0) {
                    try {
                      const fetched = await fetchRawFileContent(repoData.repo_owner, repoData.repo_name, best.file_path)
                      if (fetched && fetched.content) {
                        await indexFile({
                          id: `${repoData.id}_${best.file_path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                          repo_id: repoData.id,
                          file_path: best.file_path,
                          file_content: fetched.content,
                          file_size: fetched.size || fetched.content.length,
                          file_language: undefined,
                          file_type: 'file'
                        })
                        detectedContent = fetched.content
                      }
                    } catch { }
                  }
                  if (detectedContent) {
                    fileContent = { file_content: detectedContent }
                    retrievedFiles.unshift({ file_path: best.file_path, file_content: detectedContent, score: 1.0 })
                  }
                }
              }
            } catch (e) {
              console.warn('Filename detection failed:', (e as any)?.message || e)
            }
          }

          // Build smart retrieval based on question intent
          try {
            const q = (question || '').toLowerCase()

            const isStructureQuestion = ['structure', 'overview', 'architecture', 'organization', 'layout'].some(t => q.includes(t))
            const isMainQuestion = ['main', 'entry', 'bootstrap', 'start', 'init', 'primary'].some(t => q.includes(t))
            const isWhereQuestion = q.includes('where') || q.includes('find') || q.includes('locate')
            const isExplainQuestion = q.includes('explain') || q.includes('what') || q.includes('how')

            const queries: string[] = []

            if (isStructureQuestion) {
              queries.push('readme', 'package.json setup.py pyproject.toml requirements.txt', 'docs documentation')
            }

            if (isMainQuestion) {
              queries.push('main index app server bootstrap router __init__.py')
            }

            if (isWhereQuestion) {
              const whereMatch = q.match(/where.*?(\w+)/i)
              if (whereMatch) queries.push(whereMatch[1])
            }

            queries.push(question)
            const uniqueQueries = [...new Set(queries.filter(q => q.trim()))]

            const allResults: any[] = []
            for (const query of uniqueQueries) {
              try {
                const results = await searchFilesInRepository(repoData.id, query)
                allResults.push(...results)
              } catch (err) {
                console.warn(`Search failed for "${query}":`, err)
              }
            }

            // Deduplicate and rank
            const seenPaths = new Set<string>()
            const seenBase = new Set<string>()
            const ranked = allResults
              .filter((h: any) => h?.file_path)
              .filter((h: any) => {
                const base = (h.file_path || '').split('/').pop()?.toLowerCase() || ''
                if (seenPaths.has(h.file_path)) return false
                if (seenBase.has(base)) return false
                seenPaths.add(h.file_path)
                seenBase.add(base)
                return true
              })
              .sort((a: any, b: any) => {
                const scoreA = a._score || 0
                const scoreB = b._score || 0
                if (Math.abs(scoreA - scoreB) > 0.1) return scoreB - scoreA
                return a.file_path.length - b.file_path.length
              })

            const diverse: any[] = []
            const limit = 8
            if (ranked.length > 0) diverse.push(ranked[0])
            if (ranked.length > 1) diverse.push(ranked[1])
            if (ranked.length > 3) diverse.push(ranked[Math.floor(ranked.length / 2)])
            if (ranked.length > 4) diverse.push(ranked[ranked.length - 1])
            for (const r of ranked) {
              if (diverse.length >= limit) break
              if (!diverse.find(d => d.file_path === r.file_path)) diverse.push(r)
            }
            const unique = diverse.slice(0, limit)

            const selectedFilePath = selectedPath || ''
            for (const result of unique) {
              if (result.file_path !== selectedFilePath) {
                let content = result.file_content || ''
                if (!content || content.length === 0) {
                  try {
                    const fetched = await fetchRawFileContent(repoData.repo_owner, repoData.repo_name, result.file_path)
                    if (fetched && fetched.content) {
                      await indexFile({
                        id: `${repoData.id}_${result.file_path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                        repo_id: repoData.id,
                        file_path: result.file_path,
                        file_content: fetched.content,
                        file_size: fetched.size || fetched.content.length,
                        file_language: undefined,
                        file_type: 'file'
                      })
                      content = fetched.content
                    }
                  } catch { }
                }
                retrievedFiles.push({ file_path: result.file_path, file_content: content || '', score: result._score || 0 })
              }
            }

            if (!selectedPath && retrievedFiles.length > 0) {
              const topFile = retrievedFiles[0]
              if (topFile.file_content && topFile.file_content.length > 0) {
                fileContent = { file_content: topFile.file_content }
              }
            }

          } catch (searchError) {
            console.error('Error searching for relevant files:', searchError)
          }
        }
      } catch (error) {
        console.error('Error getting repository context:', error)
      }
    }

    // Build context for Gemini
    const context = {
      repoName: repoData?.repo_name || 'the repository',
      repoDescription: repoData?.repo_description || '',
      selectedFile: selectedPath,
      fileContent: fileContent?.file_content || fileContent,
      skillLevel,
      conversationHistory,
      relevantFiles: retrievedFiles.map(f => ({
        path: f.file_path,
        content: f.file_content.slice(0, 8000),
        score: f.score
      })),
      repoInsights: repoData && (repoData as any)._insights ? {
        summary: (repoData as any)._insights.repo_summary,
        quickstart: (repoData as any)._insights.quickstart,
        contributionGuide: (repoData as any)._insights.contribution_guide,
      } : undefined
    }

    // Generate AI response
    let response = await generateCodeResponse(question, context)
    try {
      response = enforceAssertiveTone(response)
    } catch { }

    console.log('Generated AI response successfully')

    return Response.json({
      answer: response,
      context: {
        repoName: context.repoName,
        selectedFile: selectedPath,
        skillLevel
      }
    })

  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to generate AI response'
    console.error('Error in query-ai API:', errorMessage, error)
    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
