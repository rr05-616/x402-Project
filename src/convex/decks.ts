import { v } from "convex/values";
import { getCurrentUser } from "./users";
import { mutation, query } from "./_generated/server";

const sectionValidator = v.object({
  key: v.string(),
  title: v.string(),
  eyebrow: v.string(),
  bullets: v.array(v.string()),
  accent: v.string(),
  derived: v.boolean(),
});

const statsValidator = v.object({
  words: v.number(),
  lines: v.number(),
  sectionsFound: v.number(),
});

const insightsValidator = v.object({
  executiveSummary: v.string(),
  elevatorPitch: v.string(),
  tam: v.string(),
  sam: v.string(),
  som: v.string(),
  marketNote: v.string(),
  businessModel: v.string(),
  pricingStrategy: v.string(),
  gtm: v.array(v.string()),
  roadmap: v.array(
    v.object({
      phase: v.string(),
      timeline: v.string(),
      items: v.array(v.string()),
    }),
  ),
  risks: v.array(v.string()),
  fundingAsk: v.string(),
  useOfFunds: v.array(v.string()),
  competitors: v.array(
    v.object({
      name: v.string(),
      category: v.string(),
      strengths: v.array(v.string()),
      weaknesses: v.array(v.string()),
      advantage: v.string(),
    }),
  ),
  missing: v.array(v.string()),
});

const readinessValidator = v.object({
  overall: v.number(),
  metrics: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      score: v.number(),
      note: v.string(),
    }),
  ),
});

function makeGuestTransferToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function hashGuestTransferToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Generate a short, URL-safe share code. */
function makeShareCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < bytes.length; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * Persist a generated deck: creates (or reuses) a project row from the source
 * README, then stores the deck with a fresh share code. Returns ids.
 */
export const createDeck = mutation({
  args: {
    idempotencyKey: v.string(),
    projectName: v.string(),
    sourceMarkdown: v.string(),
    slideCount: v.optional(v.number()),
    title: v.string(),
    tagline: v.string(),
    sections: v.array(sectionValidator),
    stats: statsValidator,
    insights: insightsValidator,
    readiness: readinessValidator,
    template: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");

    const idempotencyKey = args.idempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new Error("A valid project creation idempotency key is required.");
    }
    const duplicate = await ctx.db
      .query("decks")
      .withIndex("by_owner_idempotency", (q) =>
        q.eq("ownerId", user._id).eq("idempotencyKey", idempotencyKey),
      )
      .first();
    if (duplicate)
      return { projectId: duplicate.projectId, deckId: duplicate._id };

    const slideCount = args.slideCount ?? 12;
    if (slideCount !== 12 && slideCount !== 13) {
      throw new Error(
        "Pitch decks must contain 12 slides, with 13 as the maximum.",
      );
    }
    if (
      slideCount === 13 &&
      !/\b(?:raising|seeking|funding ask)\b[^\n]{0,120}\$\s*[\d,.]+/i.test(
        args.sourceMarkdown,
      )
    ) {
      throw new Error(
        "A 13th slide requires a funding amount stated in the source material.",
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    if (user.isAnonymous) {
      const used = user.guestCreditsUsed ?? 0;
      if (used >= 5) {
        throw new Error(
          "Your 5 guest project credits have been used. Sign in to continue.",
        );
      }
      await ctx.db.patch(user._id, { guestCreditsUsed: used + 1 });
    } else {
      const used =
        user.dailyCreditsDate === today
          ? (user.dailyCreditsUsed ?? 0)
          : user.dailyCreditsDate
            ? 0
            : Math.min(user.guestCreditsUsed ?? 0, 10);
      if (used >= 10) {
        throw new Error(
          "Your 10 daily project credits have been used. Try again after the UTC reset.",
        );
      }
      await ctx.db.patch(user._id, {
        dailyCreditsUsed: used + 1,
        dailyCreditsDate: today,
      });
    }

    // Reuse an existing project with the same owner + name when present.
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.eq(q.field("name"), args.projectName))
      .first();

    let projectId = existing?._id;
    if (!projectId) {
      projectId = await ctx.db.insert("projects", {
        ownerId: user._id,
        name: args.projectName,
        sourceMarkdown: args.sourceMarkdown,
      });
    } else {
      await ctx.db.patch(projectId, { sourceMarkdown: args.sourceMarkdown });
    }

    const deckId = await ctx.db.insert("decks", {
      ownerId: user._id,
      projectId,
      projectName: args.projectName,
      title: args.title,
      tagline: args.tagline,
      shareCode: makeShareCode(),
      sections: args.sections,
      stats: args.stats,
      insights: args.insights,
      readiness: args.readiness,
      template: args.template ?? "glass",
      slideCount,
      idempotencyKey,
    });

    return { projectId, deckId };
  },
});

