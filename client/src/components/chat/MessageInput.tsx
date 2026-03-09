import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage } from "../../hooks/useMatrix";

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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pendingRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Populate input when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.body);
      inputRef.current?.focus();
    }
  }, [editingMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    pendingRef.current = trimmed;
    setText("");
    onStopTyping?.();

    try {
      if (editingMessage && onSubmitEdit) {
        await onSubmitEdit(editingMessage.id, trimmed);
        onCancelEdit();
      } else {
        await onSend(trimmed);
      }
      pendingRef.current = null;
    } catch {
      setText((current) => current || pendingRef.current || "");
      pendingRef.current = null;
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
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onSendFile) await onSendFile(file);
      if (fileRef.current) fileRef.current.value = "";
    },
    [onSendFile],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && onSendFile) await onSendFile(file);
    },
    [onSendFile],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 border-t border-zinc-700"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {editingMessage && (
        <div className="flex items-center gap-2 mb-2 text-xs text-zinc-400">
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
        <div className="flex items-center gap-2 mb-2 text-xs text-indigo-400">
          <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Uploading...
        </div>
      )}
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
              className="p-2 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
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
          placeholder={
            editingMessage
              ? "Edit your message..."
              : dragOver
                ? "Drop file here..."
                : `Message #${roomName}`
          }
          className="flex-1 px-2 py-3 bg-transparent text-white placeholder-zinc-500 focus:outline-none"
        />
      </div>
    </form>
  );
}
