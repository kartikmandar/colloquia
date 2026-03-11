/**
 * MediaRenderer — renders inline images and videos from model responses.
 * Also provides an ImageLightbox for fullscreen viewing.
 */

import { useCallback, useEffect } from "react";

export interface MediaPart {
  id: string;
  type: "image" | "video";
  mimeType: string;
  objectUrl: string;
  isGenerating?: boolean;
}

interface MediaRendererProps {
  media: MediaPart;
  onExpand: (media: MediaPart) => void;
}

function MediaRenderer({
  media,
  onExpand,
}: MediaRendererProps): React.ReactElement {
  if (media.isGenerating) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-primary bg-surface-tertiary p-3">
        <div className="h-16 w-24 animate-pulse rounded bg-surface-primary" />
        <span className="text-xs text-text-tertiary">
          Generating {media.type}...
        </span>
      </div>
    );
  }

  if (media.type === "image") {
    return (
      <div className="group relative inline-block">
        <img
          src={media.objectUrl}
          alt="Generated image"
          className="max-w-full max-h-80 rounded-lg cursor-pointer transition-opacity hover:opacity-90"
          onClick={() => onExpand(media)}
        />
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <a
            href={media.objectUrl}
            download={`generated-image.${media.mimeType.split("/")[1] || "png"}`}
            className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  // Video
  return (
    <div className="group relative inline-block">
      <video
        src={media.objectUrl}
        controls
        className="max-w-full max-h-80 rounded-lg"
      />
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <a
          href={media.objectUrl}
          download={`generated-video.${media.mimeType.split("/")[1] || "mp4"}`}
          className="rounded-md bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
          title="Download"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}

/** Fullscreen lightbox for expanded image viewing */
export function ImageLightbox({
  media,
  onClose,
}: {
  media: MediaPart | null;
  onClose: () => void;
}): React.ReactElement | null {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (media) {
      document.addEventListener("keydown", handleKeyDown);
      return (): void => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [media, handleKeyDown]);

  if (!media) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={media.objectUrl}
          alt="Expanded image"
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          <a
            href={media.objectUrl}
            download={`generated-image.${media.mimeType.split("/")[1] || "png"}`}
            className="rounded-md bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
            title="Download"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </a>
          <button
            onClick={onClose}
            className="rounded-md bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
            title="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default MediaRenderer;
