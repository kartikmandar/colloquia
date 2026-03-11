// ============================================================
// Zotero API Client
// Colloquia — Voice-powered AI Research Assistant
// ============================================================

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface ZoteroTag {
  tag: string;
  type?: number;
}

export interface ZoteroItemData {
  key: string;
  version: number;
  itemType: string;
  title: string;
  creators: ZoteroCreator[];
  date: string;
  publicationTitle?: string;
  abstractNote?: string;
  DOI?: string;
  tags: ZoteroTag[];
  collections: string[];
  url?: string;
  journalAbbreviation?: string;
  conferenceName?: string;
  proceedingsTitle?: string;
  bookTitle?: string;
  university?: string;
  institution?: string;
  parentItem?: string;
  contentType?: string;
  [extra: string]: unknown;
}

export interface ZoteroItem {
  key: string;
  version: number;
  library: Record<string, unknown>;
  data: ZoteroItemData;
  meta?: Record<string, unknown>;
}

export interface ZoteroCollectionData {
  key: string;
  version: number;
  name: string;
  parentCollection: string | false;
}

export interface ZoteroCollection {
  key: string;
  version: number;
  library: Record<string, unknown>;
  data: ZoteroCollectionData;
  meta?: Record<string, unknown>;
}

export interface ZoteroFulltextResponse {
  content: string;
  indexedPages?: number;
  totalPages?: number;
}

// ------------------------------------------------------------
// Allowed document item types
// ------------------------------------------------------------

export const DOCUMENT_ITEM_TYPES: ReadonlySet<string> = new Set([
  "journalArticle",
  "conferencePaper",
  "preprint",
  "book",
  "bookSection",
  "thesis",
  "report",
  "manuscript",
]);

// ------------------------------------------------------------
// Fetch wrapper
// ------------------------------------------------------------

export class ZoteroApiError extends Error {
  public status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ZoteroApiError";
    this.status = status;
  }
}

async function zoteroFetch<T>(path: string): Promise<T> {
  const url: string = `/zotero-api${path}`;
  const response: Response = await fetch(url);

  if (!response.ok) {
    throw new ZoteroApiError(
      `Zotero API error: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const data: T = (await response.json()) as T;
  return data;
}

// ------------------------------------------------------------
// Public API functions
// ------------------------------------------------------------

export async function fetchTopItems(limit: number = 50): Promise<ZoteroItem[]> {
  const items: ZoteroItem[] = await zoteroFetch<ZoteroItem[]>(
    `/users/0/items/top?limit=${limit}&sort=dateModified&direction=desc`,
  );
  return items.filter((item: ZoteroItem) =>
    DOCUMENT_ITEM_TYPES.has(item.data.itemType),
  );
}

export async function fetchCollections(): Promise<ZoteroCollection[]> {
  return zoteroFetch<ZoteroCollection[]>(`/users/0/collections`);
}

export async function fetchCollectionItems(
  collectionKey: string,
  limit: number = 50,
): Promise<ZoteroItem[]> {
  const items: ZoteroItem[] = await zoteroFetch<ZoteroItem[]>(
    `/users/0/collections/${collectionKey}/items/top?limit=${limit}`,
  );
  return items.filter((item: ZoteroItem) =>
    DOCUMENT_ITEM_TYPES.has(item.data.itemType),
  );
}

export async function searchItems(
  query: string,
  limit: number = 25,
): Promise<ZoteroItem[]> {
  const encoded: string = encodeURIComponent(query);
  const items: ZoteroItem[] = await zoteroFetch<ZoteroItem[]>(
    `/users/0/items?q=${encoded}&qmode=everything&limit=${limit}`,
  );
  return items.filter((item: ZoteroItem) =>
    DOCUMENT_ITEM_TYPES.has(item.data.itemType),
  );
}

export async function fetchItemDetails(itemKey: string): Promise<ZoteroItem> {
  return zoteroFetch<ZoteroItem>(`/users/0/items/${itemKey}`);
}

export async function fetchItemChildren(
  itemKey: string,
): Promise<ZoteroItem[]> {
  return zoteroFetch<ZoteroItem[]>(`/users/0/items/${itemKey}/children`);
}

export async function fetchItemFulltext(
  itemKey: string,
): Promise<string | null> {
  try {
    const result: ZoteroFulltextResponse =
      await zoteroFetch<ZoteroFulltextResponse>(
        `/users/0/items/${itemKey}/fulltext`,
      );
    return result.content ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Formats a list of creators into a short author string.
 * Returns "LastName" for 1 author, "Last1 & Last2" for 2,
 * or "Last1 et al." for 3+.
 */
export function formatAuthorsShort(creators: ZoteroCreator[]): string {
  const authors: ZoteroCreator[] = creators.filter(
    (c: ZoteroCreator) => c.creatorType === "author",
  );
  if (authors.length === 0) return "Unknown";

  const lastName = (c: ZoteroCreator): string =>
    c.lastName ?? c.name ?? "Unknown";

  if (authors.length === 1) return lastName(authors[0]);
  if (authors.length === 2)
    return `${lastName(authors[0])} & ${lastName(authors[1])}`;
  return `${lastName(authors[0])} et al.`;
}

/**
 * Formats the full author list.
 */
export function formatAuthorsFull(creators: ZoteroCreator[]): string {
  const authors: ZoteroCreator[] = creators.filter(
    (c: ZoteroCreator) => c.creatorType === "author",
  );
  if (authors.length === 0) return "Unknown";

  return authors
    .map((c: ZoteroCreator) => {
      if (c.name) return c.name;
      return [c.firstName, c.lastName].filter(Boolean).join(" ");
    })
    .join(", ");
}

/**
 * Extracts a 4-digit year from the Zotero date string.
 */
export function extractYear(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const match: RegExpMatchArray | null = dateStr.match(/\d{4}/);
  return match ? match[0] : dateStr;
}

/**
 * Gets the venue/journal name from item data.
 */
export function getVenue(data: ZoteroItemData): string {
  return (
    data.publicationTitle ??
    data.conferenceName ??
    data.proceedingsTitle ??
    data.bookTitle ??
    data.university ??
    data.institution ??
    ""
  );
}
