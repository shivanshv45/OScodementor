"use client"

import type React from "react"

import { useState } from "react"
import { ChevronRight, ChevronDown, Folder, Search, X, Download } from "lucide-react"
import CodeTab from "./code-tab"

interface FileItem {
  path: string
  type: "file" | "folder"
  children?: FileItem[]
}

interface FileExplorerProps {
  files: FileItem[]
  onFileSelect: (file: string | null) => void
  selectedFile: string | null
  onExplainFile?: (filePath: string, code: string) => void
  repoUrl?: string
}

interface TreeNode {
  name: string
  path: string
  type: "file" | "folder"
  children?: TreeNode[]
}

export default function FileExplorer({ files, onFileSelect, selectedFile, onExplainFile, repoUrl }: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>("tree.exe")
  const [searchQuery, setSearchQuery] = useState("")

  // Convert GitHub hierarchical data to TreeNode format
  const convertToTreeNodes = (items: FileItem[]): TreeNode[] => {
    return items.map((item) => {
      const node: TreeNode = {
        name: item.path.split('/').pop() || item.path,
        path: item.path,
        type: item.type,
        children: item.children ? convertToTreeNodes(item.children) : undefined
      }
      return node
    })
  }

  const tree = convertToTreeNodes(files)

  const toggleFolder = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedFolders(newExpanded)
  }

  const handleFileClick = (path: string) => {
    onFileSelect(path)
    if (!openTabs.includes(path)) {
      setOpenTabs([...openTabs, path])
    }
    setActiveTab(path)
  }

  const closeTab = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const newTabs = openTabs.filter((t) => t !== path)
    setOpenTabs(newTabs)
    if (activeTab === path) {
      // Switch to tree.exe if closing the active tab
      setActiveTab(newTabs.length > 0 ? newTabs[newTabs.length - 1] : "tree.exe")
      // Clear file context when closing the active tab
      if (newTabs.length === 0) {
        onFileSelect(null)
      }
    }
  }

  const downloadTreeStructure = () => {
    const generateTreeText = (nodes: TreeNode[], depth = 0): string => {
      let result = ''
      const indent = '  '.repeat(depth)
      
      nodes.forEach(node => {
        const icon = node.type === 'folder' ? '📁' : getFileIcon(node.name)
        const type = node.type === 'folder' ? 'folder' : getFileExtension(node.name)
        const size = node.type === 'file' ? ' (file)' : ` (${countFilesInNode(node)} items)`
        
        result += `${indent}${icon} ${node.name} [${type}]${size}\n`
        
        if (node.children && node.children.length > 0) {
          result += generateTreeText(node.children, depth + 1)
        }
      })
      
      return result
    }
    
    const getFileExtension = (fileName: string): string => {
      const ext = fileName.split('.').pop()?.toLowerCase() || 'unknown'
      return ext
    }
    
    const countFilesInNode = (node: TreeNode): number => {
      if (node.type === 'file') return 1
      if (!node.children) return 0
      return node.children.reduce((total, child) => total + countFilesInNode(child), 0)
    }
    
    const treeText = generateTreeText(tree)
    const header = `Repository Tree Structure\nGenerated: ${new Date().toLocaleString()}\n\n`
    const fullText = header + treeText
    
    const blob = new Blob([fullText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tree-structure-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || ""
    const iconMap: { [key: string]: string } = {
      // React/TypeScript
      tsx: "⚛️",
      ts: "📘",
      jsx: "⚛️",
      js: "📙",
      
      // Web
      html: "🌐",
      css: "🎨",
      scss: "🎨",
      sass: "🎨",
      less: "🎨",
      
      // Data
      json: "{}",
      yaml: "📋",
      yml: "📋",
      xml: "📋",
      csv: "📊",
      
      // Documentation
      md: "📝",
      txt: "📄",
      rst: "📝",
      doc: "📄",
      docx: "📄",
      pdf: "📄",
      
      // Programming Languages
      py: "🐍",
      java: "☕",
      go: "🐹",
      rs: "🦀",
      cpp: "⚙️",
      c: "⚙️",
      h: "⚙️",
      hpp: "⚙️",
      cs: "🔷",
      php: "🐘",
      rb: "💎",
      swift: "🐦",
      kt: "🟣",
      scala: "🔴",
      clj: "🟢",
      hs: "🔷",
      ml: "🟠",
      fs: "🔵",
      vb: "🔵",
      r: "📊",
      sql: "🗃️",
      sh: "🐚",
      bash: "🐚",
      zsh: "🐚",
      fish: "🐠",
      ps1: "💻",
      bat: "💻",
      
      // Images
      svg: "🖼️",
      png: "🖼️",
      jpg: "🖼️",
      jpeg: "🖼️",
      gif: "🖼️",
      webp: "🖼️",
      ico: "🖼️",
      
      // Config
      git: "🔧",
      gitignore: "🔧",
      gitattributes: "🔧",
      dockerfile: "🐳",
      dockerignore: "🐳",
      env: "⚙️",
      config: "⚙️",
      ini: "⚙️",
      toml: "⚙️",
      lock: "🔒",
      
      // Build tools
      makefile: "🔨",
      cmake: "🔨",
      gradle: "🔨",
      maven: "🔨",
      pom: "🔨",
      gruntfile: "🔨",
      gulpfile: "🔨",
      webpack: "🔨",
      rollup: "🔨",
      vite: "🔨",
      
      // Other
      license: "📜",
      readme: "📖",
      changelog: "📋",
      todo: "✅",
      ignore: "🚫",
    }
    return iconMap[ext] || "📄"
  }

  // Helper function to check if a node or any of its children match the search
  const nodeMatchesSearch = (node: TreeNode): boolean => {
    if (!searchQuery) return true
    
    const nodeMatches = node.name.toLowerCase().includes(searchQuery.toLowerCase())
    const childrenMatch = node.children?.some(child => nodeMatchesSearch(child)) || false
    
    return nodeMatches || childrenMatch
  }

  // Helper function to check if a node should be visible (either matches search or has matching children)
  const shouldShowNode = (node: TreeNode): boolean => {
    if (!searchQuery) return true
    
    const nodeMatches = node.name.toLowerCase().includes(searchQuery.toLowerCase())
    const hasMatchingChildren = node.children?.some(child => nodeMatchesSearch(child)) || false
    
    return nodeMatches || hasMatchingChildren
  }

  const TreeNode = ({ node, depth = 0 }: { node: TreeNode; depth?: number }) => {
    const isExpanded = expandedFolders.has(node.path)
    const isFolder = node.type === "folder"
    const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase())
    const hasMatchingChildren = isFolder && node.children?.some(child => nodeMatchesSearch(child)) || false
    const shouldShow = shouldShowNode(node)

    if (!shouldShow) return null

    return (
      <div key={node.path}>
        <div
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.path)
            } else {
              handleFileClick(node.path)
            }
          }}
          className={`console-text flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/10 rounded transition-colors ${
            selectedFile === node.path ? "bg-accent/20 text-accent" : "text-foreground hover:text-accent/80"
          } ${matchesSearch && searchQuery ? "bg-yellow-500/10" : ""} ${hasMatchingChildren && searchQuery ? "bg-blue-500/10 border-l-2 border-blue-500" : ""}`}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          {isFolder ? (
            <>
              <button onClick={(e) => toggleFolder(node.path, e)} className="flex items-center justify-center w-4 h-4">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Folder size={14} className="text-accent flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="w-4" />
              <span className="text-sm flex-shrink-0">{getFileIcon(node.name)}</span>
            </>
          )}
          <span className="text-xs truncate">{node.name}</span>
          {hasMatchingChildren && searchQuery && (
            <span className="ml-auto text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
              {node.children?.filter(child => nodeMatchesSearch(child)).length || 0}
            </span>
          )}
        </div>

        {isFolder && isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-card/30">
      {/* Header */}
      <div className="console-border border-b bg-card/50 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="console-text text-xs text-muted-foreground">File Explorer</div>
          <button
            onClick={downloadTreeStructure}
            className="console-button flex items-center gap-1 px-2 py-1 text-xs"
            title="Download tree structure"
          >
            <Download size={12} />
            Export
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full console-input rounded-md pl-8 pr-3 py-2 text-xs"
          />
        </div>
      </div>

      <div className="console-border border-b bg-card/50 overflow-x-auto flex">
        {/* tree.exe tab */}
        <div
          onClick={() => setActiveTab("tree.exe")}
          className={`console-text text-xs px-4 py-2 cursor-pointer border-r border-accent/20 flex items-center gap-2 whitespace-nowrap transition-colors ${
            activeTab === "tree.exe"
              ? "bg-accent/20 text-accent"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/5"
          }`}
        >
          <span>tree.exe</span>
          {openTabs.length > 0 && <span className="text-accent/60 text-xs">({openTabs.length})</span>}
        </div>

        {/* File tabs */}
        {openTabs.map((tab) => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`console-text text-xs px-3 py-2 cursor-pointer border-r border-accent/20 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === tab
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/5"
            }`}
          >
            <span className="truncate max-w-[100px]">{tab.split("/").pop()}</span>
            <button
              onClick={(e) => closeTab(tab, e)}
              className="hover:text-accent ml-1 text-xs flex-shrink-0"
              title="Close tab"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="w-full overflow-y-auto">
          {activeTab === "tree.exe" ? (
            <div className="p-4">
              {tree.length === 0 ? (
                <div className="console-text text-muted-foreground text-xs text-center py-8">
                  {searchQuery ? "> No files match your search" : "> No files found"}
                </div>
              ) : (
                <div>
                  {searchQuery && (
                    <div className="console-text text-xs text-muted-foreground mb-2 px-2">
                      {"> Found "} {tree.filter(node => shouldShowNode(node)).length} items
                    </div>
                  )}
                  {tree.map((node) => <TreeNode key={node.path} node={node} />)}
                </div>
              )}
            </div>
          ) : (
            <CodeTab filePath={activeTab} onExplain={onExplainFile} repoUrl={repoUrl} />
          )}
        </div>
      </div>
    </div>
  )
}
