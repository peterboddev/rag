import { useState, useEffect, useRef, useCallback } from 'react';
import { DocumentChunk } from '../types';

const CHUNK_PAGE_SIZE = 50;

export interface LazyLoadingState {
  visibleChunks: DocumentChunk[];
  hasMore: boolean;
  isLoadingMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement>;
  loadedCount: number;
  totalCount: number;
}

/**
 * Hook that implements progressive lazy loading for chunk lists.
 * Initially renders the first CHUNK_PAGE_SIZE chunks, then loads more
 * as the user scrolls near the bottom using IntersectionObserver.
 */
export function useChunkLazyLoading(allChunks: DocumentChunk[]): LazyLoadingState {
  const [loadedCount, setLoadedCount] = useState(CHUNK_PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset loaded count when chunks change (new data loaded)
  useEffect(() => {
    setLoadedCount(CHUNK_PAGE_SIZE);
    setIsLoadingMore(false);
  }, [allChunks]);

  const loadMore = useCallback(() => {
    if (loadedCount >= allChunks.length || isLoadingMore) return;

    setIsLoadingMore(true);
    // Small delay to show loading indicator and avoid layout thrashing
    const timer = setTimeout(() => {
      setLoadedCount(prev => Math.min(prev + CHUNK_PAGE_SIZE, allChunks.length));
      setIsLoadingMore(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [allChunks.length, loadedCount, isLoadingMore]);

  // Set up IntersectionObserver on the sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visibleChunks = allChunks.slice(0, loadedCount);
  const hasMore = loadedCount < allChunks.length;

  return {
    visibleChunks,
    hasMore,
    isLoadingMore,
    sentinelRef,
    loadedCount,
    totalCount: allChunks.length,
  };
}

export { CHUNK_PAGE_SIZE };
