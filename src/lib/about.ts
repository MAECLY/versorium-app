/**
 * Who makes Versorium and where it lives, as Settings › About shows it.
 * Proper nouns and addresses read the same in every language, so they are
 * data here rather than locale keys.
 *
 * The repository is the one the updater is compiled to read
 * (`UPDATE_OWNER` / `UPDATE_REPO` in src-tauri/src/update/mod.rs), which is
 * what lets About say where updates come from; a unit test holds the two
 * together.
 */
export const REPOSITORY = "https://github.com/MAECLY/versorium-app";

export const ABOUT = {
  name: "Versorium",
  author: "Miguel Angel Esparza Calero",
  links: {
    author: "https://www.maecly.com/about",
    website: "https://www.maecly.com",
    repository: REPOSITORY,
    license: `${REPOSITORY}/blob/main/LICENSE`,
    cla: `${REPOSITORY}/blob/main/CLA.md`,
    notices: `${REPOSITORY}/blob/main/THIRD-PARTY-NOTICES.md`,
    releases: `${REPOSITORY}/releases`,
  },
} as const;

/** An address as a person reads it: no scheme, no trailing slash. */
export function shortAddress(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/\/$/, "");
}
