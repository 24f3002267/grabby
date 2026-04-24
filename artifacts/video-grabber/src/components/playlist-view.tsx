import { useState } from "react";
import type { PlaylistEntry, MediaFormat } from "@workspace/api-client-react";
import { useExtractMedia } from "@workspace/api-client-react";
import { Loader2, Video as VideoIcon, Clock, User, AlertTriangle } from "lucide-react";
import { FormatCard } from "./format-card";

interface PlaylistItemProps {
  entry: PlaylistEntry;
}

function PlaylistItem({ entry }: PlaylistItemProps) {
  const [expanded, setExpanded] = useState(false);
  const extractMedia = useExtractMedia();

  const handleExpand = () => {
    if (!expanded && !extractMedia.data) {
      extractMedia.mutate({ data: { url: entry.url } });
    }
    setExpanded(!expanded);
  };

  const videoData = extractMedia.data?.kind === "video" ? extractMedia.data.video : null;

  return (
    <div className="border border-border bg-card overflow-hidden">
      <button 
        onClick={handleExpand}
        className="w-full flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="w-32 h-20 bg-muted shrink-0 relative">
          {entry.thumbnail ? (
            <img src={entry.thumbnail} alt={entry.title} className="w-full h-full object-cover opacity-80" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <VideoIcon className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
          {entry.durationLabel && (
            <div className="absolute bottom-1 right-1 bg-black/80 px-1 text-[10px] text-white">
              {entry.durationLabel}
            </div>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-foreground truncate">{entry.title}</h3>
          {entry.uploader && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <User className="w-3 h-3" />
              <span>{entry.uploader}</span>
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-4 border-t border-border bg-background/50">
          {extractMedia.isPending && (
            <div className="flex items-center justify-center py-8 text-primary gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="animate-pulse">Extracting streams...</span>
            </div>
          )}
          
          {extractMedia.isError && (
            <div className="p-4 border border-destructive bg-destructive/10 text-destructive text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Extraction failed</p>
                <p>{extractMedia.error?.data?.error || extractMedia.error?.message || "Unknown error occurred"}</p>
              </div>
            </div>
          )}

          {videoData && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {videoData.formats.map((format: MediaFormat) => (
                <FormatCard 
                  key={format.formatId} 
                  format={format} 
                  videoUrl={videoData.url} 
                  videoTitle={videoData.title} 
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PlaylistView({ entries }: { entries: PlaylistEntry[] }) {
  return (
    <div className="flex flex-col gap-2 mt-6">
      {entries.map((entry) => (
        <PlaylistItem key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
