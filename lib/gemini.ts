// Gemini AI integration for intelligent code analysis and chat
import { GoogleGenAI } from "@google/genai"

// ---------------------------------------------------------------------------
// Key Manager — supports GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2 …
// Ported from Orbit backend key_manager.py
// ---------------------------------------------------------------------------
class GeminiKeyManager {
  private keys: string[]
  private currentIndex = 0

  constructor() {
    this.keys = this.loadKeys()
  }

  private loadKeys(): string[] {
    const keys: string[] = []

    // Load numbered keys first: GEMINI_API_KEY_1, GEMINI_API_KEY_2, …
    let i = 1
    while (true) {
      const key = process.env[`GEMINI_API_KEY_${i}`]
      if (!key) break
      keys.push(key)
      i++
    }

    // Also load the base key
    const baseKey = process.env.GEMINI_API_KEY
    if (baseKey) keys.push(baseKey)

    // Deduplicate
    const unique = [...new Set(keys.filter(Boolean))]
    if (unique.length === 0) {
      console.warn('[Gemini] ⚠️  No GEMINI_API_KEY found in environment')
    } else {
      console.log(`[Gemini] Loaded ${unique.length} API key(s)`)
    }
    return unique
  }

  private getNextKey(): string {
    if (this.keys.length === 0) throw new Error('No Gemini API keys configured')
    const key = this.keys[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.keys.length
    return key
  }

  async executeWithRetry<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    let lastError: unknown
    const attempts = Math.max(this.keys.length, 1)

    for (let i = 0; i < attempts; i++) {
      const key = this.getNextKey()
      try {
        return await fn(key)
      } catch (err: any) {
        const msg = String(err?.message || err)
        const status = err?.status || err?.code
        if (
          status === 429 ||
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('quota')
        ) {
          console.warn(`[Gemini] Quota exhausted for key …${key.slice(-4)}, trying next key`)
          lastError = err
          continue
        }
        // Not a quota error — rethrow immediately with real message
        throw err
      }
    }
    throw new Error(`All Gemini API keys exhausted. Last error: ${lastError}`)
  }
}

const keyManager = new GeminiKeyManager()

// ---------------------------------------------------------------------------
// Core generate helper — tries multiple models with proper fallback for quota/429/503 errors
// Active models (April 2026): Heavy/Latest models fallback to sturdy 2.5 series.
// NOTE: gemini-2.0-flash is DEPRECATED by Google and returns quota 0.
// ---------------------------------------------------------------------------
async function generateWithFallback(prompt: string, customModels?: readonly string[]): Promise<string> {
  const models = customModels || [
    'gemini-3.1-pro',
    'gemini-3-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ]

  return keyManager.executeWithRetry(async (apiKey) => {
    const client = new GoogleGenAI({ apiKey })
    let lastErr: unknown

    for (const model of models) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
        })
        const text = response?.text
        if (!text) throw new Error(`${model} returned empty response`)
        return text
      } catch (err: any) {
        const msg = String(err?.message || err)
        const status = err?.status || err?.code
        // If model not found, not supported, quota exhausted, OR 503 unavailable — try next model
        if (
          msg.includes('not found') ||
          msg.includes('not supported') ||
          msg.includes('404') ||
          msg.includes('INVALID_ARGUMENT') ||
          status === 429 ||
          status === 503 ||
          msg.includes('429') ||
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('quota') ||
          msg.includes('rate limit') ||
          msg.includes('overloaded') ||
          msg.includes('high demand')
        ) {
          console.warn(`[Gemini] ${model} unavailable/quota-exhausted (${status || 'unknown'}), trying next model…`)
          lastErr = err
          continue
        }
        throw err
      }
    }
    // If all models failed with quota/503 errors on this key, signal quota exhaustion
    // so executeWithRetry rotates to the next key
    const lastMsg = String((lastErr as any)?.message || lastErr)
    if (
      lastMsg.includes('429') ||
      lastMsg.includes('503') ||
      lastMsg.includes('UNAVAILABLE') ||
      lastMsg.includes('RESOURCE_EXHAUSTED') ||
      lastMsg.includes('quota')
    ) {
      const quotaErr = new Error(`Quota/availability exhausted for all models: ${lastMsg}`)
        ; (quotaErr as any).status = 429
      throw quotaErr
    }
    throw lastErr || new Error('All Gemini models failed')
  })
}

