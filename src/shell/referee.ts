// Pieces every game's online referee shares (pure TypeScript, also bundled into Edge Functions).

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Something worth a push notification, for the players listed (user ids). */
export interface Notice {
  room: string;
  users: string[];
  title: string;
  body: string;
  /** one notification per game: a newer one replaces the older */
  tag: string;
  /** where tapping it goes (absent: Regolith's room link) */
  url?: string;
}
