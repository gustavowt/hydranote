/**
 * Web Search Service
 * Handles web research with local processing, embeddings-based filtering, and caching
 */

import type {
  WebSearchSettings,
  WebSearchApiResult,
  WebPageContent,
  WebChunk,
  WebResearchOptions,
  WebResearchResult,
} from '../types';
import { DEFAULT_WEB_SEARCH_SETTINGS } from '../types';
import {
  createWebSearchCache,
  createWebSearchChunk,
  getWebSearchCache,
  webVectorSearch,
  cleanExpiredWebCache,
  flushDatabase,
} from './database';
import { generateEmbedding } from './embeddingService';
import { chunkText } from './documentProcessor';

const STORAGE_KEY = 'hydranote_web_search_settings';

// ============================================
// Settings Management
// ============================================

/**
 * Load web search settings from localStorage
 */
export function loadWebSearchSettings(): WebSearchSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_WEB_SEARCH_SETTINGS,
        ...parsed,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_WEB_SEARCH_SETTINGS };
}

/**
 * Save web search settings to localStorage
 */
export function saveWebSearchSettings(settings: WebSearchSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Check if web search is configured
 */
export function isWebSearchConfigured(): boolean {
  const settings = loadWebSearchSettings();
  
  switch (settings.provider) {
    case 'searxng':
      return !!settings.searxngUrl;
    case 'brave':
      return !!settings.braveApiKey;
    case 'duckduckgo':
      return true; // DuckDuckGo doesn't require configuration
    default:
      return false;
  }
}

// ============================================
// Hash Generation
// ============================================

/**
 * Generate a simple hash for cache lookup
 */
function hashQuery(query: string): string {
  const normalized = query.toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ============================================
// Environment Detection
// ============================================

/**
 * Check if running in Capacitor native environment
 */
function isCapacitorNative(): boolean {
  return typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor !== 'undefined' 
    && (window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform();
}

/**
 * Check if Electron IPC is available for web fetch
 * This is the proper way to bypass CORS in Electron - via main process IPC
 */
function isElectronWithIPC(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.web?.fetch;
}

// ============================================
// Web Search API Integration
// ============================================

/**
 * Search using SearXNG
 */
async function searchSearXNG(
  query: string,
  baseUrl: string,
  maxResults: number
): Promise<WebSearchApiResult[]> {
  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid SearXNG URL: "${baseUrl}". Please enter a valid URL like "http://localhost:9191".`);
  }

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories: 'general',
  });
  
  const url = `${baseUrl.replace(/\/$/, '')}/search?${params}`;
  
  let response: Response;
  try {
    response = await fetchWithCorsHandling(url);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Cannot connect to SearXNG at ${parsedUrl.origin}: ${errorMsg}`);
  }
  
  if (!response.ok) {
    const statusText = response.statusText || 'Unknown error';
    if (response.status === 404) {
      throw new Error(`SearXNG endpoint not found at ${url}. Make sure SearXNG is running and the URL is correct.`);
    } else if (response.status === 403) {
      throw new Error(`SearXNG access forbidden (403). Check if JSON format is enabled in SearXNG settings.`);
    } else if (response.status >= 500) {
      throw new Error(`SearXNG server error (${response.status}): ${statusText}. Check if SearXNG is running properly.`);
    }
    throw new Error(`SearXNG request failed (${response.status}): ${statusText}`);
  }
  
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid JSON response from SearXNG. Make sure the URL points to a SearXNG instance with JSON format enabled.`);
  }
  
  if (!data.results && !Array.isArray(data.results)) {
    // Check if it's an error response
    if (data.error) {
      throw new Error(`SearXNG error: ${data.error}`);
    }
  }
  
  return (data.results || []).slice(0, maxResults).map((r: { title: string; url: string; content?: string }) => ({
    title: r.title || '',
    url: r.url,
    snippet: r.content || '',
  }));
}

/**
 * Search using Brave Search API
 * @see https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 */
async function searchBrave(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<WebSearchApiResult[]> {
  // Validate API key
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'Brave Search API key is empty. ' +
      'Get your API key at: https://api-dashboard.search.brave.com (subscribe to free plan first)'
    );
  }
  
  const trimmedKey = apiKey.trim();
  
  const params = new URLSearchParams({
    q: query,
    count: maxResults.toString(),
  });
  
  const url = `https://api.search.brave.com/res/v1/web/search?${params}`;
  const headers = {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': trimmedKey,
  };
  
  let response: Response;
  try {
    // Use fetchWithCorsHandling which handles Electron IPC
    response = await fetchWithCorsHandling(url, { headers });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      throw new Error(
        `Cannot connect to Brave Search API. Please check your internet connection and try again.`
      );
    }
    throw new Error(`Connection error: ${errorMsg}`);
  }
  
  if (!response.ok) {
    // Try to get error details from response body
    let errorDetail = '';
    try {
      const errorBody = await response.json();
      if (errorBody.message) {
        errorDetail = `: ${errorBody.message}`;
      }
    } catch {
      // Ignore JSON parse errors for error response
    }
    
    if (response.status === 401) {
      throw new Error(
        `Brave Search API: Unauthorized (401)${errorDetail}. ` +
        `Make sure you have subscribed to a plan at api-dashboard.search.brave.com and your API key is correct.`
      );
    } else if (response.status === 403) {
      throw new Error(
        `Brave Search API: Forbidden (403)${errorDetail}. ` +
        `Your API key may have expired, or you need to subscribe to a plan.`
      );
    } else if (response.status === 422) {
      throw new Error(
        `Brave Search API: Invalid request (422)${errorDetail}. ` +
        `The API key format may be incorrect.`
      );
    } else if (response.status === 429) {
      throw new Error(
        `Brave Search API: Rate limit exceeded (429). ` +
        `You've hit your monthly query limit. Wait or upgrade your plan.`
      );
    } else if (response.status >= 500) {
      throw new Error(`Brave Search API server error (${response.status}). Please try again later.`);
    }
    throw new Error(`Brave Search API error (${response.status})${errorDetail}`);
  }
  
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Invalid response from Brave Search API.`);
  }
  
  return (data.web?.results || []).slice(0, maxResults).map((r: { title: string; url: string; description?: string }) => ({
    title: r.title || '',
    url: r.url,
    snippet: r.description || '',
  }));
}

/**
 * Search using DuckDuckGo (unofficial, HTML scraping)
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number
): Promise<WebSearchApiResult[]> {
  // DuckDuckGo Instant Answer API (limited but works)
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });
  
  const response = await fetchWithCorsHandling(`https://api.duckduckgo.com/?${params}`);
  
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status}`);
  }
  
  const data = await response.json();
  const results: WebSearchApiResult[] = [];
  
  // Add abstract if available
  if (data.AbstractURL && data.Abstract) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.Abstract,
    });
  }
  
  // Add related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
      if (topic.FirstURL && topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 50),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }
  
  return results.slice(0, maxResults);
}

/**
 * Perform web search using configured provider
 */
export async function searchWeb(
  query: string,
  maxResults?: number
): Promise<WebSearchApiResult[]> {
  const settings = loadWebSearchSettings();
  const max = maxResults || settings.maxResults || 5;
  
  switch (settings.provider) {
    case 'searxng':
      if (!settings.searxngUrl) {
        throw new Error('SearXNG URL not configured. Please configure it in Settings.');
      }
      return searchSearXNG(query, settings.searxngUrl, max);
      
    case 'brave':
      if (!settings.braveApiKey) {
        throw new Error('Brave Search API key not configured. Please configure it in Settings.');
      }
      return searchBrave(query, settings.braveApiKey, max);
      
    case 'duckduckgo':
      return searchDuckDuckGo(query, max);
      
    default:
      throw new Error(`Unknown search provider: ${settings.provider}`);
  }
}

// ============================================
// Content Fetching & Extraction
// ============================================

/**
 * Fetch URL with CORS handling
 * Uses Electron IPC to bypass CORS when running in Electron
 */
async function fetchWithCorsHandling(url: string, options?: { headers?: Record<string, string> }): Promise<Response> {
  const settings = loadWebSearchSettings();

  // Use Electron IPC if available - this bypasses CORS by running in the main process
  if (isElectronWithIPC()) {
    try {
      const result = await window.electronAPI!.web.fetch({
        url,
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/json,*/*',
          ...options?.headers,
        },
      });

      if (!result.success) {
        throw new Error(result.error || 'Fetch failed');
      }

      return new Response(result.body, {
        status: result.status,
        headers: new Headers(result.headers),
      });
    } catch (error) {
      throw new Error(`Network error: ${error instanceof Error ? error.message : 'Connection failed'}`);
    }
  }

  // Direct fetch (for browser - may fail due to CORS)
  try {
    return await fetch(url, {
      headers: {
        'Accept': 'text/html,application/json,*/*',
        ...options?.headers,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
      throw new Error(
        `Cannot connect to ${new URL(url).origin}. Please check the URL is correct and the service is running.`
      );
    }
    throw new Error(`Connection error: ${errorMessage}`);
  }
}

/**
 * Extract clean text content from HTML
 */
export function extractTextFromHTML(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Remove unwanted elements
  const selectorsToRemove = [
    'script', 'style', 'nav', 'footer', 'header', 'aside',
    'iframe', 'noscript', 'svg', 'form', 'button', 'input',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navbar', '.footer', '.sidebar', '.advertisement', '.ad',
    '#nav', '#navbar', '#footer', '#sidebar', '#comments',
  ];
  
  selectorsToRemove.forEach(selector => {
    try {
      doc.querySelectorAll(selector).forEach(el => el.remove());
    } catch {
      // Ignore invalid selectors
    }
  });
  
  // Try to find main content area
  const mainContent = 
    doc.querySelector('article') || 
    doc.querySelector('main') || 
    doc.querySelector('[role="main"]') ||
    doc.querySelector('.content') ||
    doc.querySelector('#content') ||
    doc.body;
  
  if (!mainContent) {
    return '';
  }
  
  // Get text and clean up
  let text = mainContent.textContent || '';
  
  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\n\s*\n/g, '\n\n')    // Normalize paragraph breaks
    .trim();
  
  return text;
}

/**
 * Fetch and extract content from a web page
 */
export async function fetchPageContent(url: string): Promise<WebPageContent> {
  try {
    const response = await fetchWithCorsHandling(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    
    const html = await response.text();
    const content = extractTextFromHTML(html);
    
    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
    
    return {
      url,
      title,
      content,
      fetchedAt: new Date(),
      contentLength: content.length,
    };
  } catch (error) {
    throw new Error(`Failed to fetch page content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================
