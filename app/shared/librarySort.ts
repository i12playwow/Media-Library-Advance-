/** Library sort orders. Lives in shared so the page component, the state
 *  hook, and future callers (tests, other pages) agree on one catalog. */
export type SortMode =
  | "actress"
  | "import-date"
  | "dvd-id"
  | "studio"
  | "tag"
  | "actress-age"
  | "recent-add"
  | "oldest"
  | "newest";

export const SORT_MODES: SortMode[] = [
  "actress",
  "studio",
  "tag",
  "import-date",
  "dvd-id",
  "actress-age",
  "recent-add",
  "oldest",
  "newest",
];

export const SORT_LABELS: Record<SortMode, string> = {
  actress: "Actress A–Z",
  studio: "Studio",
  tag: "Tag",
  "import-date": "Import Date",
  "dvd-id": "DVD ID",
  "actress-age": "Actress Age",
  "recent-add": "Recent Add",
  oldest: "Oldest",
  newest: "Newest",
};
