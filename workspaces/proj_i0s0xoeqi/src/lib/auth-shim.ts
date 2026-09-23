// Tiny shim so session.ts can be imported into the client bundle without
// pulling next/headers into the browser.

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  fullNameJa?: string;
  registrationNumber?: string;
  role: "admin" | "invigilator" | "candidate";
};

export function getUserById(id: string): AuthUser | null {
  if (typeof window === "undefined") {
    // Server side: dynamic import to avoid bundling next/headers in the client.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getUserById } =
      require("./store-impl") as typeof import("./store-impl");
    return getUserById(id);
  }
  return null;
}
