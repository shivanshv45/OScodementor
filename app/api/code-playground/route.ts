// AI-powered "Code Playground" — generates line-by-line annotations for any file
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' })

export async function POST(request: Request) {
  try {
    const { filePath, code, skillLevel = 'beginner' } = await request.json()
    if (!code || !filePath) return Response.json({ error: 'filePath and code required' }, { status: 400 })

    // Truncate very large files
    const truncated = code.slice(0, 8000)

    const prompt = `You are a code tutor. Annotate the following source file line-by-line for a ${skillLevel}-level developer.

File: ${filePath}
\`\`\`
${truncated}
\`\`\`

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "annotations": [
    {
      "startLine": 1,
      "endLine": 3,
      "type": "import",
      "label": "Dependencies",
      "explanation": "These lines import React and two hooks: useState for managing component state, and useEffect for running side effects like API calls.",
      "color": "#4fc3f7"
    }
  ],
  "fileSummary": "This file implements the main application component that manages routing and global state."
}

Rules:
- Group consecutive related lines into single annotations (e.g. a block of imports = one annotation)
- type can be: "import", "function", "class", "variable", "logic", "return", "config", "comment", "hook", "handler", "type"
- Choose distinct colors for each type (use hex codes)
- For "${skillLevel}" level:
  ${skillLevel === 'beginner' ? '- Explain basic concepts like loops, functions, variables\n  - Use analogies\n  - Define technical terms' : skillLevel === 'intermediate' ? '- Focus on patterns and architecture decisions\n  - Explain why, not just what\n  - Note performance implications' : '- Focus on edge cases, optimizations, and trade-offs\n  - Mention relevant design patterns\n  - Note potential improvements'}
- Cover the ENTIRE file, don't skip sections
- Keep explanations concise (1-2 sentences)
- Maximum 25 annotations`

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    })

    let text = response.text || ''
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()

    let result: any = { annotations: [], fileSummary: '' }
    try {
      result = JSON.parse(text)
    } catch {
      const match = text.match(/\{[\s\S]*\}/)
      if (match) result = JSON.parse(match[0])
    }

    return Response.json(result)
  } catch (error: any) {
    console.error('Code Playground API error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