/** Current server-authoritative project credit allowance. */
export const getCreditBalance = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (user.isAnonymous) {
      const used = user.guestCreditsUsed ?? 0;
      return {
        accountType: "guest" as const,
        remaining: Math.max(0, 5 - used),
        allowance: 5,
        resetAt: null,
      };
    }
    const used =
      user.dailyCreditsDate === today
        ? (user.dailyCreditsUsed ?? 0)
        : user.dailyCreditsDate
          ? 0
          : Math.min(user.guestCreditsUsed ?? 0, 10);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return {
      accountType: "registered" as const,
      remaining: Math.max(0, 10 - used),
      allowance: 10,
      resetAt: tomorrow.getTime(),
    };
  },
});

/** Issue a one-time token before a guest signs out to create an account. */
export const beginGuestTransfer = mutation({
  args: {},
  handler: async (ctx) => {
    const guest = await getCurrentUser(ctx);
    if (!guest || !guest.isAnonymous)
      throw new Error("Only guest accounts can transfer projects.");
    const token = makeGuestTransferToken();
    await ctx.db.patch(guest._id, {
      guestTransferHash: await hashGuestTransferToken(token),
    });
    return token;
  },
});

/** Atomically transfer guest-owned records to the newly authenticated account. */
export const claimGuestProjects = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in before transferring guest projects.");
    if (user.isAnonymous)
      throw new Error("Create or sign in to a registered account first.");
    if (!/^[a-f0-9]{64}$/i.test(args.token))
      throw new Error("Invalid guest transfer token.");

    const tokenHash = await hashGuestTransferToken(args.token);
    const guest = await ctx.db
      .query("users")
      .withIndex("by_guest_transfer_hash", (q) =>
        q.eq("guestTransferHash", tokenHash),
      )
      .first();
    if (!guest || !guest.isAnonymous || guest._id === user._id) {
      throw new Error(
        "Guest transfer token is invalid or has already been used.",
      );
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", guest._id))
      .collect();
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_owner", (q) => q.eq("ownerId", guest._id))
      .collect();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", guest._id))
      .collect();
    const nfts = await ctx.db
      .query("nfts")
      .withIndex("by_user", (q) => q.eq("userId", guest._id))
      .collect();
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_author", (q) => q.eq("authorId", guest._id))
      .collect();

    for (const project of projects)
      await ctx.db.patch(project._id, { ownerId: user._id });
    for (const deck of decks)
      await ctx.db.patch(deck._id, { ownerId: user._id });
    for (const payment of payments)
      await ctx.db.patch(payment._id, { userId: user._id });
    for (const nft of nfts) await ctx.db.patch(nft._id, { userId: user._id });
    for (const comment of comments)
      await ctx.db.patch(comment._id, { authorId: user._id });

    const today = new Date().toISOString().slice(0, 10);
    const registeredUsed =
      user.dailyCreditsDate === today ? (user.dailyCreditsUsed ?? 0) : 0;
    const transferredUsage = Math.min(
      10,
      registeredUsed + (guest.guestCreditsUsed ?? 0),
    );
    await ctx.db.patch(user._id, {
      dailyCreditsDate: today,
      dailyCreditsUsed: transferredUsage,
    });
    await ctx.db.patch(guest._id, {
      guestCreditsUsed: 5,
      guestTransferHash: undefined,
    });

    return { projects: projects.length, decks: decks.length };
  },
});