// ---------------------------------------------------------------------------
// Simple retry with exponential backoff (for non-quota transient errors)
// ---------------------------------------------------------------------------
async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 4
  const baseMs = opts.baseMs ?? 2000
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err: any) {
      attempt++
      const status = err?.status || err?.code
      const msg = String(err?.message || '')
      if (attempt > retries || status === 400 || status === 404 || status === 401) throw err
      if (status === 503 || status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
        // Parse retry-after from error message if available
        const retryMatch = msg.match(/retry\s+in\s+([\d.]+)s/i)
        const suggestedDelay = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) : 0
        const delay = Math.max(suggestedDelay, baseMs * Math.pow(2, attempt - 1))
        console.log(`[Gemini] ${status || 'quota error'}, retrying in ${delay}ms (attempt ${attempt}/${retries})`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Public interfaces & functions
// ---------------------------------------------------------------------------
export interface ChatContext {
  repoName: string
  repoDescription: string
  selectedFile?: string
  fileContent?: string
  skillLevel: 'beginner' | 'intermediate' | 'expert'
  conversationHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  relevantFiles?: Array<{
    path: string
    content: string
    score?: number
  }>
  repoInsights?: {
    summary?: string | null
    quickstart?: string | null
    contributionGuide?: string | null
  }
}

export async function generateCodeResponse(
  question: string,
  context: ChatContext
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured. Please add GEMINI_API_KEY to .env.local')
  }

  const systemPrompt = buildSystemPrompt(context)
  const userPrompt = buildUserPrompt(question, context)
  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`
  
  // Custom model fallback chain strictly for Chats
  const CHAT_MODELS = [
    'gemini-3-flash',
    'gemini-2.5-pro',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro',
    'gemini-2.5-flash-lite'
  ]

  try {
    const text = await withGeminiRetry(() => generateWithFallback(fullPrompt, CHAT_MODELS))
    return formatResponse(text)
  } catch (error: any) {
    // Surface the real error message — never swallow it
    console.error('[Gemini] generateCodeResponse failed:', error?.message || error)
    throw new Error(`AI response failed: ${error?.message || 'Unknown Gemini error'}`)
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
function formatResponse(text: string): string {
  if (!text) return text
  let formatted = text.trim()
  formatted = formatted.replace(/\n\s*-\s*/g, '\n- ')
  formatted = formatted.replace(/\n\s*(\d+\.)\s*/g, '\n$1 ')
  formatted = formatted.replace(/\n\s*(#{1,6})\s*/g, '\n$1 ')
  formatted = formatted.replace(/```/g, '\n```')
  formatted = formatted.replace(/\n\s*>\s*/g, '\n> ')
  formatted = formatted.replace(/\n{3,}/g, '\n\n')
  formatted = formatted.replace(/([.!?])\s+([A-Z][a-z])/g, '$1\n\n$2')
  return formatted.trim()
}

function buildSystemPrompt(context: ChatContext): string {
  const skillLevelInstructions = {
    beginner: `You are a friendly coding mentor helping a beginner understand this codebase. Use simple language, avoid jargon, and explain concepts step-by-step. Be encouraging and supportive.`,
    intermediate: `You are a knowledgeable developer helping someone with intermediate skills understand this codebase. Provide technical details while keeping explanations clear and practical.`,
    expert: `You are a senior developer discussing this codebase with a fellow expert. Provide deep technical insights, architectural analysis, and advanced implementation details.`
  }

  return `You are CodeMentor, an AI assistant that helps developers understand GitHub repositories.

${skillLevelInstructions[context.skillLevel]}

Repository Context:
- Repository: ${context.repoName}
- Description: ${context.repoDescription || 'No description available'}

CRITICAL RESPONSE RULES:
1. BE ASSERTIVE: Use definitive language. Prefer "it is/does" over "it seems/might/appears".
2. NO SPECULATION: Answer only from the provided code and context. If information is missing, say: "I don't have that information from the provided code."
3. NO HEDGING: Do NOT use: "maybe", "perhaps", "it seems", "appears to", "might", "likely", "probably".
4. GROUNDED ANSWERS: Reference specific files, functions, or lines when making claims.
5. CONFIDENT TONE: Be direct and authoritative in explanations.
6. FORMATTING: Use formatting SPARINGLY and only when appropriate:
   - Use **bold** ONLY for key technical terms, file names, or important concepts
   - Use *italic* ONLY for emphasis on specific words
   - Use \`code\` ONLY for actual code snippets, function names, or technical terms
   - Use bullet points (-) ONLY for lists of items
   - Use numbered lists (1., 2., 3.) ONLY for step-by-step instructions
   - Use > blockquotes ONLY for important warnings or notes
   - Use headers (##, ###) ONLY for major section breaks
   - Keep regular explanatory text as normal paragraphs
   - Don't over-format — most text should remain plain

Available Context:
- Selected file: ${context.selectedFile || 'None'}
- Repository insights: ${context.repoInsights ? 'Available' : 'Not available'}
- Relevant files: ${context.relevantFiles?.length || 0} files found
- Conversation history: ${context.conversationHistory?.length || 0} previous messages

Remember: You're helping someone understand real code, so be accurate and practical. Reference specific files when making claims about the codebase.`
}