// Content Processing & Embedding
// ============================================

/**
 * Process web content: chunk and generate embeddings
 */
async function processWebContent(
  cacheId: string,
  content: string,
  url: string,
  title: string
): Promise<WebChunk[]> {
  // Use existing chunking function
  const textChunks = chunkText(content, cacheId, 'web');
  
  const webChunks: WebChunk[] = [];
  
  for (let i = 0; i < textChunks.length; i++) {
    const chunk = textChunks[i];
    
    // Generate embedding for this chunk
    const embedding = await generateEmbedding(chunk.text);
    
    const webChunk: WebChunk = {
      id: crypto.randomUUID(),
      cacheId,
      url,
      title,
      text: chunk.text,
      chunkIndex: i,
      embedding,
    };
    
    // Store in database
    await createWebSearchChunk({
      id: webChunk.id,
      cacheId: webChunk.cacheId,
      chunkIndex: webChunk.chunkIndex,
      text: webChunk.text,
      embedding: webChunk.embedding,
    });
    
    webChunks.push(webChunk);
  }
  
  return webChunks;
}

// ============================================
// Cache Management
// ============================================

/**
 * Check cache for existing results
 */
async function checkCache(
  query: string,
  maxAgeMinutes: number
): Promise<{ cacheIds: string[]; fromCache: boolean } | null> {
  const queryHash = hashQuery(query);
  const cached = await getWebSearchCache(queryHash, maxAgeMinutes);
  
  if (cached.length > 0) {
    return {
      cacheIds: cached.map(c => c.id),
      fromCache: true,
    };
  }
  
  return null;
}

