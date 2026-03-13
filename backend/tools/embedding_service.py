"""Embedding service — ChromaDB + Gemini embeddings for semantic search & RAG.

Manages a persistent ChromaDB collection of paper chunks embedded via
gemini-embedding-001. All ChromaDB ops are sync, so we wrap them in
asyncio.to_thread().
"""

import asyncio
import logging
from typing import Any

import chromadb
from google import genai

from config import CHROMADB_PERSIST_DIR, EMBEDDING_MODEL, RAG_CHUNK_SIZE, RAG_CHUNK_OVERLAP

logger: logging.Logger = logging.getLogger(__name__)

EMBEDDING_BATCH_SIZE: int = 100


class EmbeddingService:
    """ChromaDB + Gemini embedding manager."""

    def __init__(self, api_key: str, persist_dir: str = CHROMADB_PERSIST_DIR) -> None:
        self.api_key: str = api_key
        self.persist_dir: str = persist_dir
        self._client: chromadb.PersistentClient = chromadb.PersistentClient(
            path=persist_dir
        )
        self._collection: chromadb.Collection = self._client.get_or_create_collection(
            name="zotero_papers",
            metadata={"hnsw:space": "cosine"},
        )
        self._genai_client: genai.Client = genai.Client(api_key=api_key)
        logger.info(
            "EmbeddingService initialized: %s (%d docs)",
            persist_dir,
            self._collection.count(),
        )

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    async def embed_texts(
        self, texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT"
    ) -> list[list[float]]:
        """Embed a list of texts using Gemini in batches."""
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
            batch: list[str] = texts[i : i + EMBEDDING_BATCH_SIZE]
            result = await asyncio.to_thread(
                self._genai_client.models.embed_content,
                model=EMBEDDING_MODEL,
                contents=batch,
                config=genai.types.EmbedContentConfig(task_type=task_type),
            )
            for emb in result.embeddings:
                all_embeddings.append(emb.values)
        return all_embeddings

    # ------------------------------------------------------------------
    # Chunking
    # ------------------------------------------------------------------

    @staticmethod
    def chunk_text(
        text: str,
        chunk_size: int = RAG_CHUNK_SIZE,
        overlap: int = RAG_CHUNK_OVERLAP,
    ) -> list[str]:
        """Split text into overlapping chunks on paragraph boundaries."""
        paragraphs: list[str] = text.split("\n\n")
        chunks: list[str] = []
        current_chunk: str = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            if len(current_chunk) + len(para) + 2 > chunk_size and current_chunk:
                chunks.append(current_chunk.strip())
                # Carry overlap
                if overlap > 0 and len(current_chunk) > overlap:
                    current_chunk = current_chunk[-overlap:]
                else:
                    current_chunk = ""
            current_chunk += ("\n\n" if current_chunk else "") + para

        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        return chunks if chunks else [text[:chunk_size]] if text else []

    # ------------------------------------------------------------------
    # Indexing
    # ------------------------------------------------------------------

    async def index_paper(
        self,
        item_key: str,
        title: str,
        authors: str,
        year: str,
        abstract: str,
        fulltext: str,
        version: str = "1",
    ) -> dict[str, Any]:
        """Index a paper's text into ChromaDB. Skips if same version exists."""
        # Check existing version
        existing = await asyncio.to_thread(
            self._collection.get,
            ids=[f"{item_key}_chunk_0"],
            include=["metadatas"],
        )
        if existing and existing["metadatas"] and len(existing["metadatas"]) > 0:
            existing_version: str = existing["metadatas"][0].get("version", "")
            if existing_version == version:
                logger.info("Paper %s already indexed (v%s), skipping", item_key, version)
                return {"chunks_indexed": 0, "status": "already_indexed"}

        # Delete old chunks first
        await self.delete_paper(item_key)

        # Build text to index
        header: str = f"Title: {title}\nAuthors: {authors}\nYear: {year}"
        if abstract:
            header += f"\nAbstract: {abstract}"
        text_to_chunk: str = header + "\n\n" + fulltext if fulltext else header

        chunks: list[str] = self.chunk_text(text_to_chunk)
        if not chunks:
            return {"chunks_indexed": 0, "status": "no_content"}

        # Embed all chunks
        embeddings: list[list[float]] = await self.embed_texts(chunks)

        # Prepare ChromaDB upsert
        ids: list[str] = [f"{item_key}_chunk_{i}" for i in range(len(chunks))]
        metadatas: list[dict[str, str]] = [
            {
                "item_key": item_key,
                "title": title,
                "authors": authors,
                "year": year,
                "chunk_index": str(i),
                "version": version,
            }
            for i in range(len(chunks))
        ]

        await asyncio.to_thread(
            self._collection.upsert,
            ids=ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
        )

        logger.info("Indexed paper %s: %d chunks", item_key, len(chunks))
        return {"chunks_indexed": len(chunks), "status": "indexed"}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    async def search(
        self,
        query: str,
        n_results: int = 10,
        item_key: str | None = None,
    ) -> list[dict[str, Any]]:
        """Semantic search across indexed papers."""
        query_embedding: list[list[float]] = await self.embed_texts(
            [query], task_type="RETRIEVAL_QUERY"
        )

        where_filter: dict[str, str] | None = None
        if item_key:
            where_filter = {"item_key": item_key}

        results = await asyncio.to_thread(
            self._collection.query,
            query_embeddings=query_embedding,
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )

        hits: list[dict[str, Any]] = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                meta: dict[str, Any] = results["metadatas"][0][i] if results["metadatas"] else {}
                distance: float = results["distances"][0][i] if results["distances"] else 0.0
                hits.append({
                    "text": doc,
                    "item_key": meta.get("item_key", ""),
                    "title": meta.get("title", ""),
                    "authors": meta.get("authors", ""),
                    "year": meta.get("year", ""),
                    "chunk_index": meta.get("chunk_index", ""),
                    "distance": distance,
                })

        return hits

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    async def is_indexed(self, item_key: str) -> bool:
        """Check if a paper has any indexed chunks."""
        result = await asyncio.to_thread(
            self._collection.get,
            ids=[f"{item_key}_chunk_0"],
        )
        return bool(result and result["ids"])

    async def get_stats(self) -> dict[str, Any]:
        """Return collection stats."""
        count: int = await asyncio.to_thread(self._collection.count)
        return {"total_chunks": count, "persist_dir": self.persist_dir}

    async def delete_paper(self, item_key: str) -> None:
        """Delete all chunks for a given paper."""
        try:
            await asyncio.to_thread(
                self._collection.delete,
                where={"item_key": item_key},
            )
        except Exception:
            # Collection might not have the item
            pass
