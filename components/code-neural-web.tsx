"use client"

import { useRef, useMemo, useState, useCallback } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Text, Billboard } from "@react-three/drei"
import * as THREE from "three"
import { X, Maximize2, Minimize2, FileCode, Loader2, Layers, GitBranch, Zap } from "lucide-react"

interface FileNode {
    path: string
    type: string
    children?: FileNode[]
    content?: string
}

interface GraphNode {
    id: string
    label: string
    folder: string
    language: string
    size: number
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    depth: number
}

interface GraphEdge {
    source: string
    target: string
    type: 'sibling' | 'cross'
}

interface CodeNeuralWebProps {
    files: FileNode[]
    repoName: string
    onFileSelect: (filePath: string) => void
    onClose: () => void
}

const langColors: Record<string, string> = {
    typescript: '#3178c6', javascript: '#f7df1e', python: '#3572a5',
    java: '#b07219', go: '#00add8', rust: '#dea584', ruby: '#701516',
    php: '#4f5d95', css: '#563d7c', html: '#e34c26', json: '#6e7681',
    markdown: '#519aba', yaml: '#cb171e', cpp: '#f34b7d', c: '#555555',
    swift: '#f05138', kotlin: '#A97BFF', scala: '#c22d40', shell: '#89e051',
    default: '#8b5cf6',
}

const langIcons: Record<string, string> = {
    typescript: '⚡', javascript: '✦', python: '🐍', java: '☕',
    go: '🔷', rust: '🦀', ruby: '💎', php: '🐘', css: '🎨',
    html: '🌐', json: '{}', markdown: '📝', yaml: '📋',
    default: '📄',
}

function getLang(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
        php: 'php', css: 'css', html: 'html', json: 'json', md: 'markdown',
        yml: 'yaml', yaml: 'yaml', cpp: 'cpp', c: 'c', swift: 'swift',
        kt: 'kotlin', scala: 'scala', sh: 'shell', bash: 'shell',
    }
    return map[ext] || 'default'
}

function getColor(lang: string): string {
    return langColors[lang] || langColors.default
}

