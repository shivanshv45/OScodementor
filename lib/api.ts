// API functions for frontend - now using real GitHub API integration

import { RepoData } from './types'

export type FetchedRepoData = RepoData & {
  cached?: boolean
  cacheAge?: number
  indexing?: boolean
  repoId?: string
}

export async function fetchRepoData(repoUrl: string): Promise<FetchedRepoData> {
  try {
    console.log('Frontend: Fetching repository data for:', repoUrl)

    const response = await fetch('/api/fetch-repo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repoUrl }),
    })

    console.log('Frontend: Response status:', response.status)
    console.log('Frontend: Response headers:', Object.fromEntries(response.headers.entries()))

    if (!response.ok) {
      let errorMessage = 'Failed to fetch repository data'
      try {
        const errorData = await response.json()
        errorMessage = errorData.error || errorData.details || errorMessage
        console.error('Frontend: API Error Response:', errorData)
      } catch (jsonError) {
        console.error('Frontend: Failed to parse error response as JSON:', jsonError)
        // Don't try to read response again, just use status
        errorMessage = `Server error (${response.status}): ${response.statusText || 'Unknown error'}`
      }
      throw new Error(errorMessage)
    }

    // Check if response has content
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Frontend: Response is not JSON, content-type:', contentType)
      throw new Error(`Expected JSON response but got: ${contentType}`)
    }

    const data = await response.json()
    console.log('Frontend: Successfully parsed repository data:', {
      name: data.name,
      stars: data.stars,
      filesCount: data.files?.length || 0,
      issuesCount: data.issues?.length || 0
    })

    return data
  } catch (error: any) {
    console.error('Frontend: Error fetching repository data:', error)
    throw error
  }
}

export async function queryAI(
  question: string,
  file?: string | null,
  skillLevel: "beginner" | "intermediate" | "expert" = "beginner",
  repoUrl?: string,
  conversationHistory?: Array<{ role: string; content: string }>
): Promise<string> {
  try {
    console.log('Frontend: Querying AI for:', question)

    const response = await fetch('/api/query-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        file,
        skillLevel,
        repoUrl,
        conversationHistory
      }),
    })

    if (!response.ok) {
      let errorMessage = 'Failed to get AI response'
      try {
        const textBody = await response.text()
        try {
          const errorData = JSON.parse(textBody)
          errorMessage = errorData.error || errorMessage
          console.error('Frontend: AI API Error Response:', errorData)
        } catch (jsonError) {
          console.error('Frontend: Failed to parse AI error response as JSON')
          errorMessage = `AI service error (${response.status}): ${textBody || 'Unknown error'}`
        }
      } catch (readError) {
        console.error('Frontend: Failed to read AI error response body')
        errorMessage = `AI service error (${response.status})`
      }
      throw new Error(errorMessage)
    }

    const data = await response.json()
    console.log('Frontend: Successfully received AI response')

    return data.answer
  } catch (error: any) {
    console.error('Frontend: Error querying AI:', error)
    throw error
  }
}

