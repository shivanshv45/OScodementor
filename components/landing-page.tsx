"use client"

import type React from "react"

import { useState } from "react"
import { ChevronRight, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface LandingPageProps {
  onRepoSubmit: (url: string) => void
}

export default function LandingPage({ onRepoSubmit }: LandingPageProps) {
  const [url, setUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    onRepoSubmit(url)
  }

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 opacity-5">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(0deg, transparent 24%, rgba(34, 197, 94, 0.1) 25%, rgba(34, 197, 94, 0.1) 26%, transparent 27%, transparent 74%, rgba(34, 197, 94, 0.1) 75%, rgba(34, 197, 94, 0.1) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(34, 197, 94, 0.1) 25%, rgba(34, 197, 94, 0.1) 26%, transparent 27%, transparent 74%, rgba(34, 197, 94, 0.1) 75%, rgba(34, 197, 94, 0.1) 76%, transparent 77%, transparent)",
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-3xl px-6 fade-in ">
        <div className="text-center mb-10 flex flex-col items-center gap-3">
          <div className="console-glow text-4xl md:text-6xl font-bold leading-tight">
            {"> CodeMentor OS"}
          </div>
          <p className="console-text text-muted-foreground max-w-2xl">
            {"$ AI-powered GitHub repository explorer — paste a repo URL and get assertive, code-grounded answers with a built-in file explorer."}
          </p>
          <div className="h-1 w-28 bg-accent/50 rounded-full mt-1" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 slide-up">
          <div className="console-border rounded-xl p-6 md:p-7 bg-card/60 backdrop-blur-sm hover-glow shadow-[0_0_60px_rgba(34,197,94,0.05)]">
            <label className="console-text text-accent mb-3 block">{"$ Enter GitHub Repository URL"}</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/username/repo"
              className="w-full console-input rounded-md px-4 py-3 mb-4"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className="w-full console-button rounded-md py-3 font-mono font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/50"
            >
              {isLoading ? (
                <>
                  <span className="inline-block animate-spin">⟳</span>
                  {"Initializing..."}
                </>
              ) : (
                <>
                  {"Explore Repository"}
                  <ChevronRight size={18} />
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div className="console-border rounded-md p-3 bg-card/40">
              <div className="text-accent text-sm font-medium">Assertive AI</div>
              <div className="console-text text-xs text-muted-foreground">Direct, code-grounded answers without hedging.</div>
            </div>
            <div className="console-border rounded-md p-3 bg-card/40">
              <div className="text-accent text-sm font-medium">Repo Explorer</div>
              <div className="console-text text-xs text-muted-foreground">Browse files, context-aware responses.</div>
            </div>
            <div className="console-border rounded-md p-3 bg-card/40">
              <div className="text-accent text-sm font-medium">Quick Actions</div>
              <div className="console-text text-xs text-muted-foreground">Summaries, architecture, contribution tips.</div>
            </div>
          </div>

          <div className="console-text text-muted-foreground/60 text-xs mt-5">
            <p className="mb-2">{"// Example repositories:"}</p>
            <div className="flex flex-wrap gap-2">
              {["https://github.com/EsotericSoftware/kryo","https://github.com/pkunk/pq","https://github.com/sansan0/TrendRadar"].map(example => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setUrl(example)}
                  className="px-2.5 py-1 rounded-md console-border bg-card/40 hover:bg-card/60 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>

      <div className="fixed right-4 bottom-4 z-20">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="console-button px-2 py-1.5 text-xs rounded-sm flex items-center gap-1"
              aria-label="About CodeMentor"
            >
              <Info size={14} /> Info
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={8}>
            <div className="max-w-xs text-left">
              <div className="font-medium">What is this?</div>
              <div className="opacity-90">
                CodeMentor explains GitHub repos like a mentor, with smart search, file explorer, and AI chat.
                Try to use repos with not more than 500 to 600 files for handling timeout issues .
                OS stands for OPEN-SOURCE.
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
