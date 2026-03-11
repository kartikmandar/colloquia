// ============================================================
// PaperBrowser Component
// Colloquia — Voice-powered AI Research Assistant
//
// Main content area for lobby mode: browse/search Zotero library.
// Layout: collection sidebar | paper list | paper detail panel
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import { Panel, Group } from "react-resizable-panels";
import type { ZoteroItem, ZoteroCollection } from "../lib/zoteroApi";
import {
  fetchTopItems,
  fetchCollections,
  fetchCollectionItems,
  searchItems,
  formatAuthorsShort,
  formatAuthorsFull,
  extractYear,
  getVenue,
} from "../lib/zoteroApi";
import ResizeHandle from "./ResizeHandle";

// ------------------------------------------------------------
// Props
// ------------------------------------------------------------

interface PaperBrowserProps {
  onPaperSelect?: (paperKey: string) => void;
  onOpenDiscussion?: (paperKey: string) => void;
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

function LoadingSpinner(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-border-primary border-t-accent-primary" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): React.ReactElement {
  return (
    <div className="mx-4 my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="mb-3 h-12 w-12"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ------------------------------------------------------------
// Collection Sidebar
// ------------------------------------------------------------

interface CollectionSidebarProps {
  collections: ZoteroCollection[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}

function CollectionSidebar({
  collections,
  activeKey,
  onSelect,
  loading,
  error,
  onRefresh,
  refreshing,
}: CollectionSidebarProps): React.ReactElement {
  return (
    <aside className="flex h-full flex-col border-r border-border-primary bg-surface-secondary">
      <h2 className="flex items-center justify-between border-b border-border-primary px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Collections
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-secondary disabled:opacity-50"
          aria-label="Refresh collections"
          title="Refresh collections"
        >
          <svg
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h5M20 20v-5h-5M20.49 9A9 9 0 0 0 5.64 5.64L4 4m15.36 15.36A9 9 0 0 1 3.51 15"
            />
          </svg>
        </button>
      </h2>

      {loading && <LoadingSpinner />}
      {error && <ErrorBanner message={error} />}

      {!loading && !error && (
        <nav className="flex-1 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className={`w-full px-4 py-2 text-left text-sm transition-colors ${
              activeKey === null
                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                : "text-text-primary hover:bg-surface-tertiary"
            }`}
          >
            All Papers
          </button>
          {collections.map((col: ZoteroCollection) => (
            <button
              key={col.key}
              onClick={() => onSelect(col.key)}
              className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                activeKey === col.key
                  ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                  : "text-text-primary hover:bg-surface-tertiary"
              }`}
            >
              {col.data.name}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}

// ------------------------------------------------------------
// Search Bar
// ------------------------------------------------------------

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

function SearchBar({
  value,
  onChange,
  onClear,
}: SearchBarProps): React.ReactElement {
  return (
    <div className="relative">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        placeholder="Search papers..."
        className="w-full rounded-lg border border-border-primary bg-surface-primary py-2 pl-10 pr-9 text-sm text-text-primary placeholder-text-tertiary outline-none transition-colors focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20"
      />
      {value.length > 0 && (
        <button
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
          aria-label="Clear search"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Paper List Row
// ------------------------------------------------------------

interface PaperRowProps {
  item: ZoteroItem;
  isSelected: boolean;
  onSelect: () => void;
}

function PaperRow({
  item,
  isSelected,
  onSelect,
}: PaperRowProps): React.ReactElement {
  const year: string = extractYear(item.data.date);
  const venue: string = getVenue(item.data);
  const authors: string = formatAuthorsShort(item.data.creators);

  return (
    <button
      onClick={onSelect}
      className={`w-full border-b border-border-secondary px-4 py-3 text-left transition-colors ${
        isSelected
          ? "bg-blue-50 border-l-2 border-l-blue-600 dark:bg-blue-950 dark:border-l-blue-400"
          : "hover:bg-surface-secondary"
      }`}
    >
      <p
        className={`text-sm leading-snug ${isSelected ? "font-semibold text-blue-900 dark:text-blue-300" : "font-medium text-text-primary"}`}
      >
        {item.data.title || "Untitled"}
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        {authors}
        {year && ` (${year})`}
        {venue && (
          <>
            {" "}
            &mdash; <span className="italic">{venue}</span>
          </>
        )}
      </p>
    </button>
  );
}

// ------------------------------------------------------------
// Paper Detail Panel
// ------------------------------------------------------------

interface PaperDetailProps {
  item: ZoteroItem;
  onOpenDiscussion: () => void;
}

function PaperDetail({
  item,
  onOpenDiscussion,
}: PaperDetailProps): React.ReactElement {
  const { data } = item;
  const year: string = extractYear(data.date);
  const venue: string = getVenue(data);
  const authors: string = formatAuthorsFull(data.creators);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="p-6">
        {/* Title */}
        <h2 className="text-xl font-bold leading-tight text-text-primary">
          {data.title || "Untitled"}
        </h2>

        {/* Authors */}
        <p className="mt-2 text-sm text-text-secondary">{authors}</p>

        {/* Year & Venue */}
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-secondary">
          {year && <span>{year}</span>}
          {year && venue && <span>&middot;</span>}
          {venue && <span className="italic">{venue}</span>}
        </div>

        {/* DOI */}
        {data.DOI && (
          <p className="mt-2 text-xs text-text-tertiary">
            DOI:{" "}
            <a
              href={`https://doi.org/${data.DOI}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary underline transition-colors hover:text-accent-primary-hover"
            >
              {data.DOI}
            </a>
          </p>
        )}

        {/* Tags */}
        {data.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.tags.map((t: { tag: string }, i: number) => (
              <span
                key={i}
                className="inline-block rounded-full bg-surface-tertiary px-2.5 py-0.5 text-xs font-medium text-text-secondary"
              >
                {t.tag}
              </span>
            ))}
          </div>
        )}

        {/* Abstract */}
        {data.abstractNote && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Abstract
            </h3>
            <p className="text-sm leading-relaxed text-text-primary">
              {data.abstractNote}
            </p>
          </div>
        )}

        {/* Open Discussion button */}
        <button
          onClick={onOpenDiscussion}
          className="mt-6 w-full rounded-lg bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary-hover focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2"
        >
          Add to chat context
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Main PaperBrowser Component
// ------------------------------------------------------------

function PaperBrowser({
  onPaperSelect,
  onOpenDiscussion,
}: PaperBrowserProps): React.ReactElement {
  // -- Collections state --
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState<boolean>(true);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  // -- Papers state --
  const [papers, setPapers] = useState<ZoteroItem[]>([]);
  const [papersLoading, setPapersLoading] = useState<boolean>(true);
  const [papersError, setPapersError] = useState<string | null>(null);

  // -- Search state --
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Selection state --
  const [selectedPaper, setSelectedPaper] = useState<ZoteroItem | null>(null);

  // ----------------------------------------------------------
  // Refresh collections (reusable callback)
  // ----------------------------------------------------------
  const refreshCollections = useCallback(async (): Promise<void> => {
    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const result: ZoteroCollection[] = await fetchCollections();
      setCollections(result);
    } catch (err: unknown) {
      const message: string =
        err instanceof Error ? err.message : "Failed to load collections";
      setCollectionsError(message);
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  // Fetch collections on mount
  useEffect(() => {
    void refreshCollections();
  }, [refreshCollections]);

  // ----------------------------------------------------------
  // Fetch papers when collection changes (and no search)
  // ----------------------------------------------------------
  const loadPapers = useCallback(
    async (collectionKey: string | null): Promise<void> => {
      setPapersLoading(true);
      setPapersError(null);
      setSelectedPaper(null);
      try {
        const result: ZoteroItem[] =
          collectionKey === null
            ? await fetchTopItems()
            : await fetchCollectionItems(collectionKey);
        setPapers(result);
      } catch (err: unknown) {
        const message: string =
          err instanceof Error ? err.message : "Failed to load papers";
        setPapersError(message);
      } finally {
        setPapersLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (searchQuery.length === 0) {
      void loadPapers(activeCollection);
    }
  }, [activeCollection, searchQuery, loadPapers]);

  // ----------------------------------------------------------
  // Refresh all (collections + current papers)
  // ----------------------------------------------------------
  const refreshAll = useCallback(async (): Promise<void> => {
    await refreshCollections();
    if (!isSearching) {
      await loadPapers(activeCollection);
    }
  }, [refreshCollections, isSearching, activeCollection, loadPapers]);

  // ----------------------------------------------------------
  // Auto-refresh every 2 minutes
  // ----------------------------------------------------------
  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void refreshAll();
    }, 120_000);
    return (): void => clearInterval(interval);
  }, [refreshAll]);

  // ----------------------------------------------------------
  // Debounced search
  // ----------------------------------------------------------
  const handleSearchChange = useCallback((value: string): void => {
    setSearchQuery(value);

    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }

    if (value.trim().length === 0) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      setPapersLoading(true);
      setPapersError(null);
      try {
        const result: ZoteroItem[] = await searchItems(value.trim());
        setPapers(result);
      } catch (err: unknown) {
        const message: string =
          err instanceof Error ? err.message : "Search failed";
        setPapersError(message);
      } finally {
        setPapersLoading(false);
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleClearSearch = useCallback((): void => {
    setSearchQuery("");
    setIsSearching(false);
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return (): void => {
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------
  const handleCollectionSelect = useCallback((key: string | null): void => {
    setActiveCollection(key);
    setSearchQuery("");
    setIsSearching(false);
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }
  }, []);

  const handlePaperClick = useCallback(
    (item: ZoteroItem): void => {
      setSelectedPaper(item);
      onPaperSelect?.(item.key);
    },
    [onPaperSelect],
  );

  const handleOpenDiscussion = useCallback((): void => {
    if (selectedPaper) {
      onOpenDiscussion?.(selectedPaper.key);
    }
  }, [selectedPaper, onOpenDiscussion]);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-border-primary bg-surface-primary shadow-panel">
      <Group orientation="horizontal">
        <Panel defaultSize="20%" minSize="12%" maxSize="30%">
          {/* Collection sidebar */}
          <CollectionSidebar
            collections={collections}
            activeKey={activeCollection}
            onSelect={handleCollectionSelect}
            loading={collectionsLoading}
            error={collectionsError}
            onRefresh={refreshAll}
            refreshing={collectionsLoading}
          />
        </Panel>
        <ResizeHandle />
        <Panel defaultSize="45%" minSize="20%">
          {/* Paper list */}
          <div className="flex h-full min-w-0 flex-col border-r border-border-primary">
            {/* Search */}
            <div className="border-b border-border-primary p-3">
              <SearchBar
                value={searchQuery}
                onChange={handleSearchChange}
                onClear={handleClearSearch}
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {papersLoading || isSearching ? (
                <LoadingSpinner />
              ) : papersError ? (
                <ErrorBanner message={papersError} />
              ) : papers.length === 0 ? (
                <EmptyState
                  message={
                    searchQuery.length > 0
                      ? "No results found"
                      : "No papers in this collection"
                  }
                />
              ) : (
                papers.map((item: ZoteroItem) => (
                  <PaperRow
                    key={item.key}
                    item={item}
                    isSelected={selectedPaper?.key === item.key}
                    onSelect={() => handlePaperClick(item)}
                  />
                ))
              )}
            </div>
          </div>
        </Panel>
        <ResizeHandle />
        <Panel defaultSize="35%" minSize="20%">
          {/* Detail panel */}
          <div className="flex h-full flex-col">
            {selectedPaper ? (
              <PaperDetail
                item={selectedPaper}
                onOpenDiscussion={handleOpenDiscussion}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-text-tertiary">
                Select a paper to view details
              </div>
            )}
          </div>
        </Panel>
      </Group>
    </div>
  );
}

export default PaperBrowser;
