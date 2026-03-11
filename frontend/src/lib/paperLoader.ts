/**
 * Paper loading — fetches all paper data from Zotero and prepares
 * a paper_context message for the backend.
 */

import {
  fetchItemDetails,
  fetchItemChildren,
  fetchItemFulltext,
  extractYear,
  getVenue,
} from "./zoteroApi";
import type { ZoteroItem, ZoteroItemData } from "./zoteroApi";
import type {
  PaperMetadata,
  PaperAnnotation,
  PaperContextMessage,
} from "./protocol";

export interface LoadPaperResult {
  message: PaperContextMessage;
  title: string;
  pdfAttachmentKey: string | null;
}

/**
 * Load all data for a paper and build a paper_context message.
 *
 * Fetches in parallel: item details, children (attachments/annotations), fulltext.
 * Returns a PaperContextMessage ready to send via WebSocket.
 */
export async function loadPaper(paperKey: string): Promise<LoadPaperResult> {
  // Parallel fetch: details + children
  const [details, children] = await Promise.all([
    fetchItemDetails(paperKey),
    fetchItemChildren(paperKey),
  ]);

  const data: ZoteroItemData = details.data;

  // Find PDF attachment
  const pdfAttachment: ZoteroItem | undefined = children.find(
    (child: ZoteroItem) =>
      child.data.itemType === "attachment" &&
      child.data.contentType === "application/pdf",
  );

  // Fetch fulltext from the PDF attachment (not the parent item)
  let fulltext: string = "";
  if (pdfAttachment) {
    const ft: string | null = await fetchItemFulltext(pdfAttachment.key);
    if (ft) {
      fulltext = ft;
    }
  }

  // Extract annotations from children
  const annotations: PaperAnnotation[] = children
    .filter((child: ZoteroItem) => child.data.itemType === "annotation")
    .map((ann: ZoteroItem): PaperAnnotation => ({
      key: ann.key,
      type: (ann.data as Record<string, unknown>).annotationType as
        | "highlight"
        | "note"
        | "image",
      comment: (ann.data as Record<string, unknown>).annotationComment as
        | string
        | undefined,
      text: (ann.data as Record<string, unknown>).annotationText as
        | string
        | undefined,
      pageLabel: (ann.data as Record<string, unknown>).annotationPageLabel as
        | string
        | undefined,
      color: (ann.data as Record<string, unknown>).annotationColor as
        | string
        | undefined,
    }));

  // Also check if the PDF attachment has its own children (nested annotations)
  let nestedAnnotations: PaperAnnotation[] = [];
  if (pdfAttachment) {
    try {
      const pdfChildren: ZoteroItem[] = await fetchItemChildren(
        pdfAttachment.key,
      );
      nestedAnnotations = pdfChildren
        .filter((child: ZoteroItem) => child.data.itemType === "annotation")
        .map((ann: ZoteroItem): PaperAnnotation => ({
          key: ann.key,
          type: (ann.data as Record<string, unknown>).annotationType as
            | "highlight"
            | "note"
            | "image",
          comment: (ann.data as Record<string, unknown>)
            .annotationComment as string | undefined,
          text: (ann.data as Record<string, unknown>).annotationText as
            | string
            | undefined,
          pageLabel: (ann.data as Record<string, unknown>)
            .annotationPageLabel as string | undefined,
          color: (ann.data as Record<string, unknown>).annotationColor as
            | string
            | undefined,
        }));
    } catch {
      // Nested children fetch failed — non-critical
    }
  }

  const allAnnotations: PaperAnnotation[] = [
    ...annotations,
    ...nestedAnnotations,
  ];

  // Build metadata
  const authors: string[] = data.creators
    .filter((c) => c.creatorType === "author")
    .map((c) => {
      if (c.name) return c.name;
      return [c.firstName, c.lastName].filter(Boolean).join(" ");
    });

  const metadata: PaperMetadata = {
    key: paperKey,
    title: data.title || "Untitled",
    authors,
    year: parseInt(extractYear(data.date), 10) || 0,
    doi: data.DOI,
    abstract: data.abstractNote,
    journal: getVenue(data),
    tags: data.tags.map((t) => t.tag),
    collections: data.collections,
  };

  const title: string = data.title || "Untitled";

  const message: PaperContextMessage = {
    type: "paper_context",
    paperKey,
    fulltext,
    metadata: {
      ...metadata,
      pdfAttachmentKey: pdfAttachment?.key ?? "",
    } as PaperMetadata & { pdfAttachmentKey: string },
    annotations: allAnnotations,
  };

  return {
    message,
    title,
    pdfAttachmentKey: pdfAttachment?.key ?? null,
  };
}
