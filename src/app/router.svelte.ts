// Minimal hash router. Hash navigation works when the app is opened from a
// local file path, unlike history-API routing (plan section 24.5).

export interface Route {
  page: string;
  param?: string;
}

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const [page = "today", param] = clean.split("/");
  return { page: page || "today", param };
}

class Router {
  current = $state<Route>(parseHash(typeof location !== "undefined" ? location.hash : ""));

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", () => {
        this.current = parseHash(location.hash);
      });
    }
  }

  go(page: string, param?: string): void {
    location.hash = param ? `#/${page}/${param}` : `#/${page}`;
  }
}

export const router = new Router();
