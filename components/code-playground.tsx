"use client"

import { useState, useEffect } from "react"
import { Sparkles, Loader2, X, Lightbulb } from "lucide-react"

interface Annotation {
    startLine: number
    endLine: number
    type: string
    label: string
    explanation: string
    color: string
}

interface CodePlaygroundProps {
    filePath: string
    code: string
    skillLevel: "beginner" | "intermediate" | "expert"
    onClose: () => void
}

export default function CodePlayground({ filePath, code, skillLevel, onClose }: CodePlaygroundProps) {
    const [annotations, setAnnotations] = useState<Annotation[]>([])
    const [fileSummary, setFileSummary] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [hoveredAnnotation, setHoveredAnnotation] = useState<number | null>(null)

    const lines = code.split('\n')
    const repoUrl = typeof window !== 'undefined' ? sessionStorage.getItem('currentRepoUrl') || 'repo' : 'repo'

    useEffect(() => {
        const cached = localStorage.getItem(`codementor_playground_${repoUrl}_${filePath}_${skillLevel}`)
        if (cached) {
            try {
                const data = JSON.parse(cached)
                if (data.annotations && data.annotations.length > 0) {
                    setAnnotations(data.annotations)
                    setFileSummary(data.fileSummary || '')
                }
            } catch (e) { }
        }
    }, [repoUrl, filePath, skillLevel])

    const generateAnnotations = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/code-playground', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath, code, skillLevel })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setAnnotations(data.annotations || [])
            setFileSummary(data.fileSummary || '')
            localStorage.setItem(`codementor_playground_${repoUrl}_${filePath}_${skillLevel}`, JSON.stringify(data))
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const getAnnotationForLine = (lineNum: number): Annotation | null => {
        return annotations.find(a => lineNum >= a.startLine && lineNum <= a.endLine) || null
    }

    const isAnnotationStart = (lineNum: number): Annotation | null => {
        return annotations.find(a => lineNum === a.startLine) || null
    }

    return (
        <div className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-sm">
            <div className="flex-1 flex flex-col bg-[#0a0f1a] m-4 rounded-xl border border-purple-500/30 overflow-hidden shadow-2xl shadow-purple-500/10">
                {/* Header */}
                <div className="px-6 py-3 border-b border-purple-500/20 flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                            <Sparkles size={16} className="text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-purple-400 font-mono font-bold text-sm">Code Playground</h2>
                            <p className="text-xs text-gray-500 font-mono">{filePath}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {annotations.length === 0 && !loading && (
                            <button
                                onClick={generateAnnotations}
                                className="px-4 py-1.5 bg-purple-500/20 border border-purple-500/40 text-purple-400 rounded-md font-mono text-xs hover:bg-purple-500/30 transition-all flex items-center gap-2"
                            >
                                <Sparkles size={14} /> Annotate Code
                            </button>
                        )}
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1"><X size={18} /></button>
                    </div>
                </div>

                {loading && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Loader2 size={32} className="text-purple-400 animate-spin mx-auto mb-3" />
                            <p className="text-purple-400 font-mono text-sm">Generating annotations...</p>
                        </div>
                    </div>
                )}

                {!loading && (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Code panel */}
                        <div className="flex-1 overflow-auto font-mono text-xs">
                            {fileSummary && (
                                <div className="px-4 py-2 bg-purple-500/5 border-b border-purple-500/20 text-purple-300 text-xs flex items-center gap-2">
                                    <Lightbulb size={12} /> {fileSummary}
                                </div>
                            )}
                            <table className="w-full border-collapse">
                                <tbody>
                                    {lines.map((line, idx) => {
                                        const lineNum = idx + 1
                                        const ann = getAnnotationForLine(lineNum)
                                        const annStart = isAnnotationStart(lineNum)
                                        const isHovered = hoveredAnnotation !== null && ann && annotations[hoveredAnnotation] === ann

                                        return (
                                            <tr
                                                key={idx}
                                                className={`transition-colors ${isHovered ? 'bg-white/5' : ''}`}
                                                onMouseEnter={() => {
                                                    if (ann) {
                                                        const annIdx = annotations.indexOf(ann)
                                                        setHoveredAnnotation(annIdx)
                                                    }
                                                }}
                                                onMouseLeave={() => setHoveredAnnotation(null)}
                                            >
                                                {/* Line number */}
                                                <td className="px-3 py-0 text-right text-gray-600 select-none w-12 align-top">
                                                    {lineNum}
                                                </td>
                                                {/* Color bar */}
                                                <td className="w-1 p-0">
                                                    {ann && (
                                                        <div className="w-1 h-full" style={{ backgroundColor: ann.color + '60' }} />
                                                    )}
                                                </td>
                                                {/* Code */}
                                                <td className="px-3 py-0 whitespace-pre text-gray-300">
                                                    {line || ' '}
                                                </td>
                                                {/* Annotation label on first line */}
                                                <td className="px-2 py-0 w-[200px]">
                                                    {annStart && (
                                                        <span
                                                            className="text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap"
                                                            style={{
                                                                backgroundColor: annStart.color + '15',
                                                                borderColor: annStart.color + '40',
                                                                color: annStart.color,
                                                            }}
                                                        >
                                                            {annStart.label}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Annotation sidebar */}
                        {annotations.length > 0 && (
                            <div className="w-[300px] border-l border-purple-500/20 overflow-y-auto bg-gray-900/30 p-3 space-y-2">
                                <h3 className="text-purple-400 font-mono text-xs font-bold mb-3">Annotations ({annotations.length})</h3>
                                {annotations.map((ann, idx) => (
                                    <div
                                        key={idx}
                                        className={`p-2.5 rounded-lg border transition-all cursor-pointer ${hoveredAnnotation === idx
                                            ? 'shadow-lg'
                                            : ''
                                            }`}
                                        style={{
                                            backgroundColor: hoveredAnnotation === idx ? ann.color + '10' : 'transparent',
                                            borderColor: hoveredAnnotation === idx ? ann.color + '40' : '#1f2937',
                                        }}
                                        onMouseEnter={() => setHoveredAnnotation(idx)}
                                        onMouseLeave={() => setHoveredAnnotation(null)}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ann.color }} />
                                            <span className="font-mono text-xs font-bold" style={{ color: ann.color }}>{ann.label}</span>
                                            <span className="text-gray-600 text-[10px] font-mono ml-auto">L{ann.startLine}-{ann.endLine}</span>
                                        </div>
                                        <p className="text-gray-400 text-[11px] leading-relaxed">{ann.explanation}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-red-400 text-xs font-mono">{error}</div>
                )}
            </div>
        </div>
    )
}
