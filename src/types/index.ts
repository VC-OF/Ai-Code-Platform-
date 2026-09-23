export interface Project {
  id: string;
  title: string;
  kind?: "app" | "build";
  createdAt: number;
  updatedAt: number;
  chatHistory?: { role: "user" | "assistant"; content: string }[];
}