/** Delete a deck; also removes its project row when no other decks remain. */
export const deleteDeck = mutation({
  args: { deckId: v.id("decks") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");

    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.ownerId !== user._id) throw new Error("Not found");

    await ctx.db.delete(args.deckId);

    if (deck.projectId) {
      const siblings = await ctx.db
        .query("decks")
        .withIndex("by_project", (q) => q.eq("projectId", deck.projectId))
        .first();
      if (!siblings) {
        const project = await ctx.db.get(deck.projectId);
        if (project && project.ownerId === user._id) {
          await ctx.db.delete(deck.projectId);
        }
      }
    }
  },
});

/** Delete a project and every deck it contains. */
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== user._id) throw new Error("Not found");

    const decks = await ctx.db
      .query("decks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const deck of decks) await ctx.db.delete(deck._id);
    await ctx.db.delete(args.projectId);
  },
});

/** All projects for the signed-in user, newest first. */
export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
  },
});

/** All decks for the signed-in user, newest first. */
export const listDecks = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("decks")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
  },
});

/** A single deck, only for its owner. */
export const getDeck = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.ownerId !== user._id) return null;
    const project = deck.projectId ? await ctx.db.get(deck.projectId) : null;
    return { ...deck, sourceMarkdown: project?.sourceMarkdown ?? "" };
  },
});

/** Public lookup used by the share link — no auth required. */
export const getDeckByShareCode = query({
  args: { shareCode: v.string() },
  handler: async (ctx, args) => {
    const deck = await ctx.db
      .query("decks")
      .withIndex("by_share_code", (q) => q.eq("shareCode", args.shareCode))
      .first();
    if (!deck) return null;
    return deck;
  },
});

/** Update a deck's template (owner or admin only). */
export const setDeckTemplate = mutation({
  args: { deckId: v.id("decks"), template: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");
    const deck = await ctx.db.get(args.deckId);
    if (!deck) throw new Error("Not found");
    const isOwner = deck.ownerId === user._id;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) throw new Error("Not allowed");
    await ctx.db.patch(args.deckId, { template: args.template });
    return args.template;
  },
});

/** Save editable deck text. The returned record is the confirmed saved state. */
export const updateDeckContent = mutation({
  args: {
    deckId: v.id("decks"),
    title: v.string(),
    tagline: v.string(),
    sections: v.array(sectionValidator),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.ownerId !== user._id) throw new Error("Not found");

    const title = args.title.trim().slice(0, 120);
    const tagline = args.tagline.trim().slice(0, 300);
    if (!title || !tagline)
      throw new Error("Title and summary cannot be empty.");
    if (args.sections.length > 6)
      throw new Error("A deck can contain at most six source sections.");
    for (const section of args.sections) {
      if (
        section.title.trim().length === 0 ||
        section.title.length > 100 ||
        section.bullets.length > 12
      ) {
        throw new Error(
          "Section titles must be 1–100 characters and sections can contain at most twelve points.",
        );
      }
      if (
        section.bullets.some(
          (bullet) => bullet.trim().length === 0 || bullet.length > 1000,
        )
      ) {
        throw new Error(
          "Slide text must be non-empty and no longer than 1,000 characters.",
        );
      }
    }

    const sections = args.sections.map((section) => ({
      ...section,
      derived: section.bullets.length === 0,
    }));
    await ctx.db.patch(args.deckId, { title, tagline, sections });
    return { title, tagline, sections };
  },
});

/** Toggle a deck's visibility in the public catalog (owner or admin only). */
export const publishDeck = mutation({
  args: { deckId: v.id("decks"), published: v.boolean() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Not signed in");
    const deck = await ctx.db.get(args.deckId);
    if (!deck) throw new Error("Not found");
    const isOwner = deck.ownerId === user._id;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) throw new Error("Not allowed");
    await ctx.db.patch(args.deckId, { published: args.published });
    return args.published;
  },
});

/** Public catalog — published decks, newest first, optional text search. */
export const listPublishedDecks = query({
  args: { query: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const q = (args.query ?? "").trim().toLowerCase();
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_published", (q) => q.eq("published", true))
      .order("desc")
      .collect();
    if (!q) return decks;
    return decks.filter((d) => {
      const haystack = `${d.title} ${d.tagline} ${d.projectName}`.toLowerCase();
      return q.split(/\s+/).every((term) => haystack.includes(term));
    });
  },
});
