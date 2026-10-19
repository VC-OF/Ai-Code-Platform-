export interface Project {
  id: string;
  title: string;
  kind?: "app" | "build";
  userId?: string | null;
  shareToken?: string | null;
  isPublic?: boolean;
  createdAt: number;
  updatedAt: number;
  chatHistory?: { role: "user" | "assistant"; content: string }[];
}