function buildGraph(files: FileNode[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const folders = new Map<string, string[]>()

    function flatten(items: FileNode[], depth: number = 0) {
        for (const item of items) {
            if (item.type === 'file') {
                const folder = item.path.split('/').slice(0, -1).join('/') || 'root'
                const lang = getLang(item.path)
                const size = item.content?.length || Math.random() * 500 + 100

                const folderHash = [...folder].reduce((a, c) => a + c.charCodeAt(0), 0)
                const goldenAngle = 2.39996322972
                const nodeIndex = nodes.length
                const angle = nodeIndex * goldenAngle
                const radius = 3 + Math.sqrt(nodeIndex) * 1.5
                const ySpread = (folderHash % 10 - 5) + (Math.random() - 0.5) * 3

                nodes.push({
                    id: item.path,
                    label: item.path.split('/').pop() || item.path,
                    folder,
                    language: lang,
                    size: Math.min(Math.max(size / 400, 0.4), 3.0),
                    x: Math.cos(angle) * radius + (Math.random() - 0.5),
                    y: ySpread,
                    z: Math.sin(angle) * radius + (Math.random() - 0.5),
                    vx: 0, vy: 0, vz: 0,
                    depth,
                })

                if (!folders.has(folder)) folders.set(folder, [])
                folders.get(folder)!.push(item.path)
            }
            if (item.children) flatten(item.children, depth + 1)
        }
    }

    flatten(files)

    for (const [, fileIds] of folders) {
        for (let i = 0; i < fileIds.length - 1; i++) {
            edges.push({ source: fileIds[i], target: fileIds[i + 1], type: 'sibling' })
        }
        if (fileIds.length > 2) {
            edges.push({ source: fileIds[0], target: fileIds[fileIds.length - 1], type: 'sibling' })
        }
    }

    const folderKeys = [...folders.keys()]
    for (let i = 0; i < folderKeys.length - 1; i++) {
        const a = folders.get(folderKeys[i])!
        const b = folders.get(folderKeys[i + 1])!
        if (a.length > 0 && b.length > 0) {
            edges.push({ source: a[0], target: b[0], type: 'cross' })
        }
    }

    return { nodes, edges }
}

function Neuron({ node, isHovered, isConnected, onClick, onHover }: {
    node: GraphNode
    isHovered: boolean
    isConnected: boolean
    onClick: () => void
    onHover: (hovered: boolean) => void
}) {
    const meshRef = useRef<THREE.Mesh>(null)
    const glowRef = useRef<THREE.Mesh>(null)
    const ringRef = useRef<THREE.Mesh>(null)
    const color = getColor(node.language)
    const baseSize = node.size * 0.18

    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        if (meshRef.current) {
            const pulse = Math.sin(t * 1.5 + node.x * 0.5) * 0.015
            meshRef.current.scale.setScalar(baseSize + pulse + (isHovered ? 0.1 : 0))
        }
        if (glowRef.current) {
            const glowPulse = 0.2 + Math.sin(t * 1.2 + node.z * 0.3) * 0.08
            const mat = glowRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = isHovered ? 0.5 : isConnected ? 0.3 : glowPulse
            glowRef.current.scale.setScalar((baseSize + (isHovered ? 0.2 : isConnected ? 0.1 : 0)) * 3.5)
        }
        if (ringRef.current) {
            ringRef.current.rotation.z = t * 0.5 + node.x
            ringRef.current.rotation.x = Math.sin(t * 0.3) * 0.2
            const mat = ringRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = isHovered ? 0.7 : 0
            ringRef.current.scale.setScalar(isHovered ? baseSize * 6 : 0)
        }
    })

    return (
        <group position={[node.x, node.y, node.z]}>
            <mesh ref={glowRef}>
                <sphereGeometry args={[1, 16, 16]} />
                <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
            </mesh>
            <mesh
                ref={meshRef}
                onClick={(e) => { e.stopPropagation(); onClick() }}
                onPointerEnter={(e) => { e.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer' }}
                onPointerLeave={() => { onHover(false); document.body.style.cursor = 'auto' }}
            >
                <sphereGeometry args={[1, 32, 32]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={isHovered ? 2.0 : isConnected ? 1.0 : 0.6}
                    roughness={0.2}
                    metalness={0.8}
                />
            </mesh>
            <mesh ref={ringRef}>
                <torusGeometry args={[1, 0.02, 16, 64]} />
                <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
            </mesh>
            {isHovered && (
                <Billboard position={[0, baseSize * 7 + 0.8, 0]}>
                    <Text fontSize={0.32} color="white" anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor="#000000">
                        {node.label}
                    </Text>
                    <Text fontSize={0.18} color="#94a3b8" anchorX="center" anchorY="top" position={[0, -0.15, 0]} outlineWidth={0.02} outlineColor="#000000">
                        {node.folder === 'root' ? '/' : node.folder}
                    </Text>
                </Billboard>
            )}
        </group>
    )
}

function Synapse({ edge, nodes, hoveredNode }: {
    edge: GraphEdge
    nodes: GraphNode[]
    hoveredNode: string | null
}) {
    const lineRef = useRef<THREE.Line>(null)
    const source = nodes.find(n => n.id === edge.source)
    const target = nodes.find(n => n.id === edge.target)
    const isActive = hoveredNode === edge.source || hoveredNode === edge.target

    const geometry = useMemo(() => {
        if (!source || !target) return new THREE.BufferGeometry()
        const points = []
        const segments = 30
        for (let i = 0; i <= segments; i++) {
            const t = i / segments
            const x = source.x + (target.x - source.x) * t
            const y = source.y + (target.y - source.y) * t + Math.sin(t * Math.PI) * 0.8
            const z = source.z + (target.z - source.z) * t
            points.push(new THREE.Vector3(x, y, z))
        }
        return new THREE.BufferGeometry().setFromPoints(points)
    }, [source, target])

    useFrame(({ clock }) => {
        if (lineRef.current) {
            const mat = lineRef.current.material as THREE.LineBasicMaterial
            if (isActive) {
                const pulse = 0.5 + Math.sin(clock.elapsedTime * 3) * 0.2
                mat.opacity = pulse
                mat.color.set('#a78bfa')
            } else {
                mat.opacity = edge.type === 'sibling' ? 0.08 : 0.04
                mat.color.set(edge.type === 'sibling' ? '#6366f1' : '#1e1b4b')
            }
        }
    })

    if (!source || !target) return null
    const LineComponent: any = 'line'

    return (
        <LineComponent ref={lineRef as any} geometry={geometry}>
            <lineBasicMaterial color="#6366f1" transparent opacity={0.08} depthWrite={false} />
        </LineComponent>
    )
}

function ParticleField() {
    const count = 400
    const positions = useMemo(() => {
        const arr = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            arr[i * 3] = (Math.random() - 0.5) * 50
            arr[i * 3 + 1] = (Math.random() - 0.5) * 50
            arr[i * 3 + 2] = (Math.random() - 0.5) * 50
        }
        return arr
    }, [])

    const ref = useRef<THREE.Points>(null)
    useFrame(({ clock }) => {
        if (ref.current) {
            ref.current.rotation.y = clock.elapsedTime * 0.008
            ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.003) * 0.08
        }
    })

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            </bufferGeometry>
            <pointsMaterial size={0.04} color="#4338ca" transparent opacity={0.4} sizeAttenuation />
        </points>
    )
}

