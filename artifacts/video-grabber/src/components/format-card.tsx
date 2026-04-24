import { Download, Play, Video, Music, HardDrive, FileAudio } from "lucide-react";
import { toast } from "sonner";
import type { MediaFormat } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface FormatCardProps {
  format: MediaFormat;
  videoUrl: string;
  videoTitle: string;
}

function sanitize(title: string) {
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

export function FormatCard({ format, videoUrl, videoTitle }: FormatCardProps) {
  const suggestedFilename = `${sanitize(videoTitle)}.${format.ext}`;
  const downloadUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&formatId=${encodeURIComponent(format.formatId)}&filename=${encodeURIComponent(suggestedFilename)}`;

  return (
    <a 
      href={downloadUrl}
      download
      onClick={() => {
        const isMerge = format.formatId.includes("+");
        toast.success("Download starting...", {
          description: isMerge
            ? "Your video will be downloaded in a bit automatically — please be patient. Merging video and audio takes a moment."
            : "Your video will be downloaded in a bit automatically — please be patient.",
          duration: 7000,
        });
      }}
      className={cn(
        "group flex flex-col gap-2 p-4 border bg-card hover:bg-secondary/50 transition-colors relative overflow-hidden",
        format.kind === "video_audio" ? "border-primary/50 hover:border-primary" : "border-border hover:border-muted-foreground/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {format.kind === "video_audio" ? <Video className="w-4 h-4 text-primary" /> : 
           format.kind === "video" ? <Play className="w-4 h-4 text-muted-foreground" /> : 
           <Music className="w-4 h-4 text-blue-400" />}
          <span className="font-bold text-lg">
            {format.resolution || "Audio"}
          </span>
        </div>
        <div className="text-xs uppercase bg-secondary px-2 py-1 text-muted-foreground font-mono">
          {format.ext}
        </div>
      </div>
      
      <div className="flex flex-col gap-1 mt-2 text-xs text-muted-foreground">
        {format.vcodec && format.vcodec !== "none" && (
          <div className="flex justify-between">
            <span>Video Codec</span>
            <span className="text-foreground">{format.vcodec}</span>
          </div>
        )}
        {format.acodec && format.acodec !== "none" && (
          <div className="flex justify-between">
            <span>Audio Codec</span>
            <span className="text-foreground">{format.acodec}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Bitrate</span>
          <span className="text-foreground">{format.tbr ? `${Math.round(format.tbr)}k` : (format.abr ? `${Math.round(format.abr)}k` : "Unknown")}</span>
        </div>
        <div className="flex justify-between font-bold text-sm mt-1 pt-1 border-t border-border/50">
          <span>Size</span>
          <span className="text-primary">{format.filesizeLabel || "Unknown"}</span>
        </div>
      </div>

      <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform flex items-center justify-center backdrop-blur-[1px]">
        <div className="flex items-center gap-2 text-primary font-bold bg-background/80 px-4 py-2 border border-primary/20">
          <Download className="w-4 h-4" />
          DOWNLOAD
        </div>
      </div>
    </a>
  );
}
