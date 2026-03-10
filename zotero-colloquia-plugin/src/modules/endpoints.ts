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
  supportedMethods = ["POST"];
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
    "/colloquia/test-doi-import": TestDoiImportEndpoint,
    "/colloquia/test-annotation": TestAnnotationEndpoint,
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