// Fallback responses for when AI service is not available
function getFallbackResponse(
  question: string,
  skillLevel: "beginner" | "intermediate" | "expert" = "beginner"
): string {
  const responsesBySkillLevel = {
    beginner: {
      summarize: `This repository is a modern web application built with React and TypeScript. 

**What is React?** React is a JavaScript library that helps you build interactive user interfaces by breaking them into reusable pieces called components.

**What is TypeScript?** TypeScript adds type safety to JavaScript, meaning you declare what type of data each variable should hold (like numbers, text, etc.).

The main features include:
- File browsing: Navigate through project files
- Code analysis: Understand what code does
- AI-powered explanations: Get help understanding code

The project uses Tailwind CSS (a styling tool) and follows best practices for organizing code into components.`,

      contribute: `Contributing is a great way to learn! Here's a beginner-friendly guide:

1. **Fork the repository**: Click "Fork" to create your own copy
2. **Clone it locally**: Download it to your computer with \`git clone\`
3. **Create a branch**: Make a new branch for your changes with \`git checkout -b feature/your-feature\`
4. **Make changes**: Edit files and test your changes
5. **Commit**: Save your changes with \`git commit -m 'Add your feature'\`
6. **Push**: Upload to GitHub with \`git push\`
7. **Pull Request**: Ask the maintainers to review and merge your changes

**Tips for beginners:**
- Start with small changes
- Read the README first
- Ask questions if you're stuck
- Follow the existing code style`,

      issues: `Here are some great first issues for beginners:

1. **Add dark mode support** - Make the app work in dark theme
   - Difficulty: Easy
   - Skills: CSS, React state

2. **Improve mobile responsiveness** - Fix layout on phones
   - Difficulty: Easy
   - Skills: CSS, responsive design

3. **Add unit tests** - Write tests for utility functions
   - Difficulty: Medium
   - Skills: Testing, JavaScript

4. **Update documentation** - Improve README and comments
   - Difficulty: Easy
   - Skills: Writing, markdown

Start with the "Easy" ones to get comfortable with the codebase!`,

      explain: `This file contains important logic for the application.

**What does it do?**
It exports a React component - think of components as reusable building blocks for your UI.

**Key concepts:**
- **useState**: Lets the component remember information (like whether a button was clicked)
- **useEffect**: Runs code when the component loads or when data changes
- **Event handling**: Responds to user actions like clicks
- **Rendering**: Displays the UI on screen

**In simple terms:** This component is like a smart container that displays information and responds to what the user does.`,
    },
    intermediate: {
      summarize: `This repository is a modern web application built with React and TypeScript, implementing a component-based architecture with state management and API integration.

**Architecture Overview:**
- React components with hooks (useState, useEffect)
- TypeScript for type safety and better IDE support
- Tailwind CSS for utility-first styling
- Modular file structure with separation of concerns

**Key Features:**
- File browsing with tree navigation
- Code analysis and syntax highlighting
- AI-powered code explanations
- Responsive design patterns

**Tech Stack:**
- Frontend: React 18+, TypeScript, Tailwind CSS
- Build: Next.js with App Router
- Styling: Utility-first CSS framework

The codebase follows modern React patterns including custom hooks, context for state management, and component composition.`,

      contribute: `Contributing guide for intermediate developers:

1. **Setup Development Environment**
   - Fork and clone the repository
   - Install dependencies: \`npm install\`
   - Create feature branch: \`git checkout -b feature/your-feature\`

2. **Development Workflow**
   - Follow the existing code style and patterns
   - Write tests for new features
   - Use TypeScript for type safety
   - Test locally before pushing

3. **Submission Process**
   - Commit with clear messages
   - Push to your fork
   - Create a Pull Request with description
   - Address review feedback

4. **Code Standards**
   - Follow ESLint configuration
   - Maintain TypeScript strict mode
   - Write meaningful component names
   - Document complex logic`,

      issues: `Intermediate-level issues to work on:

1. **Implement caching layer** - Add memoization for expensive operations
2. **Refactor state management** - Consider Context API or state library
3. **Add error boundaries** - Improve error handling in components
4. **Optimize performance** - Implement code splitting and lazy loading
5. **Enhance testing** - Add integration and E2E tests

These issues require understanding of React patterns, performance optimization, and testing strategies.`,

      explain: `This file implements a React component with the following structure:

**Component Architecture:**
- Uses functional component pattern with hooks
- Manages local state with useState
- Handles side effects with useEffect
- Implements event handlers for user interactions

**Key Implementation Details:**
- Props interface for type safety
- Custom hooks for reusable logic
- Conditional rendering based on state
- Event delegation for performance

**Performance Considerations:**
- Memoization opportunities
- Dependency array optimization
- Re-render prevention strategies

This follows React best practices for modern component development.`,
    },
    expert: {
      summarize: `Advanced React/TypeScript application with sophisticated component architecture and state management patterns.

**Technical Analysis:**
- Functional components with advanced hook patterns (custom hooks, hook composition)
- TypeScript strict mode with discriminated unions and generics
- Tailwind CSS with custom configuration and design tokens
- Next.js App Router with server/client component boundaries

**Architecture Patterns:**
- Component composition with render props and compound components
- Custom hooks for cross-cutting concerns
- Memoization strategies (React.memo, useMemo, useCallback)
- Error boundaries and suspense patterns

**Performance Optimizations:**
- Code splitting and dynamic imports
- Image optimization
- Bundle size analysis
- Runtime performance profiling

**Scalability Considerations:**
- Monorepo structure potential
- Micro-frontend architecture
- State management scaling
- API layer abstraction`,

      contribute: `Advanced contribution guidelines:

1. **Architecture Review**
   - Understand design patterns and architectural decisions
   - Review performance implications
   - Consider scalability impact

2. **Implementation Standards**
   - Advanced TypeScript patterns (generics, conditional types)
   - Performance profiling and optimization
   - Comprehensive test coverage (unit, integration, E2E)
   - Documentation and architectural decision records

3. **Code Quality**
   - Static analysis and type checking
   - Performance budgets
   - Accessibility compliance (WCAG)
   - Security best practices

4. **Submission Requirements**
   - Detailed PR description with rationale
   - Performance metrics and benchmarks
   - Test coverage reports
   - Documentation updates`,

      issues: `Advanced technical challenges:

1. **Implement advanced caching strategy** - Redis integration, cache invalidation
2. **Optimize bundle size** - Tree-shaking, code splitting analysis
3. **Add observability** - Logging, tracing, monitoring
4. **Implement feature flags** - A/B testing infrastructure
5. **Performance profiling** - Identify and optimize bottlenecks

These require deep understanding of web performance, architecture patterns, and DevOps practices.`,

      explain: `Deep technical analysis of component implementation:

**Advanced Patterns:**
- Higher-order components and render props
- Custom hook composition and hook rules
- Concurrent rendering and Suspense integration
- Fiber architecture implications

**Performance Characteristics:**
- Reconciliation algorithm behavior
- Batching and priority levels
- Memory profiling and leak detection
- Runtime performance metrics

**Type System Analysis:**
- Generic constraints and variance
- Discriminated unions for type safety
- Conditional types and mapped types
- Type inference and narrowing

**Optimization Opportunities:**
- Memoization strategies and trade-offs
- Lazy evaluation patterns
- Virtual scrolling for large lists
- Streaming and progressive rendering`,
    },
  }

  // Determine response type based on question
  let responseType = "explain"
  if (question.toLowerCase().includes("summarize")) responseType = "summarize"
  if (question.toLowerCase().includes("contribute")) responseType = "contribute"
  if (question.toLowerCase().includes("issue")) responseType = "issues"

  return (
    responsesBySkillLevel[skillLevel][responseType as keyof (typeof responsesBySkillLevel)[typeof skillLevel]] ||
    responsesBySkillLevel[skillLevel]["explain"]
  )
}

export async function indexElastic(repoUrl: string): Promise<void> {
  // Placeholder for Elastic indexing
  // Comment: "Simulates Elastic indexing; replace with real Elastic API later."

  await new Promise((resolve) => setTimeout(resolve, 400))
  console.log(`[Elastic] Indexing repository: ${repoUrl}`)
}
