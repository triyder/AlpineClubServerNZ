import sanitizeHtml from "sanitize-html";

/**
 * Sanitising and rewriting for shared post bodies (Communication Portal).
 *
 * THIS SERVER DOES NOT TRUST THE HTML IT IS SENT. A club authenticates with an
 * API key, which proves which club is calling and nothing whatever about what
 * its members wrote — and this body is then handed to every OTHER club, whose
 * members' browsers render it. One club with a compromised key, or simply an
 * older client with a weaker sanitiser, must not be able to put script into
 * another club's board. So the sending club sanitises, and this sanitises
 * again, and the receiving club sanitises once more on render.
 *
 * The allowlist deliberately matches the client's
 * (AlpineClubBookingsNZ `club-post-html.ts`). Where they differ they must
 * differ in this direction only: anything this one drops is simply not shown,
 * whereas anything this one ALLOWS that a client would have dropped is a
 * capability granted by the network rather than by the club.
 */

const ALLOWED_COLOURS = [
  "#b42318",
  "#b54708",
  "#067647",
  "#175cd3",
  "#6941c6",
  "#475467",
];

/**
 * Where an image may point AFTER rewriting — this server's own route.
 *
 * A shared body arrives naming the SENDING club's local image URLs, which mean
 * nothing anywhere else. `rewriteImageSources` maps them onto the copies this
 * server stored; anything it could not map is dropped rather than left
 * pointing at a host the reader cannot reach.
 */
// The `.webp` suffix is optional because the serving route strips it: links are
// written with it so the URL looks like a file, and both forms resolve.
const SERVER_IMAGE_SRC = /^\/api\/images\/posts\/[0-9a-f]{32}(\.webp)?$/;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "h1",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "blockquote",
    "span",
    "div",
    "a",
    "img",
  ],
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  allowedStyles: {
    "*": {
      color: ALLOWED_COLOURS.map((hex) => new RegExp(`^${hex}$`, "i")),
      "font-size": [/^(10|12|14|16|20|24|32)pt$/],
      "font-family": [/^(sans-serif|serif|monospace)$/],
      "text-align": [/^(left|center|right|justify)$/],
    },
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { img: [] },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }),
  },
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  exclusiveFilter: (frame) => {
    if (frame.tag === "img") {
      return !SERVER_IMAGE_SRC.test(frame.attribs?.src ?? "");
    }
    return false;
  },
};

/**
 * Rewrite the sending club's image URLs onto this server's own copies.
 *
 * `mapping` is localPublicId -> this server's publicId, built from the order
 * the client sent its files in. Run BEFORE sanitising, because sanitising
 * drops any image that does not already point at this server.
 */
export function rewriteImageSources(
  html: string,
  mapping: Map<string, string>,
): string {
  return html.replace(
    /\/api\/club-posts\/images\/([0-9a-f]{32})/g,
    (whole, localId: string) => {
      const serverId = mapping.get(localId);
      // Left as-is when unmapped, which means the sanitiser then drops the
      // whole <img>. Better a missing picture than one pointing at a host this
      // reader has no access to and which would leak that they read it.
      // Written WITH the suffix, matching `postImageUrl`, so every link this
      // server emits to an image has one shape.
      return serverId ? `/api/images/posts/${serverId}.webp` : whole;
    },
  );
}

/** Sanitise a shared body. Returns null when nothing survives. */
export function sanitizeSharedHtml(input: unknown): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const cleaned = sanitizeHtml(input, OPTIONS).trim();
  return cleaned === "" ? null : cleaned;
}