function Scene({ graph, onFileSelect, hoveredNode, setHoveredNode }: {
    graph: { nodes: GraphNode[]; edges: GraphEdge[] }
    onFileSelect: (path: string) => void
    hoveredNode: string | null
    setHoveredNode: (id: string | null) => void
}) {
    const connectedNodes = useMemo(() => {
        if (!hoveredNode) return new Set<string>()
        const connected = new Set<string>()
        graph.edges.forEach(e => {
            if (e.source === hoveredNode) connected.add(e.target)
            if (e.target === hoveredNode) connected.add(e.source)
        })
        return connected
    }, [hoveredNode, graph.edges])

    return (
        <>
            <color attach="background" args={['#030712']} />
            <fog attach="fog" args={['#030712', 20, 50]} />
            <ambientLight intensity={0.15} />
            <pointLight position={[15, 15, 15]} intensity={1.2} color="#7c3aed" distance={60} decay={2} />
            <pointLight position={[-15, -8, -15]} intensity={0.8} color="#06b6d4" distance={50} decay={2} />
            <pointLight position={[0, 20, 0]} intensity={0.5} color="#e879f9" distance={40} decay={2} />
            <pointLight position={[-10, 5, 15]} intensity={0.3} color="#34d399" distance={30} decay={2} />

            <ParticleField />

            {graph.edges.map((edge, idx) => (
                <Synapse key={idx} edge={edge} nodes={graph.nodes} hoveredNode={hoveredNode} />
            ))}

            {graph.nodes.map((node) => (
                <Neuron
                    key={node.id}
                    node={node}
                    isHovered={hoveredNode === node.id}
                    isConnected={connectedNodes.has(node.id)}
                    onClick={() => onFileSelect(node.id)}
                    onHover={(h) => setHoveredNode(h ? node.id : null)}
                />
            ))}

            <OrbitControls
                enableDamping
                dampingFactor={0.05}
                minDistance={3}
                maxDistance={35}
                autoRotate
                autoRotateSpeed={0.4}
                enablePan
                panSpeed={0.5}
            />
        </>
    )
}

