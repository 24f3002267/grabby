import { useState } from "react";
import { useExtractMedia } from "@workspace/api-client-react";
import type { MediaFormat } from "@workspace/api-client-react";
import { Terminal, ArrowRight, Loader2, AlertTriangle, Youtube, PlaySquare, FolderDown } from "lucide-react";
import { FormatCard } from "@/components/format-card";
import { PlaylistView } from "@/components/playlist-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "sonner";

export default function Home() {
  const [url, setUrl] = useState("");
  const extractMedia = useExtractMedia();

  const handleExtract = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    extractMedia.mutate({ data: { url: url.trim() } });
  };

  const data = extractMedia.data;
  const isVideo = data?.kind === "video" && data.video;
  const isPlaylist = data?.kind === "playlist" && data.playlist;

  return (
    <div className="min-h-screen w-full flex flex-col">
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: "!bg-card !border !border-primary/40 !text-foreground !rounded-none !font-mono",
            title: "!font-bold !uppercase !text-primary !tracking-wider",
            description: "!text-muted-foreground",
          },
        }}
      />
      <header className="border-b border-border bg-background p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
          <Terminal className="w-6 h-6 text-primary" />
          <span>GRABBY<span className="text-primary animate-pulse">_</span></span>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground font-mono">
          <span className="flex items-center gap-1"><Youtube className="w-3 h-3" /> YouTube</span>
          <span className="flex items-center gap-1"><PlaySquare className="w-3 h-3" /> Bilibili</span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 md:p-8 flex flex-col">
        {!data && !extractMedia.isPending && (
          <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full pt-20 pb-32">
            <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tighter uppercase">
              Rip it. <br/>
              <span className="text-primary">Save it.</span>
            </h1>
            <p className="text-muted-foreground mb-8 font-mono">
              Provide a target URL to commence extraction. No tracking, no bullshit. Just the raw stream.
            </p>
          </div>
        )}

        <form onSubmit={handleExtract} className="mb-8 relative group">
          <div className="absolute -inset-1 bg-primary/20 blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center bg-card border border-border focus-within:border-primary transition-colors">
            <div className="pl-4 text-muted-foreground">
              <ArrowRight className="w-5 h-5" />
            </div>
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 bg-transparent border-none outline-none focus:ring-0 p-4 font-mono text-lg"
              disabled={extractMedia.isPending}
            />
            <button 
              type="submit" 
              disabled={!url.trim() || extractMedia.isPending}
              className="bg-primary text-primary-foreground font-bold px-8 py-4 uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {extractMedia.isPending ? "Executing" : "Extract"}
            </button>
          </div>
        </form>

        {extractMedia.isPending && (
          <div className="py-20 flex flex-col items-center justify-center text-primary font-mono gap-4">
            <Loader2 className="w-10 h-10 animate-spin" />
            <div className="animate-pulse">Negotiating stream...</div>
          </div>
        )}

        {extractMedia.isError && (
          <div className="border border-destructive bg-destructive/10 p-6 text-destructive">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="w-6 h-6" />
              <h2 className="text-xl font-bold uppercase">Extraction Fault</h2>
            </div>
            <p className="font-mono">{extractMedia.error?.data?.error || extractMedia.error?.message || "Unknown server error occurred."}</p>
          </div>
        )}

        {isVideo && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-6 mb-8 border border-border bg-card p-4">
              <div className="w-full md:w-64 shrink-0 aspect-video bg-muted relative">
                {data.video!.thumbnail ? (
                  <img src={data.video!.thumbnail} alt={data.video!.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center border border-border">
                    <span className="text-muted-foreground">No Preview</span>
                  </div>
                )}
                {data.video!.durationLabel && (
                  <div className="absolute bottom-2 right-2 bg-black text-white px-2 py-0.5 text-xs font-mono">
                    {data.video!.durationLabel}
                  </div>
                )}
                <div className="absolute top-2 left-2 bg-primary text-primary-foreground px-2 py-0.5 text-xs font-bold uppercase">
                  {data.video!.source}
                </div>
              </div>
              <div className="flex flex-col justify-center">
                <h2 className="text-2xl md:text-3xl font-bold mb-2">{data.video!.title}</h2>
                <div className="text-muted-foreground font-mono flex items-center gap-4">
                  {data.video!.uploader && <span>UP: {data.video!.uploader}</span>}
                  <span>FMT: {data.video!.formats.length} avail</span>
                </div>
              </div>
            </div>

            <Tabs defaultValue="video_audio" className="w-full">
              <TabsList className="bg-card border border-border p-0 rounded-none w-full justify-start h-auto">
                <TabsTrigger value="video_audio" className="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-3 px-6 uppercase font-bold">Video + Audio</TabsTrigger>
                <TabsTrigger value="video" className="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-3 px-6 uppercase font-bold">Video Only</TabsTrigger>
                <TabsTrigger value="audio" className="rounded-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-3 px-6 uppercase font-bold">Audio Only</TabsTrigger>
              </TabsList>
              
              <div className="mt-6">
                <TabsContent value="video_audio">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.video!.formats.filter((f: MediaFormat) => f.kind === "video_audio").sort((a: MediaFormat, b: MediaFormat) => (b.height||0) - (a.height||0)).map((f: MediaFormat) => (
                      <FormatCard key={f.formatId} format={f} videoUrl={data.video!.url} videoTitle={data.video!.title} />
                    ))}
                    {data.video!.formats.filter((f: MediaFormat) => f.kind === "video_audio").length === 0 && (
                      <div className="col-span-full p-8 text-center text-muted-foreground border border-border border-dashed">
                        No combined formats available. Check Video Only / Audio Only.
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="video">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.video!.formats.filter((f: MediaFormat) => f.kind === "video").sort((a: MediaFormat, b: MediaFormat) => (b.height||0) - (a.height||0)).map((f: MediaFormat) => (
                      <FormatCard key={f.formatId} format={f} videoUrl={data.video!.url} videoTitle={data.video!.title} />
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="audio">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {data.video!.formats.filter((f: MediaFormat) => f.kind === "audio").sort((a: MediaFormat, b: MediaFormat) => (b.abr||0) - (a.abr||0)).map((f: MediaFormat) => (
                      <FormatCard key={f.formatId} format={f} videoUrl={data.video!.url} videoTitle={data.video!.title} />
                    ))}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}

        {isPlaylist && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-6 mb-8 border border-border bg-card p-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <FolderDown className="w-5 h-5 text-primary" />
                  <span className="text-primary font-bold uppercase tracking-wider">Playlist Detected</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold mb-2">{data.playlist!.title}</h2>
                <div className="text-muted-foreground font-mono flex items-center gap-4">
                  {data.playlist!.uploader && <span>UP: {data.playlist!.uploader}</span>}
                  <span>QTY: {data.playlist!.entryCount} entries</span>
                </div>
              </div>
            </div>

            <PlaylistView entries={data.playlist!.entries} />
          </div>
        )}

      </main>

      <footer className="border-t border-border bg-card p-4 mt-auto">
        <div className="max-w-5xl mx-auto text-xs text-muted-foreground font-mono text-center">
          <p>Downloading copyrighted material without permission is illegal.</p>
          <p className="mt-1 opacity-50">Grabby assumes no responsibility for your actions.</p>
        </div>
      </footer>
    </div>
  );
}
