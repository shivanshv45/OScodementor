"use client"

import { useState, useEffect } from "react"
import { Shield, AlertTriangle, AlertCircle, Info, X, Loader2, Zap, Bug } from "lucide-react"

interface BugIssue {
    file: string
    line: number
    severity: "critical" | "high" | "medium" | "low"
    category: string
    title: string
    description: string
    suggestion: string
}

interface BugRadarProps {
    repoUrl: string
    repoName: string
    onFileSelect: (filePath: string) => void
    onClose: () => void
}

const severityConfig = {
    critical: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: AlertCircle, glow: 'shadow-red-500/20' },
    high: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', icon: AlertTriangle, glow: 'shadow-orange-500/20' },
    medium: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: Info, glow: 'shadow-yellow-500/20' },
    low: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Info, glow: 'shadow-blue-500/20' },
}

const categoryIcons: Record<string, string> = {
    security: '🔒', bug: '🐛', performance: '⚡', 'anti-pattern': '🔄',
    'code-smell': '👃', 'error-handling': '⚠️',
}

export default function BugRadar({ repoUrl, repoName, onFileSelect, onClose }: BugRadarProps) {
    const [issues, setIssues] = useState<BugIssue[]>([])
    const [summary, setSummary] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [expandedIssue, setExpandedIssue] = useState<number | null>(null)
    const [filter, setFilter] = useState<string>('all')

    useEffect(() => {
        const cached = localStorage.getItem(`codementor_bugradar_${repoUrl}`)
        if (cached) {
            try {
                const data = JSON.parse(cached)
                if (data.issues && data.issues.length > 0) {
                    setIssues(data.issues)
                    setSummary(data.summary || '')
                }
            } catch (e) { }
        }
    }, [repoUrl])

    const runScan = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/bug-radar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setIssues(data.issues || [])
            setSummary(data.summary || '')
            localStorage.setItem(`codementor_bugradar_${repoUrl}`, JSON.stringify(data))
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const filtered = filter === 'all' ? issues : issues.filter(i => i.severity === filter)
    const counts = {
        critical: issues.filter(i => i.severity === 'critical').length,
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length,
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#0a0f1a] border border-red-500/20 rounded-xl w-[750px] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl shadow-red-500/10">
                {/* Header */}
                <div className="px-6 py-4 border-b border-red-500/20 flex items-center justify-between bg-gradient-to-r from-red-500/10 to-transparent">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                            <Shield size={20} className="text-red-400" />
                        </div>
                        <div>
                            <h2 className="text-red-400 font-mono font-bold text-lg">Bug Radar</h2>
                            <p className="text-xs text-gray-500 font-mono">Security & code quality scanner for {repoName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors p-1"><X size={20} /></button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {issues.length === 0 && !loading && (
                        <div className="text-center py-12">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center relative">
                                <Bug size={36} className="text-red-400" />
                                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500/40 flex items-center justify-center">
                                    <Zap size={12} className="text-red-200" />
                                </div>
                            </div>
                            <h3 className="text-red-400 font-mono text-xl mb-2">Scan for Issues</h3>
                            <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                                AI will analyze source files for bugs, security vulnerabilities, anti-patterns, and code smells.
                            </p>
                            <button
                                onClick={runScan}
                                className="px-6 py-3 bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg font-mono hover:bg-red-500/30 transition-all flex items-center gap-2 mx-auto"
                            >
                                <Shield size={18} /> Run Security Scan
                            </button>
                            {error && <p className="text-red-400 text-xs mt-4 font-mono">{error}</p>}
                        </div>
                    )}

                    {loading && (
                        <div className="text-center py-16">
                            <Loader2 size={40} className="text-red-400 animate-spin mx-auto mb-4" />
                            <p className="text-red-400 font-mono text-sm">Scanning codebase for issues...</p>
                            <p className="text-gray-600 text-xs mt-1">Analyzing files for bugs, security issues, and anti-patterns</p>
                        </div>
                    )}

                    {issues.length > 0 && (
                        <>
                            {/* Summary */}
                            <div className="mb-4 p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
                                <p className="text-gray-400 text-xs font-mono">{summary}</p>
                            </div>

                            {/* Severity filter pills */}
                            <div className="flex gap-2 mb-4 flex-wrap">
                                <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${filter === 'all' ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-800 text-gray-500 hover:border-gray-700'}`}>
                                    All ({issues.length})
                                </button>
                                {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
                                    counts[sev] > 0 && (
                                        <button key={sev} onClick={() => setFilter(sev)} className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${filter === sev ? `${severityConfig[sev].bg} ${severityConfig[sev].border} ${severityConfig[sev].color}` : 'border-gray-800 text-gray-500 hover:border-gray-700'}`}>
                                            {sev} ({counts[sev]})
                                        </button>
                                    )
                                ))}
                            </div>

                            {/* Issue cards */}
                            <div className="space-y-2">
                                {filtered.map((issue, idx) => {
                                    const config = severityConfig[issue.severity] || severityConfig.low
                                    const Icon = config.icon
                                    const isExpanded = expandedIssue === idx
                                    return (
                                        <div
                                            key={idx}
                                            onClick={() => setExpandedIssue(isExpanded ? null : idx)}
                                            className={`border rounded-lg p-3 cursor-pointer transition-all ${config.border} ${isExpanded ? `${config.bg} shadow-lg ${config.glow}` : 'hover:bg-gray-900/50'}`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <Icon size={16} className={`${config.color} mt-0.5 shrink-0`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-mono">{categoryIcons[issue.category] || '📋'}</span>
                                                        <h4 className={`${config.color} font-mono text-sm font-semibold`}>{issue.title}</h4>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onFileSelect(issue.file) }}
                                                            className="text-cyan-400 text-xs font-mono hover:underline"
                                                        >{issue.file}</button>
                                                        <span className="text-gray-600 text-xs font-mono">:L{issue.line}</span>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className="mt-3 space-y-2 animate-in slide-in-from-top-2">
                                                            <p className="text-gray-400 text-xs">{issue.description}</p>
                                                            <div className="p-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md">
                                                                <p className="text-emerald-400 text-xs font-mono">💡 {issue.suggestion}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`px-2 py-0.5 rounded text-xs font-mono ${config.bg} ${config.color} ${config.border} border`}>
                                                    {issue.severity}
                                                </span>
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
