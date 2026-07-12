# Pitch Black Price Guide — Early Prices From Japan
### Full video script — ready for narration pipeline

---

## HOOK (0:00–0:15)

Pitch Black doesn't release until July 17th — but we already know exactly
what these cards are worth. Japan's Abyss Eye set, which Pitch Black is
almost a 1-to-1 adaptation of, has been out since May 22nd. That means
real secondary market data already exists for nearly every chase card in
this set. Here's the complete price breakdown, straight from Japan,
before anyone else has English pricing to go on.

---

## CHAPTER 1: Set Overview (0:15–1:00)

Pitch Black is the fifth set in Pokemon's Mega Evolution block, headlined
by Mega Darkrai ex. It's a small set — 120 cards total, 84 in the main
set and 36 secret rares — making it one of the more concentrated chase
lists in recent memory. The English version adds three cards not in the
original Japanese release: Mega Delphox ex, Mega Slowbro ex, and Jett,
while cutting Zarude's Illustration Rare, which becomes the Elite
Trainer Box promo instead.

[ON-SCREEN: quick set stats card — 120 cards, 36 secret rares, July 17
release, headlined by Mega Darkrai ex]

---

## CHAPTER 2: Secret Rares (1:00–5:00)

*[This section uses the automated per-card narration pipeline —
build_card_ssml() — for each card below, in this order. Countdown
numbering applies: highest price first.]*

Cards to include (confirmed Secret Rares, 085–120):
- Mega Darkrai ex — Special Illustration Rare (114–119 range) — **the
  headline chase card of the set**
- Mega Darkrai ex — Hyper Rare (120) — the single rarest pull in Pitch Black
- Gwynn — Special Illustration Rare
- Mega Zeraora ex — Special Illustration Rare
- [Additional Illustration Rares / Ultra Rares as live data confirms
  pricing — pull the actual top N by price from your existing chase-card
  ranking logic rather than a fixed list, since JP secondary prices may
  surface a card here that isn't obvious from hype alone]

**Transition line into Chapter 3:**
"Those are the true secret rares — but a few cards outside that print
run are already outperforming expectations too."

---

## CHAPTER 3: Sleeper Picks (5:00–6:30)

*[This is the differentiated segment — the one no gameplay-focused
competitor video does, since it requires live price data to spot rather
than hype/popularity alone. Pull directly from cards where
price_change_pct is high but rarity_tier_rank is NOT top-tier — the
existing infer_reason_key() logic already flags exactly this pattern.]*

Sample framing line (per card, adapt via the "trend_up" reason template
already built into the pipeline):
"Here's one worth watching — [Card Name] isn't a secret rare, but it's
already trading well above what you'd expect for its rarity in Japan."

---

## CHAPTER 4: Closing / Price & Value Guide (6:30–7:15)

That's the full early price breakdown for Pitch Black, based on real
Japanese secondary market data from Abyss Eye. Keep in mind: prices
often shift once English pull rates and print runs are confirmed, so
treat these as a starting point, not a guarantee. If you want live,
constantly updating prices as Pitch Black actually releases on July
17th, the full price guide is linked below and updates automatically as
real English market data comes in. See you in the next one.

[ON-SCREEN + VOICEOVER: explicit call to the site link, since this is
the actual conversion point]

---

## Production notes

- **Total runtime target**: ~7 minutes — matches the "longer videos with
  strong retention rank better" finding, without padding
- **Hook must land in the first 8-10 seconds** — the current hook draft
  above front-loads the "already know the price" angle immediately,
  matching the retention research
- **Card list for Chapter 2/3 should be pulled live**, not hardcoded from
  this document — this script is the narrative skeleton; the actual
  per-card content should come from your real chase-card ranking data at
  render time, the same way the pipeline already works
- **Say "Pitch Black," "Japan"/"Japanese," and card names naturally and
  often** throughout — this is real indexed transcript content per the
  YouTube SEO research, not just flavor text
