"use client"

import { useState, useEffect } from "react"
import { Play, BookOpen, Clock, ChevronRight, Loader2, X, CheckCircle2 } from "lucide-react"

interface OnboardStep {
    step: number
    title: string
    file: string
    why: string
    keyThings: string[]
    timeEstimate: string
}

interface OnboardMeProps {
    repoUrl: string
    repoName: string
    onFileSelect: (filePath: string) => void
    onClose: () => void
}

export default function OnboardMe({ repoUrl, repoName, onFileSelect, onClose }: OnboardMeProps) {
    const [steps, setSteps] = useState<OnboardStep[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [currentStep, setCurrentStep] = useState(0)
    const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

    useEffect(() => {
        const cached = localStorage.getItem(`codementor_onboard_${repoUrl}`)
        if (cached) {
            try {
                const data = JSON.parse(cached)
                if (data.steps && data.steps.length > 0) {
                    setSteps(data.steps)
                }
            } catch (e) { }
        }
    }, [repoUrl])

    const generateOnboarding = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/onboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setSteps(data.steps || [])
            setCurrentStep(0)
            setCompletedSteps(new Set())
            localStorage.setItem(`codementor_onboard_${repoUrl}`, JSON.stringify(data))
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const markComplete = (stepIdx: number) => {
        setCompletedSteps(prev => {
            const next = new Set(prev)
            next.add(stepIdx)
            return next
        })
        if (stepIdx < steps.length - 1) setCurrentStep(stepIdx + 1)
    }

    const totalTime = steps.reduce((acc, s) => {
        const mins = parseInt(s.timeEstimate) || 5
        return acc + mins
    }, 0)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#0a0f1a] border border-emerald-500/30 rounded-xl w-[700px] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl shadow-emerald-500/10">
                {/* Header */}
                <div className="px-6 py-4 border-b border-emerald-500/20 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                            <BookOpen size={20} className="text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-emerald-400 font-mono font-bold text-lg">Onboard Me</h2>
                            <p className="text-xs text-gray-500 font-mono">Guided codebase walkthrough for {repoName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {steps.length === 0 && !loading && (
                        <div className="text-center py-12">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                                <BookOpen size={36} className="text-emerald-400" />
                            </div>
                            <h3 className="text-emerald-400 font-mono text-xl mb-2">Ready to explore?</h3>
                            <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                                AI will analyze the codebase and create a personalized reading order — from entry points to core logic.
                            </p>
                            <button
                                onClick={generateOnboarding}
                                className="px-6 py-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded-lg font-mono hover:bg-emerald-500/30 transition-all flex items-center gap-2 mx-auto"
                            >
                                <Play size={18} /> Generate Onboarding Guide
                            </button>
                            {error && <p className="text-red-400 text-xs mt-4 font-mono">{error}</p>}
                        </div>
                    )}

                    {loading && (
                        <div className="text-center py-16">
                            <Loader2 size={40} className="text-emerald-400 animate-spin mx-auto mb-4" />
                            <p className="text-emerald-400 font-mono text-sm">Analyzing codebase structure...</p>
                            <p className="text-gray-600 text-xs mt-1">This takes 10-15 seconds</p>
                        </div>
                    )}

                    {steps.length > 0 && (
                        <>
                            {/* Progress bar */}
                            <div className="mb-6">
                                <div className="flex items-center justify-between text-xs text-gray-500 font-mono mb-2">
                                    <span>{completedSteps.size}/{steps.length} steps completed</span>
                                    <span className="flex items-center gap-1"><Clock size={12} /> ~{totalTime} min total</span>
                                </div>
                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500 rounded-full"
                                        style={{ width: `${(completedSteps.size / steps.length) * 100}%` }}
                                    />
                                </div>
                            </div>

                            {/* Steps */}
                            <div className="space-y-3">
                                {steps.map((s, idx) => {
                                    const isActive = idx === currentStep
                                    const isDone = completedSteps.has(idx)
                                    return (
                                        <div
                                            key={idx}
                                            className={`border rounded-lg p-4 transition-all cursor-pointer ${isActive
                                                ? 'border-emerald-500/50 bg-emerald-500/5 shadow-lg shadow-emerald-500/5'
                                                : isDone
                                                    ? 'border-emerald-500/20 bg-emerald-500/5 opacity-70'
                                                    : 'border-gray-800 hover:border-gray-700'
                                                }`}
                                            onClick={() => setCurrentStep(idx)}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-mono font-bold ${isDone ? 'bg-emerald-500/30 text-emerald-300' : isActive ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/40' : 'bg-gray-800 text-gray-500'
                                                    }`}>
                                                    {isDone ? <CheckCircle2 size={16} /> : s.step}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="text-emerald-400 font-mono text-sm font-semibold">{s.title}</h4>
                                                        <span className="text-gray-600 text-xs font-mono flex items-center gap-1">
                                                            <Clock size={10} /> {s.timeEstimate}
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onFileSelect(s.file) }}
                                                        className="text-cyan-400 text-xs font-mono hover:underline mt-1 flex items-center gap-1"
                                                    >
                                                        <ChevronRight size={12} /> {s.file}
                                                    </button>

                                                    {isActive && (
                                                        <div className="mt-3 space-y-2 animate-in slide-in-from-top-2">
                                                            <p className="text-gray-400 text-xs">{s.why}</p>
                                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                                {s.keyThings.map((thing, i) => (
                                                                    <span key={i} className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono">
                                                                        {thing}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <div className="flex gap-2 mt-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onFileSelect(s.file) }}
                                                                    className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs rounded-md font-mono hover:bg-emerald-500/30 transition-colors"
                                                                >
                                                                    Open File
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); markComplete(idx) }}
                                                                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-md font-mono hover:bg-gray-700 transition-colors"
                                                                >
                                                                    Mark Done ✓
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
