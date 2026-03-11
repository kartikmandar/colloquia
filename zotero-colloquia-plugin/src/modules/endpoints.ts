/**
 * Colloquia HTTP Endpoints — registered via Zotero.Server.Endpoints
 *
 * All endpoints are POST and accept/return JSON.
 * Endpoint path format: /colloquia/<action>
 *
 * These are called by the Colloquia frontend (via Vite proxy) when the
 * backend delegates Zotero write operations.
 */

const PLUGIN_VERSION = "0.1.0";

// Track registered endpoint paths for cleanup
const registeredPaths: string[] = [];

/**
 * Helper to parse JSON body from a Zotero HTTP request.
 */
function parseBody(data: string | object | undefined): Record<string, any> {
  if (!data) return {};
  // Zotero may pass data as already-parsed object or as string
  if (typeof data === "object") return data as Record<string, any>;
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Helper to create a JSON success response.
 */
function jsonResponse(
  statusCode: number,
  body: Record<string, any>,
): [number, string, string] {
  return [statusCode, "application/json", JSON.stringify(body)];
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/ping — Health check
// ---------------------------------------------------------------------------

class PingEndpoint {
  supportedMethods = ["GET", "POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  init(
    _request: Record<string, any>,
  ): [number, string, string] {
    return jsonResponse(200, {
      status: "ok",
      version: PLUGIN_VERSION,
      plugin: "colloquia",
    });
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/createNote
// ---------------------------------------------------------------------------

class CreateNoteEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { parentItemKey, noteContent, tags } = body;

      if (!parentItemKey || !noteContent) {
        return jsonResponse(400, {
          error: "Missing required fields: parentItemKey, noteContent",
        });
      }

      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        parentItemKey,
      );
      if (!parentItem) {
        return jsonResponse(404, { error: `Item not found: ${parentItemKey}` });
      }

      const note = new Zotero.Item("note");
      note.libraryID = Zotero.Libraries.userLibraryID;
      note.parentKey = parentItemKey;
      note.setNote(noteContent);

      // Add tags if provided
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          note.addTag(String(tag), 0); // type 0 = user tag
        }
      }

      await note.saveTx();

      return jsonResponse(200, { noteKey: note.key });
    } catch (e: any) {
      ztoolkit.log(`createNote error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/addTags
// ---------------------------------------------------------------------------

class AddTagsEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKeys, tags } = body;

      if (!Array.isArray(itemKeys) || !Array.isArray(tags)) {
        return jsonResponse(400, {
          error: "Missing required fields: itemKeys[], tags[]",
        });
      }

      let modified = 0;
      for (const key of itemKeys) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!item) continue;

        let changed = false;
        for (const tag of tags) {
          if (!item.hasTag(String(tag))) {
            item.addTag(String(tag), 0);
            changed = true;
          }
        }

        if (changed) {
          await item.saveTx();
          modified++;
        }
      }

      return jsonResponse(200, { modified });
    } catch (e: any) {
      ztoolkit.log(`addTags error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/removeTags
// ---------------------------------------------------------------------------

class RemoveTagsEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKeys, tags } = body;

      if (!Array.isArray(itemKeys) || !Array.isArray(tags)) {
        return jsonResponse(400, {
          error: "Missing required fields: itemKeys[], tags[]",
        });
      }

      let modified = 0;
      for (const key of itemKeys) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!item) continue;

        let changed = false;
        for (const tag of tags) {
          if (item.hasTag(String(tag))) {
            item.removeTag(String(tag));
            changed = true;
          }
        }

        if (changed) {
          await item.saveTx();
          modified++;
        }
      }

      return jsonResponse(200, { modified });
    } catch (e: any) {
      ztoolkit.log(`removeTags error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/addRelated
// ---------------------------------------------------------------------------

class AddRelatedEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKey1, itemKey2 } = body;

      if (!itemKey1 || !itemKey2) {
        return jsonResponse(400, {
          error: "Missing required fields: itemKey1, itemKey2",
        });
      }

      const libID = Zotero.Libraries.userLibraryID;
      const item1 = await Zotero.Items.getByLibraryAndKeyAsync(
        libID,
        itemKey1,
      );
      const item2 = await Zotero.Items.getByLibraryAndKeyAsync(
        libID,
        itemKey2,
      );

      if (!item1 || !item2) {
        return jsonResponse(404, {
          error: `Item not found: ${!item1 ? itemKey1 : itemKey2}`,
        });
      }

      // Bidirectional linking
      item1.addRelatedItem(item2);
      item2.addRelatedItem(item1);

      await item1.saveTx();
      await item2.saveTx();

      return jsonResponse(200, { success: true });
    } catch (e: any) {
      ztoolkit.log(`addRelated error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/searchLibrary
// ---------------------------------------------------------------------------

class SearchLibraryEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { query, tag, collection, author, dateRange } = body;

      const s = new Zotero.Search();
      (s as any).libraryID = Zotero.Libraries.userLibraryID;

      // Add search conditions based on provided filters
      if (query) {
        s.addCondition("quicksearch-titleCreatorYear", "contains", query);
      }

      if (tag) {
        s.addCondition("tag", "is", tag);
      }

      if (collection) {
        s.addCondition("collection", "is", collection);
      }

      if (author) {
        s.addCondition("creator", "contains", author);
      }

      if (dateRange) {
        if (dateRange.start) {
          s.addCondition("date", "isAfter", dateRange.start);
        }
        if (dateRange.end) {
          s.addCondition("date", "isBefore", dateRange.end);
        }
      }

      // If no conditions were added, get all items
      if (!query && !tag && !collection && !author && !dateRange) {
        s.addCondition("itemType", "isNot", "attachment");
        s.addCondition("itemType", "isNot", "note");
      }

      const ids: number[] = await s.search();
      const items = await Zotero.Items.getAsync(ids);

      // Serialize to lightweight JSON
      const results = items
        .filter((item: any) => item.isRegularItem())
        .slice(0, 50) // Limit results
        .map((item: any) => ({
          key: item.key,
          itemType: item.itemType,
          title: item.getField("title"),
          creators: item.getCreators().map((c: any) => ({
            firstName: c.firstName || "",
            lastName: c.lastName || "",
            creatorType: c.creatorType,
          })),
          date: item.getField("date"),
          year: item.getField("year"),
          DOI: item.getField("DOI"),
          abstractNote: item.getField("abstractNote"),
          publicationTitle: item.getField("publicationTitle"),
          tags: item.getTags().map((t: any) => t.tag),
        }));

      return jsonResponse(200, { items: results });
    } catch (e: any) {
      ztoolkit.log(`searchLibrary error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/createAnnotation
// ---------------------------------------------------------------------------

/** Shape of a single rect: [x1, y1, x2, y2]. */
type AnnotationRect = [number, number, number, number];

interface CreateAnnotationBody {
  parentItemKey: string;
  annotationType: "highlight" | "image" | "note";
  pageIndex: number;
  rects: AnnotationRect[];
  comment: string;
  color?: string;
}

/** Default page dimensions in PDF points (8.5 x 11 inches). */
const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

class CreateAnnotationEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body: CreateAnnotationBody = parseBody(request.data) as CreateAnnotationBody;
      const { parentItemKey, annotationType, pageIndex, rects, comment, color } = body;

      // --- Validate required fields ---
      if (!parentItemKey || !annotationType || pageIndex === undefined || !rects || !comment) {
        return jsonResponse(400, {
          error: "Missing required fields: parentItemKey, annotationType, pageIndex, rects, comment",
        });
      }

      if (!["highlight", "image", "note"].includes(annotationType)) {
        return jsonResponse(400, {
          error: `Invalid annotationType: ${annotationType}. Must be "highlight", "image", or "note".`,
        });
      }

      if (!Array.isArray(rects) || rects.length === 0) {
        return jsonResponse(400, {
          error: "rects must be a non-empty array of [x1, y1, x2, y2] coordinates.",
        });
      }

      // --- Validate coordinates ---
      for (const rect of rects) {
        if (!Array.isArray(rect) || rect.length !== 4) {
          return jsonResponse(400, {
            error: "Each rect must be an array of exactly 4 numbers [x1, y1, x2, y2].",
          });
        }

        const [x1, y1, x2, y2]: AnnotationRect = rect;

        // Reject all-zero bounding boxes
        if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) {
          return jsonResponse(400, {
            error: "All-zero bounding box rejected. Coordinates must define a real region.",
          });
        }

        // Reject coordinates exceeding page dimensions
        for (const val of [x1, x2]) {
          if (val < 0 || val > DEFAULT_PAGE_WIDTH) {
            return jsonResponse(400, {
              error: `X coordinate ${val} out of range [0, ${DEFAULT_PAGE_WIDTH}].`,
            });
          }
        }
        for (const val of [y1, y2]) {
          if (val < 0 || val > DEFAULT_PAGE_HEIGHT) {
            return jsonResponse(400, {
              error: `Y coordinate ${val} out of range [0, ${DEFAULT_PAGE_HEIGHT}].`,
            });
          }
        }
      }

      // --- Resolve parent PDF attachment ---
      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        parentItemKey,
      );

      if (!parentItem) {
        return jsonResponse(404, {
          error: `Item not found: ${parentItemKey}`,
        });
      }

      let attachmentItem = parentItem;
      if (!parentItem.isAttachment()) {
        const attachmentIDs = parentItem.getAttachments();
        const attachments = await Zotero.Items.getAsync(attachmentIDs);
        const pdfAttachment = attachments.find(
          (a: any) => a.attachmentContentType === "application/pdf",
        );
        if (!pdfAttachment) {
          return jsonResponse(404, {
            error: "No PDF attachment found for this item.",
          });
        }
        attachmentItem = pdfAttachment;
      }

      // --- Compute sortIndex from first rect ---
      // Format: "NNNNN|NNNNNN|NNNNN" (5|6|5 digits zero-padded)
      const firstRect: AnnotationRect = rects[0];
      const yPos: number = Math.round(firstRect[1]);
      const xPos: number = Math.round(firstRect[0]);
      const sortIndex: string = [
        String(pageIndex).padStart(5, "0"),
        String(yPos).padStart(6, "0"),
        String(xPos).padStart(5, "0"),
      ].join("|");

      // --- Create annotation item ---
      const annotation = new Zotero.Item("annotation");
      annotation.libraryID = Zotero.Libraries.userLibraryID;
      annotation.parentKey = attachmentItem.key;
      annotation.annotationType = annotationType;
      annotation.annotationComment = comment;
      annotation.annotationColor = color || "#a28ae5"; // Colloquia purple
      annotation.annotationPageLabel = String(pageIndex + 1); // 1-indexed
      annotation.annotationPosition = JSON.stringify({
        pageIndex,
        rects,
      });
      (annotation as any).annotationSortIndex = sortIndex;

      await annotation.saveTx();

      // --- Trigger live refresh so annotation appears without reopening ---
      try {
        Zotero.Notifier.trigger("refresh", "item", [annotation.id], {});
      } catch {
        ztoolkit.log("createAnnotation: Notifier.trigger refresh failed, annotation still saved.");
      }

      return jsonResponse(200, { annotationKey: annotation.key });
    } catch (e: any) {
      ztoolkit.log(`createAnnotation error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/addPaper
// ---------------------------------------------------------------------------

interface AddPaperBody {
  doi?: string;
  title?: string;
  authors?: string;
  url?: string;
  abstract?: string;
  collectionKey?: string;
}

class AddPaperEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body: AddPaperBody = parseBody(request.data) as AddPaperBody;
      const { doi, title, authors, url, abstract: paperAbstract, collectionKey } = body;

      if (!doi && !title) {
        return jsonResponse(400, {
          error: "At least one of 'doi' or 'title' is required.",
        });
      }

      let savedItem: any = null;

      // Try DOI import first via Zotero.Translate.Search()
      if (doi) {
        try {
          const translate = new Zotero.Translate.Search();
          translate.setIdentifier({ DOI: doi });
          const translators = await translate.getTranslators();

          if (translators && translators.length > 0) {
            translate.setTranslator(translators);
            const items = await translate.translate({
              libraryID: Zotero.Libraries.userLibraryID,
            });
            if (items && items.length > 0) {
              savedItem = items[0];
            }
          }
        } catch (e: any) {
          ztoolkit.log(`addPaper DOI translate failed, using fallback: ${e.message}`);
        }
      }

      // Fallback: create item manually with provided metadata
      if (!savedItem) {
        const item = new Zotero.Item("journalArticle");
        item.libraryID = Zotero.Libraries.userLibraryID;

        if (title) item.setField("title", title);
        if (doi) item.setField("DOI", doi);
        if (url) item.setField("url", url);
        if (paperAbstract) item.setField("abstractNote", paperAbstract);

        // Parse authors string "First Last, First Last" → creators
        if (authors) {
          const creatorList: Array<{ firstName: string; lastName: string; creatorType: "author" }> = [];
          for (const name of authors.split(",")) {
            const trimmed: string = name.trim();
            if (!trimmed) continue;
            const parts: string[] = trimmed.split(/\s+/);
            const lastName: string = parts.pop() || trimmed;
            const firstName: string = parts.join(" ");
            creatorList.push({
              firstName,
              lastName,
              creatorType: "author",
            });
          }
          item.setCreators(creatorList);
        }

        await item.saveTx();
        savedItem = item;
      }

      // Add to collection if specified
      if (collectionKey && savedItem) {
        const collection = await Zotero.Collections.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          collectionKey,
        );
        if (collection) {
          collection.addItem(savedItem.id);
          await collection.saveTx();
        }
      }

      const resultTitle: string = savedItem?.getField?.("title") || title || "Unknown";
      return jsonResponse(200, {
        itemKey: savedItem.key,
        title: resultTitle,
      });
    } catch (e: any) {
      ztoolkit.log(`addPaper error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/test-doi-import (Phase 3.2a verification)
// ---------------------------------------------------------------------------

class TestDoiImportEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { doi } = body;

      if (!doi) {
        return jsonResponse(400, { error: "Missing required field: doi" });
      }

      // Try Zotero.Translate.Search() with DOI
      const translate = new Zotero.Translate.Search();
      translate.setIdentifier({ DOI: doi });

      const translators = await translate.getTranslators();
      if (!translators || translators.length === 0) {
        return jsonResponse(200, {
          success: false,
          method: "translate",
          error: "No translators found for DOI",
          fallback_available: true,
        });
      }

      translate.setTranslator(translators);

      const items = await translate.translate({ libraryID: false });
      if (items && items.length > 0) {
        const item = items[0];
        return jsonResponse(200, {
          success: true,
          method: "translate",
          title: item.title || "Unknown",
          creators: item.creators || [],
          itemType: item.itemType || "journalArticle",
        });
      }

      return jsonResponse(200, {
        success: false,
        method: "translate",
        error: "Translation returned no items",
        fallback_available: true,
      });
    } catch (e: any) {
      ztoolkit.log(`test-doi-import error: ${e.message}`);
      return jsonResponse(200, {
        success: false,
        method: "translate",
        error: e.message,
        fallback_available: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/test-annotation (Phase 3.2b verification)
// ---------------------------------------------------------------------------

class TestAnnotationEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { parentItemKey, pageIndex, comment } = body;

      if (!parentItemKey) {
        return jsonResponse(400, {
          error: "Missing required field: parentItemKey",
        });
      }

      const pageIdx = pageIndex ?? 0;
      const commentText = comment || "Test annotation from Colloquia";

      // Find the PDF attachment for the parent item
      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        parentItemKey,
      );

      if (!parentItem) {
        return jsonResponse(404, {
          error: `Item not found: ${parentItemKey}`,
        });
      }

      // Get attachment — could be the item itself or a child
      let attachmentItem = parentItem;
      if (!parentItem.isAttachment()) {
        const attachmentIDs = parentItem.getAttachments();
        const attachments = await Zotero.Items.getAsync(attachmentIDs);
        const pdfAttachment = attachments.find(
          (a: any) => a.attachmentContentType === "application/pdf",
        );
        if (!pdfAttachment) {
          return jsonResponse(404, {
            error: "No PDF attachment found for this item",
          });
        }
        attachmentItem = pdfAttachment;
      }

      // Create annotation
      const annotation = new Zotero.Item("annotation");
      annotation.libraryID = Zotero.Libraries.userLibraryID;
      annotation.parentKey = attachmentItem.key;
      annotation.annotationType = "image";
      annotation.annotationComment = commentText;
      annotation.annotationColor = "#a28ae5"; // Colloquia purple
      annotation.annotationPageLabel = String(pageIdx + 1);
      annotation.annotationPosition = JSON.stringify({
        pageIndex: pageIdx,
        rects: [[100, 100, 400, 400]], // Hardcoded test box
      });
      // sortIndex format: "NNNNN|NNNNNN|NNNNN" (5|6|5 digits)
      (annotation as any).annotationSortIndex = `${String(pageIdx).padStart(5, "0")}|000100|00100`;

      await annotation.saveTx();

      // Try to trigger refresh so it appears without reopening
      let refreshMethod = "save-only";
      try {
        Zotero.Notifier.trigger(
          "refresh",
          "item",
          [annotation.id],
          {},
        );
        refreshMethod = "notifier-refresh";
      } catch {
        try {
          Zotero.Notifier.trigger(
            "redraw",
            "item",
            [attachmentItem.id],
            {},
          );
          refreshMethod = "notifier-redraw";
        } catch {
          // Neither worked — needs manual reopen
          refreshMethod = "manual-reopen-needed";
        }
      }

      return jsonResponse(200, {
        success: true,
        annotationKey: annotation.key,
        attachmentKey: attachmentItem.key,
        refreshMethod,
        note: "Check if annotation appeared in the open PDF reader",
      });
    } catch (e: any) {
      ztoolkit.log(`test-annotation error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: GET /colloquia/listCollections
// ---------------------------------------------------------------------------

class ListCollectionsEndpoint {
  supportedMethods = ["GET", "POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    _request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const collections = Zotero.Collections.getByLibrary(
        Zotero.Libraries.userLibraryID,
      );
      const results = [];
      for (const col of collections) {
        results.push({
          key: col.key,
          name: col.name,
          parentCollectionKey: col.parentKey || null,
          itemCount: col.getChildItems(false).length,
        });
      }
      return jsonResponse(200, { collections: results });
    } catch (e: any) {
      ztoolkit.log(`listCollections error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/createCollection
// ---------------------------------------------------------------------------

class CreateCollectionEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { name, parentCollectionKey } = body;

      if (!name) {
        return jsonResponse(400, {
          error: "Missing required field: name",
        });
      }

      const collection = new Zotero.Collection();
      (collection as any).libraryID = Zotero.Libraries.userLibraryID;
      collection.name = name;

      if (parentCollectionKey) {
        collection.parentKey = parentCollectionKey;
      }

      await collection.saveTx();

      return jsonResponse(200, { collectionKey: collection.key });
    } catch (e: any) {
      ztoolkit.log(`createCollection error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/addToCollection
// ---------------------------------------------------------------------------

class AddToCollectionEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKeys, collectionKey } = body;

      if (!Array.isArray(itemKeys) || !collectionKey) {
        return jsonResponse(400, {
          error: "Missing required fields: itemKeys[], collectionKey",
        });
      }

      const collection = await Zotero.Collections.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        collectionKey,
      );
      if (!collection) {
        return jsonResponse(404, {
          error: `Collection not found: ${collectionKey}`,
        });
      }

      let modified = 0;
      for (const key of itemKeys) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!item) continue;

        collection.addItem(item.id);
        modified++;
      }

      await collection.saveTx();

      return jsonResponse(200, { modified });
    } catch (e: any) {
      ztoolkit.log(`addToCollection error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/removeFromCollection
// ---------------------------------------------------------------------------

class RemoveFromCollectionEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKeys, collectionKey } = body;

      if (!Array.isArray(itemKeys) || !collectionKey) {
        return jsonResponse(400, {
          error: "Missing required fields: itemKeys[], collectionKey",
        });
      }

      const collection = await Zotero.Collections.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        collectionKey,
      );
      if (!collection) {
        return jsonResponse(404, {
          error: `Collection not found: ${collectionKey}`,
        });
      }

      let modified = 0;
      for (const key of itemKeys) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!item) continue;

        collection.removeItem(item.id);
        modified++;
      }

      await collection.saveTx();

      return jsonResponse(200, { modified });
    } catch (e: any) {
      ztoolkit.log(`removeFromCollection error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/getAnnotations
// ---------------------------------------------------------------------------

class GetAnnotationsEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKey } = body;

      if (!itemKey) {
        return jsonResponse(400, {
          error: "Missing required field: itemKey",
        });
      }

      const parentItem = await Zotero.Items.getByLibraryAndKeyAsync(
        Zotero.Libraries.userLibraryID,
        itemKey,
      );
      if (!parentItem) {
        return jsonResponse(404, {
          error: `Item not found: ${itemKey}`,
        });
      }

      // Find the PDF attachment
      let attachmentItem = parentItem;
      if (!parentItem.isAttachment()) {
        const attachmentIDs = parentItem.getAttachments();
        const attachments = await Zotero.Items.getAsync(attachmentIDs);
        const pdfAttachment = attachments.find(
          (a: any) => a.attachmentContentType === "application/pdf",
        );
        if (!pdfAttachment) {
          return jsonResponse(404, {
            error: "No PDF attachment found for this item.",
          });
        }
        attachmentItem = pdfAttachment;
      }

      // Get annotation children
      const annotationItems: any[] = attachmentItem.getAnnotations();

      const annotations = annotationItems.map((ann: any) => {
        let position = {};
        try {
          position = JSON.parse(ann.annotationPosition || "{}");
        } catch {
          // leave as empty object
        }

        return {
          key: ann.key,
          annotationType: ann.annotationType,
          comment: ann.annotationComment || "",
          color: ann.annotationColor || "",
          pageLabel: ann.annotationPageLabel || "",
          position,
        };
      });

      return jsonResponse(200, { annotations });
    } catch (e: any) {
      ztoolkit.log(`getAnnotations error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Endpoint: POST /colloquia/trashItems
// ---------------------------------------------------------------------------

class TrashItemsEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(
    request: Record<string, any>,
  ): Promise<[number, string, string]> {
    try {
      const body = parseBody(request.data);
      const { itemKeys } = body;

      if (!Array.isArray(itemKeys)) {
        return jsonResponse(400, {
          error: "Missing required field: itemKeys[]",
        });
      }

      let trashed = 0;
      for (const key of itemKeys) {
        const item = await Zotero.Items.getByLibraryAndKeyAsync(
          Zotero.Libraries.userLibraryID,
          key,
        );
        if (!item) continue;

        item.deleted = true;
        await item.saveTx();
        trashed++;
      }

      return jsonResponse(200, { trashed });
    } catch (e: any) {
      ztoolkit.log(`trashItems error: ${e.message}`);
      return jsonResponse(500, { error: e.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all Colloquia HTTP endpoints with Zotero.Server.
 */
export function registerEndpoints(): void {
  const endpoints: Record<string, any> = {
    "/colloquia/ping": PingEndpoint,
    "/colloquia/createNote": CreateNoteEndpoint,
    "/colloquia/addTags": AddTagsEndpoint,
    "/colloquia/removeTags": RemoveTagsEndpoint,
    "/colloquia/addRelated": AddRelatedEndpoint,
    "/colloquia/searchLibrary": SearchLibraryEndpoint,
    "/colloquia/createAnnotation": CreateAnnotationEndpoint,
    "/colloquia/addPaper": AddPaperEndpoint,
    "/colloquia/test-doi-import": TestDoiImportEndpoint,
    "/colloquia/test-annotation": TestAnnotationEndpoint,
    "/colloquia/listCollections": ListCollectionsEndpoint,
    "/colloquia/createCollection": CreateCollectionEndpoint,
    "/colloquia/addToCollection": AddToCollectionEndpoint,
    "/colloquia/removeFromCollection": RemoveFromCollectionEndpoint,
    "/colloquia/getAnnotations": GetAnnotationsEndpoint,
    "/colloquia/trashItems": TrashItemsEndpoint,
  };

  for (const [path, EndpointClass] of Object.entries(endpoints)) {
    Zotero.Server.Endpoints[path] = EndpointClass;
    registeredPaths.push(path);
    ztoolkit.log(`Registered endpoint: ${path}`);
  }
}

/**
 * Unregister all Colloquia HTTP endpoints.
 */
export function unregisterEndpoints(): void {
  for (const path of registeredPaths) {
    delete Zotero.Server.Endpoints[path];
  }
  registeredPaths.length = 0;
}
