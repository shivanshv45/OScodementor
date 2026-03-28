// Unified Search Engine Interface
// All search engines (Elasticsearch, Typesense) implement this interface

export interface SearchEngineFile {
    id: string
    repo_id: string
    file_path: string
    file_content: string
    file_size: number
    file_language: string | null
    file_type: string
    indexed_at?: string
    created_at?: string
    _score?: number
}

export interface SearchEngineRepository {
    id: string
    repo_url: string
    repo_name: string
    repo_owner: string
    repo_description: string | null
    repo_stars: number
    repo_language: string | null
    repo_languages: string[]
    repo_default_branch: string
    repo_updated_at: string
    indexed_at?: string
    last_accessed_at?: string
    access_count?: number
    index_status: string
    is_popular: boolean
    created_at?: string
    _score?: number
}

export interface SearchEngineStats {
    total_repositories: number
    total_files: number
}

export interface SearchEngine {
    readonly name: string

    /** Test connectivity to the search engine */
    testConnection(): Promise<boolean>

    /** Create indices/collections if they don't exist */
    initialize(): Promise<void>

    /** Index a repository document */
    indexRepository(repoData: Partial<SearchEngineRepository>): Promise<void>

    /** Index a file document (with retry) */
    indexFile(fileData: Partial<SearchEngineFile>): Promise<string>

    /** Search repositories by query */
    searchRepositories(query: string, filters?: Record<string, any>): Promise<SearchEngineRepository[]>

    /** Search files within a specific repository */
    searchFilesInRepository(
        repoId: string,
        query: string,
        fileType?: string,
        language?: string
    ): Promise<SearchEngineFile[]>

    /** Get a specific file by path within a repository */
    getFileContent(repoId: string, filePath: string): Promise<SearchEngineFile | null>

    /** Delete a repository and all its files */
    deleteRepository(repoId: string): Promise<void>

    /** Get statistics (total repos, total files) */
    getStats(): Promise<SearchEngineStats>
}
