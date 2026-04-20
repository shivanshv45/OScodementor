// AI-powered "Onboard Me" — generates a guided reading order for the codebase
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
        const { repoUrl } = await request.json()
        if (!repoUrl) return Response.json({ error: 'repoUrl required' }, { status: 400 })

        const repo = await getRepositoryByUrl(repoUrl)
        if (!repo) return Response.json({ error: 'Repository not indexed' }, { status: 404 })

        // Get all files from the repo
        const files = await searchFilesInRepository(repo.id, '*')
        const filePaths = files.map(f => f.file_path).filter(Boolean)

        // Get key files content for context
        const keyPatterns = ['readme', 'package.json', 'index', 'main', 'app', 'server', 'config', 'setup']
        const keyFiles = files
            .filter(f => keyPatterns.some(p => f.file_path.toLowerCase().includes(p)))
            .slice(0, 10)
            .map(f => `--- ${f.file_path} ---\n${(f.file_content || '').slice(0, 2000)}`)
            .join('\n\n')

        const prompt = `You are a senior developer onboarding a new team member to a codebase called "${repo.repo_name}".

Here are ALL the files in this repository:
${filePaths.join('\n')}

Here is the content of key files:
${keyFiles}

Generate a structured onboarding guide as a JSON array. Each step should guide the reader through the codebase in the most logical order — from entry points to core logic to utilities to tests.

Return ONLY valid JSON in this exact format (no markdown, no backticks):
[
  {
    "step": 1,
    "title": "Start with the entry point",
    "file": "src/index.ts",
    "why": "This is where the application boots up. Understanding the entry point gives you the big picture.",
    "keyThings": ["Express server setup", "Middleware registration", "Route mounting"],
    "timeEstimate": "5 min"
  }
]

Rules:
- Include 6-12 steps maximum
- Only reference files that actually exist in the file list
- Order from most important to least important for understanding
- Be specific about what to look for in each file
- Keep "why" concise (1-2 sentences)
- keyThings should have 2-4 items each`

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
                    console.warn(`[Onboard] ${model} unavailable (${status}), trying next model…`)
                    lastError = err
                    continue
                }
                throw err
            }
        }

        if (!text && lastError) throw lastError

        // Strip markdown code fences if present
        text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()

        let steps: any[] = []
        try {
            steps = JSON.parse(text)
        } catch {
            // Try to extract JSON array from text
            const match = text.match(/\[[\s\S]*\]/)
            if (match) steps = JSON.parse(match[0])
        }

        return Response.json({ steps })
    } catch (error: any) {
        console.error('Onboard API error:', error)
        return Response.json({ error: error.message }, { status: 500 })
    }
}