function buildUserPrompt(question: string, context: ChatContext): string {
  let prompt = `User Question: ${question}\n\n`

  if (context.selectedFile && context.fileContent) {
    prompt += `Currently viewing file: ${context.selectedFile}\n`
    prompt += `File content:\n\`\`\`\n${context.fileContent}\n\`\`\`\n\n`
  }

  if (context.relevantFiles && context.relevantFiles.length > 0) {
    prompt += `Relevant files from the repository:\n\n`
    context.relevantFiles.forEach((file, index) => {
      prompt += `${index + 1}. File: ${file.path}\n`
      if (file.content && file.content.length > 0) {
        prompt += `Content:\n\`\`\`\n${file.content}\n\`\`\`\n\n`
      } else {
        prompt += `Content: [No content available]\n\n`
      }
    })
    prompt += `Use these files to provide accurate, context-aware answers. Reference specific files when relevant.\n\n`
  }

  if (context.repoInsights && (context.repoInsights.summary || context.repoInsights.quickstart || context.repoInsights.contributionGuide)) {
    prompt += `Repository insights (for grounding):\n\n`
    if (context.repoInsights.summary) prompt += `Summary:\n${context.repoInsights.summary}\n\n`
    if (context.repoInsights.quickstart) prompt += `Quickstart:\n${context.repoInsights.quickstart}\n\n`
    if (context.repoInsights.contributionGuide) prompt += `Contribution Guide:\n${context.repoInsights.contributionGuide}\n\n`
  }

  if (context.conversationHistory && context.conversationHistory.length > 0) {
    prompt += `Previous conversation:\n`
    context.conversationHistory.slice(-3).forEach(msg => {
      prompt += `${msg.role}: ${msg.content}\n`
    })
    prompt += '\n'
  }

  return prompt
}

// ---------------------------------------------------------------------------
// Other exported functions (analyzeRepositoryStructure, explainFile, etc.)
// ---------------------------------------------------------------------------
export async function analyzeRepositoryStructure(
  repoName: string,
  files: Array<{ path: string; type: string; content?: string }>
): Promise<string> {
  try {
    const fileList = files
      .filter(f => f.type === 'file')
      .map(f => f.path)
      .slice(0, 50)

    const prompt = `Analyze this repository structure and provide a high-level overview:

Repository: ${repoName}
Files: ${fileList.join(', ')}

Please provide:
1. What this project does (1-2 sentences)
2. Main technologies/frameworks used
3. Key directories and their purposes
4. Entry points (main files to look at first)
5. Architecture overview (if apparent)

Keep it concise and beginner-friendly.`

    return await generateWithFallback(prompt)
  } catch (error: any) {
    console.error('[Gemini] analyzeRepositoryStructure failed:', error?.message || error)
    return 'Unable to analyze repository structure at this time.'
  }
}

export async function explainFile(
  filePath: string,
  fileContent: string,
  repoContext: string
): Promise<string> {
  try {
    const prompt = `Explain this file in the context of the repository:

File: ${filePath}
Repository Context: ${repoContext}

File Content:
\`\`\`
${fileContent.substring(0, 3000)}
\`\`\`

Please provide:
1. What this file does
2. Key functions/classes and their purposes
3. How it fits into the overall project
4. Important patterns or concepts used
5. Any notable code quality or best practices

Keep the explanation clear and practical.`

    return await generateWithFallback(prompt)
  } catch (error: any) {
    console.error('[Gemini] explainFile failed:', error?.message || error)
    return 'Unable to explain this file at this time.'
  }
}