/**
 * Store search results in cache
 */
async function cacheSearchResults(
  query: string,
  pages: WebPageContent[]
): Promise<string[]> {
  const queryHash = hashQuery(query);
  const cacheIds: string[] = [];
  
  for (const page of pages) {
    const cacheId = crypto.randomUUID();
    
    await createWebSearchCache({
      id: cacheId,
      queryHash,
      query,
      url: page.url,
      title: page.title,
      rawContent: page.content,
      fetchedAt: page.fetchedAt,
    });
    
    // Process and embed content
    await processWebContent(cacheId, page.content, page.url, page.title);
    
    cacheIds.push(cacheId);
  }
  
  await flushDatabase();
  
  return cacheIds;
}

// ============================================
// Main Web Research Function
// ============================================

/**
 * Perform web research with caching and vector filtering
 */
export async function webResearch(
  query: string,
  options?: WebResearchOptions
): Promise<WebResearchResult> {
  const startTime = Date.now();
  const settings = loadWebSearchSettings();
  
  const maxResults = options?.maxResults || settings.maxResults || 5;
  const maxChunks = options?.maxChunks || 10;
  const useCache = options?.useCache !== false;
  const cacheMaxAge = options?.cacheMaxAge || settings.cacheMaxAge || 60;
  
  try {
    let cacheIds: string[] = [];
    let fromCache = false;
    const sources: Array<{ url: string; title: string }> = [];
    
    // Step 1: Check cache
    if (useCache) {
      const cached = await checkCache(query, cacheMaxAge);
      if (cached) {
        cacheIds = cached.cacheIds;
        fromCache = true;
        
        // Get source info from cache
        const cachedEntries = await getWebSearchCache(hashQuery(query), cacheMaxAge);
        for (const entry of cachedEntries) {
          sources.push({ url: entry.url, title: entry.title });
        }
      }
    }
    
    // Step 2: If not cached, perform search and fetch
    if (cacheIds.length === 0) {
      // Clean expired cache periodically
      await cleanExpiredWebCache(cacheMaxAge);
      
      // Search web
      const searchResults = await searchWeb(query, maxResults);
      
      if (searchResults.length === 0) {
        return {
          query,
          sources: [],
          relevantContent: [],
          fromCache: false,
          searchTime: Date.now() - startTime,
          error: 'No search results found',
        };
      }
      
      // Fetch pages
      const pages: WebPageContent[] = [];
      
      for (const result of searchResults) {
        try {
          const page = await fetchPageContent(result.url);
          if (page.content.length > 100) { // Skip empty/tiny pages
            pages.push(page);
            sources.push({ url: result.url, title: result.title || page.title });
          }
        } catch (error) {
          // Continue with other pages if one fails
          console.warn(`Failed to fetch ${result.url}:`, error);
        }
      }
      
      if (pages.length === 0) {
        return {
          query,
          sources: [],
          relevantContent: [],
          fromCache: false,
          searchTime: Date.now() - startTime,
          error: 'Failed to fetch any search results',
        };
      }
      
      // Cache results
      cacheIds = await cacheSearchResults(query, pages);
    }
    
    // Step 3: Vector search to find relevant chunks
    const queryEmbedding = await generateEmbedding(query);
    const searchHits = await webVectorSearch(queryEmbedding, cacheIds, maxChunks);
    
    // Convert to WebChunk format
    const relevantContent: WebChunk[] = searchHits.map(hit => ({
      id: hit.chunkId,
      cacheId: hit.cacheId,
      url: hit.url,
      title: hit.title,
      text: hit.text,
      chunkIndex: 0, // Not needed for results
      embedding: [], // Not needed for results
      score: hit.score,
    }));
    
    return {
      query,
      sources,
      relevantContent,
      fromCache,
      searchTime: Date.now() - startTime,
    };
    
  } catch (error) {
    return {
      query,
      sources: [],
      relevantContent: [],
      fromCache: false,
      searchTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Web research failed',
    };
  }
}

