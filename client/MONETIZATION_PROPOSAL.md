# Concord Native Mobile Monetization Proposal

**Status:** Draft 2026-04-08 · Task INS-021 / OPT-002 · For user review
**Scope:** Native mobile frontend apps (iOS + Android) ONLY. The browser-accessible web UI is the canonical free interface and stays free-forever, no ads, forever.
**Framing:** "A plea for donations." Not a paywall. Not a feature lockout. A cosmetic layer on top of a great free application — people who care will pay, people who don't, won't, and that's fine.

---

## Executive Summary

Concord's web UI is, and will remain, **free forever with no advertising and no feature restrictions**. Every message, every voice call, every video call, every file exchange, every place you can host, every server you can join — all of it works in any browser on any device without paying anything.

The native mobile apps (iOS and Android) are a **cosmetic convenience layer** on top of that free experience. They exist because some users prefer a native-feeling app over a PWA, and because distributing via the App Store and Play Store gives Concord a marketing surface we wouldn't otherwise have. They are NOT required to use Concord.

We propose monetizing ONLY the native mobile apps with two tiers:

1. **Free (ad-supported)** — full functional parity with the web UI, with unobtrusive banner/native ads. The default experience. Every feature works. No feature is gated behind the paid tier.
2. **Ad-free (one-time purchase)** — the same app minus ads. A small one-time price (~$2.99 USD, adjusted regionally). No subscription. Pay once, ad-free on that device family forever.

The **non-negotiable commitment** threaded through every section below: anyone can use Concord with zero ads and zero payments by opening it in a web browser. That is the canonical interface.

---

## 1. Ad Network Recommendation

### Options considered

| Option | Pros | Cons |
|---|---|---|
| **AdMob (Google)** | Largest fill rate, proven StoreKit/Play-Billing integration, low dev cost. | Heavy tracking, user-hostile defaults, privacy manifest burden, requires App Tracking Transparency prompt on iOS. Runs counter to Concord's decentralization/privacy story. |
| **Apple Search Ads + Google Ads** | First-party ecosystems, fewer third-party trackers. | Apple Search Ads is acquisition-side (ads *for* Concord in other apps), not what we want. Google Ads inside our app funnels back to AdMob anyway. |
| **EthicalAds / Carbon Ads** | No tracking, good fit for developer-adjacent audiences, simple integration. | Small inventory, low fill rate — likely can't sustain revenue on consumer chat apps. |
| **In-house ("Concord promotes Concord")** | Zero tracking, full control of content, reinforces product narrative. Promote Concord servers, upcoming features, community events. | Zero revenue from the ads themselves — they become a marketing surface, not a monetization surface. The ad-free tier still monetizes; ads become value-add for community-curated content. |
| **Mixed (house ads + minimal network fallback)** | Best of both — house ads fill first, tiny backfill from a privacy-respecting network. | Extra engineering; two code paths. |

### Recommendation

**Primary: In-house "house ads" system.** Every ad slot shows either:
- A Concord place to discover (curated or algorithmically surfaced from public places)
- A Concord feature announcement ("Try the new visual forum map")
- A community event ("Concord development livestream tonight")
- A blank slate explaining "this space supports Concord development — [remove ads for $2.99]"

**No tracking, no third-party SDKs, no ATT prompt.** Concord's narrative is privacy-respecting and decentralized; importing AdMob contradicts that in a user-visible way every time the app opens.

**Fallback (optional, phase 2):** If house ad inventory is insufficient, integrate **EthicalAds** as a backfill for the handful of impressions house ads can't fill. EthicalAds does not track users, collects no PII, and is already used by Python docs, Read the Docs, and similar privacy-conscious surfaces.

**Excluded:** AdMob. The user-tracking load, privacy manifest complications, ATT prompt friction, and narrative cost outweigh the revenue lift for a product whose entire value proposition is decentralized private comms.

---

## 2. Ad-Free Tier Model

### Options considered

| Option | Pros | Cons |
|---|---|---|
| **One-time purchase** | Simple, honest, "pay once forever" matches the donation framing. No recurring billing friction. | Smaller lifetime value per user. Store billing surcharge still applies. |
| **Subscription (monthly or annual)** | Higher lifetime value, recurring revenue. | Feels predatory for a cosmetic upgrade. Subscription fatigue. Apple + Google take 15-30% in perpetuity. Hostile to the donation framing. |
| **Freemium with IAP unlocks** | Unlock different cosmetic themes, custom chat colors, etc. | Turns into a treadmill of microtransactions. Every unlock is a decision the user has to relitigate. Not aligned with "donation plea" framing. |
| **Pay-what-you-want** | Honest donation model. | No App Store or Play Store mechanism for truly variable pricing — you'd have to ship 3-5 price point variants ($0.99, $2.99, $4.99, $9.99, $19.99) and label them as "tips." |

