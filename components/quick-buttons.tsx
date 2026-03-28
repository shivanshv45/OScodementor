"use client"

import { useState, useEffect } from "react"



interface QuickButtonsProps {
  onButtonClick: (question: string) => void
  selectedFile: string | null
  onOnboardMe?: () => void
  onBugRadar?: () => void
  onCodePlayground?: () => void
  onNeuralWeb?: () => void
}

interface QuickButton {
  label: string
  question: string
  special?: string
}

export default function QuickButtons({ onButtonClick, selectedFile, onOnboardMe, onBugRadar, onCodePlayground, onNeuralWeb }: QuickButtonsProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    if (showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [showTooltip])

  const buttons: QuickButton[] = [
    {
      label: "Neural Web",
      question: "",
      special: "neuralweb",
    },
    {
      label: "Onboard Me",
      question: "",
      special: "onboard",
    },
    {
      label: "Bug Radar",
      question: "",
      special: "bugradar",
    },
    {
      label: selectedFile ? "Playground" : "Playground — Open a file first",
      question: "",
      special: "playground",
    },
  ]

  const handleClick = (btn: QuickButton) => {
    if (btn.special === 'onboard' && onOnboardMe) return onOnboardMe()
    if (btn.special === 'bugradar' && onBugRadar) return onBugRadar()
    if (btn.special === 'playground') {
      if (!selectedFile) {
        setShowTooltip(true)
        return
      }
      if (onCodePlayground) return onCodePlayground()
    }
    if (btn.special === 'neuralweb' && onNeuralWeb) return onNeuralWeb()
  }

  return (
    <div className="relative">
      {showTooltip && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap animate-pulse"
          style={{ background: 'rgba(147, 51, 234, 0.15)', border: '1px solid rgba(147, 51, 234, 0.3)', color: '#c084fc' }}>
          ↗ Open a file from the explorer first
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
      {buttons.map((btn, idx) => {
        const needsFile = btn.special === 'playground' && !selectedFile;

        return (
          <button
            key={idx}
            onClick={() => handleClick(btn)}
            className={`console-text rounded-md px-3 py-2 text-xs font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${needsFile ? 'opacity-50 border border-purple-500/20 bg-purple-500/5 text-purple-400/60 hover:opacity-70 hover:bg-purple-500/10 active:scale-95' :
                btn.special === 'onboard' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95'
                  : btn.special === 'bugradar' ? 'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-95'
                    : btn.special === 'playground' ? 'border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 active:scale-95'
                      : btn.special === 'neuralweb' ? 'border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 active:scale-95'
                        : 'border-gray-700 bg-gray-800'
              }`}
            title={needsFile ? "Select a file first to use Playground" : btn.label}
          >
            <span>{btn.label}</span>
          </button>
        )
      })}
      </div>
    </div>
  )
}