/**
 * Format web research results for display
 */
export function formatWebResearchResults(result: WebResearchResult): string {
  if (result.error) {
    return `Web research failed: ${result.error}`;
  }
  
  if (result.relevantContent.length === 0) {
    return 'No relevant content found from web search.';
  }
  
  const sections: string[] = [];
  
  // Group chunks by source
  const bySource = new Map<string, WebChunk[]>();
  for (const chunk of result.relevantContent) {
    const key = chunk.url;
    if (!bySource.has(key)) {
      bySource.set(key, []);
    }
    bySource.get(key)!.push(chunk);
  }
  
  // Format each source
  let sourceNum = 1;
  for (const [url, chunks] of bySource) {
    const title = chunks[0]?.title || url;
    const relevance = chunks[0]?.score ? `${(chunks[0].score * 100).toFixed(1)}%` : '';
    
    sections.push(`### Source ${sourceNum}: ${title}`);
    sections.push(`**URL:** ${url}${relevance ? ` | **Relevance:** ${relevance}` : ''}`);
    sections.push('');
    
    // Combine chunks from same source
    const content = chunks.map(c => c.text).join('\n\n');
    sections.push(content);
    sections.push('');
    
    sourceNum++;
  }
  
  // Add metadata
  sections.push('---');
  sections.push(`*${result.fromCache ? 'From cache' : 'Fresh search'} | ${result.sources.length} sources | ${result.searchTime}ms*`);
  
  return sections.join('\n');
}

