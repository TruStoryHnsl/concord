import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ChatMessage } from "../../hooks/useMatrix";
import { useToastStore } from "../../stores/toast";

interface MessageInputProps {
  onSend: (message: string) => Promise<void>;
  onSubmitEdit?: (eventId: string, newBody: string) => Promise<void>;
  onSendFile?: (file: File) => Promise<void>;
  uploading?: boolean;
  editingMessage: ChatMessage | null;
  onCancelEdit: () => void;
  onKeystroke?: () => void;
  onStopTyping?: () => void;
  roomName: string;
}

interface StagedFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

export function MessageInput({
  onSend,
  onSubmitEdit,
  onSendFile,
  uploading,
  editingMessage,
  onCancelEdit,
  onKeystroke,
  onStopTyping,
  roomName,
}: MessageInputProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const pendingRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Populate input when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.body);
      setStagedFiles([]);
      inputRef.current?.focus();
    }
  }, [editingMessage]);

  // Clean up preview URLs on unmount or when files change
  useEffect(() => {
    return () => {
      stagedFiles.forEach((sf) => {
        if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
      });
    };
  }, [stagedFiles]);

  const stageFiles = useCallback((files: FileList | File[]) => {
    const newStaged: StagedFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setStagedFiles((prev) => [...prev, ...newStaged]);
  }, []);

  const removeStaged = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const removed = prev.find((sf) => sf.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((sf) => sf.id !== id);
    });
  }, []);

  const hasContent = text.trim().length > 0 || stagedFiles.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if ((!trimmed && stagedFiles.length === 0) || sending) return;

    setSending(true);
    pendingRef.current = trimmed;
    setText("");
    const filesToSend = [...stagedFiles];
    setStagedFiles([]);
    onStopTyping?.();

    try {
      if (editingMessage && onSubmitEdit) {
        await onSubmitEdit(editingMessage.id, trimmed);
        onCancelEdit();
      } else {
        // Send staged files first
        if (onSendFile) {
          for (const sf of filesToSend) {
            await onSendFile(sf.file);
          }
        }
        // Send text message if any
        if (trimmed) {
          await onSend(trimmed);
        }
      }
      pendingRef.current = null;
      // Clean up preview URLs
      filesToSend.forEach((sf) => {
        if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
      });
    } catch (err) {
      setText((current) => current || pendingRef.current || "");
      pendingRef.current = null;
      addToast(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && editingMessage) {
      e.preventDefault();
      setText("");
      onCancelEdit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (!editingMessage) {
      if (e.target.value) onKeystroke?.();
      else onStopTyping?.();
    }
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        stageFiles(e.target.files);
      }
      if (fileRef.current) fileRef.current.value = "";
    },
    [stageFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        stageFiles(e.dataTransfer.files);
      }
    },
    [stageFiles],
  );

  const formatSize = useMemo(() => (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-zinc-700"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {editingMessage && (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs text-zinc-400">
          <span>Editing message</span>
          <button
            type="button"
            onClick={() => {
              setText("");
              onCancelEdit();
            }}
            className="text-zinc-500 hover:text-white"
          >
            Esc to cancel
          </button>
        </div>
      )}
      {uploading && (
        <div className="flex items-center gap-2 px-4 pt-2 text-xs text-indigo-400">
          <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Uploading...
        </div>
      )}

      {/* Media deck */}
      {stagedFiles.length > 0 && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {stagedFiles.map((sf) => (
              <div
                key={sf.id}
                className="relative flex-shrink-0 group"
              >
                {sf.previewUrl ? (
                  <img
                    src={sf.previewUrl}
                    alt={sf.file.name}
                    className="w-20 h-20 object-cover rounded-lg border border-zinc-600"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg border border-zinc-600 bg-zinc-800 flex flex-col items-center justify-center p-1.5">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-zinc-500 mb-1">
                      <path d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13z" />
                    </svg>
                    <span className="text-[9px] text-zinc-500 truncate w-full text-center">{sf.file.name}</span>
                    <span className="text-[9px] text-zinc-600">{formatSize(sf.file.size)}</span>
                  </div>
                )}
                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removeStaged(sf.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div
          className={`flex items-center gap-2 bg-zinc-800 border rounded-lg px-2 ${
            dragOver
              ? "border-indigo-500 bg-indigo-500/10"
              : editingMessage
                ? "border-indigo-500/50"
                : "border-zinc-700"
          }`}
        >
          {onSendFile && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-press p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white active:text-indigo-400 transition-colors flex-shrink-0 rounded-lg"
                title="Upload file"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    fillRule="evenodd"
                    d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          )}
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={onStopTyping}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoComplete="off"
            autoCorrect="on"
            spellCheck
            placeholder={
              editingMessage
                ? "Edit your message..."
                : dragOver
                  ? "Drop file here..."
                  : stagedFiles.length > 0
                    ? "Add a message or press Enter to send"
                    : `Message #${roomName}`
            }
            className="flex-1 px-2 py-3 bg-transparent text-white placeholder-zinc-500 focus:outline-none text-base md:text-sm"
          />
          {/* Show send button when there are staged files */}
          {hasContent && (
            <button
              type="submit"
              disabled={sending}
              className="p-2 text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 transition-colors flex-shrink-0"
              title="Send"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