export default function CodeNeuralWeb({ files, repoName, onFileSelect, onClose }: CodeNeuralWebProps) {
    const [hoveredNode, setHoveredNode] = useState<string | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [selectedNodeContent, setSelectedNodeContent] = useState<{ path: string, content: string, loading: boolean } | null>(null)
    const [activeFilter, setActiveFilter] = useState<string | null>(null)

    const graph = useMemo(() => buildGraph(files), [files])

    const filteredGraph = useMemo(() => {
        if (!activeFilter) return graph
        return {
            nodes: graph.nodes.filter(n => n.language === activeFilter),
            edges: graph.edges.filter(e => {
                const s = graph.nodes.find(n => n.id === e.source)
                const t = graph.nodes.find(n => n.id === e.target)
                return s?.language === activeFilter && t?.language === activeFilter
            }),
        }
    }, [graph, activeFilter])

    const languages = useMemo(() => {
        const langs = new Map<string, number>()
        graph.nodes.forEach(n => langs.set(n.language, (langs.get(n.language) || 0) + 1))
        return [...langs.entries()].sort((a, b) => b[1] - a[1])
    }, [graph])

    const folderCount = useMemo(() => {
        const folders = new Set(graph.nodes.map(n => n.folder))
        return folders.size
    }, [graph])

    const handleNodeClick = async (path: string) => {
        onFileSelect(path)
        setSelectedNodeContent({ path, content: '', loading: true })
        try {
            const repoUrl = sessionStorage.getItem('currentRepoUrl') || ''
            if (!repoUrl) throw new Error("Repository URL not found")

            const cacheKey = `codementor_file_${repoUrl}_${path}`
            const cached = localStorage.getItem(cacheKey)
            if (cached) {
                setSelectedNodeContent({ path, content: cached, loading: false })
                return
            }

            const res = await fetch('/api/fetch-file-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl, filePath: path })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            const content = data.content || '// Empty file'
            try { localStorage.setItem(cacheKey, content) } catch (e) { }
            setSelectedNodeContent({ path, content, loading: false })
        } catch (err: any) {
            setSelectedNodeContent({ path, content: `// Error loading file: ${err.message}`, loading: false })
        }
    }

    const containerClass = isFullscreen ? 'fixed inset-0 z-50' : 'fixed inset-3 z-50 rounded-2xl'

    return (
        <div className={`${containerClass} overflow-hidden flex flex-col`}
            style={{
                background: 'linear-gradient(135deg, #030712 0%, #0c0a1e 40%, #0f0720 100%)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                boxShadow: '0 0 80px rgba(139, 92, 246, 0.08), 0 0 200px rgba(6, 182, 212, 0.04), inset 0 1px 0 rgba(255,255,255,0.03)',
            }}>

            {/* Header */}
            <div className="relative z-10 px-5 py-3.5 flex items-center justify-between"
                style={{
                    background: 'linear-gradient(90deg, rgba(139,92,246,0.08) 0%, rgba(6,182,212,0.04) 50%, transparent 100%)',
                    borderBottom: '1px solid rgba(139,92,246,0.12)',
                }}>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(6,182,212,0.2))', border: '1px solid rgba(139,92,246,0.3)' }}>
                            <Zap size={18} className="text-violet-300" />
                        </div>
                        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                    </div>
                    <div>
                        <h2 className="font-bold text-sm tracking-wide" style={{ color: '#c4b5fd' }}>Neural Code Web</h2>
                        <p className="text-[10px] font-mono" style={{ color: '#6b7280' }}>
                            {repoName} — {filteredGraph.nodes.length} files • {filteredGraph.edges.length} connections • {folderCount} modules
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    <button onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-2 rounded-lg transition-all hover:scale-105"
                        style={{ color: '#9ca3af', background: 'rgba(139,92,246,0.05)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#c4b5fd'; e.currentTarget.style.background = 'rgba(139,92,246,0.15)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'rgba(139,92,246,0.05)' }}>
                        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button onClick={onClose}
                        className="p-2 rounded-lg transition-all hover:scale-105"
                        style={{ color: '#9ca3af', background: 'rgba(239,68,68,0.05)' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'rgba(239,68,68,0.05)' }}>
                        <X size={15} />
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative">
                <Canvas camera={{ position: [0, 8, 18], fov: 55 }} dpr={[1, 2]}>
                    <Scene
                        graph={filteredGraph}
                        onFileSelect={handleNodeClick}
                        hoveredNode={hoveredNode}
                        setHoveredNode={setHoveredNode}
                    />
                </Canvas>

                {/* Legend Panel */}
                <div className="absolute bottom-5 left-5 rounded-xl p-4 max-w-[220px] backdrop-blur-xl"
                    style={{
                        background: 'linear-gradient(145deg, rgba(3,7,18,0.9), rgba(15,7,32,0.85))',
                        border: '1px solid rgba(139,92,246,0.12)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}>
                    <div className="flex items-center gap-2 mb-3">
                        <Layers size={12} style={{ color: '#818cf8' }} />
                        <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#818cf8' }}>Languages</p>
                    </div>
                    <div className="space-y-1.5">
                        {languages.slice(0, 8).map(([lang, count]) => (
                            <button
                                key={lang}
                                onClick={() => setActiveFilter(activeFilter === lang ? null : lang)}
                                className="flex items-center gap-2.5 w-full rounded-md px-2 py-1 transition-all group"
                                style={{
                                    background: activeFilter === lang ? `${getColor(lang)}15` : 'transparent',
                                    border: activeFilter === lang ? `1px solid ${getColor(lang)}30` : '1px solid transparent',
                                }}>
                                <div className="w-2.5 h-2.5 rounded-full transition-transform group-hover:scale-125"
                                    style={{
                                        backgroundColor: getColor(lang),
                                        boxShadow: `0 0 6px ${getColor(lang)}60`,
                                    }} />
                                <span className="text-[11px] font-mono flex-1 text-left capitalize"
                                    style={{ color: activeFilter === lang ? getColor(lang) : '#9ca3af' }}>
                                    {lang}
                                </span>
                                <span className="text-[10px] font-mono tabular-nums" style={{ color: '#4b5563' }}>{count}</span>
                            </button>
                        ))}
                    </div>
                    {activeFilter && (
                        <button onClick={() => setActiveFilter(null)}
                            className="mt-2 w-full text-center text-[10px] font-mono py-1 rounded-md transition-all"
                            style={{ color: '#818cf8', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
                            Show All
                        </button>
                    )}
                </div>

                {/* Hovered Node Info */}
                {hoveredNode && !selectedNodeContent && (
                    <div className="absolute top-5 right-5 rounded-xl p-4 max-w-[280px] backdrop-blur-xl"
                        style={{
                            background: 'linear-gradient(145deg, rgba(3,7,18,0.92), rgba(15,7,32,0.88))',
                            border: '1px solid rgba(139,92,246,0.2)',
                            boxShadow: '0 8px 32px rgba(139,92,246,0.1)',
                        }}>
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-2.5 h-2.5 rounded-full"
                                style={{
                                    backgroundColor: getColor(graph.nodes.find(n => n.id === hoveredNode)?.language || 'default'),
                                    boxShadow: `0 0 8px ${getColor(graph.nodes.find(n => n.id === hoveredNode)?.language || 'default')}80`,
                                }} />
                            <p className="font-mono text-xs font-bold truncate" style={{ color: '#e2e8f0' }}>
                                {hoveredNode.split('/').pop()}
                            </p>
                        </div>
                        <p className="font-mono text-[10px] truncate mb-2" style={{ color: '#6b7280' }}>{hoveredNode}</p>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full capitalize"
                                style={{
                                    color: getColor(graph.nodes.find(n => n.id === hoveredNode)?.language || 'default'),
                                    background: `${getColor(graph.nodes.find(n => n.id === hoveredNode)?.language || 'default')}15`,
                                    border: `1px solid ${getColor(graph.nodes.find(n => n.id === hoveredNode)?.language || 'default')}30`,
                                }}>
                                {graph.nodes.find(n => n.id === hoveredNode)?.language || 'unknown'}
                            </span>
                            <span className="text-[10px] font-mono" style={{ color: '#4b5563' }}>Click to view</span>
                        </div>
                    </div>
                )}

                {/* Controls Hint */}
                <div className="absolute bottom-5 right-5 flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg backdrop-blur-sm"
                        style={{
                            background: 'rgba(3,7,18,0.7)',
                            border: '1px solid rgba(139,92,246,0.08)',
                        }}>
                        <GitBranch size={10} style={{ color: '#6366f1' }} />
                        <p className="text-[10px] font-mono" style={{ color: '#4b5563' }}>Drag rotate • Scroll zoom • Click open</p>
                    </div>
                </div>

                {/* File Content Panel */}
                {selectedNodeContent && (
                    <div className="absolute top-4 right-4 bottom-4 w-[480px] flex flex-col rounded-xl overflow-hidden backdrop-blur-xl"
                        style={{
                            background: 'linear-gradient(180deg, rgba(3,7,18,0.96), rgba(15,7,32,0.94))',
                            border: '1px solid rgba(139,92,246,0.2)',
                            boxShadow: '0 16px 64px rgba(0,0,0,0.5), 0 0 40px rgba(139,92,246,0.06)',
                            animation: 'slideIn 0.25s ease-out',
                        }}>
                        <div className="px-4 py-3 flex items-center justify-between"
                            style={{
                                background: 'linear-gradient(90deg, rgba(139,92,246,0.12), rgba(6,182,212,0.06))',
                                borderBottom: '1px solid rgba(139,92,246,0.15)',
                            }}>
                            <div className="flex items-center gap-2.5 overflow-hidden">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                                    style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.2)' }}>
                                    <FileCode size={14} className="text-violet-400" />
                                </div>
                                <div className="overflow-hidden">
                                    <h3 className="font-mono text-xs font-bold truncate" style={{ color: '#c4b5fd' }}>
                                        {selectedNodeContent.path.split('/').pop()}
                                    </h3>
                                    <p className="font-mono text-[9px] truncate" style={{ color: '#4b5563' }}>
                                        {selectedNodeContent.path}
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedNodeContent(null)}
                                className="p-1.5 rounded-lg transition-all"
                                style={{ color: '#9ca3af' }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)' }}
                                onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}>
                                <X size={14} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-4"
                            style={{ scrollbarColor: '#1e1b4b transparent', scrollbarWidth: 'thin' }}>
                            {selectedNodeContent.loading ? (
                                <div className="h-full flex flex-col items-center justify-center">
                                    <div className="relative">
                                        <Loader2 size={28} className="animate-spin" style={{ color: '#7c3aed' }} />
                                        <div className="absolute inset-0 animate-ping opacity-20">
                                            <Loader2 size={28} style={{ color: '#7c3aed' }} />
                                        </div>
                                    </div>
                                    <p className="font-mono text-xs mt-3" style={{ color: '#6b7280' }}>Loading file...</p>
                                </div>
                            ) : (
                                <pre className="font-mono text-[11px] leading-relaxed whitespace-pre" style={{ color: '#d1d5db', tabSize: 2 }}>
                                    {selectedNodeContent.content}
                                </pre>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    )
}