/**
 * Clear all web search cache
 */
export async function clearWebSearchCache(): Promise<number> {
  // Clear with 0 max age = delete everything
  return cleanExpiredWebCache(0);
}

/**
 * Test web search connection with detailed diagnostics
 */
export async function testWebSearchConnection(): Promise<{
  success: boolean;
  message: string;
  details?: string;
  suggestions?: string[];
}> {
  const settings = loadWebSearchSettings();
  
  // Check configuration first
  switch (settings.provider) {
    case 'searxng':
      if (!settings.searxngUrl) {
        return {
          success: false,
          message: 'SearXNG URL not configured',
          suggestions: ['Enter your SearXNG instance URL (e.g., http://localhost:9191)'],
        };
      }
      break;
    case 'brave':
      if (!settings.braveApiKey) {
        return {
          success: false,
          message: 'Brave Search API key not configured',
          suggestions: [
            'Go to api-dashboard.search.brave.com',
            'Subscribe to a plan (free plan available - you won\'t be charged)',
            'Generate an API key in the "API Keys" section',
          ],
        };
      }
      break;
  }
  
  try {
    const results = await searchWeb('test', 1);
    
    return {
      success: true,
      message: `Connection successful! Found ${results.length} result(s).`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const suggestions: string[] = [];
    
    // Provide specific suggestions based on provider and error
    if (settings.provider === 'brave') {
      if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        suggestions.push(
          'Make sure you have subscribed to a plan at api-dashboard.search.brave.com',
          'Even the free plan requires subscription (you won\'t be charged)',
          'Double-check your API key is copied correctly',
          'Generate a new API key in the "API Keys" section if needed'
        );
      } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        suggestions.push(
          'Subscribe to a plan at api-dashboard.search.brave.com',
          'Your API key may have expired',
          'Generate a new API key if needed'
        );
      } else if (errorMessage.includes('422')) {
        suggestions.push(
          'The API key format appears incorrect',
          'Copy the full API key from api-dashboard.search.brave.com',
          'Make sure there are no extra spaces'
        );
      } else if (errorMessage.includes('429') || errorMessage.includes('Rate limit')) {
        suggestions.push(
          'You\'ve hit your monthly query limit',
          'Wait until next month or upgrade your plan',
          'Free plan includes 2,000 queries/month'
        );
      } else if (errorMessage.includes('Cannot connect') || errorMessage.includes('Failed to fetch') || errorMessage.includes('Connection error')) {
        suggestions.push(
          'Check your internet connection',
          'Verify your API key is correct',
          'Try again in a few moments'
        );
      }
    } else if (settings.provider === 'searxng') {
      if (errorMessage.includes('Cannot connect')) {
        suggestions.push(
          `Check if SearXNG is running at ${settings.searxngUrl}`,
          'Verify the URL is correct',
          'Check your firewall settings'
        );
      } else if (errorMessage.includes('404')) {
        suggestions.push(
          'Verify the SearXNG URL is correct',
          'Make sure SearXNG is properly installed and running'
        );
      } else if (errorMessage.includes('JSON')) {
        suggestions.push(
          'Enable JSON format in SearXNG settings',
          'Check that the URL points to a SearXNG instance'
        );
      } else {
        suggestions.push(
          'Check if SearXNG is running',
          'Verify the URL is correct'
        );
      }
    } else if (settings.provider === 'duckduckgo') {
      suggestions.push(
        'Check your internet connection',
        'DuckDuckGo service may be temporarily unavailable',
        'Try again in a few moments'
      );
    }
    
    // If no specific suggestions, add generic ones
    if (suggestions.length === 0) {
      suggestions.push(
        'Check your internet connection',
        'Verify your configuration settings',
        'Try again in a few moments'
      );
    }
    
    return {
      success: false,
      message: errorMessage,
      suggestions,
    };
  }
}

