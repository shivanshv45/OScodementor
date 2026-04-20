// AI-powered "Bug Radar" — scans files for bugs, anti-patterns, security issues
import { searchFilesInRepository } from '@/lib/search-adapter'
import { getRepositoryByUrl } from '@/lib/database'
import { GoogleGenAI } from '@google/genai'

// Active models (April 2026): Heavy/Latest models fallback to sturdy 2.5 series.
// NOTE: gemini-2.0-flash is DEPRECATED by Google and returns quota 0.
const MODELS = [
  'gemini-3.1-pro',
  'gemini-3-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const

export async function POST(request: Request) {
    try {
        const { repoUrl, filePath } = await request.json()
        if (!repoUrl) return Response.json({ error: 'repoUrl required' }, { status: 400 })

        const repo = await getRepositoryByUrl(repoUrl)
        if (!repo) return Response.json({ error: 'Repository not indexed' }, { status: 404 })

        // If a specific file is given, scan just that file; otherwise scan key files
        let filesToScan: Array<{ file_path: string; file_content: string }> = []

        if (filePath) {
            const allFiles = await searchFilesInRepository(repo.id, filePath)
            const match = allFiles.find(f => f.file_path === filePath)
            if (match) filesToScan = [{ file_path: match.file_path, file_content: match.file_content || '' }]
        } else {
            // Scan most important source files
            const allFiles = await searchFilesInRepository(repo.id, '*')
            const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.cpp']
            const sourceFiles = allFiles
                .filter(f => codeExtensions.some(ext => f.file_path.endsWith(ext)))
                .filter(f => !f.file_path.includes('node_modules') && !f.file_path.includes('.min.'))
                .slice(0, 8) // Limit to 8 files to stay within token limits
            filesToScan = sourceFiles.map(f => ({ file_path: f.file_path, file_content: (f.file_content || '').slice(0, 4000) }))
        }

        if (filesToScan.length === 0) {
            return Response.json({ issues: [], summary: 'No source files found to scan.' })
        }

        const fileContext = filesToScan
            .map(f => `--- ${f.file_path} ---\n${f.file_content}`)
            .join('\n\n')

        const prompt = `You are a senior code reviewer and security expert. Analyze the following source files from the "${repo.repo_name}" repository for bugs, anti-patterns, and potential security issues.

${fileContext}

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "issues": [
    {
      "file": "src/server.ts",
      "line": 42,
      "severity": "high",
      "category": "security",
      "title": "SQL Injection vulnerability",
      "description": "User input is directly concatenated into SQL query without parameterization.",
      "suggestion": "Use parameterized queries or an ORM to prevent SQL injection."
    }
  ],
  "summary": "Found 3 issues: 1 critical security vulnerability, 1 performance anti-pattern, 1 code smell."
}

Rules:
- severity: "critical", "high", "medium", "low"
- category: "security", "bug", "performance", "anti-pattern", "code-smell", "error-handling"
- Be specific about line numbers (estimate if needed)
- Only flag REAL issues, not style preferences
- Include actionable suggestions
- If no issues found, return empty issues array with a positive summary
- Maximum 15 issues`

        // Model fallback loop — handles 503/429 gracefully
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' })
        let lastError: any
        let text = ''

        for (const model of MODELS) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents: prompt,
                })
                text = response.text || ''
                break // success — exit loop
            } catch (err: any) {
                const msg = String(err?.message || err)
                const status = err?.status || err?.code
                if (status === 503 || status === 429 || msg.includes('UNAVAILABLE') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('overloaded') || msg.includes('not found') || msg.includes('not supported')) {
                    console.warn(`[Bug Radar] ${model} unavailable (${status}), trying next model…`)
                    lastError = err
                    continue
                }
                throw err
            }
        }

        if (!text && lastError) throw lastError

        text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()

        let result: any = { issues: [], summary: 'Analysis complete.' }
        try {
            result = JSON.parse(text)
        } catch {
            const match = text.match(/\{[\s\S]*\}/)
            if (match) result = JSON.parse(match[0])
        }

        return Response.json(result)
    } catch (error: any) {
        console.error('Bug Radar API error:', error)
        return Response.json({ error: error.message }, { status: 500 })
    }
}
