import { create } from "zustand";
import type { ForumPost } from "@/api/tauri";
import {
  getForumPosts,
  postToLocalForum,
  postToGlobalForum,
  setLocalForumRange,
} from "@/api/tauri";

interface ForumState {
  localPosts: ForumPost[];
  globalPosts: ForumPost[];
  localRange: number; // max hops, default 3
  loading: boolean;

  loadPosts: (scope: "local" | "global") => Promise<void>;
  addPost: (post: ForumPost) => void;
  postToLocal: (content: string) => Promise<void>;
  postToGlobal: (content: string) => Promise<void>;
  setLocalRange: (hops: number) => void;
}

export const useForumStore = create<ForumState>((set, get) => ({
  localPosts: [],
  globalPosts: [],
  localRange: 3,
  loading: false,

  loadPosts: async (scope) => {
    set({ loading: true });
    try {
      const posts = await getForumPosts(scope);
      if (scope === "local") {
        set({ localPosts: posts, loading: false });
      } else {
        set({ globalPosts: posts, loading: false });
      }
    } catch (err) {
      console.warn("Failed to load forum posts:", err);
      set({ loading: false });
    }
  },

  addPost: (post) => {
    set((state) => {
      if (post.forumScope === "local") {
        if (state.localPosts.some((p) => p.id === post.id)) return state;
        return { localPosts: [post, ...state.localPosts] };
      }
      if (state.globalPosts.some((p) => p.id === post.id)) return state;
      return { globalPosts: [post, ...state.globalPosts] };
    });
  },

  postToLocal: async (content) => {
    try {
      const post = await postToLocalForum(content, get().localRange);
      set((state) => ({ localPosts: [post, ...state.localPosts] }));
    } catch (err) {
      console.error("Failed to post to local forum:", err);
    }
  },

  postToGlobal: async (content) => {
    try {
      const post = await postToGlobalForum(content);
      set((state) => ({ globalPosts: [post, ...state.globalPosts] }));
    } catch (err) {
      console.error("Failed to post to global forum:", err);
    }
  },

  setLocalRange: (hops) => {
    set({ localRange: hops });
    void setLocalForumRange(hops);
  },
}));
