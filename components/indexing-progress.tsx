"use client"

import { useState, useEffect } from "react"
import { Loader2, CheckCircle, AlertCircle, Database, Search, Zap } from "lucide-react"

// Add shimmer animation keyframes
const shimmerStyle = `
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .animate-shimmer {
    animation: shimmer 2s infinite;
  }
`

interface IndexingProgressProps {
  repoId: string
  onComplete?: () => void
  onError?: (error: string) => void
}

interface IndexingStatus {
  status: 'pending' | 'indexing' | 'completed' | 'failed'
  progress: number
  currentStep: string
  totalFiles: number
  indexedFiles: number
  errorMessage?: string
}

export default function IndexingProgress({ repoId, onComplete, onError }: IndexingProgressProps) {
  const [status, setStatus] = useState<IndexingStatus>({
    status: 'pending',
    progress: 0,
    currentStep: 'Starting...',
    totalFiles: 0,
    indexedFiles: 0
  })
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (!repoId) return

    const checkStatus = async () => {
      try {
        const response = await fetch('/api/index-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoId })
        })

        if (!response.ok) {
          throw new Error('Failed to check indexing status')
        }

        const data = await response.json()
        
        if (data.found) {
          setStatus({
            status: data.status,
            progress: data.progress,
            currentStep: data.currentStep,
            totalFiles: data.totalFiles,
            indexedFiles: data.indexedFiles,
            errorMessage: data.errorMessage
          })

          // Handle completion
          if (data.status === 'completed') {
            setTimeout(() => {
              setIsVisible(false)
              onComplete?.()
            }, 3000) // Show success message for 3 seconds
          }

          // Handle error
          if (data.status === 'failed') {
            onError?.(data.errorMessage || 'Indexing failed')
          }
        } else {
          // If no status found, assume indexing is starting
          setStatus(prev => ({
            ...prev,
            status: 'indexing',
            currentStep: 'Starting indexing process... please be patient might take 2-10 mins to complete... ',
            progress: 5
          }))
        }
      } catch (error) {
        console.error('Error checking indexing status:', error)
        // Prevent unhandled errors from crashing the UI
        try {
          // Don't hide on error, keep trying
        } catch (e) {
          console.error('Error in error handler:', e)
        }
      }
    }

    // Check status immediately
    checkStatus()

    // Set up polling every 1.5 seconds for more responsive updates
    const interval = setInterval(checkStatus, 1500)

    return () => clearInterval(interval)
  }, [repoId, onComplete, onError])

  if (!isVisible) return null

  const getStatusIcon = () => {
    switch (status.status) {
      case 'pending':
        return <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />
      case 'indexing':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
    }
  }

  const getStatusColor = () => {
    switch (status.status) {
      case 'pending':
        return 'border-yellow-500/30 bg-yellow-500/10'
      case 'indexing':
        return 'border-blue-500/30 bg-blue-500/10'
      case 'completed':
        return 'border-green-500/30 bg-green-500/10'
      case 'failed':
        return 'border-red-500/30 bg-red-500/10'
      default:
        return 'border-gray-500/30 bg-gray-500/10'
    }
  }

  const getStepIcon = (step: string) => {
    if (step.includes('GitHub')) return <Database className="w-4 h-4" />
    if (step.includes('Analyzing') || step.includes('structure')) return <Search className="w-4 h-4" />
    if (step.includes('Indexing') || step.includes('files')) return <Zap className="w-4 h-4" />
    return <Loader2 className="w-4 h-4" />
  }

  return (
    <>
      <style>{shimmerStyle}</style>
      <div className={`console-border border rounded-lg p-6 ${getStatusColor()} mb-6`}>
      <div className="flex items-center gap-3 mb-4">
        {getStatusIcon()}
        <div className="flex-1">
          <h3 className="console-text font-medium text-lg">
            {status.status === 'completed' ? 'Repository Ready!' : 'Indexing Repository...'}
          </h3>
          <p className="console-text text-sm text-muted-foreground">
            {status.currentStep}
            {status.status === 'indexing' && status.progress <= 10 && (
              <span className="inline-block ml-2 animate-pulse">⏳</span>
            )}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-sm console-text text-muted-foreground mb-2">
          <span className="font-medium">{status.progress}%</span>
          <span className="font-medium">{status.indexedFiles}/{status.totalFiles} files</span>
        </div>
        <div className="w-full bg-muted/20 rounded-full h-3 relative overflow-hidden">
          <div 
            className="bg-accent h-3 rounded-full transition-all duration-500 ease-out relative"
            style={{ width: `${status.progress}%` }}
          >
            {/* Animated shimmer effect when stuck at low progress */}
            {status.status === 'indexing' && status.progress <= 10 && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            )}
          </div>
          {/* Subtle pulse animation for the progress bar track when stuck */}
          {status.status === 'indexing' && status.progress <= 10 && (
            <div className="absolute inset-0 bg-accent/20 animate-pulse" />
          )}
        </div>
      </div>

      {/* Status Steps */}
      <div className="space-y-3">
        {[
          { 
            key: 'fetching', 
            label: 'Fetching from GitHub...', 
            active: status.currentStep.includes('GitHub') || status.currentStep.includes('Fetching'),
            completed: status.progress > 20
          },
          { 
            key: 'analyzing', 
            label: 'Analyzing structure...', 
            active: status.currentStep.includes('Analyzing') || status.currentStep.includes('structure'),
            completed: status.progress > 40
          },
          { 
            key: 'indexing', 
            label: 'Building search index...', 
            active: status.currentStep.includes('Indexing') || status.currentStep.includes('files'),
            completed: status.status === 'completed'
          },
          { 
            key: 'completed', 
            label: 'Repository ready!', 
            active: status.status === 'completed',
            completed: status.status === 'completed'
          }
        ].map((step, index) => {
          // Ensure only one step is active at a time
          const isActive = step.active && !step.completed
          const isCompleted = step.completed
          const isPending = !isActive && !isCompleted
          
          return (
          <div 
            key={step.key}
            className={`flex items-center gap-3 text-sm transition-all duration-500 ${
              isActive 
                ? 'console-text text-accent font-medium' 
                : isCompleted
                  ? 'console-text text-green-400'
                  : 'console-text text-muted-foreground/40'
            }`}
          >
            <div className={`w-5 h-5 flex items-center justify-center ${
              isActive ? 'text-accent' : isCompleted ? 'text-green-400' : 'text-muted-foreground/40'
            }`}>
              {isActive ? getStepIcon(step.label) : (
                isCompleted ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <div className="w-3 h-3 rounded-full bg-muted-foreground/20" />
                )
              )}
            </div>
            <span>{step.label}</span>
          </div>
          )
        })}
      </div>

      {/* Error Message */}
      {status.status === 'failed' && status.errorMessage && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded console-text text-sm text-red-400">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          {status.errorMessage}
        </div>
      )}

      {/* Success Message */}
      {status.status === 'completed' && (
        <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg console-text text-sm text-green-400">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Repository indexed successfully!</span>
          </div>
          <p>You can now ask questions about the code and get intelligent answers.</p>
        </div>
      )}

      {/* Helpful message when stuck at low progress */}
      {status.status === 'indexing' && status.progress <= 15 && (
        <div className="mt-3 space-y-2">
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded console-text text-xs text-blue-400">
            <p className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Initial setup may take a moment on first run. This is normal and indexing will continue...</span>
            </p>
          </div>
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded console-text text-xs text-yellow-400">
            <p className="flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              <span>Note: Indexing multiple repositories simultaneously may hit GitHub API rate limits, which can slow down the indexing process. Please be patient.</span>
            </p>
          </div>
        </div>
      )}

      {/* Progress Animation */}
      {status.status === 'indexing' && (
        <div className="mt-4 flex items-center justify-center">
          <div className="flex space-x-2">
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
            <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
