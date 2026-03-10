// ============================================================
// PaperBrowser Component
// Colloquia — Voice-powered AI Research Assistant
//
// Main content area for lobby mode: browse/search Zotero library.
// Layout: collection sidebar | paper list | paper detail panel
// ============================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ZoteroItem,
  ZoteroCollection,
} from "../lib/zoteroApi";
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

// ------------------------------------------------------------
// Props
// ------------------------------------------------------------

interface PaperBrowserProps {
  onPaperSelect?: (paperKey: string) => void;
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

function LoadingSpinner(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }): React.ReactElement {
  return (
    <div className="mx-4 my-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
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
}

function CollectionSidebar({
  collections,
  activeKey,
  onSelect,
  loading,
  error,
}: CollectionSidebarProps): React.ReactElement {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <h2 className="border-b border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Collections
      </h2>

      {loading && <LoadingSpinner />}
      {error && <ErrorBanner message={error} />}

      {!loading && !error && (
        <nav className="flex-1 overflow-y-auto">
          <button
            onClick={() => onSelect(null)}
            className={`w-full px-4 py-2 text-left text-sm transition-colors ${
              activeKey === null
                ? "bg-blue-50 font-medium text-blue-700"
                : "text-gray-700 hover:bg-gray-100"
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
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "text-gray-700 hover:bg-gray-100"
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
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
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
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-9 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {value.length > 0 && (
        <button
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
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
      className={`w-full border-b border-gray-100 px-4 py-3 text-left transition-colors ${
        isSelected
          ? "bg-blue-50 border-l-2 border-l-blue-600"
          : "hover:bg-gray-50"
      }`}
    >
      <p
        className={`text-sm leading-snug ${isSelected ? "font-semibold text-blue-900" : "font-medium text-gray-900"}`}
      >
        {item.data.title || "Untitled"}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {authors}
        {year && ` (${year})`}
        {venue && (
          <>
            {" "}
            &mdash;{" "}
            <span className="italic">{venue}</span>
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
        <h2 className="text-xl font-bold leading-tight text-gray-900">
          {data.title || "Untitled"}
        </h2>

        {/* Authors */}
        <p className="mt-2 text-sm text-gray-600">{authors}</p>

        {/* Year & Venue */}
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
          {year && <span>{year}</span>}
          {year && venue && <span>&middot;</span>}
          {venue && <span className="italic">{venue}</span>}
        </div>

        {/* DOI */}
        {data.DOI && (
          <p className="mt-2 text-xs text-gray-400">
            DOI:{" "}
            <a
              href={`https://doi.org/${data.DOI}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline hover:text-blue-700"
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
                className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
              >
                {t.tag}
              </span>
            ))}
          </div>
        )}

        {/* Abstract */}
        {data.abstractNote && (
          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Abstract
            </h3>
            <p className="text-sm leading-relaxed text-gray-700">
              {data.abstractNote}
            </p>
          </div>
        )}

        {/* Open Discussion button */}
        <button
          onClick={onOpenDiscussion}
          className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Open Discussion
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
  // Fetch collections on mount
  // ----------------------------------------------------------
  useEffect(() => {
    let cancelled: boolean = false;

    const load = async (): Promise<void> => {
      setCollectionsLoading(true);
      setCollectionsError(null);
      try {
        const result: ZoteroCollection[] = await fetchCollections();
        if (!cancelled) {
          setCollections(result);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message: string =
            err instanceof Error ? err.message : "Failed to load collections";
          setCollectionsError(message);
        }
      } finally {
        if (!cancelled) {
          setCollectionsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Debounced search
  // ----------------------------------------------------------
  const handleSearchChange = useCallback(
    (value: string): void => {
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
    },
    [],
  );

  const handleClearSearch = useCallback((): void => {
    setSearchQuery("");
    setIsSearching(false);
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------
  const handleCollectionSelect = useCallback(
    (key: string | null): void => {
      setActiveCollection(key);
      setSearchQuery("");
      setIsSearching(false);
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
      }
    },
    [],
  );

  const handlePaperClick = useCallback(
    (item: ZoteroItem): void => {
      setSelectedPaper(item);
      onPaperSelect?.(item.key);
    },
    [onPaperSelect],
  );

  const handleOpenDiscussion = useCallback((): void => {
    // Placeholder -- will be wired to WebSocket later
  }, []);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Collection sidebar */}
      <CollectionSidebar
        collections={collections}
        activeKey={activeCollection}
        onSelect={handleCollectionSelect}
        loading={collectionsLoading}
        error={collectionsError}
      />

      {/* Paper list */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-gray-200">
        {/* Search */}
        <div className="border-b border-gray-200 p-3">
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

      {/* Detail panel */}
      <div className="hidden w-96 shrink-0 flex-col lg:flex">
        {selectedPaper ? (
          <PaperDetail
            item={selectedPaper}
            onOpenDiscussion={handleOpenDiscussion}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-400">
            Select a paper to view details
          </div>
        )}
      </div>
    </div>
  );
}

export default PaperBrowser;