export async function suggestContributions(
  repoName: string,
  repoDescription: string,
  issues: Array<{ title: string; labels: string[] }>
): Promise<string> {
  try {
    const issueList = issues
      .filter(issue => issue.labels.some(label =>
        label.toLowerCase().includes('good first issue') ||
        label.toLowerCase().includes('beginner') ||
        label.toLowerCase().includes('help wanted')
      ))
      .slice(0, 10)

    const prompt = `Suggest good first contributions for this repository:

Repository: ${repoName}
Description: ${repoDescription}

Available Issues:
${issueList.map(issue => `- ${issue.title} (${issue.labels.join(', ')})`).join('\n')}

Please provide:
1. 3-5 specific contribution suggestions
2. Skills needed for each suggestion
3. Steps to get started
4. Files to look at first
5. How to test changes

Make it encouraging and actionable for beginners.`

    return await generateWithFallback(prompt)
  } catch (error: any) {
    console.error('[Gemini] suggestContributions failed:', error?.message || error)
    return 'Unable to suggest contributions at this time.'
  }
}

export async function generateInsightsFromReadme(
  repoName: string,
  readmeContent: string,
  files: Array<{ path: string; type: string }>
): Promise<{
  summary: string
  quickstart: string
  contributionGuide: string
}> {
  const prompt = `Extract key information from this README to create repository insights.

Repository: ${repoName}
README Content:
${readmeContent}

Files in repo: ${files.slice(0, 50).map(f => f.path).join(', ')}

Please provide THREE sections:

1. SUMMARY (2-3 sentences):
- What this project does
- Main purpose and key features
- Technology stack if mentioned

2. QUICKSTART (step-by-step setup):
- Prerequisites/requirements
- Installation steps
- How to run locally
- Basic usage

3. CONTRIBUTION_GUIDE (contribution process):
- How to contribute
- Development setup
- Code style/standards
- Where to ask questions

Format your response as:
SUMMARY: [your summary here]
QUICKSTART: [your quickstart here]
CONTRIBUTION_GUIDE: [your contribution guide here]`

  const text = await generateWithFallback(prompt)
  const summary = extractSection(text, 'SUMMARY')
  const quickstart = extractSection(text, 'QUICKSTART')
  const contributionGuide = extractSection(text, 'CONTRIBUTION_GUIDE')

  return {
    summary: summary || 'Repository summary unavailable.',
    quickstart: quickstart || 'Quickstart guide unavailable.',
    contributionGuide: contributionGuide || 'Contribution guide unavailable.'
  }
}

function extractSection(text: string, sectionName: string): string {
  const regex = new RegExp(`${sectionName}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : ''
}

// Post-processor to enforce assertive tone while preserving code blocks
export function enforceAssertiveTone(text: string): string {
  try {
    const codeFence = /```[\s\S]*?```/g
    const codeBlocks = text.match(codeFence) || []
    const parts = text.split(codeFence)

    const hedges: Array<[RegExp, string]> = [
      [/\bit seems\b/gi, 'it is'],
      [/\bit appears\b/gi, 'it is'],
      [/\bseems to\b/gi, ''],
      [/\bappears to\b/gi, ''],
      [/\bperhaps\b/gi, ''],
      [/\bprobably\b/gi, ''],
      [/\blikely\b/gi, ''],
      [/\bmight\b/gi, ''],
      [/\bmay\b/gi, ''],
    ]

    const processInline = (segment: string): string => {
      const inlineFence = /`[^`]*`/g
      const inlineCodes = segment.match(inlineFence) || []
      const inlineParts = segment.split(inlineFence)
      const replaced = inlineParts.map(p => {
        let s = p
        for (const [re, rep] of hedges) s = s.replace(re, rep)
        return s.replace(/\s{2,}/g, ' ')
      })
      let out = ''
      for (let i = 0; i < replaced.length; i++) {
        out += replaced[i]
        if (i < inlineCodes.length) out += inlineCodes[i]
      }
      return out
    }

    const processed = parts.map(processInline)
    let result = ''
    for (let i = 0; i < processed.length; i++) {
      result += processed[i]
      if (i < codeBlocks.length) result += codeBlocks[i]
    }
    return result.trim()
  } catch {
    return text
  }
}