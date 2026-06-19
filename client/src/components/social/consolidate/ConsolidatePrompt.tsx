/**
 * Component home: **multi-device-consolidation** (OWNED by the consolidation
 * branch).
 *
 * Merge-prompt UX surfaced when multiple devices claim the same owner. The
 * consolidation branch owns everything under
 * `client/src/components/social/consolidate/`. Base branch ships this
 * placeholder so the directory + import path exist and the build compiles.
 */
import { socialConsolidatePending } from "../../../api/social/consolidate";

export function ConsolidatePrompt() {
  void socialConsolidatePending;
  return null;
}