### Recommendation

**One-time purchase.** Single SKU: "Concord ad-free." Pay once, ad-free on that platform forever. Matches the donation framing ("pay once if you care, don't if you don't"), avoids subscription hostility, keeps the in-app purchase flow simple.

**Phase 2 addition (optional):** Add a "tip jar" with three or four higher-priced SKUs ($4.99, $9.99, $19.99, "Big fan" $49.99) that do NOTHING except display a tiny thank-you badge next to the user's name in a setting (opt-in display). These are pure donations — no feature, no status beyond the opt-in badge. Users who want to pay more than $2.99 can, and we make it explicit that this is a donation to Concord development, not a purchase.

**Excluded:**
- Subscription model (hostile to framing).
- Freemium unlocks (treadmill, decision fatigue).
- Pay-what-you-want at store-billing level (infeasible).

---

## 3. Price Points Per Platform

### iOS (App Store)

- **Concord ad-free:** **USD $2.99** (Tier 3 in Apple's pricing matrix — corresponds to $2.99 in the US, with Apple's regional equivalents applied automatically).
- **Tip jar (phase 2):** $4.99, $9.99, $19.99, $49.99 ("Big fan").
- **App itself (free download):** $0.00. The ad-supported experience is the default.

### Android (Google Play)

- **Concord ad-free:** **USD $2.99** equivalent (Google Play's Localized Pricing applies regional adjustments automatically). In practice this will be ~$2.99 USD / €2.99 EUR / ¥320 JPY / ₹99 INR etc.
- **Tip jar (phase 2):** same as iOS tiers.
- **App itself (free download):** $0.00.

### Rationale for $2.99

- Below the psychological "not worth thinking about" threshold for most users in major markets.
- Below Apple's Tier 2 ($1.99) floor where the 30% cut eats most of the revenue anyway — Tier 3 leaves ~$2.09 after Apple's cut, which is enough to meaningfully fund development.
- High enough that it doesn't feel like a trivial in-app purchase that gets lost in transaction history.
- Matches the "small donation" framing — more than a coffee, less than a beer.

### Excluded

- Higher tiers ($4.99, $9.99) as the default — feels expensive for a cosmetic upgrade to an app that's also free in the browser.
- Lower tiers ($0.99) — most of the revenue goes to Apple/Google, and it signals "disposable" rather than "support."

---

## 4. Regional Pricing

**Strategy:** Rely on the store platforms' automatic localized pricing.

- **Apple App Store Connect** handles regional pricing via [Apple's pricing matrix](https://developer.apple.com/app-store/pricing/). Pick Tier 3 in USD and Apple computes equivalents for 175 regions automatically, including currency, local tax, and "ends in .99" psychological rounding.
- **Google Play Console** uses [Localized Pricing](https://support.google.com/googleplay/android-developer/answer/138000) the same way — set USD and Play computes regional prices.

**Override list (manual adjustments for affordability):**

- **India (INR):** override to ~₹49 (≈USD $0.60) instead of the default ~₹249. India is both a huge market AND a price-sensitive market; a default conversion from $2.99 is ~$2.99 worth of INR which is substantial relative to local purchasing power. A lower price-point here is consistent with the "donation plea" framing and not losing revenue (users at the default price would mostly skip).
- **Brazil (BRL):** override to ~R$4.99 (≈USD $1) for similar reasons.
- **Southeast Asia (IDR / PHP / VND):** similar 50-65% discounts off the default localization.

**Compliance:** Regional VAT/GST is handled by the store platforms on our behalf — we receive net proceeds.

---

## 5. Refund Policy

**Policy statement (shown at point of purchase):**

> Concord is free to use in your browser at any time. The ad-free tier is a donation to Concord development — if you change your mind, request a refund through your device's app store within the standard store window (Apple: 90 days at Apple's discretion; Google: 48 hours self-service, beyond that case-by-case).
>
> We will not contest a refund request. If you requested ad-free but decided it wasn't worth it to you, that's fine. Concord still works, in your browser, free, forever.

**Why no-contest:** The transaction is framed as a donation. Contesting a refund request on a donation is hostile and undermines the framing. Accepting refunds is the cost of running on an honest model.

**Abuse guardrails:** None. At $2.99 per transaction, abuse is not material. If someone systematically buys and refunds to get ad-free, we lose $0 per cycle and they end up... running the app in the browser for free, which is already what we're offering.

---

## 6. Store Listing Strategy (App Store + Play Store)

### Common to both stores

- **App name:** "Concord — Decentralized Chat"
- **Short description:** "Private, decentralized group chat. Free forever in your browser. Native apps available."
- **Long description lead paragraph:** "Concord is a decentralized, privacy-respecting group chat platform. Every feature — messaging, voice, video, file sharing, servers, rooms, forums — works for free in any web browser, forever. The iOS / Android app is a convenient native version of that same experience. Ads in the free version help fund development; if you'd rather support us directly, the ad-free tier is a small one-time purchase."
- **Privacy manifest (iOS) / Data Safety form (Android):** declare ZERO data collection. House ads do not track users. No advertising ID use. No analytics SDKs beyond the ones required for crash reporting (and even those should be opt-in — see "Crash reporting" below).
- **Content rating:** Teen / 13+ (consistent with most social/communication apps; user-generated content requires content moderation tools, which Concord already has).
- **Age gate:** 13+ on both stores. COPPA compliance means under-13 accounts are not permitted. The registration flow should include an age self-declaration and the privacy policy should state the 13+ minimum.

### iOS App Store specifics

- **Screenshots:** 6 screenshots. Show the free web version + native iOS app side-by-side with a caption "Same Concord, free in your browser or native on iOS."
- **App preview (video):** 15-second loop showing a voice call → map view → chat, with captioning "Decentralized. Free. Yours."
- **Keywords:** "decentralized chat, privacy, voice chat, video chat, group chat, forum, mesh, peer to peer, free messenger."
- **Privacy label:** "Data Not Collected" across all categories. The house ad system does not collect data; contacts and messages never leave the decentralized network.
- **App Review specifics:** the app requests Camera, Microphone, Local Network, and Bluetooth permissions with usage strings explaining each. Be explicit in the reviewer notes that Local Network + Bluetooth are required for the mesh-transport pathway (MPC on iOS) and are used only for peer-to-peer node discovery, not for tracking.

### Google Play Store specifics

- **Screenshots:** 8 screenshots (Play allows more). Same side-by-side framing.
- **Feature graphic:** Concord logo + tagline "Decentralized. Free. Yours."
- **Data Safety form:** declare no data collection, no data shared with third parties. House ads declared as "first-party ads, no tracking."
- **Target API level:** Android API 35 (Android 15) or latest required by Play Console at submission time.
- **Permissions:** Microphone, Camera, Local Network, Bluetooth, Foreground Service (for embedded servitude running in background per INS-022). Foreground service type: `mediaPlayback | microphone` (conservative choice — lets voice calls run in the background without triggering the "always-on background service" policy hammer).

---

## 7. In-App Purchase Integration

### iOS: StoreKit 2

- **Tauri v2 StoreKit plugin:** Tauri v2 has a first-class [StoreKit plugin](https://v2.tauri.app/plugin/store) (or we write a thin Objective-C bridge via Tauri's mobile plugin API).
- **Product configuration:** one non-consumable in-app purchase, ID `com.concord.ads_free`. Price tier 3.
- **Purchase flow:** user taps "Remove ads" → StoreKit modal → confirmation → local receipt validation → persistent "ad-free" flag written to `localStorage` AND synced to the Matrix account's user profile (so the user is ad-free on any future install signed in with the same account, not just this device).
- **Restore purchases:** mandatory button in settings per Apple guidelines — calls `Transaction.currentEntitlements` and re-applies the ad-free flag.
- **Receipt validation:** client-side via `VerificationResult.verify()` — no server-side validation required for a non-consumable at this price point. A server-side check is added to phase 2 if fraud becomes a concern.

### Android: Google Play Billing Library

- **Tauri v2 Play Billing plugin:** similar approach — use the Tauri plugin or a thin Kotlin bridge.
- **Product configuration:** one [inapp product](https://developer.android.com/google/play/billing/integrate), SKU `com.concord.ads_free`. $2.99 USD base.
- **Purchase flow:** `BillingClient.launchBillingFlow()` → onPurchaseUpdated callback → acknowledge the purchase → persist `ad-free` flag locally and sync to the Matrix profile.
- **Acknowledgment:** REQUIRED within 3 days or Play refunds automatically. Handled in the purchase callback.
- **Restore:** `queryPurchasesAsync()` on app launch to detect existing entitlements — Play keeps a server-side record so "restore" is automatic, no explicit user action needed.

### Cross-platform state sync

The "ad-free" flag is synced via a custom Matrix account data field (`com.concord.ad_free` under the user's account data). This means:
- Buying ad-free on iOS ALSO removes ads on the web UI (if the web UI has ads — currently it has none, so this is a no-op today).
- Signing into the same Matrix account on Android after buying ad-free on iOS will restore ad-free automatically (cross-platform restore).
- If the user buys ad-free on BOTH iOS and Android, that's fine — they paid twice, we keep both receipts, and they're ad-free on both platforms. No refund triggered automatically.

### Implementation order

1. **Phase 0 (current):** no ads, no purchases. Native apps launch with nothing monetized.
2. **Phase 1 (INS-021 implementation):** house ads rendered in-app on mobile only. No purchase flow yet. Gather data on how intrusive the house ads feel.
3. **Phase 2:** purchase flow lands. "Remove ads" button appears. Ad-free unlock works on both platforms.
4. **Phase 3 (optional):** tip jar SKUs added.
5. **Phase 4 (optional):** EthicalAds backfill if house ads can't sustain inventory.

---

## Appendix A — Commitments We Will NOT Break

1. **The web UI has no ads. Ever.** Not "no ads until we change our mind" — no ads, forever. If a future stakeholder argues for web ads, the answer is no. The web UI is the canonical free interface and its freeness is what lets us honestly frame the native ads as "optional support."
2. **No feature gating behind payment.** Every feature in the native app is also in the web app, and every feature in both is free. The ad-free tier removes ads. Nothing else.
3. **No data collection by the ad system.** House ads are first-party. If we ever add a backfill network it will be a privacy-respecting one (EthicalAds) and the Data Safety declaration will remain "no data collected."
4. **Refunds are honored, no questions asked.** Donation framing means we do not contest refund requests.
5. **Concord remains open-source on the free tier.** The web UI's code is the canonical Concord codebase. Making the native apps paid does not close-source Concord.

## Appendix B — Open Questions for User Review

1. **House ad content curation:** who curates the list of "Concord places to discover" that house ads rotate through? Automated by a trending algorithm? Hand-picked? Community voted? This matters for how the feature is built.
2. **Tip jar opt-in:** should the tip jar launch with phase 2, or strictly defer to phase 3? Feels like a phase 3 feature — but a small "Support Concord" button in settings could land earlier.
3. **Crash reporting:** Sentry is opt-in but requires an SDK. Is the user OK with an opt-in Sentry integration, or should we rely purely on user bug reports (BugReportModal)?
4. **Cross-platform restore UX:** if a user buys ad-free on iOS then installs on Android with the same Matrix account, should the restore be automatic (no dialog) or opt-in (dialog: "We noticed you bought ad-free on another device — restore?")? Automatic is less friction; opt-in is more transparent.
5. **Ad placement:** where in the app do house ads appear? Candidates: (a) a banner at the top of the chat list, (b) a native card between every N messages in the message list, (c) a full-screen interstitial after certain actions (aggressive, not recommended), (d) a settings-tab promotion (passive, easy to ignore). Recommendation: (a) + (b) with (b) tuned conservatively (every 50 messages, not every 5).
6. **Promotion of ad-free in the ad rotation itself:** when house ad inventory is low, one of the "ads" is a friendly prompt to buy ad-free. Should this appear always (at a low rate) or only when inventory is empty? Recommendation: always, at ~5% rotation rate, so users see the upgrade path even when house inventory is healthy.

---

## Appendix C — Cross-References

- **Scope retag:** Concord retagged `public` → `commercial` on 2026-04-08 (see PLAN.md Open Conflicts). This proposal is the commercial-scope work.
- **v3 Scope Boundary:** this proposal is the narrow exception to the v3 commerce deferral — native mobile apps only, web UI stays free-forever.
- **INS-020 (OPT-001):** native mobile frontend apps. This proposal depends on INS-020 shipping — no native app, no ad surface.
- **Apple Developer Program:** user enrolled 2026-04-07, awaiting ID verification. Proceed as if active.
- **PLAN.md "From 2026-04-22 Routing — Resolved" items 1, 2, 3, 7** are the resolutions this proposal implements.

---

*Proposal draft — awaiting user decision on Appendix B open questions.*
