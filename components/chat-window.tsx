"use client"

import React, { useState, useRef, useEffect } from "react"
import { Send, MessageCircle, Download } from "lucide-react"
import QuickButtons from "./quick-buttons"
import { queryAI } from "@/lib/api"
import IndexingProgress from "./indexing-progress"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface ChatMessage {
  id: string
  type: "user" | "ai"
  content: string
  timestamp: Date
  context?: string
}

interface RepoData {
  name: string
  description: string
  stars: number
  languages: string[]
  files: Array<{
    path: string
    type: "file" | "folder"
    children?: Array<{
      path: string
      type: "file" | "folder"
      children?: Array<{
        path: string
        type: "file" | "folder"
      }>
    }>
  }>
  issues: Array<{ title: string; url: string; labels: string[] }>
}

interface ChatWindowProps {
  repoData: RepoData
  selectedFile: string | null
  skillLevel: "beginner" | "intermediate" | "expert"
  repoUrl?: string
  isIndexing?: boolean
  repoId?: string
  onIndexingComplete?: () => void
  onError?: (error: string) => void
  onClearFileContext?: () => void
  onOnboardMe?: () => void
  onBugRadar?: () => void
  onCodePlayground?: () => void
  onNeuralWeb?: () => void
}

export default function ChatWindow({ repoData, selectedFile, skillLevel, repoUrl, isIndexing, repoId, onIndexingComplete, onError, onClearFileContext, onOnboardMe, onBugRadar, onCodePlayground, onNeuralWeb }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      type: "ai",
      content: `Repository "${repoData.name}" loaded. Ask me anything about this codebase!`,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [insights, setInsights] = useState<{ summary?: string; quickstart?: string; contributionGuide?: string } | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const loadInsights = async () => {
      try {
        const url = repoUrl || sessionStorage.getItem('currentRepoUrl') || ''
        if (!url) return
        const res = await fetch('/api/repository-insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoUrl: url })
        })
        if (!res.ok) return
        const data = await res.json()
        if (data?.insights) {
          setInsights({
            summary: data.insights.repo_summary || undefined,
            quickstart: data.insights.quickstart || undefined,
            contributionGuide: data.insights.contribution_guide || undefined
          })
        }
      } catch { }
    }
    loadInsights()
  }, [repoUrl])

  const handleSendMessage = async (question: string) => {
    if (!question.trim() || isIndexing) return

    // Add user message with current file context
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: question,
      timestamp: new Date(),
      context: selectedFile || undefined,
    }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Build context-aware question
      let contextualQuestion = question
      if (selectedFile) {
        contextualQuestion = `Regarding the file "${selectedFile}": ${question}`
      }

      const conversationHistory = messages.slice(-5).map(m => ({
        role: m.type === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
      const response = await queryAI(contextualQuestion, selectedFile, skillLevel, repoUrl, conversationHistory)
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: response,
        timestamp: new Date(),
        context: selectedFile || undefined,
      }
      setMessages((prev) => [...prev, aiMessage])
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: "Sorry, I encountered an error while processing your question. Please try again.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    }
    setIsLoading(false)
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }

  const downloadChat = () => {
    const chatText = messages.map(msg => {
      const timestamp = formatTime(msg.timestamp)
      const role = msg.type === 'user' ? 'User' : 'AI'
      const context = msg.context ? ` (${msg.context.split('/').pop()})` : ''
      return `${role}${context} [${timestamp}]:\n${msg.content}\n`
    }).join('\n')

    const blob = new Blob([chatText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-${repoData.name}-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Indexing Progress */}
      {isIndexing && repoId && (
        <div className="p-4 border-b console-border">
          <IndexingProgress
            repoId={repoId}
            onComplete={() => {
              // Soft refresh: keep user in context instead of full reload
              try {
                const url = sessionStorage.getItem('currentRepoUrl') || ''
                if (url) {
                  // Trigger a client-side fetch to populate from cache
                  fetch('/api/fetch-repo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repoUrl: url })
                  }).then(() => {
                    // Fallback to reload only if necessary
                    // The RepoConsole's parent will update state on its own flow
                  })
                }
                // Notify parent to re-fetch repo data and re-enable UI
                onIndexingComplete?.()
              } catch { }
            }}
            onError={(error) => {
              console.error('Indexing error:', error)
              // Prevent unhandled errors from crashing the UI
              try {
                onError?.(error)
              } catch (e) {
                console.error('Error in onError handler:', e)
              }
            }}
          />
        </div>
      )}

      {/* Header with Download Button */}
      <div className="flex items-center justify-between p-4 border-b console-border bg-card/30">
        <div className="console-text text-sm font-medium">Chat with AI</div>
        <button
          onClick={downloadChat}
          disabled={messages.length <= 1}
          className="console-button flex items-center gap-2 px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          title="Download chat history"
        >
          <Download size={14} />
          Download
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 1 && !isIndexing && (
          <div className="flex items-center justify-center h-full text-center">
            <div className="space-y-3">
              <MessageCircle size={32} className="text-accent/40 mx-auto" />
              <p className="console-text text-muted-foreground text-sm">
                {"Ask questions about the repository or select a file to get started"}
              </p>
              {insights && insights.summary && (
                <div className="mt-4 text-left max-w-lg mx-auto">
                  <div className="console-text text-xs bg-card/40 border border-accent/20 rounded-lg p-3">
                    <span className="text-accent font-medium">📋 Repository Summary:</span>
                    <div className="mt-1 text-muted-foreground">
                      {insights.summary.slice(0, 200)}{insights.summary.length > 200 ? '…' : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {isIndexing && (
          <div className="flex items-center justify-center h-full text-center">
            <div className="space-y-3">
              <MessageCircle size={32} className="text-accent/40 mx-auto animate-pulse" />
              <p className="console-text text-muted-foreground text-sm">
                {"Indexing repository... Please wait while we build the search index"}
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
            <div className="flex flex-col gap-1 max-w-xs lg:max-w-md">
              <div
                className={`console-text rounded-lg px-4 py-3 ${msg.type === "user"
                  ? "bg-accent/20 border border-accent/50 text-foreground"
                  : "bg-card/60 border border-accent/30 text-foreground"
                  }`}
              >
                {msg.type === "ai" && <span className="text-accent mr-2">{"> "}</span>}
                {msg.type === "ai" ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: ({ className, children, ...props }: any) => {
                          // In react-markdown v10+, inline code doesn't have className
                          const isCodeBlock =
                            className?.includes('language-') ||
                            String(children).includes('\n') ||
                            String(children).length > 50

                          return isCodeBlock ? (
                            <pre className="bg-muted/20 border border-accent/30 rounded-md p-3 my-2 overflow-x-auto">
                              <code className={className} {...props}>
                                {children}
                              </code>
                            </pre>
                          ) : (
                            <code className="bg-accent/20 text-accent px-1.5 py-0.5 rounded text-sm" {...props}>
                              {children}
                            </code>
                          )
                        },
                        // Prevent paragraph nesting issues by using div for paragraphs that might contain block elements
                        p: ({ children, ...props }) => {
                          return <div className="mb-2 last:mb-0" {...props}>{children}</div>
                        },
                        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                        li: ({ children }) => <li className="text-sm">{children}</li>,
                        strong: ({ children }) => <strong className="text-accent font-semibold">{children}</strong>,
                        em: ({ children }) => <em className="text-accent/80 italic">{children}</em>,
                        h1: ({ children }) => <h1 className="text-lg font-bold text-accent mb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-base font-bold text-accent mb-2">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-bold text-accent mb-1">{children}</h3>,
                        blockquote: ({ children }) => <blockquote className="border-l-4 border-accent/50 pl-4 my-2 text-muted-foreground">{children}</blockquote>
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                )}
              </div>
              <div className="flex items-center gap-2 px-2">
                <span className="console-text text-xs text-muted-foreground/60">{formatTime(msg.timestamp)}</span>
                {msg.context && (
                  <span className="console-text text-xs text-accent/60 bg-accent/10 px-2 py-0.5 rounded">
                    {msg.context.split("/").pop()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="console-text text-muted-foreground animate-pulse flex items-center gap-2">
              <span>{"> Processing"}</span>
              <span className="inline-block animate-spin">⟳</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Buttons */}
      <div className="px-6 py-4 console-border border-t bg-card/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="console-text text-xs text-muted-foreground">Quick Actions</span>
        </div>
        <QuickButtons
          onButtonClick={handleSendMessage}
          selectedFile={selectedFile}
          onOnboardMe={onOnboardMe}
          onBugRadar={onBugRadar}
          onCodePlayground={onCodePlayground}
          onNeuralWeb={onNeuralWeb}
        />
      </div>

      {/* Input Area */}
      <div className="px-6 py-4 console-border border-t bg-card/50">
        {/* File Context Badge */}
        {selectedFile && (
          <div className="mb-3 flex items-center gap-2">
            <span className="console-text text-xs text-accent bg-accent/10 px-2 py-1 rounded flex items-center gap-1">
              📄 {selectedFile.split('/').pop()}
            </span>
            <button
              onClick={() => onClearFileContext?.()}
              className="console-text text-xs text-muted-foreground hover:text-accent transition-colors"
              title="Clear file context"
            >
              ✕
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage(input)
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isIndexing ? "Indexing in progress..." : selectedFile ? `Ask about ${selectedFile.split('/').pop()}...` : "Ask about the code..."}
            className="flex-1 console-input rounded-md px-4 py-2"
            disabled={isLoading || isIndexing}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || isIndexing}
            className="console-button rounded-md px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:bg-accent/90 active:scale-95"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
