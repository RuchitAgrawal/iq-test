# IQ Test — Implementation Plan

## 1. Purpose

A standalone, shareable "cognitive score" quiz that has no visible connection to The Last Question. It exists to be genuinely fun and shareable on its own, and to softly bridge high-intent players into TLQ after they've already gotten value from it. Success here is measured by two separate things: does the quiz spread on its own, and does it convert a meaningful percentage of finishers into TLQ visitors.

## 2. Product Scope (MVP)

- 15-20 question quiz, single session, no login required to play
- Mixed question types: pattern/sequence completion, odd-one-out, spatial rotation, word analogies, 2-3 short logic puzzles
- Difficulty ramps across the quiz so early questions are easy (keeps people in) and later ones are hard (makes the final score feel earned)
- Instant result screen at the end, no waiting, no email gate before seeing the score
- Result framed as "estimated cognitive score" or a percentile, not a clinical IQ number, to avoid pseudoscience claims and to make the result itself debatable (debate = shares)
- Auto-generated shareable result image sized for WhatsApp/Instagram story and generic social share
- Telegram bot as the primary distribution mechanic (WhatsApp is phase 2, see section 6)

## 3. Question Bank Design

- Build a pool of 60-80 questions across the categories above so repeat players don't see the exact same quiz twice
- Each question tagged with category and difficulty (1-5) so the quiz can be assembled algorithmically: pull a balanced mix, sort by ascending difficulty
- Store questions in a simple structured format (JSON) so new ones can be added without touching app code:

```json
{
  "id": "seq-014",
  "category": "sequence",
  "difficulty": 3,
  "prompt": "2, 6, 12, 20, 30, ?",
  "options": ["36", "40", "42", "44"],
  "answer": "42"
}
```

- Seed 2-3 questions with a light deduction/lie-detection flavor near the end of the quiz. These double as thematic seeding for the TLQ bridge later, without being an obvious ad.

## 4. Scoring Logic

- Each question has a difficulty weight (1-5). Score is a weighted sum of correct answers, normalized to a 0-100 scale or mapped to a percentile bucket
- Percentile buckets can be static bands to start (e.g. top 5%, top 15%, top 35%, average, below average) rather than a live-computed percentile against real user data, since you won't have enough volume to compute a meaningful live percentile on day one
- Once you have real completion data (a few thousand runs), recompute the bands from actual score distribution so the percentiles become genuine
- Do not label the output "IQ" anywhere in the primary UI copy. Use it only loosely in metadata/SEO if needed, keep the on-screen language softer.

## 5. Result Screen and Sharing

- Result card shows: score/percentile, a short "type" label (e.g. "Pattern Thinker", "Fast Analyzer") based on which category they scored strongest in, and a single share button
- Share button generates a pre-rendered image (server-side or canvas-rendered client-side) sized correctly for the target platform, not just a link with OG tags. People share images, not links.
- Below the result card, one soft CTA block linking to TLQ: "Scored well on logic? See if you can outsmart someone who's lying to your face." This is the only mention of TLQ anywhere on the site. No branding overlap, no logo, just a text/thumbnail card.

## 6. Telegram Bot (Primary Distribution)

- Bot commands: `/iqtest` starts a quiz session and returns a link to play, `/leaderboard` shows the group's top scores, `/rank` shows the player's own rank in the group
- When a user finishes the quiz (played via the web link, not inline in Telegram, since 15-20 MCQs are painful in a chat UI), the bot posts their result card back to the group automatically if they started the quiz from that group
- Group leaderboard persists over time in a lightweight database (group_id, user_id, best_score), giving a reason to return to the group and re-check standings
- Bot should work in any group it's added to without setup, zero friction to install

### WhatsApp (Phase 2)

- WhatsApp requires the Business API (via a provider like Twilio or Meta directly), which has approval lag and per-message cost, so this is not the launch channel
- Only build this once Telegram distribution proves the loop works (people actually add the bot to groups and it actually generates repeat plays). No point paying for WhatsApp infrastructure to test an unproven mechanic.

## 7. Technical Architecture

- **Frontend**: static site (single page), no framework overhead needed, quiz state can live entirely in client memory until submission
- **Backend**: lightweight API for (a) serving a randomized/balanced question set, (b) scoring and storing results, (c) Telegram bot webhook handling, (d) leaderboard queries
- **Database**: simple relational or key-value store is enough, no need for anything heavy at this stage. Tables: questions, results (session_id, score, category_breakdown, timestamp), telegram_groups, telegram_scores
- **Image generation**: server-side rendering of the share card (e.g. an HTML-to-image render step) keeps the output consistent across devices, rather than relying on client-side canvas which varies by browser
- **Hosting**: this is low-traffic-until-it-isn't, so pick something that scales without manual intervention (serverless functions or a small autoscaling setup) rather than a fixed server, since Reddit/Telegram spikes can be sudden

## 8. Build Phases

**Phase 1 — Core quiz (week 1-2)**
- Question bank (60-80 questions), quiz assembly logic, scoring, result screen, share image generation

**Phase 2 — Telegram bot (week 2-3)**
- Bot setup, group leaderboard, result posting back to group

**Phase 3 — TLQ bridge + polish (week 3)**
- CTA placement and copy testing, UTM tracking on the TLQ link, mobile polish, load testing for share-driven spikes

**Phase 4 — Launch (week 4)**
- Soft launch in a few Telegram groups you control or have access to, watch for bugs and drop-off points, then push wider

## 9. Metrics to Track

- Completion rate (started quiz vs finished quiz)
- Share rate (finished vs shared result)
- Telegram bot adds (groups) and repeat play rate within a group
- Click-through rate on the TLQ bridge CTA
- Actual conversion: TLQ click-throughs that result in a TLQ session start

## 10. Risks and Notes

- Avoid any language that implies a clinical or validated psychometric test, both for credibility and to avoid pushback from people who take IQ testing seriously
- Keep the TLQ CTA singular and soft. A quiz that feels like an ad funnel will get called out in comments/shares, which kills the exact virality you're relying on
- Watch bot spam concerns, some Telegram groups may flag or remove bots that post automatically, so give admins an easy way to disable auto-posting if needed
